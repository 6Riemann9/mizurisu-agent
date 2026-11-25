import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type PlatformKind = "web" | "desktop" | "mobile";

export type ApiProtocol =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export type ProtocolMode = "compatible" | "auto";

export type ProviderGroup =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "qwen"
  | "meta"
  | "mistral"
  | "xai"
  | "other";

export interface ModelInfo {
  id: string;
  name: string;
  providerGroup: ProviderGroup;
  api: ApiProtocol;
  supportsReasoning: boolean;
  supportsVision: boolean;
  contextWindow: number;
  maxTokens: number;
  ownedBy?: string;
  /** 是否支持常规对话（排除向量、语音、生图等专用模型） */
  isChatCapable?: boolean;
  /** 是否为官方推荐的主流办公旗舰模型 */
  recommended?: boolean;
  /** 简短中文能力标签（最多 3 个） */
  tags?: string[];
}

export interface NewApiSiteStatus {
  systemName?: string;
  quotaPerUnit: number;
  displayInCurrency: boolean;
  quotaDisplayType?: string;
  currencySymbol?: string;
  turnstileCheck?: boolean;
  turnstileSiteKey?: string;
}

export interface NewApiUserInfo {
  id: number;
  username: string;
  displayName: string;
  role: number;
  group?: string;
  quota: number;
  usedQuota: number;
}

export interface NewApiTokenItem {
  id: number;
  name: string;
  key: string;
  maskedKey: string;
  status: number;
  remainQuota: number;
  unlimitedQuota: boolean;
  expiredTime: number;
  usedQuota?: number;
  group?: string;
}

export type AuthMode = "account" | "apikey" | "guest";

export interface AuthSession {
  mode: AuthMode;
  baseUrl: string;
  username?: string;
  user?: NewApiUserInfo;
  siteStatus?: NewApiSiteStatus;
  accessToken?: string;
  tokens: NewApiTokenItem[];
  activeTokenId?: number;
  activeApiKey: string;
  loggedInAt: number;
}

export interface NewApiConfig {
  brandName: string;
  baseUrl: string;
  apiKey: string;
  protocolMode: ProtocolMode;
  selectedModelId: string;
  thinkingLevel: ThinkingLevel;
  customModels: string[];
  modelProtocolOverrides: Record<string, ApiProtocol>;
}

export interface BillingInfo {
  supported: boolean;
  remainingUsd?: number;
  hardLimitUsd?: number;
  usedUsd?: number;
  expiresAt?: number;
  message?: string;
  updatedAt: number;
}

export type OfficeFileCategory =
  | "excel"
  | "word"
  | "ppt"
  | "slides"
  | "pdf"
  | "markdown"
  | "code"
  | "image"
  | "text"
  | "binary";

export interface WorkspaceFileMeta {
  path: string;
  name: string;
  mimeType: string;
  size: number;
  updatedAt: number;
  category: OfficeFileCategory;
}

export interface WorkspaceFileRecord extends WorkspaceFileMeta {
  data: Uint8Array;
}

export interface FileSnapshot {
  id: string;
  path: string;
  size: number;
  createdAt: number;
  note?: string;
  data: Uint8Array;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "success" | "error" | "blocked";
  resultText?: string;
  durationMs?: number;
  modifiedPath?: string;
  /** 修改前后核心变更摘要（如 Word/PPT 原地编辑） */
  changeSummary?: string;
  /** 修改前快照 ID（支持一键回滚） */
  rollbackSnapshotId?: string;
  /** 回滚目标文件路径 */
  rollbackPath?: string;
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: "high" | "medium" | "low";
  updatedAt: number;
}

export interface QuestionnaireQuestion {
  id: string;
  question: string;
  options: string[];
  multiSelect?: boolean;
}

export interface QuestionnaireRequest {
  id: string;
  title?: string;
  questions: QuestionnaireQuestion[];
  resolve: (answers: Record<string, string[]> | null) => void;
}

export interface HandoffPayload {
  title: string;
  summary: string;
  keyDecisions: string[];
  relevantFiles: string[];
  nextSteps: string[];
  promptDraft: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  transport: "streamable-http" | "sse";
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface TokenBurdenReport {
  systemPromptTokens: number;
  toolSchemaTokens: number;
  historyTokens: number;
  totalEstimatedTokens: number;
  contextWindow: number;
  budgetLimit: number;
  usagePercent: number;
  estimatedSessionCostUsd: number;
  perPluginToolTokens: Record<string, number>;
}

export interface WorkspaceProfile {
  id: string;
  name: string;
  nativeDir?: string;
  createdAt: number;
}

export interface MessageUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  totalTokens: number;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  attachments?: Array<{ path: string; name: string; category: OfficeFileCategory }>;
  /** 用户随消息上传的图片预览列表 */
  images?: Array<{ name: string; mimeType: string; dataUrl: string }>;
  toolCalls?: ToolCallRecord[];
  usage?: MessageUsage;
  modelId?: string;
  errorMessage?: string;
  createdAt: number;
  isStreaming?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UiMessage[];
  totalTokens: number;
  /** 所属工作区 ID（undefined 视为默认工作区 default） */
  workspaceId?: string;
  /** 会话级任务进度清单（pi-todo-list） */
  todos?: TodoItem[];
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  title: string;
  description: string;
  argsPreview: string;
  resolve: (approved: boolean) => void;
}

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  category: "excel" | "word" | "ppt" | "analysis" | "custom";
  prompt: string;
  systemHint: string;
  builtin?: boolean;
}

export interface AppSettings {
  theme: "dark" | "light";
  /** 是否开启基于 OKLCH 对比度增强的高对比度模式 */
  highContrast?: boolean;
  autoApproveDelete: boolean;
  mountedNativeDir?: string;
  previewWidth: number;
  /** 用户收藏的常用模型 ID 列表 */
  favoriteModels?: string[];
  /** 模型选择器中是否显示非对话模型（如向量/语音/生图） */
  showNonChatModels?: boolean;
  /** 是否已关闭首次使用引导提示 */
  onboardingDismissed?: boolean;
  /** 客户自定义的全局办公偏好提示词 */
  customSystemPrompt?: string;
  /** Mizurisu-Pi 内置插件开关表 */
  enabledPlugins?: Record<string, boolean>;
  /** 受只读保护的工作区路径列表（支持 * 通配符） */
  protectedPaths?: string[];
  /** 已配置的 Remote MCP 服务器列表 */
  mcpServers?: McpServerConfig[];
  /** 可选自定义免费 SearXNG 搜索实例地址 */
  customSearxngUrl?: string;
  /** 可选 Web 端无 CORS 网页抓取代理地址 */
  webProxyUrl?: string;
}

/** 全局轻提示操作按钮（如撤销删除） */
export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

/** 全局轻提示条目 */
export interface ToastItem {
  id: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  action?: ToastAction;
  durationMs?: number;
}

/** API 错误分类枚举 */
export type ApiErrorCode =
  | "auth"
  | "quota"
  | "rate_limit"
  | "model_unavailable"
  | "cors_network"
  | "context_length"
  | "server"
  | "unknown";

/** 面向客户的 API 错误诊断结果与修复建议 */
export interface ApiErrorDiagnosis {
  code: ApiErrorCode;
  title: string;
  advice: string;
  retryable: boolean;
  suggestOpenSettings?: boolean;
  suggestSwitchModel?: boolean;
  suggestBillingConsole?: boolean;
}
