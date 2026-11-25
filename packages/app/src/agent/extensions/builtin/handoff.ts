import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, obj, opt, str } from "@earendil-works/pi-schema";
import type { ChatSession, HandoffPayload, TodoItem } from "../../../types";
import type { ExtensionRuntimeContext, MizurisuExtension } from "../types";

const handoffParams = obj({
  title: str({ description: "交接后的新会话标题" }),
  summary: str({ description: "截至目前的进展总结" }),
  keyDecisions: opt(arr(str(), { description: "已拍板的关键口径、约束与设计决策" })),
  relevantFiles: opt(arr(str(), { description: "工作区中关联或已产出的文件路径" })),
  nextSteps: arr(str(), {
    description: "新会话接力后应立刻推进的下一步事项",
  }),
});

export function buildHandoffPrompt(payload: Omit<HandoffPayload, "promptDraft">): string {
  const parts: string[] = [
    `# 上下文交接摘要：${payload.title}`,
    "",
    "## 一、当前进展",
    payload.summary.trim() || "（延续上一轮工作台任务）",
  ];

  if (payload.keyDecisions.length > 0) {
    parts.push("", "## 二、已确定决策与口径");
    for (const d of payload.keyDecisions) {
      parts.push(`- ${d}`);
    }
  }

  if (payload.relevantFiles.length > 0) {
    parts.push("", "## 三、关联工作区文件");
    for (const f of payload.relevantFiles) {
      parts.push(`- \`${f}\``);
    }
  }

  if (payload.nextSteps.length > 0) {
    parts.push("", "## 四、下一步待办");
    payload.nextSteps.forEach((step, idx) => {
      parts.push(`${idx + 1}. ${step}`);
    });
  }

  parts.push("", "请基于以上交接上下文与工作区文件继续推进。");
  return parts.join("\n");
}

/** 从现有会话历史自动提炼结构化 Handoff 载荷（供 UI 一键接力新会话调用） */
export function buildHandoffFromSession(
  session: ChatSession | undefined,
  todos: TodoItem[] = []
): HandoffPayload {
  const title = session?.title ? `${session.title} · 接力` : "接力新会话";
  const messages = session?.messages || [];

  const fileSet = new Set<string>();
  const decisions: string[] = [];

  for (const m of messages) {
    for (const att of m.attachments || []) {
      fileSet.add(att.path);
    }
    for (const tc of m.toolCalls || []) {
      if (tc.modifiedPath) fileSet.add(tc.modifiedPath);
      if (tc.args && typeof tc.args.path === "string") {
        fileSet.add(tc.args.path);
      }
    }
    if (m.role === "user" && m.content.trim()) {
      decisions.push(`用户需求：${m.content.trim().slice(0, 120)}`);
    }
  }

  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content.trim());

  const summary = lastAssistant
    ? lastAssistant.content.trim().slice(0, 600)
    : messages.length > 0
      ? `已完成 ${messages.length} 条对话轮次，相关产出保存在工作区中。`
      : "全新接力会话。";

  const pendingTodos = todos
    .filter((t) => t.status === "pending" || t.status === "in_progress")
    .map((t) => t.content);

  const nextSteps =
    pendingTodos.length > 0 ? pendingTodos : ["继续审查并完善工作区已产出文档"];

  const base = {
    title,
    summary,
    keyDecisions: decisions.slice(-4),
    relevantFiles: [...fileSet].slice(0, 12),
    nextSteps,
  };

  return {
    ...base,
    promptDraft: buildHandoffPrompt(base),
  };
}

export const handoffExtension: MizurisuExtension = {
  id: "pi-handoff",
  name: "长对话接力 (Handoff)",
  description: "对话过长时提炼核心结论、已产文件与剩余待办，一键无损开启专注新会话。",
  category: "workflow",
  defaultEnabled: true,
  register(api, runtimeCtx?: ExtensionRuntimeContext) {
    if (runtimeCtx && runtimeCtx.subagentDepth > 0) {
      return;
    }

    const handoffTool: AgentTool<typeof handoffParams> = {
      name: "session_handoff",
      label: "生成交接摘要并开启新会话",
      description:
        "当当前对话轮次过长或上下文接近上限时，提炼关键决策、已产文件与下一步待办，为用户开启干净的接力新会话。",
      parameters: handoffParams,
      execute: async (_id, params) => {
        const base = {
          title: params.title.trim() || "接力新会话",
          summary: params.summary.trim(),
          keyDecisions: params.keyDecisions || [],
          relevantFiles: params.relevantFiles || [],
          nextSteps: params.nextSteps || [],
        };
        const payload: HandoffPayload = {
          ...base,
          promptDraft: buildHandoffPrompt(base),
        };
        await runtimeCtx?.onHandoff?.(payload);
        return {
          content: [
            {
              type: "text",
              text: `已创建接力新会话草稿「${payload.title}」，关联 ${payload.relevantFiles.length} 个工作区文件。`,
            },
          ],
          details: { handoffTitle: payload.title },
          terminate: true,
        };
      },
    };

    api.registerTool(handoffTool);
  },
};
