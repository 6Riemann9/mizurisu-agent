import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { int, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import {
  parseSlidesHtmlDocument,
  readExcelSheet,
  readPdfDocument,
  readPptDocument,
  readWordDocument,
} from "../../../office";
import { kvGet, kvSet } from "../../../storage/db";
import type { WorkspaceVFS } from "../../../storage/workspace-vfs";
import type { WorkspaceFileMeta } from "../../../types";
import type { ExtensionRuntimeContext, MizurisuExtension } from "../types";

const GLOBAL_MEMORY_KV_KEY = "global_memory_md";
const MAX_MEMORY_CHARS = 8000;
const MAX_INJECT_CHARS = 2000;
const MAX_SEARCH_FILE_BYTES = 10 * 1024 * 1024;

export function getWorkspaceMemoryKey(vfs?: WorkspaceVFS): string {
  const wsId =
    vfs && typeof (vfs as unknown as { getActiveWorkspaceId?: () => string }).getActiveWorkspaceId === "function"
      ? (vfs as unknown as { getActiveWorkspaceId: () => string }).getActiveWorkspaceId()
      : "default";
  return wsId === "default" ? "workspace_memory_md" : `workspace_memory_md:${wsId}`;
}

export async function readMemoryScopes(
  vfs?: WorkspaceVFS,
  scope: "global" | "workspace" | "both" = "both"
): Promise<{ globalMemory: string; workspaceMemory: string }> {
  const [globalMemory, workspaceMemory] = await Promise.all([
    scope === "workspace" ? Promise.resolve("") : kvGet<string>(GLOBAL_MEMORY_KV_KEY).then((v) => v || ""),
    scope === "global" ? Promise.resolve("") : kvGet<string>(getWorkspaceMemoryKey(vfs)).then((v) => v || ""),
  ]);
  return {
    globalMemory: globalMemory.trim(),
    workspaceMemory: workspaceMemory.trim(),
  };
}

export async function writeMemoryScope(
  vfs: WorkspaceVFS | undefined,
  scope: "global" | "workspace",
  content: string,
  mode: "append" | "replace" = "append"
): Promise<string> {
  const key = scope === "global" ? GLOBAL_MEMORY_KV_KEY : getWorkspaceMemoryKey(vfs);
  const incoming = content.trim();
  if (!incoming) {
    throw new Error("记忆内容不能为空");
  }

  let next = incoming;
  if (mode === "append") {
    const prev = ((await kvGet<string>(key)) || "").trim();
    next = prev ? `${prev}\n- ${incoming.replace(/^-+\s*/, "")}` : `- ${incoming.replace(/^-+\s*/, "")}`;
  }

  if (next.length > MAX_MEMORY_CHARS) {
    next = next.slice(next.length - MAX_MEMORY_CHARS);
  }
  await kvSet(key, next);
  return next;
}

async function extractSearchableText(
  vfs: WorkspaceVFS,
  meta: WorkspaceFileMeta
): Promise<string> {
  if (meta.size > MAX_SEARCH_FILE_BYTES) return "";
  if (meta.category === "binary" || meta.category === "image") return "";

  if (meta.category === "markdown" || meta.category === "code" || meta.category === "text") {
    return await vfs.readText(meta.path);
  }

  if (meta.category === "slides") {
    const html = await vfs.readText(meta.path);
    const deck = parseSlidesHtmlDocument(html);
    return deck.slides
      .map((s, i) => `[Slide ${i + 1}] ${s.title}\n${s.html.replace(/<[^>]+>/g, " ")}\n${s.notes || ""}`)
      .join("\n");
  }

  const bytes = await vfs.readBytes(meta.path);
  if (meta.category === "word") {
    const res = await readWordDocument(bytes);
    return res.text;
  }
  if (meta.category === "ppt") {
    const res = await readPptDocument(bytes);
    return res.slides
      .map((s) => `[Slide ${s.index}] ${s.title} ${s.texts.join(" ")} ${s.notes}`)
      .join("\n");
  }
  if (meta.category === "pdf") {
    const res = await readPdfDocument(bytes, { startPage: 1, endPage: 30 });
    return res.pages.map((p) => `[Page ${p.pageNumber}] ${p.text}`).join("\n");
  }
  if (meta.category === "excel") {
    const res = await readExcelSheet(bytes, { filename: meta.path, startRow: 1, maxRows: 250 });
    return res.rows
      .map((row, idx) => `[Row ${idx + 1}] ${row.map((c) => c.value ?? "").join(" | ")}`)
      .join("\n");
  }

  return "";
}

export interface WorkspaceSearchHit {
  path: string;
  category: string;
  matches: Array<{ line: number; snippet: string }>;
}

export async function searchWorkspaceFiles(
  vfs: WorkspaceVFS,
  query: string,
  maxResults = 15
): Promise<WorkspaceSearchHit[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    throw new Error("检索关键词不能为空");
  }
  const tokens = cleanQuery
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const files = await vfs.listFiles();
  const hits: WorkspaceSearchHit[] = [];

  for (const meta of files) {
    if (hits.length >= maxResults) break;
    let text = "";
    try {
      text = await extractSearchableText(vfs, meta);
    } catch {
      continue;
    }
    if (!text) continue;

    const lines = text.split(/\r?\n/);
    const matchedLines: Array<{ line: number; snippet: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const lower = line.toLowerCase();
      if (lower.includes(cleanQuery.toLowerCase()) || tokens.every((tk) => lower.includes(tk))) {
        matchedLines.push({
          line: i + 1,
          snippet: line.length > 180 ? `${line.slice(0, 180)}...` : line,
        });
        if (matchedLines.length >= 4) break;
      }
    }

    if (matchedLines.length > 0) {
      hits.push({
        path: meta.path,
        category: meta.category,
        matches: matchedLines,
      });
    }
  }

  return hits;
}

const memoryReadParams = obj({
  scope: opt(
    oneOf(["both", "global", "workspace"] as const, {
      description: "读取范围：both=全局+当前工作区，global=全局偏好，workspace=当前工作区",
    })
  ),
});

const memorySaveParams = obj({
  scope: oneOf(["workspace", "global"] as const, {
    description: "global=跨工作区长期偏好（公司名/排版规范）；workspace=当前项目专属记忆",
  }),
  mode: opt(
    oneOf(["append", "replace"] as const, {
      description: "append=追加条目（默认）；replace=整份覆盖更新",
    })
  ),
  content: str({ description: "要记住的事实、客户口径或历史决策要点" }),
});

const searchWorkspaceParams = obj({
  query: str({ description: "检索关键词（支持多词空格组合匹配）" }),
  maxResults: opt(int({ description: "最多返回文件数，默认 15", minimum: 1, maximum: 50 })),
});

export const memoryExtension: MizurisuExtension = {
  id: "pi-gl-mem",
  name: "长期记忆与跨文档检索 (Memory & Search)",
  description: "维护全局与工作区 MEMORY.md 长期记忆，并提供跨 Word/Excel/PPT/PDF/Markdown 全文检索。",
  category: "knowledge",
  defaultEnabled: true,
  register(api, runtimeCtx?: ExtensionRuntimeContext) {
    const memoryReadTool: AgentTool<typeof memoryReadParams> = {
      name: "memory_read",
      label: "读取长期记忆",
      description: "读取已保存的全局办公偏好与当前工作区 MEMORY 记忆。",
      parameters: memoryReadParams,
      execute: async (_id, params) => {
        const res = await readMemoryScopes(runtimeCtx?.vfs, params.scope ?? "both");
        const blocks: string[] = [];
        if (res.globalMemory) blocks.push(`## 全局长期记忆\n${res.globalMemory}`);
        if (res.workspaceMemory) blocks.push(`## 当前工作区记忆\n${res.workspaceMemory}`);
        return {
          content: [
            {
              type: "text",
              text: blocks.length > 0 ? blocks.join("\n\n") : "当前暂无已保存的长期记忆。",
            },
          ],
          details: res,
        };
      },
    };

    const memorySaveTool: AgentTool<typeof memorySaveParams> = {
      name: "memory_save",
      label: "写入长期记忆",
      description:
        "保存用户长期办公偏好、企业口径、模板规范或项目关键结论到 MEMORY，跨会话永久记住。",
      parameters: memorySaveParams,
      execute: async (_id, params) => {
        const saved = await writeMemoryScope(
          runtimeCtx?.vfs,
          params.scope,
          params.content,
          params.mode ?? "append"
        );
        return {
          content: [
            {
              type: "text",
              text: `已写入${params.scope === "global" ? "全局" : "工作区"}记忆（当前共 ${saved.length} 字）。`,
            },
          ],
          details: { scope: params.scope, length: saved.length },
        };
      },
    };

    const searchWorkspaceTool: AgentTool<typeof searchWorkspaceParams> = {
      name: "search_workspace",
      label: "跨文档全文检索",
      description:
        "在当前工作区所有 Word / Excel / PPT / PDF / Slides / Markdown 文件中并行搜索关键词，快速定位目标文档与页/行片段。",
      parameters: searchWorkspaceParams,
      execute: async (_id, params) => {
        if (!runtimeCtx?.vfs) {
          throw new Error("未绑定工作区 VFS");
        }
        const hits = await searchWorkspaceFiles(
          runtimeCtx.vfs,
          params.query,
          params.maxResults ?? 15
        );
        if (hits.length === 0) {
          return {
            content: [{ type: "text", text: `未在工作区文档中检索到「${params.query}」。` }],
            details: { hitCount: 0 },
          };
        }
        const summary = hits
          .map(
            (h) =>
              `### ${h.path} (${h.category})\n` +
              h.matches.map((m) => `- [L${m.line}] ${m.snippet}`).join("\n")
          )
          .join("\n\n");
        return {
          content: [{ type: "text", text: `命中 ${hits.length} 份工作区文档：\n\n${summary}` }],
          details: { hitCount: hits.length, paths: hits.map((h) => h.path) },
        };
      },
    };

    api.registerTool(memoryReadTool);
    api.registerTool(memorySaveTool);
    api.registerTool(searchWorkspaceTool);
    api.injectSystemPrompt(
      "- 工作区文件较多时先调用 `search_workspace` 精准定位后再读取全文；当用户明确交代长期偏好（如品牌色、汇报口径）时调用 `memory_save` 持久化。"
    );

    api.onTransformContext(async (messages, ctx): Promise<AgentMessage[]> => {
      const { globalMemory, workspaceMemory } = await readMemoryScopes(ctx.vfs, "both");
      const joined = [
        globalMemory ? `[全局长期记忆]\n${globalMemory}` : "",
        workspaceMemory ? `[工作区记忆]\n${workspaceMemory}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      if (!joined) return messages;
      const alreadyInjected = messages.some((m) => {
        if (m.role !== "user") return false;
        const txt = typeof m.content === "string" ? m.content : "";
        return txt.includes("[长期记忆 MEMORY]");
      });
      if (alreadyInjected) return messages;

      const clipped =
        joined.length > MAX_INJECT_CHARS ? `${joined.slice(0, MAX_INJECT_CHARS)}\n...(已截断)` : joined;

      return [
        {
          role: "user",
          content: `[长期记忆 MEMORY] 以下为用户跨会话长期偏好与项目背景，请遵循：\n${clipped}`,
          timestamp: Date.now(),
        },
        ...messages,
      ];
    });
  },
};
