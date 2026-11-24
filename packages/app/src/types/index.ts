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
  autoApproveDelete: boolean;
  mountedNativeDir?: string;
  previewWidth: number;
}
