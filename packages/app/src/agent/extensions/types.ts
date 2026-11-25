import type { AgentMessage, AgentTool, BeforeToolCallContext, BeforeToolCallResult, AfterToolCallContext, AfterToolCallResult, StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { PlatformAdapter } from "../../platform/types";
import type { WorkspaceVFS } from "../../storage/workspace-vfs";
import type {
  AppSettings,
  ApprovalRequest,
  HandoffPayload,
  MessageUsage,
  ModelInfo,
  NewApiConfig,
  PermissionMode,
  QuestionnaireRequest,
  TodoItem,
} from "../../types";

export interface ExtensionRuntimeContext {
  sessionId: string;
  vfs: WorkspaceVFS;
  config: NewApiConfig;
  settings: AppSettings;
  permissionMode?: PermissionMode;
  sessionAllowedTools?: ReadonlySet<string>;
  model: Model<Api>;
  modelInfo?: ModelInfo;
  models: ModelInfo[];
  streamFn: StreamFn;
  platform: PlatformAdapter;
  /** 子代理嵌套深度：主 Agent 为 0，子 Agent 为 1（禁止递归派生与界面阻塞弹窗） */
  subagentDepth: number;
  todos: TodoItem[];
  updateTodos: (todos: TodoItem[]) => void;
  requestQuestionnaire?: (req: QuestionnaireRequest) => void;
  cancelQuestionnaire?: (id: string) => void;
  requestApproval?: (req: ApprovalRequest) => void;
  cancelApproval?: (id: string) => void;
  onHandoff?: (payload: HandoffPayload) => void | Promise<void>;
  onSubagentUsage?: (usage: MessageUsage) => void;
}

export type BeforeToolCallHook = (
  context: BeforeToolCallContext,
  runtimeCtx: ExtensionRuntimeContext,
  signal?: AbortSignal
) => Promise<BeforeToolCallResult | undefined> | BeforeToolCallResult | undefined;

export type AfterToolCallHook = (
  context: AfterToolCallContext,
  runtimeCtx: ExtensionRuntimeContext,
  signal?: AbortSignal
) => Promise<AfterToolCallResult | undefined> | AfterToolCallResult | undefined;

export type TransformContextHook = (
  messages: AgentMessage[],
  runtimeCtx: ExtensionRuntimeContext,
  signal?: AbortSignal
) => Promise<AgentMessage[]> | AgentMessage[];

export interface ExtensionAPI {
  registerTool: (tool: AgentTool<any>) => void;
  injectSystemPrompt: (snippet: string) => void;
  onBeforeToolCall: (hook: BeforeToolCallHook) => void;
  onAfterToolCall: (hook: AfterToolCallHook) => void;
  onTransformContext: (hook: TransformContextHook) => void;
}

export type ExtensionCategory = "workflow" | "knowledge" | "office" | "ecosystem" | "safety";

export interface MizurisuExtension {
  id: string;
  name: string;
  description: string;
  category: ExtensionCategory;
  defaultEnabled: boolean;
  register: (api: ExtensionAPI, runtimeCtx?: ExtensionRuntimeContext) => void;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  description: string;
  category: ExtensionCategory;
  enabled: boolean;
  defaultEnabled: boolean;
  toolNames: string[];
  estimatedToolTokens: number;
}
