import type { PlatformAdapter } from "../platform/types";
import type {
  AuthSession,
  NewApiSiteStatus,
  NewApiTokenItem,
  NewApiUserInfo,
} from "../types";
import { normalizeNewApiBaseUrl, resolveEffectiveBaseUrl } from "./client";

export type SessionPlatform = Pick<PlatformAdapter, "sessionRequest"> &
  Partial<Pick<PlatformAdapter, "clearSessionCookies">>;

interface NewApiEnvelope<T = unknown> {
  success?: boolean;
  message?: string;
  data?: T;
}

/**
 * 归一化 API Key：去除首尾空白与 Bearer 前缀，并在缺失时补全 sk- 前缀
 */
export function normalizeApiKey(rawKey: string): string {
  let clean = (rawKey || "").trim();
  if (!clean) return "";
  if (/^bearer\s+/i.test(clean)) {
    clean = clean.replace(/^bearer\s+/i, "").trim();
  }
  if (!clean) return "";
  if (/^sk-/i.test(clean)) {
    return `sk-${clean.slice(3)}`;
  }
  return `sk-${clean}`;
}

/**
 * 判断 Key 是否为脱敏/掩码格式（如 sk-abcd****efgh、sk-ab...yz、sk-ab••••yz）
 */
export function isMaskedKey(rawKey?: string | null): boolean {
  const clean = (rawKey || "").trim();
  if (!clean) return false;
  return /\*|•|\.{3,}/.test(clean);
}

/**
 * 将明文或原始 Key 格式化为安全的脱敏显示文本
 */
export function maskApiKey(rawKey: string): string {
  const clean = (rawKey || "").trim();
  if (!clean) return "";
  if (isMaskedKey(clean)) {
    return clean;
  }
  const normalized = normalizeApiKey(clean);
  if (normalized.length <= 6) {
    return `${normalized.slice(0, 3)}****`;
  }
  if (normalized.length <= 12) {
    return `${normalized.slice(0, 5)}****${normalized.slice(-2)}`;
  }
  return `${normalized.slice(0, 7)}****${normalized.slice(-4)}`;
}

/**
 * 将 New-API 内部额度单位换算为货币文本（默认 500000 = $1.00）
 */
export function formatQuotaUsd(quota: number, quotaPerUnit = 500000, symbol = "$"): string {
  if (!Number.isFinite(quota) || !Number.isFinite(quotaPerUnit) || quotaPerUnit <= 0) {
    return `${symbol}0.00`;
  }
  const value = quota / quotaPerUnit;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs === 0 || abs >= 0.01) {
    return `${sign}${symbol}${abs.toFixed(2)}`;
  }
  return `${sign}${symbol}${abs.toFixed(4)}`;
}

/**
 * 按站点配置自动显示 CNY (¥) 或 USD ($) 额度
 */
export function formatQuotaDisplay(
  quota: number,
  siteStatus?: Pick<NewApiSiteStatus, "quotaPerUnit" | "quotaDisplayType" | "currencySymbol">
): string {
  const perUnit = siteStatus?.quotaPerUnit ?? 500000;
  const displayType = (siteStatus?.quotaDisplayType || "").toUpperCase();
  const symbol =
    displayType === "CNY"
      ? "¥"
      : displayType === "CUSTOM" && siteStatus?.currencySymbol
        ? siteStatus.currencySymbol
        : "$";
  return formatQuotaUsd(quota, perUnit, symbol);
}

/**
 * 构建 New-API 会话鉴权请求头（New-Api-User 与可选 Bearer Token）
 */
export function buildNewApiAuthHeaders(
  userId?: number,
  accessToken?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (typeof userId === "number" && Number.isFinite(userId) && userId > 0) {
    headers["New-Api-User"] = String(userId);
  }
  if (accessToken && accessToken.trim()) {
    headers["Authorization"] = `Bearer ${accessToken.trim()}`;
  }
  return headers;
}

function parseEnvelopeJson<T>(text: string, status: number): NewApiEnvelope<T> {
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as NewApiEnvelope<T>;
  } catch {
    throw new Error(`服务器返回了非 JSON 响应 (HTTP ${status}): ${text.slice(0, 120)}`);
  }
}

async function requestNewApiEnvelope<T>(
  platform: SessionPlatform,
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}
): Promise<NewApiEnvelope<T>> {
  const res = await platform.sessionRequest(url, options);
  let parsed: NewApiEnvelope<T> | null = null;
  try {
    parsed = parseEnvelopeJson<T>(res.text, res.status);
  } catch (parseErr) {
    if (!res.ok) {
      throw new Error(
        `请求失败 (HTTP ${res.status}): ${res.text.slice(0, 180) || "无响应内容"}`
      );
    }
    throw parseErr;
  }

  if (!res.ok) {
    const msg = parsed?.message?.trim() || res.text.slice(0, 180) || `HTTP ${res.status}`;
    throw new Error(`请求失败 (HTTP ${res.status}): ${msg}`);
  }

  if (parsed && parsed.success === false) {
    throw new Error(parsed.message?.trim() || "New-API 站点返回操作失败");
  }

  return parsed ?? {};
}

function parseUserInfo(raw: Record<string, unknown>, fallbackUsername = ""): NewApiUserInfo {
  const id = Number(raw.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("未能从登录响应中解析到有效的用户 ID");
  }
  const username = String(raw.username ?? fallbackUsername).trim() || `user_${id}`;
  const displayName =
    String(raw.display_name ?? raw.displayName ?? username).trim() || username;
  const role = Number.isFinite(Number(raw.role)) ? Number(raw.role) : 1;
  const group =
    typeof raw.group === "string" && raw.group.trim() ? raw.group.trim() : undefined;
  const quota = Number.isFinite(Number(raw.quota)) ? Number(raw.quota) : 0;
  const usedQuotaRaw = raw.used_quota ?? raw.usedQuota ?? 0;
  const usedQuota = Number.isFinite(Number(usedQuotaRaw)) ? Number(usedQuotaRaw) : 0;

  return {
    id,
    username,
    displayName,
    role,
    group,
    quota,
    usedQuota,
  };
}

function normalizeTokenItem(raw: Record<string, unknown>): NewApiTokenItem {
  const id = Number(raw.id);
  const name = String(raw.name ?? "Unnamed Token").trim() || "Unnamed Token";
  const rawKey = typeof raw.key === "string" ? raw.key.trim() : "";
  const explicitMasked =
    typeof (raw.masked_key ?? raw.maskedKey) === "string"
      ? String(raw.masked_key ?? raw.maskedKey).trim()
      : "";

  let key = "";
  let maskedKey = explicitMasked || "sk-****";

  if (rawKey) {
    if (isMaskedKey(rawKey)) {
      key = rawKey;
      maskedKey = explicitMasked || rawKey;
    } else {
      key = normalizeApiKey(rawKey);
      maskedKey = explicitMasked || maskApiKey(key);
    }
  }

  const remainRaw = raw.remain_quota ?? raw.remainQuota ?? 0;
  const unlimitedRaw = raw.unlimited_quota ?? raw.unlimitedQuota ?? false;
  const expiredRaw = raw.expired_time ?? raw.expiredTime ?? -1;
  const usedRaw = raw.used_quota ?? raw.usedQuota;

  return {
    id,
    name,
    key,
    maskedKey,
    status: Number.isFinite(Number(raw.status)) ? Number(raw.status) : 1,
    remainQuota: Number.isFinite(Number(remainRaw)) ? Number(remainRaw) : 0,
    unlimitedQuota: Boolean(unlimitedRaw),
    expiredTime: Number.isFinite(Number(expiredRaw)) ? Number(expiredRaw) : -1,
    usedQuota:
      usedRaw !== undefined && Number.isFinite(Number(usedRaw))
        ? Number(usedRaw)
        : undefined,
    group:
      typeof raw.group === "string" && raw.group.trim() ? raw.group.trim() : undefined,
  };
}

function extractCandidateKeyFromData(data: unknown): string {
  if (typeof data === "string") {
    return data.trim();
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const raw = obj.key ?? obj.token;
    if (typeof raw === "string") {
      return raw.trim();
    }
  }
  return "";
}

function isTokenUsable(token: NewApiTokenItem): boolean {
  if (token.status !== 1) return false;
  if (token.expiredTime > 0) {
    const expMs = token.expiredTime > 1e12 ? token.expiredTime : token.expiredTime * 1000;
    if (expMs <= Date.now()) return false;
  }
  return token.unlimitedQuota || token.remainQuota > 0;
}

/**
 * 获取 New-API 站点元信息（GET /api/status）
 */
export async function fetchSiteStatus(
  baseUrl: string,
  platform: SessionPlatform
): Promise<NewApiSiteStatus> {
  const normalized = normalizeNewApiBaseUrl(baseUrl);
  if (!normalized) {
    throw new Error("请先填写 New-API 站点地址");
  }
  const root = resolveEffectiveBaseUrl(normalized);

  const envelope = await requestNewApiEnvelope<Record<string, unknown>>(
    platform,
    `${root}/api/status`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    }
  );

  const data = (envelope.data && typeof envelope.data === "object"
    ? envelope.data
    : {}) as Record<string, unknown>;
  const rawPerUnit = data.quota_per_unit ?? data.quotaPerUnit;
  const quotaPerUnit =
    typeof rawPerUnit === "number" && Number.isFinite(rawPerUnit) && rawPerUnit > 0
      ? rawPerUnit
      : 500000;
  const systemNameRaw = data.system_name ?? data.systemName;
  const systemName =
    typeof systemNameRaw === "string" && systemNameRaw.trim()
      ? systemNameRaw.trim()
      : undefined;
  const displayRaw = data.display_in_currency ?? data.displayInCurrency;
  const quotaDisplayType =
    typeof (data.quota_display_type ?? data.quotaDisplayType) === "string"
      ? String(data.quota_display_type ?? data.quotaDisplayType).trim()
      : undefined;
  const currencySymbol =
    typeof (data.custom_currency_symbol ?? data.currencySymbol) === "string"
      ? String(data.custom_currency_symbol ?? data.currencySymbol).trim()
      : undefined;
  const turnstileCheck = Boolean(data.turnstile_check ?? data.turnstileCheck);
  const turnstileSiteKey =
    typeof (data.turnstile_site_key ?? data.turnstileSiteKey) === "string"
      ? String(data.turnstile_site_key ?? data.turnstileSiteKey).trim()
      : undefined;

  return {
    systemName,
    quotaPerUnit,
    displayInCurrency: displayRaw === undefined ? true : Boolean(displayRaw),
    quotaDisplayType,
    currencySymbol,
    turnstileCheck,
    turnstileSiteKey,
  };
}

/**
 * 使用 New-API 账号密码登录（POST /api/user/login）
 */
export async function loginNewApiAccount(
  params: {
    baseUrl: string;
    username: string;
    password: string;
    turnstileToken?: string;
  },
  platform: SessionPlatform
): Promise<{
  user: NewApiUserInfo;
  accessToken?: string;
  authHeaders: Record<string, string>;
}> {
  const normalized = normalizeNewApiBaseUrl(params.baseUrl);
  const username = params.username.trim();
  const password = params.password;

  if (!normalized) throw new Error("请先填写 New-API 站点地址");
  if (!username) throw new Error("请输入用户名");
  if (!password) throw new Error("请输入登录密码");

  const root = resolveEffectiveBaseUrl(normalized);
  const qs = params.turnstileToken?.trim()
    ? `?turnstile=${encodeURIComponent(params.turnstileToken.trim())}`
    : "";

  const envelope = await requestNewApiEnvelope<Record<string, unknown>>(
    platform,
    `${root}/api/user/login${qs}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ username, password }),
    }
  );

  const dataObj = (
    envelope.data && typeof envelope.data === "object" ? envelope.data : envelope
  ) as Record<string, unknown>;
  const rawUser = (
    dataObj.user && typeof dataObj.user === "object" ? dataObj.user : dataObj
  ) as Record<string, unknown>;

  const user = parseUserInfo(rawUser, username);
  const accessTokenRaw =
    dataObj.access_token ??
    dataObj.accessToken ??
    rawUser.access_token ??
    rawUser.accessToken ??
    dataObj.token;
  const accessToken =
    typeof accessTokenRaw === "string" && accessTokenRaw.trim()
      ? accessTokenRaw.trim()
      : undefined;

  return {
    user,
    accessToken,
    authHeaders: buildNewApiAuthHeaders(user.id, accessToken),
  };
}

/**
 * 获取当前登录用户的详细账户信息与额度（GET /api/user/self）
 */
export async function fetchUserSelf(
  baseUrl: string,
  authHeaders: Record<string, string>,
  platform: SessionPlatform
): Promise<NewApiUserInfo> {
  const normalized = normalizeNewApiBaseUrl(baseUrl);
  if (!normalized) throw new Error("请先填写 New-API 站点地址");
  const root = resolveEffectiveBaseUrl(normalized);

  const envelope = await requestNewApiEnvelope<Record<string, unknown>>(
    platform,
    `${root}/api/user/self`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...authHeaders,
      },
    }
  );

  const rawData = (
    envelope.data && typeof envelope.data === "object" ? envelope.data : envelope
  ) as Record<string, unknown>;
  return parseUserInfo(rawData);
}

/**
 * 拉取当前账户的 API 令牌列表（GET /api/token/?p=0&size=50，兼容 data.items 与数组）
 */
export async function fetchUserTokens(
  baseUrl: string,
  authHeaders: Record<string, string>,
  platform: SessionPlatform
): Promise<NewApiTokenItem[]> {
  const normalized = normalizeNewApiBaseUrl(baseUrl);
  if (!normalized) throw new Error("请先填写 New-API 站点地址");
  const root = resolveEffectiveBaseUrl(normalized);

  const envelope = await requestNewApiEnvelope<unknown>(
    platform,
    `${root}/api/token/?p=0&size=50`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...authHeaders,
      },
    }
  );

  const data = envelope.data;
  let rawItems: unknown[] = [];
  if (Array.isArray(data)) {
    rawItems = data;
  } else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.items)) {
      rawItems = obj.items;
    } else if (Array.isArray(obj.list)) {
      rawItems = obj.list;
    }
  }

  return rawItems
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map(normalizeTokenItem)
    .filter((t) => Number.isFinite(t.id));
}

/**
 * 揭露单个令牌的明文 Key：
 * - 若令牌已携带非掩码 Key，直接归一化返回
 * - 若为掩码或空 Key，依次尝试 POST /api/token/${id}/key 与 GET /api/token/${id}
 */
export async function resolvePlaintextKeyForToken(
  baseUrl: string,
  token: Pick<NewApiTokenItem, "id" | "key">,
  authHeaders: Record<string, string>,
  platform: SessionPlatform
): Promise<string | null> {
  const inline = (token.key || "").trim();
  if (inline && !isMaskedKey(inline)) {
    return normalizeApiKey(inline);
  }

  const normalized = normalizeNewApiBaseUrl(baseUrl);
  if (!normalized || !Number.isFinite(token.id) || token.id <= 0) {
    return null;
  }
  const root = resolveEffectiveBaseUrl(normalized);

  // 1. 优先尝试 POST /api/token/${id}/key（新版 New-API 明文揭露接口）
  try {
    const postRes = await requestNewApiEnvelope<unknown>(
      platform,
      `${root}/api/token/${token.id}/key`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...authHeaders,
        },
        body: "{}",
      }
    );
    const cand = extractCandidateKeyFromData(postRes.data ?? postRes);
    if (cand && !isMaskedKey(cand)) {
      return normalizeApiKey(cand);
    }
  } catch {
    // 继续回退 GET /api/token/${id}
  }

  // 2. 回退 GET /api/token/${id}
  try {
    const getRes = await requestNewApiEnvelope<unknown>(
      platform,
      `${root}/api/token/${token.id}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...authHeaders,
        },
      }
    );
    const cand = extractCandidateKeyFromData(getRes.data ?? getRes);
    if (cand && !isMaskedKey(cand)) {
      return normalizeApiKey(cand);
    }
  } catch {
    // 两种方式均失败则返回 null
  }

  return null;
}

/**
 * 创建新的 New-API 令牌（默认名为 Mizurisu Agent 且无限额），并提取其明文 Key
 */
export async function createNewApiToken(
  baseUrl: string,
  authHeaders: Record<string, string>,
  platform: SessionPlatform,
  options?: {
    name?: string;
    group?: string;
    remainQuota?: number;
    unlimitedQuota?: boolean;
    expiredTime?: number;
  }
): Promise<NewApiTokenItem> {
  const normalized = normalizeNewApiBaseUrl(baseUrl);
  if (!normalized) throw new Error("请先填写 New-API 站点地址");
  const root = resolveEffectiveBaseUrl(normalized);

  const tokenName = options?.name?.trim() || "Mizurisu Agent";
  const payload = {
    name: tokenName,
    remain_quota: options?.remainQuota ?? 0,
    expired_time: options?.expiredTime ?? -1,
    unlimited_quota: options?.unlimitedQuota ?? true,
    model_limits_enabled: false,
    model_limits: "",
    allow_ips: "",
    group: options?.group ?? "",
  };

  const envelope = await requestNewApiEnvelope<unknown>(
    platform,
    `${root}/api/token/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(payload),
    }
  );

  let createdItem: NewApiTokenItem | undefined;
  if (envelope.data && typeof envelope.data === "object" && !Array.isArray(envelope.data)) {
    const obj = envelope.data as Record<string, unknown>;
    if (obj.id !== undefined || obj.key !== undefined) {
      createdItem = normalizeTokenItem(obj);
      const inlineKey = (createdItem.key || "").trim();
      if (inlineKey && !isMaskedKey(inlineKey)) {
        const key = normalizeApiKey(inlineKey);
        return {
          ...createdItem,
          key,
          maskedKey: maskApiKey(key),
        };
      }
      if (Number.isFinite(createdItem.id) && createdItem.id > 0) {
        const revealed = await resolvePlaintextKeyForToken(
          root,
          createdItem,
          authHeaders,
          platform
        );
        if (revealed) {
          return {
            ...createdItem,
            key: revealed,
            maskedKey: maskApiKey(revealed),
          };
        }
      }
    }
  }

  // 兼容旧版 One-API：POST /api/token/ 返回 data: null，需重新拉取列表定位新建令牌
  const tokens = await fetchUserTokens(root, authHeaders, platform);
  const candidates = tokens
    .filter((t) => t.name === tokenName)
    .sort((a, b) => b.id - a.id);
  const target =
    candidates[0] ??
    createdItem ??
    [...tokens].sort((a, b) => b.id - a.id)[0];

  if (!target) {
    throw new Error("令牌创建请求已返回成功，但列表中未找到新建令牌");
  }

  const plaintext = await resolvePlaintextKeyForToken(root, target, authHeaders, platform);
  if (!plaintext) {
    throw new Error("已自动创建令牌，但未能获取到明文 API Key，请在控制台确认站点配置");
  }

  return {
    ...target,
    key: plaintext,
    maskedKey: maskApiKey(plaintext),
  };
}

async function bootstrapTokensForUser(
  normalizedBaseUrl: string,
  user: NewApiUserInfo,
  authHeaders: Record<string, string>,
  platform: SessionPlatform,
  onProgress?: (message: string) => void
): Promise<{
  tokens: NewApiTokenItem[];
  activeTokenId?: number;
  activeApiKey: string;
}> {
  const initialTokens = await fetchUserTokens(normalizedBaseUrl, authHeaders, platform);
  let tokens = [...initialTokens];
  let activeTokenId: number | undefined;
  let activeApiKey = "";

  const usableTokens = tokens.filter(isTokenUsable);
  for (const candidate of usableTokens) {
    onProgress?.(`正在提取可用令牌「${candidate.name}」的明文 Key...`);
    const resolved = await resolvePlaintextKeyForToken(
      normalizedBaseUrl,
      candidate,
      authHeaders,
      platform
    );
    if (resolved) {
      activeTokenId = candidate.id;
      activeApiKey = resolved;
      tokens = tokens.map((t) =>
        t.id === candidate.id
          ? { ...t, key: resolved, maskedKey: maskApiKey(resolved) }
          : t
      );
      break;
    }
  }

  if (!activeApiKey) {
    onProgress?.("未找到可用的明文令牌，正在自动创建 Mizurisu Agent 无限额令牌...");
    const created = await createNewApiToken(normalizedBaseUrl, authHeaders, platform, {
      name: "Mizurisu Agent",
      group: user.group,
    });
    activeTokenId = created.id;
    activeApiKey = created.key;

    const refreshed = await fetchUserTokens(normalizedBaseUrl, authHeaders, platform).catch(
      () => [] as NewApiTokenItem[]
    );
    if (refreshed.length > 0) {
      const hasCreated = refreshed.some((t) => t.id === created.id);
      tokens = hasCreated
        ? refreshed.map((t) => (t.id === created.id ? created : t))
        : [created, ...refreshed];
    } else {
      tokens = [created, ...tokens];
    }
  }

  return { tokens, activeTokenId, activeApiKey };
}

/**
 * 一键完成 New-API 账号密码鉴权、信息同步与可用 Key 引导：
 * 站点状态 -> 账号登录 -> 用户详情与令牌列表 -> 揭露首个可用启用令牌（若无可用明文令牌则自动新建 Mizurisu Agent 令牌）
 */
export async function authenticateAndBootstrapKey(
  params: {
    baseUrl: string;
    username: string;
    password: string;
    turnstileToken?: string;
    onProgress?: (message: string) => void;
  },
  platform: SessionPlatform
): Promise<AuthSession> {
  const root = normalizeNewApiBaseUrl(params.baseUrl);
  if (!root) {
    throw new Error("请先填写 New-API 站点地址");
  }

  params.onProgress?.("正在读取中转站配置...");
  const siteStatus = await fetchSiteStatus(root, platform).catch<NewApiSiteStatus>(() => ({
    quotaPerUnit: 500000,
    displayInCurrency: true,
  }));

  params.onProgress?.("正在验证账号与密码...");
  const loginRes = await loginNewApiAccount(
    {
      baseUrl: root,
      username: params.username,
      password: params.password,
      turnstileToken: params.turnstileToken,
    },
    platform
  );

  params.onProgress?.("正在同步账户额度与令牌列表...");
  const user = await fetchUserSelf(root, loginRes.authHeaders, platform).catch(
    () => loginRes.user
  );
  const { tokens, activeTokenId, activeApiKey } = await bootstrapTokensForUser(
    root,
    user,
    loginRes.authHeaders,
    platform,
    params.onProgress
  );

  return {
    mode: "account",
    baseUrl: root,
    username: user.username,
    user,
    siteStatus,
    accessToken: loginRes.accessToken,
    tokens,
    activeTokenId,
    activeApiKey,
    loggedInAt: Date.now(),
  };
}

/**
 * 静默探测当前浏览器/客户端是否已存在有效中转站登录 Cookie（同源部署免二次登录）
 */
export async function tryResumeExistingSession(
  baseUrl: string,
  platform: SessionPlatform
): Promise<AuthSession | null> {
  const root = normalizeNewApiBaseUrl(baseUrl);
  if (!root) return null;

  try {
    const user = await fetchUserSelf(root, {}, platform);
    const authHeaders = buildNewApiAuthHeaders(user.id);
    const [siteStatus, bootstrapped] = await Promise.all([
      fetchSiteStatus(root, platform).catch<NewApiSiteStatus>(() => ({
        quotaPerUnit: 500000,
        displayInCurrency: true,
      })),
      bootstrapTokensForUser(root, user, authHeaders, platform),
    ]);

    return {
      mode: "account",
      baseUrl: root,
      username: user.username,
      user,
      siteStatus,
      tokens: bootstrapped.tokens,
      activeTokenId: bootstrapped.activeTokenId,
      activeApiKey: bootstrapped.activeApiKey,
      loggedInAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * 解析从 New-API 后台快捷跳转携带的一次性 Key 与地址参数（支持 hash 与 query）
 */
export function extractAuthFromUrl(
  href: string
): { apiKey: string; baseUrl?: string } | null {
  try {
    const u = new URL(href);
    const hashRaw = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
    const hashParams = new URLSearchParams(hashRaw.includes("=") ? hashRaw : "");
    const searchParams = u.searchParams;

    const rawKey =
      hashParams.get("key") ||
      hashParams.get("apiKey") ||
      hashParams.get("api_key") ||
      searchParams.get("key") ||
      searchParams.get("apiKey") ||
      searchParams.get("api_key");

    const apiKey = rawKey ? normalizeApiKey(rawKey) : "";
    if (!apiKey || apiKey === "sk-") return null;

    const rawBase =
      hashParams.get("baseUrl") ||
      hashParams.get("address") ||
      hashParams.get("server") ||
      searchParams.get("baseUrl") ||
      searchParams.get("address") ||
      searchParams.get("server");

    return {
      apiKey,
      baseUrl: rawBase ? normalizeNewApiBaseUrl(rawBase) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 登出 New-API 会话并清理本地持久化的桌面端 Cookie
 */
export async function logoutNewApiAccount(
  baseUrl: string,
  authHeaders: Record<string, string>,
  platform: SessionPlatform
): Promise<void> {
  const normalized = normalizeNewApiBaseUrl(baseUrl);
  if (normalized) {
    const root = resolveEffectiveBaseUrl(normalized);
    await platform
      .sessionRequest(`${root}/api/user/logout`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...authHeaders,
        },
      })
      .catch(() => undefined);
  }
  await platform.clearSessionCookies?.().catch(() => undefined);
}
