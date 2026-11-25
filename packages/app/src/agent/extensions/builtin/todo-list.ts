import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { arr, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import type { TodoItem } from "../../../types";
import type { ExtensionRuntimeContext, MizurisuExtension } from "../types";

const todoWriteParams = obj({
  mode: opt(
    oneOf(["replace", "upsert"] as const, {
      description: "replace=整表替换进度；upsert=按 id 增量更新/追加，默认 replace",
    })
  ),
  todos: arr(
    obj({
      id: str({ description: "唯一任务 ID，如 step-1" }),
      content: str({ description: "任务内容描述" }),
      status: oneOf(["pending", "in_progress", "completed", "cancelled"] as const),
      priority: opt(oneOf(["high", "medium", "low"] as const)),
    }),
    { description: "任务清单条目数组" }
  ),
});

const todoReadParams = obj({});

export function mergeTodos(
  existing: TodoItem[],
  incoming: Array<{
    id: string;
    content: string;
    status: TodoItem["status"];
    priority?: TodoItem["priority"];
  }>,
  mode: "replace" | "upsert" = "replace"
): TodoItem[] {
  const now = Date.now();
  if (mode === "replace") {
    return incoming.map((item) => ({
      id: item.id.trim() || `todo_${Math.random().toString(36).slice(2, 7)}`,
      content: item.content.trim(),
      status: item.status,
      ...(item.priority ? { priority: item.priority } : {}),
      updatedAt: now,
    }));
  }

  const map = new Map<string, TodoItem>(existing.map((t) => [t.id, t]));
  for (const item of incoming) {
    const id = item.id.trim() || `todo_${Math.random().toString(36).slice(2, 7)}`;
    map.set(id, {
      id,
      content: item.content.trim(),
      status: item.status,
      ...(item.priority ? { priority: item.priority } : {}),
      updatedAt: now,
    });
  }
  return [...map.values()];
}

export function formatTodoSummaryForContext(todos: TodoItem[]): string {
  if (!todos || todos.length === 0) return "";
  const active = todos.filter((t) => t.status !== "cancelled");
  if (active.length === 0) return "";
  const completedCount = active.filter((t) => t.status === "completed").length;
  const lines = active.map((t) => {
    const mark =
      t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]";
    return `- ${mark} (${t.id}) ${t.content}`;
  });
  return `[当前任务清单进度：已完成 ${completedCount}/${active.length}]\n${lines.join("\n")}`;
}

export const todoListExtension: MizurisuExtension = {
  id: "pi-todo-list",
  name: "任务进度板 (Todo List)",
  description: "为多步复杂任务维护持久化进度清单，即使上下文裁剪也不会遗漏后续交付步骤。",
  category: "workflow",
  defaultEnabled: true,
  register(api, runtimeCtx?: ExtensionRuntimeContext) {
    const todoWriteTool: AgentTool<typeof todoWriteParams> = {
      name: "todo_write",
      label: "更新任务进度清单",
      description:
        "创建或更新当前会话的多步任务进度清单（支持 replace 全量覆盖与 upsert 增量更新），UI 会实时展示并在上下文压缩时自动保活。",
      parameters: todoWriteParams,
      execute: async (_id, params) => {
        if (!runtimeCtx) {
          throw new Error("未绑定运行时上下文");
        }
        const next = mergeTodos(
          runtimeCtx.todos,
          params.todos,
          params.mode === "upsert" ? "upsert" : "replace"
        );
        runtimeCtx.todos = next;
        runtimeCtx.updateTodos(next);

        const done = next.filter((t) => t.status === "completed").length;
        return {
          content: [
            {
              type: "text",
              text: `已更新任务进度清单（${done}/${next.length} 已完成）。\n${formatTodoSummaryForContext(next)}`,
            },
          ],
          details: { total: next.length, completed: done },
        };
      },
    };

    const todoReadTool: AgentTool<typeof todoReadParams> = {
      name: "todo_read",
      label: "读取任务进度清单",
      description: "查看当前会话中尚未完成或已完成的任务进度条目。",
      parameters: todoReadParams,
      execute: async () => {
        const todos = runtimeCtx?.todos ?? [];
        return {
          content: [
            {
              type: "text",
              text:
                todos.length === 0
                  ? "当前会话暂无任务进度条目。"
                  : formatTodoSummaryForContext(todos),
            },
          ],
          details: { total: todos.length },
        };
      },
    };

    api.registerTool(todoWriteTool);
    api.registerTool(todoReadTool);
    api.injectSystemPrompt(
      "- 遇到需要 3 步及以上工具调用的复杂办公任务时，可用 `todo_write` 列出步骤并实时推进，避免漏项。"
    );

    // 将未完成的 Todo 状态注入到上下文末尾（非破坏性，防裁剪后忘掉后半段交付）
    api.onTransformContext((messages, ctx): AgentMessage[] => {
      const pending = ctx.todos.filter(
        (t) => t.status === "pending" || t.status === "in_progress"
      );
      if (pending.length === 0) return messages;
      const note = formatTodoSummaryForContext(ctx.todos);
      if (!note) return messages;
      // 如果最后几条消息刚更新过 todo 则不重复注入
      const recentHasTodo = messages.slice(-2).some((m) => {
        if (m.role !== "user") return false;
        const txt = typeof m.content === "string" ? m.content : "";
        return txt.includes("[当前任务清单进度");
      });
      if (recentHasTodo) return messages;
      return [
        ...messages,
        {
          role: "user",
          content: `[系统进度提醒] 请持续对照以下未完成任务推进，完成后及时用 todo_write 标记：\n${note}`,
          timestamp: Date.now(),
        },
      ];
    });
  },
};
