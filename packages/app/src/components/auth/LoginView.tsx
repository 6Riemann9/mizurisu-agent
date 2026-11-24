import {
  AlertCircle,
  Coins,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  Moon,
  Sun,
} from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { isMaskedKey, normalizeApiKey } from "../../newapi/auth";
import {
  DEFAULT_BRAND_NAME,
  DEFAULT_NEWAPI_URL,
  classifyApiError,
  getMizurisuConsoleLinks,
} from "../../newapi/client";
import { useAppStore } from "../../store/useAppStore";
import { BrandLogo } from "../common/FileBadge";

type LoginMode = "account" | "apikey";

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: "dark" | "light" | "auto";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    }
  ) => string;
  reset?: (widgetId: string) => void;
  remove?: (widgetId: string) => void;
}

function canMountTurnstileOnCurrentHost(targetBaseUrl: string): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  if (protocol !== "https:" && protocol !== "http:") return false;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  ) {
    return false;
  }
  const cleanTarget = targetBaseUrl.trim();
  if (!cleanTarget) return false;
  try {
    const parsed = new URL(
      cleanTarget.startsWith("http") ? cleanTarget : `https://${cleanTarget}`
    );
    const stripWww = (h: string) => h.toLowerCase().replace(/^www\./, "");
    return stripWww(hostname) === stripWww(parsed.hostname);
  } catch {
    return false;
  }
}

export function LoginView() {
  const {
    config,
    settings,
    siteStatus,
    checkingExistingSession,
    authBusy,
    authProgress,
    authError,
    loginWithAccount,
    loginWithApiKey,
    enterGuestMode,
    toggleTheme,
  } = useAppStore();

  const initialBaseUrl = config.baseUrl?.trim() || DEFAULT_NEWAPI_URL;
  const [mode, setMode] = useState<LoginMode>("account");
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [urlExpanded, setUrlExpanded] = useState(!initialBaseUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState(config.apiKey || "");
  const [showSecret, setShowSecret] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [keyCleanHint, setKeyCleanHint] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const [autoSwitchedHint, setAutoSwitchedHint] = useState(false);

  const turnstileBoxRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const autoSwitchedForTurnstileRef = useRef(false);

  const errorMessage = localError || authError || null;
  const activeTargetUrl = baseUrl || config.baseUrl || DEFAULT_NEWAPI_URL;
  const consoleLinks = getMizurisuConsoleLinks(activeTargetUrl);
  const diagnosis = errorMessage
    ? classifyApiError(errorMessage, activeTargetUrl)
    : null;
  const maskedKeyDetected = mode === "apikey" && isMaskedKey(apiKey);
  const sameAsStationStatusTarget = (() => {
    try {
      const a = new URL(
        activeTargetUrl.startsWith("http") ? activeTargetUrl : `https://${activeTargetUrl}`
      );
      const bUrl = config.baseUrl || DEFAULT_NEWAPI_URL;
      const b = new URL(bUrl.startsWith("http") ? bUrl : `https://${bUrl}`);
      return a.host.toLowerCase() === b.host.toLowerCase();
    } catch {
      return true;
    }
  })();
  const hostSupportsTurnstile = canMountTurnstileOnCurrentHost(activeTargetUrl);
  const turnstileUnsupportedHere = Boolean(
    sameAsStationStatusTarget && siteStatus?.turnstileCheck && !hostSupportsTurnstile
  );
  const shouldMountTurnstile =
    mode === "account" &&
    Boolean(siteStatus?.turnstileCheck && siteStatus?.turnstileSiteKey) &&
    hostSupportsTurnstile;

  const isTurnstileBlocked = Boolean(
    errorMessage && /turnstile|captcha|人机|验证码|校验/i.test(errorMessage)
  );

  // 探测到站点启用 Turnstile 且当前宿主（如 localhost/桌面端/异域）无法挂载校验时，
  // 首次自动切至 API Key 直连模式，避免用户打开即撞上 Turnstile token is empty 报错
  useEffect(() => {
    if (
      turnstileUnsupportedHere &&
      !autoSwitchedForTurnstileRef.current &&
      mode === "account" &&
      !username &&
      !password
    ) {
      autoSwitchedForTurnstileRef.current = true;
      setMode("apikey");
      setAutoSwitchedHint(true);
    }
  }, [turnstileUnsupportedHere, mode, username, password]);

  useEffect(() => {
    if (!shouldMountTurnstile || !siteStatus?.turnstileSiteKey) {
      setTurnstileToken("");
      return;
    }

    let cancelled = false;
    let attachedScript: HTMLScriptElement | null = null;

    const renderWidget = () => {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (!api || !turnstileBoxRef.current || cancelled) return;
      if (turnstileWidgetIdRef.current && api.remove) {
        api.remove(turnstileWidgetIdRef.current);
      }
      turnstileWidgetIdRef.current = api.render(turnstileBoxRef.current, {
        sitekey: siteStatus.turnstileSiteKey!,
        theme: settings.theme === "light" ? "light" : "dark",
        callback: (token) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken(""),
      });
    };

    if ((window as unknown as { turnstile?: TurnstileApi }).turnstile) {
      renderWidget();
    } else {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[src*="challenges.cloudflare.com/turnstile"]'
      );
      if (existingScript) {
        attachedScript = existingScript;
        existingScript.addEventListener("load", renderWidget);
      } else {
        const script = document.createElement("script");
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        attachedScript = script;
        script.addEventListener("load", renderWidget);
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (attachedScript) {
        attachedScript.removeEventListener("load", renderWidget);
      }
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (turnstileWidgetIdRef.current && api?.remove) {
        try {
          api.remove(turnstileWidgetIdRef.current);
        } catch {
          // 忽略销毁异常
        }
        turnstileWidgetIdRef.current = null;
      }
    };
  }, [shouldMountTurnstile, siteStatus?.turnstileSiteKey, settings.theme]);

  const displayHost = (() => {
    const raw = baseUrl.trim();
    if (!raw) return "";
    try {
      const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      return parsed.host;
    } catch {
      return raw;
    }
  })();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const targetUrl = baseUrl.trim() || DEFAULT_NEWAPI_URL;
    if (!targetUrl) {
      setLocalError("请输入 Mizurisu / AI 中转站点地址");
      return;
    }

    try {
      if (mode === "account") {
        if (!username.trim() || !password) {
          setLocalError("请输入用户名与密码");
          return;
        }
        if (shouldMountTurnstile && !turnstileToken) {
          setLocalError("请先完成下方人机校验");
          return;
        }
        await loginWithAccount(
          targetUrl,
          username.trim(),
          password,
          turnstileToken || undefined
        );
      } else {
        const cleaned = cleanApiKeyInput(apiKey);
        if (!cleaned) {
          setLocalError("请输入有效的 API Key");
          return;
        }
        if (isMaskedKey(cleaned)) {
          setLocalError(
            "检测到当前输入为脱敏掩码 Key，请前往控制台复制完整的明文 API Key"
          );
          return;
        }
        if (cleaned !== apiKey) {
          setApiKey(cleaned);
          setKeyCleanHint("已自动去除 Bearer 前缀与多余空白并规整格式");
        }
        await loginWithApiKey(targetUrl, cleaned);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (turnstileWidgetIdRef.current && api?.reset) {
        api.reset(turnstileWidgetIdRef.current);
        setTurnstileToken("");
      }
    }
  };

  const cleanApiKeyInput = (raw: string): string => {
    const withoutBearer = raw.trim().replace(/^bearer(?:\s+|$)/i, "");
    const compact = withoutBearer.replace(/\s+/g, "");
    return compact ? normalizeApiKey(compact) : "";
  };

  const handleApiKeyChange = (raw: string) => {
    setLocalError(null);
    const hasBearerPrefix = /^\s*bearer\s+(?:sk-|\S{4,})/i.test(raw);
    const hasSurroundingSpaces =
      raw !== raw.trim() && raw.trim().length > 0 && !/^bearer$/i.test(raw.trim());
    const hasInnerSpaces = /\s/.test(raw.trim()) && !/^bearer\s*/i.test(raw.trim());

    if (hasBearerPrefix || hasSurroundingSpaces || hasInnerSpaces) {
      const cleaned = cleanApiKeyInput(raw);
      setApiKey(cleaned);
      setKeyCleanHint(
        cleaned !== raw ? "已自动清洗 Bearer 前缀与多余空白并规整格式" : null
      );
      return;
    }

    setApiKey(raw);
    setKeyCleanHint(null);
  };

  const handleApiKeyPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData?.getData("text") ?? "";
    if (!pasted) return;
    const start = e.currentTarget.selectionStart ?? apiKey.length;
    const end = e.currentTarget.selectionEnd ?? apiKey.length;
    const combined = apiKey.slice(0, start) + pasted + apiKey.slice(end);
    if (
      /^\s*bearer\s+/i.test(combined) ||
      /\s/.test(combined) ||
      pasted !== pasted.trim()
    ) {
      e.preventDefault();
      const cleaned = cleanApiKeyInput(combined);
      setApiKey(cleaned);
      setLocalError(null);
      setKeyCleanHint("已自动清洗粘贴内容中的 Bearer 前缀与多余空白");
    }
  };

  const handleGuest = async () => {
    setLocalError(null);
    try {
      await enterGuestMode();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="min-h-screen w-full bg-[var(--bg-canvas)] text-[var(--text-primary)] flex flex-col items-center justify-center px-4 py-8 relative">
      {/* 右上角极简主题切换 */}
      <button
        type="button"
        onClick={() => toggleTheme()}
        className="absolute top-4 right-4 w-7 h-7 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
        title={settings.theme === "dark" ? "切换至浅色模式" : "切换至深色模式"}
      >
        {settings.theme === "dark" ? (
          <Sun className="w-3.5 h-3.5" />
        ) : (
          <Moon className="w-3.5 h-3.5" />
        )}
      </button>

      {/* 极简居中登录面板 */}
      <div className="w-full max-w-[368px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6">
        {/* 品牌 Logo + 标题 */}
        <div className="flex flex-col items-center text-center mb-5">
          <BrandLogo className="w-11 h-11 rounded-xl mb-3" />
          <h1 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
            {siteStatus?.systemName || config.brandName || DEFAULT_BRAND_NAME}
          </h1>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            {mode === "account"
              ? "登录 Mizurisu / AI 中转站点账号并自动拉取 API Key 与模型"
              : "粘贴你的 Mizurisu / AI 中转站点 API Key 直接进入工作台"}
          </p>
        </div>

        {checkingExistingSession && (
          <div className="mb-3 px-3 py-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] flex items-center justify-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <Loader2 className="w-3 h-3 animate-spin text-[var(--accent)]" />
            <span>正在检测 {displayHost || "中转站"} 已登录会话...</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* 默认已锁定预设站点，平时折叠 */}
          {!urlExpanded ? (
            <div className="h-8 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] flex items-center justify-between gap-2 text-[12px]">
              <div className="flex items-center gap-1.5 min-w-0 text-[var(--text-secondary)]">
                <Globe className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                <span className="font-mono truncate">{displayHost}</span>
              </div>
              <button
                type="button"
                onClick={() => setUrlExpanded(true)}
                className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0 cursor-pointer"
              >
                切换站点
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                  站点地址
                </label>
                {initialBaseUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setBaseUrl(initialBaseUrl);
                      setUrlExpanded(false);
                    }}
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    恢复默认
                  </button>
                )}
              </div>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setLocalError(null);
                }}
                placeholder={DEFAULT_NEWAPI_URL || "https://your-station-domain.com"}
                disabled={authBusy}
                className="w-full h-9 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[13px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-strong)] transition"
              />
            </div>
          )}

          {mode === "account" ? (
            <>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                  用户名
                </label>
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setLocalError(null);
                  }}
                  placeholder="输入中转站账号"
                  disabled={authBusy}
                  autoFocus
                  className="w-full h-9 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-strong)] transition"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                  密码
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setLocalError(null);
                    }}
                    placeholder="输入登录密码"
                    disabled={authBusy}
                    className="w-full h-9 pl-3 pr-9 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-strong)] transition"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    aria-label={showSecret ? "隐藏密码" : "显示密码"}
                  >
                    {showSecret ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {shouldMountTurnstile && (
                <div className="pt-1 flex justify-center">
                  <div ref={turnstileBoxRef} />
                </div>
              )}

              {turnstileUnsupportedHere && !isTurnstileBlocked && (
                <div className="px-3 py-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[11.5px] text-[var(--text-secondary)] leading-relaxed space-y-1.5">
                  <p>
                    当前站点已开启域名人机校验（Turnstile），本地/桌面或异域环境无法直接提交账号密码。建议前往控制台复制 Key 并改用直连：
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-[11px]">
                    <a
                      href={consoleLinks.tokenUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline"
                    >
                      <span>前往控制台复制 Key</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("apikey");
                        setLocalError(null);
                      }}
                      className="text-[var(--text-primary)] underline cursor-pointer"
                    >
                      改用 API Key 直连
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-1.5">
              {autoSwitchedHint && turnstileUnsupportedHere && (
                <div className="px-2.5 py-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[11px] text-[var(--text-secondary)] leading-relaxed">
                  已检测到当前站点开启域名人机校验，已默认切换至「API Key 直连」（部署于站点同域名下可自动复用网页登录态免登）。
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                  API Key
                </label>
                <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
                  <a
                    href={consoleLinks.tokenUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline"
                  >
                    <span>前往控制台获取 Key</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                  <a
                    href={consoleLinks.topupUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
                  >
                    <span>充值/查看额度</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              </div>
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  onPaste={handleApiKeyPaste}
                  onBlur={() => {
                    if (apiKey.trim()) {
                      const cleaned = cleanApiKeyInput(apiKey);
                      if (cleaned && cleaned !== apiKey) {
                        setApiKey(cleaned);
                        setKeyCleanHint("已自动规整 API Key 格式");
                      }
                    }
                  }}
                  placeholder="sk-...（支持直接粘贴带 Bearer 前缀的令牌）"
                  disabled={authBusy}
                  autoFocus
                  className="w-full h-9 pl-3 pr-9 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[13px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-strong)] transition"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  aria-label={showSecret ? "隐藏 Key" : "显示 Key"}
                >
                  {showSecret ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              {keyCleanHint && (
                <p className="text-[11px] text-[var(--status-success)] leading-snug">
                  {keyCleanHint}
                </p>
              )}
              {maskedKeyDetected && (
                <p className="text-[11px] text-[var(--status-warning)] leading-snug">
                  检测到脱敏掩码格式（含 * 或 ...），请前往控制台点击「复制」按钮获取完整明文 Key。
                </p>
              )}
            </div>
          )}

          {errorMessage && diagnosis && (
            <div className="px-3 py-2.5 rounded-md border border-[var(--border-hairline)] border-l-2 border-l-[var(--status-danger)] bg-[var(--bg-elevated)] text-[12px] leading-snug break-words space-y-1.5">
              <div className="flex items-start gap-2 text-[var(--status-danger)] font-medium">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{diagnosis.title}</span>
              </div>
              <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
                {diagnosis.advice}
              </p>

              {(diagnosis.suggestBillingConsole || (isTurnstileBlocked && mode === "account")) && (
                <div className="pt-1 flex flex-wrap items-center gap-3 text-[11px]">
                  <a
                    href={consoleLinks.tokenUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent)] hover:underline inline-flex items-center gap-1"
                  >
                    <span>前往控制台获取 Key</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                  <a
                    href={consoleLinks.topupUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline inline-flex items-center gap-1"
                  >
                    <span>充值/查看额度</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                  {isTurnstileBlocked && mode === "account" && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode("apikey");
                        setLocalError(null);
                      }}
                      className="text-[var(--text-primary)] underline cursor-pointer"
                    >
                      切换 Key 直连
                    </button>
                  )}
                </div>
              )}

              <details className="pt-0.5 text-[11px] text-[var(--text-muted)]">
                <summary className="cursor-pointer hover:text-[var(--text-secondary)] select-none">
                  查看原始报错细节
                </summary>
                <div className="mt-1 font-mono text-[10.5px] break-all opacity-90">
                  {errorMessage}
                </div>
              </details>
            </div>
          )}

          {/* 唯一 #5E6AD2 主操作按钮 */}
          <button
            type="submit"
            disabled={authBusy}
            className="w-full h-9 mt-1 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 text-white text-[13px] font-medium inline-flex items-center justify-center gap-2 transition cursor-pointer"
          >
            {authBusy && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
            <span className="truncate">
              {authBusy
                ? authProgress || "正在同步连接..."
                : mode === "account"
                  ? "登录并同步 Key"
                  : "验证 Key 并进入"}
            </span>
          </button>
        </form>

        {/* 底部直达外链与模式切换 */}
        <div className="mt-5 pt-4 border-t border-[var(--border-hairline)] flex flex-col items-center gap-2 text-[12px] text-[var(--text-muted)]">
          <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
            <a
              href={consoleLinks.tokenUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--border-hairline)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
            >
              <KeyRound className="w-3 h-3 text-[var(--accent)]" />
              <span>前往控制台获取 Key</span>
              <ExternalLink className="w-2.5 h-2.5 text-[var(--text-muted)]" />
            </a>
            <a
              href={consoleLinks.topupUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--border-hairline)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
            >
              <Coins className="w-3 h-3 text-[var(--text-muted)]" />
              <span>充值/查看额度</span>
              <ExternalLink className="w-2.5 h-2.5 text-[var(--text-muted)]" />
            </a>
          </div>
          <button
            type="button"
            disabled={authBusy}
            onClick={() => {
              setMode((m) => (m === "account" ? "apikey" : "account"));
              setLocalError(null);
              setKeyCleanHint(null);
            }}
            className="hover:text-[var(--text-primary)] transition cursor-pointer disabled:opacity-50"
          >
            {mode === "account" ? "使用 API Key 直连" : "返回账号密码登录"}
          </button>
          <button
            type="button"
            disabled={authBusy}
            onClick={handleGuest}
            className="hover:text-[var(--text-primary)] transition cursor-pointer disabled:opacity-50"
          >
            离线体验文档工作台
          </button>
        </div>
      </div>
    </div>
  );
}
