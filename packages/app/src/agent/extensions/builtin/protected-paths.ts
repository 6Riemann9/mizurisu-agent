import type { ExtensionRuntimeContext, MizurisuExtension } from "../types";

const WRITE_OR_DELETE_TOOLS = new Set([
  "write_text_file",
  "edit_text_file",
  "delete_file",
  "excel_create",
  "excel_update",
  "word_create",
  "word_update",
  "ppt_create",
  "ppt_update",
  "slides_create",
  "slides_update_slide",
  "pdf_create",
  "pdf_merge",
  "pdf_split",
  "pdf_watermark",
  "markdown_export",
]);

function normalizePathPattern(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").trim();
}

export function matchesProtectedPath(targetPath: string, patterns: string[] = []): boolean {
  const cleanTarget = normalizePathPattern(targetPath);
  if (!cleanTarget || patterns.length === 0) return false;

  for (const rawPattern of patterns) {
    const cleanPat = normalizePathPattern(rawPattern);
    if (!cleanPat) continue;
    if (cleanPat === cleanTarget) return true;

    if (cleanPat.includes("*")) {
      const escaped = cleanPat
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*");
      const regex = new RegExp(`^${escaped}$`, "i");
      if (regex.test(cleanTarget)) return true;
    }
  }
  return false;
}

export function extractTargetPathsFromArgs(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];
  const out: string[] = [];
  for (const key of ["path", "outputPath"] as const) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) {
      out.push(v.trim());
    }
  }
  return out;
}

export const protectedPathsExtension: MizurisuExtension = {
  id: "pi-protected-paths",
  name: "重要原件只读保护 (Protected Paths)",
  description: "为重要合同或财报原件加锁保护，AI 尝试覆盖修改或删除前自动拦截并请求二次确认。",
  category: "safety",
  defaultEnabled: true,
  register(api) {
    api.onBeforeToolCall(async ({ toolCall, args }, runtimeCtx: ExtensionRuntimeContext, signal) => {
      if (!WRITE_OR_DELETE_TOOLS.has(toolCall.name)) {
        return undefined;
      }
      const protectedPatterns = runtimeCtx.settings.protectedPaths || [];
      if (protectedPatterns.length === 0) return undefined;

      const targets = extractTargetPathsFromArgs(args as Record<string, unknown> | undefined);
      const hit = targets.find((t) => matchesProtectedPath(t, protectedPatterns));
      if (!hit) return undefined;

      if (!runtimeCtx.requestApproval) {
        return {
          block: true,
          reason: `文件「${hit}」已被设为只读保护原件，禁止直接覆盖或删除；请另存为新文件名再修改。`,
        };
      }

      const approved = await new Promise<boolean>((resolve) => {
        let settled = false;
        const cleanup = () => {
          signal?.removeEventListener("abort", onAbort);
        };
        const safeResolve = (value: boolean) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };
        const onAbort = () => {
          runtimeCtx.cancelApproval?.(toolCall.id);
          safeResolve(false);
        };

        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) {
          onAbort();
          return;
        }

        runtimeCtx.requestApproval?.({
          id: toolCall.id,
          sessionId: runtimeCtx.sessionId,
          toolName: toolCall.name,
          title: "受保护文件修改确认",
          description: `文件「${hit}」已被锁定保护。是否允许 ${toolCall.name} 修改或删除它？（建议优先拒绝并让 Agent 另存副本）`,
          argsPreview: JSON.stringify(args, null, 2),
          resolve: safeResolve,
        });
      });

      if (!approved || signal?.aborted) {
        return {
          block: true,
          reason: `用户拒绝覆盖受保护原件「${hit}」，请改用新文件名（如加上 _修改版 后缀）保存副本。`,
        };
      }
      return undefined;
    });
  },
};
