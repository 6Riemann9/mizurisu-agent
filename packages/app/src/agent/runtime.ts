import { Agent, type AgentEvent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  ImageContent,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import { inferModelMetadata, toPiModel } from "../newapi/client";
import { createNewApiStreamFn } from "../newapi/stream";
import { getPlatformAdapter } from "../platform";
import type { WorkspaceVFS } from "../storage/workspace-vfs";
import type {
  AppSettings,
  ApprovalRequest,
  MessageUsage,
  ModelInfo,
  NewApiConfig,
  SkillTemplate,
  ToolCallRecord,
  UiMessage,
} from "../types";
import { buildSystemPrompt } from "./system-prompt";
import { buildAgentTools } from "./tools";

export interface RunnerCallbacks {
  onAssistantUpdate: (sessionId: string, msg: UiMessage) => void;
  onToolModifiedFile: (path: string) => void;
  onRequestApproval: (req: ApprovalRequest) => void;
  /** 当运行被取消或中断时通知 UI 主动关闭对应审批弹窗 */
  onCancelApproval?: (approvalId: string) => void;
  onRunFinished: (sessionId: string) => void;
}

interface AssistantRoundState {
  text: string;
  thinking: string;
  usage?: MessageUsage;
  ended: boolean;
}

function extractTextAndThinking(content: AssistantMessage["content"]): {
  text: string;
  thinking: string;
  toolCallsFromBlocks: ToolCall[];
} {
  let text = "";
  let thinking = "";
  const toolCallsFromBlocks: ToolCall[] = [];
  for (const block of content) {
    if (block.type === "text") {
      text += (block as TextContent).text;
    } else if (block.type === "thinking") {
      thinking += (block as ThinkingContent).thinking;
    } else if (block.type === "toolCall") {
      toolCallsFromBlocks.push(block as ToolCall);
    }
  }
  return { text, thinking, toolCallsFromBlocks };
}

/** 估算单条消息字符数（图片按约 3000 字符折算，避免 base64 失真） */
function estimateContentChars(content: unknown): number {
  if (typeof content === "string") {
    return content.length;
  }
  if (!Array.isArray(content)) {
    return 0;
  }
  let chars = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as {
      type?: string;
      text?: string;
      thinking?: string;
      name?: string;
      arguments?: unknown;
    };
    if (item.type === "text" && typeof item.text === "string") {
      chars += item.text.length;
    } else if (item.type === "thinking" && typeof item.thinking === "string") {
      chars += item.thinking.length;
    } else if (item.type === "toolCall") {
      chars += (item.name || "").length + JSON.stringify(item.arguments || {}).length;
    } else if (item.type === "image") {
      chars += 3000;
    } else {
      chars += JSON.stringify(block).length;
    }
  }
  return chars;
}

/** 按约 3 字符 / token 估算单条 AgentMessage 的 token 占用 */
function estimateMessageTokens(msg: AgentMessage): number {
  let chars = estimateContentChars((msg as { content?: unknown }).content);
  if (msg.role === "system" && msg.sections) {
    for (const val of Object.values(msg.sections)) {
      if (typeof val === "string") chars += val.length;
    }
  }
  // 预留角色与结构元信息开销
  chars += 12;
  return Math.max(1, Math.ceil(chars / 3));
}

function truncateTextToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const suffix = "\n...(历史内容已按上下文预算截断)";
  if (maxChars <= suffix.length + 12) {
    return text.slice(0, Math.max(1, maxChars));
  }
  return `${text.slice(0, maxChars - suffix.length)}${suffix}`;
}

function truncateMessageToTokens(msg: AgentMessage, maxTokens: number): AgentMessage {
  const maxChars = Math.max(24, maxTokens * 3 - 12);
  if (msg.role === "user") {
    if (typeof msg.content === "string") {
      return { ...msg, content: truncateTextToChars(msg.content, maxChars) };
    }
    if (Array.isArray(msg.content)) {
      let remaining = maxChars;
      const nextContent = msg.content.map((block) => {
        if (block.type === "text") {
          const sliced = truncateTextToChars(block.text, Math.max(12, remaining));
          remaining = Math.max(0, remaining - sliced.length);
          return { ...block, text: sliced };
        }
        return block;
      });
      return { ...msg, content: nextContent };
    }
  }
  if (msg.role === "assistant") {
    let remaining = maxChars;
    const nextContent = msg.content.map((block) => {
      if (block.type === "text") {
        const sliced = truncateTextToChars(block.text, Math.max(12, remaining));
        remaining = Math.max(0, remaining - sliced.length);
        return { ...block, text: sliced };
      }
      if (block.type === "thinking") {
        const sliced = truncateTextToChars(block.thinking, Math.max(12, remaining));
        remaining = Math.max(0, remaining - sliced.length);
        return { ...block, thinking: sliced };
      }
      return block;
    });
    return { ...msg, content: nextContent };
  }
  return msg;
}

/**
 * 将历史对话裁剪至目标上下文窗口预算内（约 3 chars/token）：
 * - 上限为 Math.max(8000, Math.floor(contextWindow * 0.65))
 * - 保留首条系统上下文说明（若有）与最近完整对话轮次
 */
export function trimHistoryToBudget(
  messages: AgentMessage[],
  contextWindow: number
): AgentMessage[] {
  if (!messages || messages.length === 0) return [];

  const safeWindow =
    Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 128000;
  const maxBudgetTokens = Math.max(8000, Math.floor(safeWindow * 0.65));

  const totalTokens = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  if (totalTokens <= maxBudgetTokens) {
    return messages.slice();
  }

  const hasLeadingSystem = messages[0]?.role === "system";
  const head: AgentMessage[] = hasLeadingSystem ? [messages[0]] : [];
  const body = hasLeadingSystem ? messages.slice(1) : messages;

  // 按用户提问为起点切分为完整对话轮次，避免截断工具调用配对或产生孤立助手消息
  const turns: AgentMessage[][] = [];
  let currentTurn: AgentMessage[] = [];
  for (const msg of body) {
    if (msg.role === "user") {
      if (currentTurn.length > 0) {
        turns.push(currentTurn);
      }
      currentTurn = [msg];
    } else {
      currentTurn.push(msg);
    }
  }
  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }

  let usedTokens = head.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  const keptTurns: AgentMessage[][] = [];

  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    const turnTokens = turn.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
    if (usedTokens + turnTokens <= maxBudgetTokens) {
      keptTurns.unshift(turn);
      usedTokens += turnTokens;
      continue;
    }

    // 若最新一轮本身即超出预算，按剩余预算裁切内容以保底保留最新轮次且总量受控
    if (keptTurns.length === 0) {
      const remainingTokens = Math.max(64, maxBudgetTokens - usedTokens);
      const perMsgBudget = Math.max(32, Math.floor(remainingTokens / Math.max(1, turn.length)));
      const fittedTurn: AgentMessage[] = [];
      let fittedTokens = 0;
      for (const m of turn) {
        const candidate = truncateMessageToTokens(m, perMsgBudget);
        const candTokens = estimateMessageTokens(candidate);
        if (fittedTokens + candTokens <= remainingTokens || fittedTurn.length === 0) {
          fittedTurn.push(candidate);
          fittedTokens += candTokens;
        }
      }
      if (fittedTurn.length > 0) {
        keptTurns.unshift(fittedTurn);
      }
    }
    break;
  }

  return [...head, ...keptTurns.flat()];
}

export function uiMessagesToPiMessages(
  history: UiMessage[],
  targetModel?: Model<Api>
): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const m of history) {
    if (m.role === "user") {
      const attachNote = m.attachments?.length
        ? `\n\n[用户附带工作区文件: ${m.attachments.map((a) => a.path).join(", ")}]`
        : "";
      const imageNote = m.images?.length
        ? `\n\n[用户附带图片: ${m.images.map((img) => img.name || "image").join(", ")}]`
        : "";
      const baseText = m.content.trim()
        ? m.content
        : m.images?.length
          ? "请查看并分析我发送的图片内容。"
          : m.attachments?.length
            ? "请读取并分析我附带的工作区文件。"
            : "";
      out.push({
        role: "user",
        content: `${baseText}${attachNote}${imageNote}`,
        timestamp: m.createdAt,
      });
    } else if (m.role === "assistant") {
      const toolSummaries = (m.toolCalls || [])
        .filter((tc) => Boolean(tc.name))
        .map((tc) => {
          const argPath =
            tc.args && typeof tc.args.path === "string" ? tc.args.path : undefined;
          const target = tc.modifiedPath || argPath;
          const suffix = tc.status === "error" ? " (失败)" : "";
          return target
            ? `[历史工具操作: ${tc.name} -> ${target}${suffix}]`
            : `[历史工具操作: ${tc.name}${suffix}]`;
        });
      const combined = [m.content.trim(), ...toolSummaries].filter(Boolean).join("\n\n");
      if (combined) {
        out.push({
          role: "assistant",
          content: [{ type: "text", text: combined }],
          api: targetModel?.api ?? "openai-completions",
          provider: targetModel?.provider ?? "openai",
          model: m.modelId || targetModel?.id || "history",
          usage: {
            input: m.usage?.inputTokens || 0,
            output: m.usage?.outputTokens || 0,
            cacheRead: m.usage?.cacheReadTokens || 0,
            cacheWrite: 0,
            totalTokens: m.usage?.totalTokens || 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: m.createdAt,
        });
      }
    }
  }
  return out;
}

export class PiAgentRunner {
  private agent: Agent | null = null;
  private activeSessionId: string | null = null;
  private runSeq = 0;
  private activeRunSeq = 0;
  private vfs: WorkspaceVFS;
  private callbacks: RunnerCallbacks;
  private customStreamFn?: StreamFn;

  constructor(vfs: WorkspaceVFS, callbacks: RunnerCallbacks, customStreamFn?: StreamFn) {
    this.vfs = vfs;
    this.callbacks = callbacks;
    this.customStreamFn = customStreamFn;
  }

  isRunning(): boolean {
    return Boolean(this.agent?.state.isStreaming);
  }

  abort(options?: { discardResult?: boolean }): void {
    if (options?.discardResult === true) {
      // 丢弃当前轮次后续状态通知，消除重发/删会话/重置期间的窄时间窗回写竞态
      this.activeRunSeq = ++this.runSeq;
      this.activeSessionId = null;
    }
    this.agent?.abort();
  }

  steer(text: string): void {
    if (!this.agent || !this.agent.state.isStreaming) return;
    this.agent.steer({
      role: "user",
      content: text,
      timestamp: Date.now(),
    });
  }

  async runTurn(options: {
    sessionId: string;
    userMessage: UiMessage;
    historyBeforeUser: UiMessage[];
    config: NewApiConfig;
    models: ModelInfo[];
    settings: AppSettings;
    activeSkill?: SkillTemplate;
    images?: ImageContent[];
  }): Promise<void> {
    // 在任何异步等待前先抢占运行序号并中止旧运行，防止并发启动时状态串写
    const runSeq = ++this.runSeq;
    this.activeRunSeq = runSeq;
    this.activeSessionId = options.sessionId;
    this.agent?.abort();

    const platform = getPlatformAdapter();
    const files = await this.vfs.listFiles();
    if (this.activeRunSeq !== runSeq) {
      return;
    }

    const modelInfo =
      options.models.find((m) => m.id === options.config.selectedModelId) ??
      inferModelMetadata(options.config.selectedModelId || "gpt-4o", options.config);
    const piModel = toPiModel(modelInfo, options.config);

    const systemPrompt = buildSystemPrompt({
      brandName: options.config.brandName,
      platformKind: platform.kind,
      files,
      activeSkill: options.activeSkill,
      customSystemPrompt: options.settings.customSystemPrompt,
    });

    const tools = buildAgentTools(this.vfs);
    const streamFn = this.customStreamFn ?? createNewApiStreamFn(() => platform.getFetch());

    const assistantMsgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const toolMap = new Map<string, ToolCallRecord>();
    const roundMap = new Map<number, AssistantRoundState>();
    let activeRoundIndex = -1;

    let currentAssistant: UiMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      thinking: "",
      toolCalls: [],
      modelId: piModel.id,
      createdAt: Date.now(),
      isStreaming: true,
    };

    const syncRoundsToAssistant = () => {
      const ordered = Array.from(roundMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, round]) => round);

      const nonEmptyTexts = ordered.filter((r) => r.text.trim().length > 0);
      currentAssistant.content = nonEmptyTexts
        .map((r, idx) =>
          r.ended || idx < nonEmptyTexts.length - 1
            ? r.text.trim()
            : r.text.replace(/^\n+/, "")
        )
        .join("\n\n");

      const nonEmptyThinkings = ordered.filter((r) => r.thinking.trim().length > 0);
      const joinedThinking = nonEmptyThinkings
        .map((r, idx) =>
          r.ended || idx < nonEmptyThinkings.length - 1
            ? r.thinking.trim()
            : r.thinking.replace(/^\n+/, "")
        )
        .join("\n\n");
      currentAssistant.thinking = joinedThinking || undefined;

      // 累计多轮工具调用过程中每轮结束时的 Token 消耗，避免最后一轮覆盖总计
      let hasUsage = false;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let totalTokens = 0;
      for (const round of ordered) {
        if (round.usage) {
          hasUsage = true;
          inputTokens += round.usage.inputTokens;
          outputTokens += round.usage.outputTokens;
          cacheReadTokens += round.usage.cacheReadTokens || 0;
          totalTokens += round.usage.totalTokens;
        }
      }
      if (hasUsage) {
        currentAssistant.usage = {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          totalTokens,
        };
      }
    };

    const emitUpdate = () => {
      if (this.activeRunSeq !== runSeq) return;
      currentAssistant = {
        ...currentAssistant,
        toolCalls: [...toolMap.values()],
      };
      this.callbacks.onAssistantUpdate(options.sessionId, currentAssistant);
    };

    const historyMessages = trimHistoryToBudget(
      uiMessagesToPiMessages(options.historyBeforeUser, piModel),
      piModel.contextWindow
    );

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model: piModel,
        thinkingLevel: options.config.thinkingLevel,
        tools,
        messages: historyMessages,
      },
      streamFn,
      getApiKey: () => options.config.apiKey.trim(),
      beforeToolCall: async ({ toolCall, args }, signal) => {
        if (signal?.aborted) {
          return { block: true, reason: "用户已终止执行" };
        }
        const needConfirm =
          toolCall.name === "run_shell_command" ||
          (toolCall.name === "delete_file" && !options.settings.autoApproveDelete);

        if (!needConfirm) return undefined;

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
            this.callbacks.onCancelApproval?.(toolCall.id);
            safeResolve(false);
          };

          // 监听中断信号，确保用户在等待审批时点击停止不会造成 Promise 永久挂起死锁
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) {
            onAbort();
            return;
          }

          this.callbacks.onRequestApproval({
            id: toolCall.id,
            toolName: toolCall.name,
            title:
              toolCall.name === "run_shell_command"
                ? "确认执行本机 Shell 命令"
                : "确认删除工作区文件",
            description:
              toolCall.name === "run_shell_command"
                ? "Agent 请求在您的电脑上执行以下命令，请确认安全后再放行："
                : "Agent 请求删除工作区中的以下文件（删除前仍会保留快照）：",
            argsPreview: JSON.stringify(args, null, 2),
            resolve: safeResolve,
          });
        });

        if (!approved || signal?.aborted) {
          return {
            block: true,
            reason: signal?.aborted ? "用户已终止执行" : "用户在界面拒绝了该高危操作",
          };
        }
        return undefined;
      },
    });

    const unsubscribe = this.agent.subscribe((event: AgentEvent) => {
      if (this.activeSessionId !== options.sessionId || this.activeRunSeq !== runSeq) return;

      if (event.type === "message_start" && event.message.role === "assistant") {
        activeRoundIndex += 1;
        const parsed = extractTextAndThinking((event.message as AssistantMessage).content);
        roundMap.set(activeRoundIndex, {
          text: parsed.text,
          thinking: parsed.thinking,
          ended: false,
        });
        syncRoundsToAssistant();
        emitUpdate();
      } else if (event.type === "message_update" && event.message.role === "assistant") {
        if (activeRoundIndex < 0) activeRoundIndex = 0;
        const parsed = extractTextAndThinking((event.message as AssistantMessage).content);
        const prev = roundMap.get(activeRoundIndex);
        roundMap.set(activeRoundIndex, {
          text: parsed.text,
          thinking: parsed.thinking,
          usage: prev?.usage,
          ended: false,
        });
        syncRoundsToAssistant();
        emitUpdate();
      } else if (event.type === "message_end" && event.message.role === "assistant") {
        if (activeRoundIndex < 0) activeRoundIndex = 0;
        const am = event.message as AssistantMessage;
        const parsed = extractTextAndThinking(am.content);
        const roundUsage: MessageUsage | undefined = am.usage
          ? {
              inputTokens: am.usage.input || 0,
              outputTokens: am.usage.output || 0,
              cacheReadTokens: am.usage.cacheRead || 0,
              totalTokens: am.usage.totalTokens || 0,
            }
          : undefined;
        roundMap.set(activeRoundIndex, {
          text: parsed.text,
          thinking: parsed.thinking,
          usage: roundUsage,
          ended: true,
        });
        syncRoundsToAssistant();
        if (am.errorMessage) {
          currentAssistant.errorMessage = am.errorMessage;
        }
        emitUpdate();
      } else if (event.type === "tool_execution_start") {
        toolMap.set(event.toolCallId, {
          id: event.toolCallId,
          name: event.toolName,
          args: (event.args as Record<string, unknown>) || {},
          status: "running",
        });
        emitUpdate();
      } else if (event.type === "tool_execution_end") {
        const prev = toolMap.get(event.toolCallId);
        const resObj = event.result as
          | {
              content?: Array<{ type: string; text?: string }>;
              details?: { modifiedPath?: string };
            }
          | undefined;
        const resultText = resObj?.content
          ?.filter((c) => c.type === "text" && c.text)
          .map((c) => c.text)
          .join("\n");
        const modifiedPath = resObj?.details?.modifiedPath;
        if (modifiedPath && !event.isError) {
          this.callbacks.onToolModifiedFile(modifiedPath);
        }
        toolMap.set(event.toolCallId, {
          id: event.toolCallId,
          name: event.toolName,
          args: prev?.args || {},
          status: event.isError ? "error" : "success",
          resultText,
          durationMs: event.durationMs,
          modifiedPath,
        });
        emitUpdate();
      }
    });

    try {
      emitUpdate();
      const basePromptText = options.userMessage.content.trim()
        ? options.userMessage.content
        : options.images && options.images.length > 0
          ? "请查看并分析我发送的图片内容。"
          : "请读取并分析我附带的工作区文件。";
      const attachNote = options.userMessage.attachments?.length
        ? `\n\n[用户本次附带文件: ${options.userMessage.attachments.map((a) => a.path).join(", ")}]`
        : "";
      await this.agent.prompt(`${basePromptText}${attachNote}`, options.images);
      await this.agent.waitForIdle();
    } catch (err) {
      currentAssistant.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      unsubscribe();
      currentAssistant.isStreaming = false;
      // 仅当仍是当前最新活跃轮次时才提交收尾更新与结束回调，避免已被新轮次取代的旧运行串写消息或提前关闭流式状态
      if (this.activeRunSeq === runSeq) {
        emitUpdate();
        this.activeSessionId = null;
        this.agent = null;
        this.callbacks.onRunFinished(options.sessionId);
      }
    }
  }
}
