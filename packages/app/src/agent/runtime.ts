import { Agent, type AgentEvent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, TextContent, ThinkingContent, ToolCall } from "@earendil-works/pi-ai";
import { inferModelMetadata, toPiModel } from "../newapi/client";
import { createNewApiStreamFn } from "../newapi/stream";
import { getPlatformAdapter } from "../platform";
import type { WorkspaceVFS } from "../storage/workspace-vfs";
import type {
  AppSettings,
  ApprovalRequest,
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
  onRunFinished: (sessionId: string) => void;
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

function uiMessagesToPiMessages(history: UiMessage[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const m of history) {
    if (m.role === "user") {
      const attachNote = m.attachments?.length
        ? `\n\n[用户附带工作区文件: ${m.attachments.map((a) => a.path).join(", ")}]`
        : "";
      out.push({
        role: "user",
        content: `${m.content}${attachNote}`,
        timestamp: m.createdAt,
      });
    } else if (m.role === "assistant" && m.content.trim()) {
      out.push({
        role: "assistant",
        content: [{ type: "text", text: m.content }],
        api: "openai-completions",
        provider: "openai",
        model: m.modelId || "history",
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
  return out;
}

export class PiAgentRunner {
  private agent: Agent | null = null;
  private activeSessionId: string | null = null;
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

  abort(): void {
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
    const platform = getPlatformAdapter();
    const files = await this.vfs.listFiles();
    const modelInfo =
      options.models.find((m) => m.id === options.config.selectedModelId) ??
      inferModelMetadata(options.config.selectedModelId || "gpt-4o", options.config);
    const piModel = toPiModel(modelInfo, options.config);

    const systemPrompt = buildSystemPrompt({
      brandName: options.config.brandName,
      platformKind: platform.kind,
      files,
      activeSkill: options.activeSkill,
    });

    const tools = buildAgentTools(this.vfs);
    const streamFn = this.customStreamFn ?? createNewApiStreamFn(() => platform.getFetch());

    const assistantMsgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const toolMap = new Map<string, ToolCallRecord>();
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

    const emitUpdate = () => {
      currentAssistant = {
        ...currentAssistant,
        toolCalls: [...toolMap.values()],
      };
      this.callbacks.onAssistantUpdate(options.sessionId, currentAssistant);
    };

    this.activeSessionId = options.sessionId;
    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model: piModel,
        thinkingLevel: options.config.thinkingLevel,
        tools,
        messages: uiMessagesToPiMessages(options.historyBeforeUser),
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
            resolve,
          });
        });

        if (!approved) {
          return { block: true, reason: "用户在界面拒绝了该高危操作" };
        }
        return undefined;
      },
    });

    const unsubscribe = this.agent.subscribe((event: AgentEvent) => {
      if (this.activeSessionId !== options.sessionId) return;

      if (event.type === "message_update" && event.message.role === "assistant") {
        const parsed = extractTextAndThinking(event.message.content);
        currentAssistant.content = parsed.text;
        currentAssistant.thinking = parsed.thinking || undefined;
        emitUpdate();
      } else if (event.type === "message_end" && event.message.role === "assistant") {
        const am = event.message as AssistantMessage;
        const parsed = extractTextAndThinking(am.content);
        currentAssistant.content = parsed.text;
        currentAssistant.thinking = parsed.thinking || undefined;
        if (am.usage) {
          currentAssistant.usage = {
            inputTokens: am.usage.input,
            outputTokens: am.usage.output,
            cacheReadTokens: am.usage.cacheRead,
            totalTokens: am.usage.totalTokens,
          };
        }
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
      const attachNote = options.userMessage.attachments?.length
        ? `\n\n[用户本次附带文件: ${options.userMessage.attachments.map((a) => a.path).join(", ")}]`
        : "";
      await this.agent.prompt(`${options.userMessage.content}${attachNote}`, options.images);
      await this.agent.waitForIdle();
    } catch (err) {
      currentAssistant.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      unsubscribe();
      currentAssistant.isStreaming = false;
      emitUpdate();
      this.callbacks.onRunFinished(options.sessionId);
    }
  }
}
