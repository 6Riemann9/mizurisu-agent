import type { Api, Model } from "@earendil-works/pi-ai";
import { detectPlatformKind } from "../platform";
import type { PlatformAdapter } from "../platform/types";
import type {
  ApiErrorDiagnosis,
  ApiProtocol,
  BillingInfo,
  ModelInfo,
  NewApiConfig,
  ProtocolMode,
  ProviderGroup,
} from "../types";

export const DEFAULT_NEWAPI_URL =
  (import.meta.env?.VITE_DEFAULT_NEWAPI_URL as string | undefined)?.trim() ||
  "https://www.mizurisu.com";

export const DEFAULT_BRAND_NAME =
  (import.meta.env?.VITE_APP_BRAND_NAME as string | undefined)?.trim() ||
  "Mizurisu Agent";

/**
 * 将用户输入的 New-API 地址归一化为不含尾斜杠与 /v1 /v1beta 的站点根地址
 */
export function normalizeNewApiBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  let normalized = trimmed.replace(/\/+$/, "");
  normalized = normalized.replace(/\/v1beta$/i, "").replace(/\/v1$/i, "");
  return normalized.replace(/\/+$/, "");
}

function stripWwwHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function isSameStationHost(urlA: string, urlB: string): boolean {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    return a.protocol === b.protocol && stripWwwHost(a.host) === stripWwwHost(b.host);
  } catch {
    return false;
  }
}

/**
 * 解析当前运行环境实际请求前缀：
 * - Web 同源部署（如直接挂在 www.mizurisu.com/agent/）：返回 ""，走相对路径并自动携带站点登录 Cookie
 * - Web 本地开发模式且目标为默认中转站：返回 ""，自动走 Vite dev proxy（解决 localhost CORS 拦截）
 * - Desktop / Mobile 或其他外站域名：返回完整的归一化 https://... 地址
 */
export function resolveEffectiveBaseUrl(rawBaseUrl: string): string {
  const root = normalizeNewApiBaseUrl(rawBaseUrl);
  if (!root) return "";

  if (typeof window !== "undefined" && detectPlatformKind() === "web") {
    if (window.location?.origin && isSameStationHost(root, window.location.origin)) {
      return "";
    }
    const isDev = Boolean(import.meta.env?.DEV);
    const defaultRoot = normalizeNewApiBaseUrl(DEFAULT_NEWAPI_URL);
    if (isDev && defaultRoot && isSameStationHost(root, defaultRoot)) {
      return "";
    }
  }

  return root;
}

/**
 * 严格按 pi-ai@1.6.0 各协议适配器约定构造 baseUrl：
 * - openai-completions / openai-responses: `${root}/v1`
 * - anthropic-messages: `${root}` (Anthropic SDK 会自行拼接 `/v1/messages`)
 * - google-generative-ai: `${root}/v1beta` (pi-ai 设置 apiVersion: "")
 */
export function buildProtocolBaseUrl(
  rawBaseUrl: string,
  api: ApiProtocol,
  options?: { absoluteForBrowserSdk?: boolean }
): string {
  const effective = resolveEffectiveBaseUrl(rawBaseUrl);
  const root =
    effective === "" && options?.absoluteForBrowserSdk && typeof window !== "undefined"
      ? window.location.origin
      : effective;
  if (!root && effective !== "") return "";
  switch (api) {
    case "anthropic-messages":
      return root;
    case "google-generative-ai":
      return `${root}/v1beta`;
    case "openai-responses":
    case "openai-completions":
    default:
      return `${root}/v1`;
  }
}

export function inferProviderGroup(modelId: string, ownedBy?: string): ProviderGroup {
  const s = `${modelId} ${ownedBy || ""}`.toLowerCase();
  if (s.includes("claude") || s.includes("anthropic")) return "anthropic";
  if (s.includes("gemini") || s.includes("google") || s.includes("gemma")) return "google";
  if (s.includes("deepseek")) return "deepseek";
  if (s.includes("qwen") || s.includes("qwq") || s.includes("tongyi")) return "qwen";
  if (s.includes("llama") || s.includes("meta")) return "meta";
  if (s.includes("mistral") || s.includes("mixtral") || s.includes("codestral")) return "mistral";
  if (s.includes("grok") || s.includes("xai")) return "xai";
  if (
    s.includes("gpt") ||
    s.includes("chatgpt") ||
    /\bo[134](-|$)/.test(s) ||
    s.includes("openai")
  ) {
    return "openai";
  }
  return "other";
}

export function inferProtocolForModel(
  modelId: string,
  mode: ProtocolMode,
  overrides?: Record<string, ApiProtocol>
): ApiProtocol {
  if (overrides && overrides[modelId]) {
    return overrides[modelId];
  }
  if (mode === "compatible") {
    return "openai-completions";
  }
  const lower = modelId.toLowerCase();
  if (lower.includes("claude")) return "anthropic-messages";
  if (lower.includes("gemini")) return "google-generative-ai";
  return "openai-completions";
}

/** 非对话类专用模型匹配规则（向量、语音、生图、视频、审核、重排等） */
export const NON_CHAT_MODEL_RE =
  /(embedding|tts|whisper|dall-e|moderation|rerank|realtime|audio|transcribe|image|flux|midjourney|sora|kling|suno|bge-|jina-embeddings|voyage-)/i;

/** 主流办公旗舰对话模型匹配规则 */
const RECOMMENDED_MODEL_RE =
  /(claude-(?:sonnet-4(?:[-.]5)?|3[-.]7-sonnet)|gpt-4o(?![-.]mini)|gpt-4\.1(?![-.](?:mini|nano))|gpt-5(?![-.](?:mini|nano))|gemini-(?:2\.5(?![-.].*lite)|3(?![-.].*lite))|deepseek-(?:chat|v3|reasoner))/i;

/** 轻量高速模型匹配规则 */
const LIGHTWEIGHT_MODEL_RE = /(mini|nano|lite|haiku|turbo|flash|8b|7b|3b|1\.5b)/i;

export function inferModelMetadata(
  modelId: string,
  config: Pick<NewApiConfig, "protocolMode" | "modelProtocolOverrides">,
  ownedBy?: string
): ModelInfo {
  const lower = modelId.toLowerCase();
  const providerGroup = inferProviderGroup(modelId, ownedBy);
  const api = inferProtocolForModel(
    modelId,
    config.protocolMode,
    config.modelProtocolOverrides
  );
  const isChatCapable = !NON_CHAT_MODEL_RE.test(modelId);

  const supportsReasoning =
    isChatCapable &&
    (/\bo[134](-|$)/.test(lower) ||
      lower.includes("gpt-5") ||
      lower.includes("r1") ||
      lower.includes("reasoner") ||
      lower.includes("thinking") ||
      lower.includes("qwq") ||
      lower.includes("claude-3-7") ||
      lower.includes("claude-4") ||
      lower.includes("claude-sonnet-4") ||
      lower.includes("claude-opus-4") ||
      lower.includes("claude-haiku-4") ||
      lower.includes("gemini-2.5") ||
      lower.includes("gemini-3"));

  const supportsVision =
    isChatCapable &&
    (lower.includes("gpt-4o") ||
      lower.includes("gpt-4.1") ||
      lower.includes("gpt-4.5") ||
      lower.includes("gpt-5") ||
      lower.includes("claude") ||
      lower.includes("gemini") ||
      lower.includes("vl") ||
      lower.includes("vision"));

  let contextWindow = 128000;
  let maxTokens = 16384;
  if (lower.includes("gemini")) {
    contextWindow = 1000000;
    maxTokens = 65536;
  } else if (lower.includes("claude")) {
    contextWindow = 200000;
    maxTokens = 16384;
  } else if (lower.includes("gpt-4.1") || lower.includes("gpt-5")) {
    contextWindow = 400000;
    maxTokens = 32768;
  } else if (lower.includes("deepseek")) {
    contextWindow = 128000;
    maxTokens = 8192;
  }

  const recommended = isChatCapable && RECOMMENDED_MODEL_RE.test(modelId);
  const tags: string[] = [];
  if (!isChatCapable) {
    tags.push("非对话");
  } else {
    if (recommended) tags.push("推荐");
    if (supportsReasoning) tags.push("推理");
    if (supportsVision) tags.push("视觉");
    if (contextWindow >= 200000) tags.push("长文本");
    if (LIGHTWEIGHT_MODEL_RE.test(lower)) tags.push("轻量");
  }

  return {
    id: modelId,
    name: modelId,
    providerGroup,
    api,
    supportsReasoning,
    supportsVision,
    contextWindow,
    maxTokens,
    ownedBy,
    isChatCapable,
    recommended,
    tags: tags.slice(0, 3),
  };
}

export function toPiModel(modelInfo: ModelInfo, config: NewApiConfig): Model<Api> {
  const baseUrl = buildProtocolBaseUrl(config.baseUrl, modelInfo.api, {
    absoluteForBrowserSdk: true,
  });
  const provider =
    modelInfo.api === "anthropic-messages"
      ? "anthropic"
      : modelInfo.api === "google-generative-ai"
        ? "google"
        : "openai";

  return {
    id: modelInfo.id,
    name: modelInfo.name,
    api: modelInfo.api,
    provider,
    baseUrl,
    input: modelInfo.supportsVision ? ["text", "image"] : ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    reasoning: modelInfo.supportsReasoning,
    contextWindow: modelInfo.contextWindow,
    maxTokens: modelInfo.maxTokens,
  };
}

export type SessionRequestFn = PlatformAdapter["sessionRequest"];

export interface FetchModelsFallbackOptions {
  sessionRequest?: SessionRequestFn;
  authHeaders?: Record<string, string>;
}

const PREFERRED_STATION_MODEL_PATTERNS: RegExp[] = [
  /^claude-sonnet-4[-.]5/i,
  /^claude-sonnet-4(?![a-z])/i,
  /^claude-3[-.]7-sonnet/i,
  /^claude-3[-.]5-sonnet/i,
  /^gpt-4o$/i,
  /^gpt-4o-(\d{4}|latest)/i,
  /^gpt-4\.1$/i,
  /^gpt-4\.1-(\d{4}|latest)/i,
  /^gpt-5$/i,
  /^gpt-5-(\d{4}|chat)/i,
  /^gemini-2\.5-pro/i,
  /^gemini-2\.5-flash/i,
  /^deepseek-chat$/i,
  /^deepseek-v3/i,
  /^deepseek-reasoner$/i,
  /^claude-opus-4/i,
  /^claude-haiku-4/i,
  /^gpt-4o-mini$/i,
  /^o3(?:-mini)?$/i,
  /^o4-mini$/i,
  /^gemini-2\.0-flash$/i,
  /^qwen/i,
];

/**
 * 从站点实际返回的模型列表中选择默认模型：
 * - 若站点包含 preferredId 则优先保留
 * - 否则按主流旗舰对话模型顺序匹配站点实际提供的模型，绝不硬塞站点不存在的模型
 */
export function pickDefaultStationModel(
  models: ModelInfo[],
  preferredId?: string
): string {
  if (!models || models.length === 0) {
    return "";
  }
  const preferred = preferredId?.trim();
  if (preferred && models.some((m) => m.id === preferred)) {
    return preferred;
  }

  for (const pattern of PREFERRED_STATION_MODEL_PATTERNS) {
    const matched = models.find(
      (m) => !NON_CHAT_MODEL_RE.test(m.id) && pattern.test(m.id)
    );
    if (matched) {
      return matched.id;
    }
  }

  const chatLike = models.find((m) => !NON_CHAT_MODEL_RE.test(m.id));
  return chatLike?.id ?? models[0].id;
}

function finalizeModelList(
  rawItems: Array<{ id: string; owned_by?: string }>,
  config: NewApiConfig
): ModelInfo[] {
  const seen = new Set<string>();
  const models: ModelInfo[] = [];

  for (const item of rawItems) {
    const id = item?.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push(inferModelMetadata(id, config, item.owned_by));
  }

  for (const customId of config.customModels || []) {
    const clean = customId.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    models.push(inferModelMetadata(clean, config, "custom"));
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function extractUserModelsPayload(payload: unknown): Array<{ id: string; owned_by?: string }> {
  const out: Array<{ id: string; owned_by?: string }> = [];
  if (!payload || typeof payload !== "object") {
    return out;
  }

  const envelope = payload as { success?: boolean; data?: unknown };
  const body = envelope.data !== undefined ? envelope.data : payload;

  const pushEntry = (entry: unknown, fallbackOwner?: string) => {
    if (typeof entry === "string" && entry.trim()) {
      out.push({ id: entry.trim(), owned_by: fallbackOwner });
    } else if (entry && typeof entry === "object") {
      const obj = entry as { id?: unknown; name?: unknown; owned_by?: unknown };
      const id =
        typeof obj.id === "string"
          ? obj.id.trim()
          : typeof obj.name === "string"
            ? obj.name.trim()
            : "";
      if (id) {
        out.push({
          id,
          owned_by: typeof obj.owned_by === "string" ? obj.owned_by : fallbackOwner,
        });
      }
    }
  };

  if (Array.isArray(body)) {
    for (const item of body) pushEntry(item);
    return out;
  }

  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.models)) {
      for (const item of obj.models) pushEntry(item);
      return out;
    }
    if (Array.isArray(obj.items)) {
      for (const item of obj.items) pushEntry(item);
      return out;
    }
    for (const [group, val] of Object.entries(obj)) {
      if (Array.isArray(val)) {
        for (const item of val) pushEntry(item, group);
      }
    }
  }

  return out;
}

export async function fetchNewApiModels(
  config: NewApiConfig,
  fetchImpl: typeof fetch,
  sessionOrOptions?: SessionRequestFn | FetchModelsFallbackOptions
): Promise<ModelInfo[]> {
  const normalized = normalizeNewApiBaseUrl(config.baseUrl);
  if (!normalized) {
    throw new Error("请先填写 New-API 中转站地址");
  }
  const root = resolveEffectiveBaseUrl(normalized);

  const sessionRequest =
    typeof sessionOrOptions === "function"
      ? sessionOrOptions
      : sessionOrOptions?.sessionRequest;
  const authHeaders =
    typeof sessionOrOptions === "function"
      ? undefined
      : sessionOrOptions?.authHeaders;

  const apiKey = config.apiKey.trim();
  if (!apiKey && !sessionRequest) {
    throw new Error("请先填写 API Key");
  }

  let primaryError: Error | null = null;

  if (apiKey) {
    try {
      const res = await fetchImpl(`${root}/v1/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });

      if (res.ok) {
        const json = (await res.json()) as
          | { data?: Array<{ id: string; owned_by?: string }> }
          | Array<{ id: string; owned_by?: string }>;
        const rawList = Array.isArray(json) ? json : json.data || [];
        return finalizeModelList(rawList, config);
      }

      const body = await res.text().catch(() => "");
      primaryError = new Error(
        `拉取模型失败 (HTTP ${res.status}): ${body.slice(0, 180) || res.statusText}`
      );
    } catch (err) {
      primaryError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (sessionRequest) {
    const sessRes = await sessionRequest(`${root}/api/user/models`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...authHeaders,
      },
    });
    if (sessRes.ok) {
      try {
        const parsed = JSON.parse(sessRes.text) as { success?: boolean; message?: string };
        if (parsed && parsed.success === false) {
          throw new Error(parsed.message || "站点 /api/user/models 返回失败");
        }
        const rawList = extractUserModelsPayload(parsed);
        return finalizeModelList(rawList, config);
      } catch (err) {
        if (primaryError) throw primaryError;
        throw err instanceof Error ? err : new Error(String(err));
      }
    }

    if (primaryError) {
      throw primaryError;
    }
    throw new Error(
      `拉取模型失败 (HTTP ${sessRes.status}): ${sessRes.text.slice(0, 180) || "无响应"}`
    );
  }

  throw primaryError ?? new Error("拉取模型失败");
}

function formatDateYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function fetchNewApiBilling(
  config: NewApiConfig,
  fetchImpl: typeof fetch
): Promise<BillingInfo> {
  const normalized = normalizeNewApiBaseUrl(config.baseUrl);
  const root = resolveEffectiveBaseUrl(normalized);
  const now = Date.now();
  if (!normalized || !config.apiKey.trim()) {
    return { supported: false, message: "未配置中转站地址或 Key", updatedAt: now };
  }

  const headers = {
    Authorization: `Bearer ${config.apiKey.trim()}`,
    Accept: "application/json",
  };

  try {
    const subRes = await fetchImpl(`${root}/v1/dashboard/billing/subscription`, {
      method: "GET",
      headers,
    });

    if (!subRes.ok) {
      return {
        supported: false,
        message: subRes.status === 404 || subRes.status === 403 ? "该站点未开放 Key 余额查询" : `余额查询返回 ${subRes.status}`,
        updatedAt: now,
      };
    }

    const subJson = (await subRes.json()) as {
      hard_limit_usd?: number;
      soft_limit_usd?: number;
      system_hard_limit_usd?: number;
      access_until?: number;
      balance?: number;
    };

    const hardLimit =
      typeof subJson.hard_limit_usd === "number"
        ? subJson.hard_limit_usd
        : subJson.system_hard_limit_usd;

    let usedUsd: number | undefined;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 90 * 24 * 3600 * 1000);
      const usageRes = await fetchImpl(
        `${root}/v1/dashboard/billing/usage?start_date=${formatDateYmd(start)}&end_date=${formatDateYmd(end)}`,
        { method: "GET", headers }
      );
      if (usageRes.ok) {
        const usageJson = (await usageRes.json()) as { total_usage?: number };
        if (typeof usageJson.total_usage === "number") {
          // OpenAI billing usage 单位为美分 (cents)
          usedUsd = Number((usageJson.total_usage / 100).toFixed(4));
        }
      }
    } catch {
      // 忽略 usage 失败，仍保留 subscription 信息
    }

    const remainingUsd =
      typeof subJson.balance === "number"
        ? Number(subJson.balance.toFixed(4))
        : typeof hardLimit === "number" && typeof usedUsd === "number"
          ? Number(Math.max(0, hardLimit - usedUsd).toFixed(4))
          : hardLimit;

    return {
      supported: true,
      hardLimitUsd: hardLimit,
      usedUsd,
      remainingUsd,
      expiresAt: subJson.access_until && subJson.access_until > 0 ? subJson.access_until : undefined,
      updatedAt: now,
    };
  } catch (err) {
    return {
      supported: false,
      message: err instanceof Error ? err.message : "查询余额请求异常",
      updatedAt: now,
    };
  }
}

export const PROVIDER_GROUP_LABELS: Record<ProviderGroup, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  google: "Google (Gemini)",
  deepseek: "DeepSeek",
  qwen: "Qwen (通义千问)",
  meta: "Meta (Llama)",
  mistral: "Mistral",
  xai: "xAI (Grok)",
  other: "其他模型",
};

export interface MizurisuConsoleLinks {
  homeUrl: string;
  tokenUrl: string;
  topupUrl: string;
  logUrl: string;
}

/**
 * 依据站点地址生成 Mizurisu / New-API 控制台常用快捷链接；
 * 若 baseUrl 无效或非 http/https 协议，则回落至默认站点地址。
 */
export function getMizurisuConsoleLinks(baseUrl?: string): MizurisuConsoleLinks {
  const fallback = normalizeNewApiBaseUrl(DEFAULT_NEWAPI_URL) || "https://www.mizurisu.com";
  const candidate = normalizeNewApiBaseUrl(baseUrl || "");
  let homeUrl = fallback;

  if (candidate) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        homeUrl = candidate;
      }
    } catch {
      // 地址解析失败时回落默认主站地址
    }
  }

  return {
    homeUrl,
    tokenUrl: `${homeUrl}/console/token`,
    topupUrl: `${homeUrl}/console/topup`,
    logUrl: `${homeUrl}/console/log`,
  };
}

/**
 * 将原始 API / 网络异常信息诊断为客户可理解的标题、操作建议与修复入口提示
 */
export function classifyApiError(rawError: string, baseUrl?: string): ApiErrorDiagnosis {
  const text = (rawError || "").trim();

  // 1. 优先识别额度耗尽（部分中转站会在 403/429 下返回 insufficient_quota 或中文余额不足提示）
  if (
    /(?:\b402\b|insufficient_quota|quota[_\s-]?(?:exceeded|exhausted|not[_\s-]?enough|insufficient)|余额不足|额度不足|额度已用尽|额度耗尽|欠费|\bquota\b)/i.test(
      text
    )
  ) {
    return {
      code: "quota",
      title: "账户或令牌额度不足",
      advice: "当前 API Key 或账户余额已耗尽，请前往控制台充值或切换仍有可用额度的令牌。",
      retryable: false,
      suggestOpenSettings: true,
      suggestBillingConsole: true,
    };
  }

  // 2. 上下文长度超限
  if (
    /(?:context_length|maximum context|too many tokens|context window|prompt is too long|reduce the length|上下文过长|上下文长度|超出最大上下文)/i.test(
      text
    )
  ) {
    return {
      code: "context_length",
      title: "对话内容超出模型上下文限制",
      advice: "当前对话历史或附带文本过长，建议新建对话、减少附带文件，或切换支持更长上下文的模型（如 Gemini / Claude）。",
      retryable: false,
      suggestSwitchModel: true,
    };
  }

  // 3. 模型不可用 / 无可用渠道（优先于泛化 503，精准识别“无可用渠道”）
  if (
    /(?:\b404\b|model_not_found|model[_\s]+not[_\s]+found|no available channel|无可用渠道|无可用通道|模型不存在|不支持该模型|当前分组.*无可用)/i.test(
      text
    )
  ) {
    return {
      code: "model_unavailable",
      title: "所选模型暂不可用",
      advice: "中转站当前未配置该模型可用渠道或模型名称已下线，请切换其他推荐对话模型后重试。",
      retryable: false,
      suggestSwitchModel: true,
    };
  }

  // 4. 鉴权失败 / Key 无效 / 权限不足
  if (
    /(?:\b401\b|\b403\b|invalid_api_key|incorrect api key|unauthorized|forbidden|authentication|鉴权失败|无效的令牌|令牌已过期|未提供令牌|未配置.*Key)/i.test(
      text
    )
  ) {
    return {
      code: "auth",
      title: "身份鉴权失效或 API Key 错误",
      advice: "API Key 可能无效、已过期或无权访问该接口，请打开设置重新登录或更换有效令牌。",
      retryable: false,
      suggestOpenSettings: true,
      suggestBillingConsole: true,
    };
  }

  // 5. 请求频率限制
  if (
    /(?:\b429\b|rate[_\s-]?limit|too many requests|请求过于频繁|并发限制|触发限流)/i.test(
      text
    )
  ) {
    return {
      code: "rate_limit",
      title: "请求频率触发限流",
      advice: "当前请求过于频繁或达到并发上限，请稍等数秒后重试，或临时切换其他模型。",
      retryable: true,
      suggestSwitchModel: true,
    };
  }

  // 6. 浏览器跨域 CORS 或网络中断
  if (
    /(?:failed to fetch|networkerror|network request failed|cors|access-control-allow-origin|err_connection|econnrefused|enotfound|etimedout|load failed|fetch failed|网络中断|网络连接|跨域)/i.test(
      text
    )
  ) {
    const cleanBase = normalizeNewApiBaseUrl(baseUrl || "");
    const advice = cleanBase
      ? `无法连通站点 ${cleanBase}，可能是浏览器跨域 (CORS) 拦截或网络中断。可将本工作台同源部署于中转站域名下，或改用桌面端客户端（免跨域直连）。`
      : "请求被浏览器跨域 (CORS) 拦截或网络连接中断。请检查站点地址与网络状态，建议同源部署或使用桌面端客户端。";
    return {
      code: "cors_network",
      title: "网络连接中断或跨域受限",
      advice,
      retryable: true,
      suggestOpenSettings: true,
    };
  }

  // 7. 上游服务端错误 (500 / 502 / 503 / 504)
  if (
    /(?:\b500\b|\b502\b|\b503\b|\b504\b|internal server error|bad gateway|service unavailable|gateway timeout|overloaded|上游服务)/i.test(
      text
    )
  ) {
    return {
      code: "server",
      title: "上游模型服务暂时波动",
      advice: "中转站或上游模型接口暂时返回服务端错误，建议稍后重试或切换其他可用模型。",
      retryable: true,
      suggestSwitchModel: true,
    };
  }

  // 8. 兜底未知错误
  return {
    code: "unknown",
    title: "请求未能正常完成",
    advice: text
      ? `错误详情：${text.slice(0, 180)}。请检查站点配置、网络状态或切换模型后重试。`
      : "发生未知异常，请检查配置或稍后重试。",
    retryable: true,
    suggestOpenSettings: true,
  };
}
