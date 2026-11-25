import { Agent, type AgentEvent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import { arr, obj, opt, str } from "@earendil-works/pi-schema";
import type { MessageUsage } from "../../../types";
import { buildAgentTools } from "../../tools";
import { ExtensionHost } from "../host";
import type { ExtensionRuntimeContext, MizurisuExtension } from "../types";

const MAX_CONCURRENT_SUBAGENTS = 3;
const SUBAGENT_TIMEOUT_MS = 120_000;

const delegateSubagentsParams = obj({
  tasks: arr(
    obj({
      role: str({ description: "子代理角色名称，例如：财报数据核对员、行业检索员" }),
      goal: str({ description: "明确要完成的子任务目标与期望返回格式" }),
      relevantPaths: opt(arr(str(), { description: "需要重点查看的工作区文件路径" })),
    }),
    { minItems: 1, maxItems: MAX_CONCURRENT_SUBAGENTS, description: "最多 3 个可并行委派的独立子任务" }
  ),
});

export interface SubagentRunOutput {
  role: string;
  ok: boolean;
  text: string;
  usage: MessageUsage;
}

/** 运行单个隔离上下文的子代理（强制 subagentDepth = 1 防止递归派生与交互阻塞） */
export async function runSingleSubagent(
  task: { role: string; goal: string; relevantPaths?: string[] },
  parentCtx: ExtensionRuntimeContext,
  allExtensions: MizurisuExtension[],
  parentSignal?: AbortSignal
): Promise<SubagentRunOutput> {
  const usageTotal: MessageUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
  };

  const subCtx: ExtensionRuntimeContext = {
    ...parentCtx,
    subagentDepth: 1,
    requestQuestionnaire: undefined,
    cancelQuestionnaire: undefined,
    onHandoff: undefined,
  };

  const host = new ExtensionHost(allExtensions);
  const compiled = host.compile(subCtx);
  const baseTools = buildAgentTools(parentCtx.vfs).filter(
    (t) => t.name !== "run_shell_command"
  );
  const tools = [...baseTools, ...compiled.tools];

  const fileNote =
    task.relevantPaths && task.relevantPaths.length > 0
      ? `\n\n请重点检查工作区文件：${task.relevantPaths.join(", ")}`
      : "";

  const subSystemPrompt = [
    `你是 Mizurisu Agent 委派的子代理，当前专注角色：**${task.role}**。`,
    "请仅使用工具聚焦完成分配给你的子任务，输出结构化、严谨、可核验的简体中文结论（不要发散闲聊）。",
    ...compiled.promptSnippets,
  ].join("\n\n");

  const subAgent = new Agent({
    initialState: {
      systemPrompt: subSystemPrompt,
      model: parentCtx.model,
      thinkingLevel: parentCtx.config.thinkingLevel,
      tools,
      messages: [],
    },
    streamFn: parentCtx.streamFn,
    getApiKey: () => parentCtx.config.apiKey.trim(),
    transformContext: async (msgs, signal) =>
      compiled.transformHooks.length > 0
        ? await host.runTransformContext(compiled.transformHooks, msgs, subCtx, signal)
        : msgs,
    beforeToolCall: async (ctx, signal) =>
      compiled.beforeHooks.length > 0
        ? await host.runBeforeToolCall(compiled.beforeHooks, ctx, subCtx, signal)
        : undefined,
  });

  let finalText = "";
  let errorText = "";

  const unsubscribe = subAgent.subscribe((ev: AgentEvent) => {
    if (ev.type === "message_end" && ev.message.role === "assistant") {
      const am = ev.message as AssistantMessage;
      const text = am.content
        .filter((b): b is TextContent => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (text.trim()) {
        finalText = text.trim();
      }
      if (am.errorMessage) {
        errorText = am.errorMessage;
      }
      if (am.usage) {
        usageTotal.inputTokens += am.usage.input || 0;
        usageTotal.outputTokens += am.usage.output || 0;
        usageTotal.cacheReadTokens = (usageTotal.cacheReadTokens || 0) + (am.usage.cacheRead || 0);
        usageTotal.totalTokens += am.usage.totalTokens || 0;
      }
    }
  });

  const onParentAbort = () => {
    subAgent.abort();
  };
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  const timeoutTimer = setTimeout(() => {
    subAgent.abort();
  }, SUBAGENT_TIMEOUT_MS);

  try {
    await subAgent.prompt(`${task.goal}${fileNote}`);
    await subAgent.waitForIdle();
    parentCtx.onSubagentUsage?.(usageTotal);
    return {
      role: task.role,
      ok: !errorText && !parentSignal?.aborted,
      text: errorText ? `执行出错：${errorText}${finalText ? `\n${finalText}` : ""}` : finalText || "（子代理完成执行但未返回文本）",
      usage: usageTotal,
    };
  } catch (err) {
    parentCtx.onSubagentUsage?.(usageTotal);
    return {
      role: task.role,
      ok: false,
      text: `子代理异常：${err instanceof Error ? err.message : String(err)}`,
      usage: usageTotal,
    };
  } finally {
    clearTimeout(timeoutTimer);
    parentSignal?.removeEventListener("abort", onParentAbort);
    unsubscribe();
  }
}

export function createSubagentsExtension(
  getAllExtensions: () => MizurisuExtension[]
): MizurisuExtension {
  return {
    id: "pi-subagents",
    name: "多子代理并行分工 (Subagents)",
    description: "将调研、数据核对与文档审校拆分为最多 3 个隔离上下文子代理并行处理，防止主对话爆上下文。",
    category: "workflow",
    defaultEnabled: true,
    register(api, runtimeCtx?: ExtensionRuntimeContext) {
      // 硬护栏：子代理内部绝不允许再派生孙代理（depth === 0 时才注入工具）
      if (runtimeCtx && runtimeCtx.subagentDepth > 0) {
        return;
      }

      const delegateTool: AgentTool<typeof delegateSubagentsParams> = {
        name: "delegate_subagents",
        label: "并行委派子代理分工",
        description:
          "当遇到需要多文件核对、资料调研或分模块独立分析的复杂任务时，派出最多 3 个隔离上下文子代理并行处理并汇总结果。",
        parameters: delegateSubagentsParams,
        execute: async (_id, params, signal) => {
          if (!runtimeCtx) {
            throw new Error("未绑定运行时上下文");
          }
          const slice = params.tasks.slice(0, MAX_CONCURRENT_SUBAGENTS);
          const allExts = getAllExtensions();
          const results = await Promise.all(
            slice.map((t) => runSingleSubagent(t, runtimeCtx, allExts, signal))
          );

          const summaryText = results
            .map(
              (r, i) =>
                `### 子代理 ${i + 1}：${r.role}（${r.ok ? "成功" : "异常"} · ${r.usage.totalTokens} tokens）\n${r.text}`
            )
            .join("\n\n");

          const combinedTokens = results.reduce((s, r) => s + r.usage.totalTokens, 0);
          return {
            content: [{ type: "text", text: summaryText }],
            details: {
              taskCount: results.length,
              totalTokens: combinedTokens,
              results: results.map((r) => ({ role: r.role, ok: r.ok, usage: r.usage })),
            },
          };
        },
      };

      api.registerTool(delegateTool);
      api.injectSystemPrompt(
        "- 遇到多份大文档比对、并行数据分析或调研写作拆解时，可调用 `delegate_subagents` 派出子代理并行处理，避免主上下文被中间细节撑爆。"
      );
    },
  };
}
