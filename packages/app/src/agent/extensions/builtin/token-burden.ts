import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { TokenBurdenReport, UiMessage } from "../../../types";
import type { MizurisuExtension } from "../types";
import { estimateToolSchemaTokens } from "../host";

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** 常见主流模型近似公开单价（美元 / 1M tokens），未知模型使用保守均价并在 UI 明确标注「估算」 */
const MODEL_PRICING_TABLE: Array<[RegExp, ModelPricing]> = [
  [/claude.*opus/i, { inputPerMillion: 15, outputPerMillion: 75 }],
  [/claude.*sonnet/i, { inputPerMillion: 3, outputPerMillion: 15 }],
  [/claude.*haiku/i, { inputPerMillion: 0.8, outputPerMillion: 4 }],
  [/gpt-4\.1-mini|gpt-4o-mini|gpt-5-mini|o4-mini|o3-mini/i, { inputPerMillion: 0.4, outputPerMillion: 1.6 }],
  [/gpt-4\.1|gpt-4o|gpt-5/i, { inputPerMillion: 2.5, outputPerMillion: 10 }],
  [/gemini.*flash/i, { inputPerMillion: 0.15, outputPerMillion: 0.6 }],
  [/gemini.*pro/i, { inputPerMillion: 1.25, outputPerMillion: 5 }],
  [/deepseek-reasoner|deepseek-r1/i, { inputPerMillion: 0.55, outputPerMillion: 2.19 }],
  [/deepseek/i, { inputPerMillion: 0.27, outputPerMillion: 1.1 }],
  [/qwen/i, { inputPerMillion: 0.4, outputPerMillion: 1.2 }],
];

const FALLBACK_PRICING: ModelPricing = {
  inputPerMillion: 1.0,
  outputPerMillion: 3.0,
};

export function getEstimatedModelPricing(modelId: string): ModelPricing {
  for (const [re, price] of MODEL_PRICING_TABLE) {
    if (re.test(modelId)) {
      return price;
    }
  }
  return FALLBACK_PRICING;
}

export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const price = getEstimatedModelPricing(modelId);
  const cost =
    (Math.max(0, inputTokens) / 1_000_000) * price.inputPerMillion +
    (Math.max(0, outputTokens) / 1_000_000) * price.outputPerMillion;
  return Number(cost.toFixed(6));
}

export function estimateCharsTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 3));
}

export function estimateTokenBurden(params: {
  systemPrompt: string;
  tools: AgentTool<any>[];
  historyMessages: AgentMessage[];
  uiMessages: UiMessage[];
  contextWindow: number;
  modelId: string;
  perPluginToolTokens?: Record<string, number>;
}): TokenBurdenReport {
  const safeWindow =
    Number.isFinite(params.contextWindow) && params.contextWindow > 0
      ? params.contextWindow
      : 128000;
  const budgetLimit = Math.max(8000, Math.floor(safeWindow * 0.65));

  const systemPromptTokens = estimateCharsTokens(params.systemPrompt);
  const toolSchemaTokens = params.tools.reduce(
    (sum, tool) => sum + estimateToolSchemaTokens(tool),
    0
  );

  let historyChars = 0;
  for (const m of params.historyMessages) {
    const content = (m as { content?: unknown }).content;
    if (typeof content === "string") {
      historyChars += content.length;
    } else if (Array.isArray(content)) {
      for (const blk of content) {
        if (!blk || typeof blk !== "object") continue;
        const rec = blk as { type?: string; text?: string; thinking?: string };
        if (rec.type === "image") historyChars += 3000;
        else if (typeof rec.text === "string") historyChars += rec.text.length;
        else if (typeof rec.thinking === "string") historyChars += rec.thinking.length;
        else historyChars += JSON.stringify(blk).length;
      }
    }
    historyChars += 12;
  }
  const historyTokens = historyChars > 0 ? Math.max(1, Math.ceil(historyChars / 3)) : 0;

  const totalEstimatedTokens = systemPromptTokens + toolSchemaTokens + historyTokens;
  const usagePercent = Math.min(
    100,
    Math.round((totalEstimatedTokens / Math.max(1, budgetLimit)) * 100)
  );

  let sessionInput = 0;
  let sessionOutput = 0;
  let totalCost = 0;
  for (const msg of params.uiMessages) {
    if (msg.usage) {
      sessionInput += msg.usage.inputTokens || 0;
      sessionOutput += msg.usage.outputTokens || 0;
      totalCost += estimateCostUsd(
        msg.modelId || params.modelId,
        msg.usage.inputTokens || 0,
        msg.usage.outputTokens || 0
      );
    }
  }
  // 若单条没有 modelId 记录但有汇总输入输出，保证非零估算
  if (totalCost === 0 && (sessionInput > 0 || sessionOutput > 0)) {
    totalCost = estimateCostUsd(params.modelId, sessionInput, sessionOutput);
  }

  return {
    systemPromptTokens,
    toolSchemaTokens,
    historyTokens,
    totalEstimatedTokens,
    contextWindow: safeWindow,
    budgetLimit,
    usagePercent,
    estimatedSessionCostUsd: Number(totalCost.toFixed(6)),
    perPluginToolTokens: params.perPluginToolTokens || {},
  };
}

export const tokenBurdenExtension: MizurisuExtension = {
  id: "pi-token-burden",
  name: "上下文与费用透视 (Token Burden)",
  description: "实时分析系统提示词、工具 Schema 与历史对话上下文水位，并估算当前会话 Mizurisu 额度消耗。",
  category: "workflow",
  defaultEnabled: true,
  register() {
    // 透视统计通过纯函数在运行时/UI 实时计算，不额外占用模型工具 Token
  },
};
