import { ExternalLink, Eye, EyeOff, Globe, Loader2, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { DEFAULT_BRAND_NAME, DEFAULT_NEWAPI_URL } from "../../newapi/client";
import { useAppStore } from "../../store/useAppStore";
import { PiMark } from "../common/FileBadge";

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

function isNonLocalHttpHost(): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  if (protocol !== "https:" && protocol !== "http:") return false;
  return (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "[::1]"
  );
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
  const [turnstileToken, setTurnstileToken] = useState<string>("");

  const turnstileBoxRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  const errorMessage = localError || authError || null;
  const shouldMountTurnstile =
    mode === "account" &&
    Boolean(siteStatus?.turnstileCheck && siteStatus?.turnstileSiteKey) &&
    isNonLocalHttpHost();

  const isTurnstileBlocked = Boolean(
    errorMessage && /turnstile|人机|验证码|校验/i.test(errorMessage)
  );

  useEffect(() => {
    if (!shouldMountTurnstile || !siteStatus?.turnstileSiteKey) {
      setTurnstileToken("");
      return;
    }

    let cancelled = false;
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
        existingScript.addEventListener("load", renderWidget);
      } else {
        const script = document.createElement("script");
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.onload = renderWidget;
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
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
      setLocalError("请输入 New-API 中转站地址");
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
        if (!apiKey.trim()) {
          setLocalError("请输入有效的 API Key");
          return;
        }
        await loginWithApiKey(targetUrl, apiKey.trim());
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

  const handleGuest = async () => {
    setLocalError(null);
    try {
      await enterGuestMode();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  };

  const tokenConsoleUrl = baseUrl.trim()
    ? `${baseUrl.trim().replace(/\/+$/, "")}/console/token`
    : "";

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
        {/* 单色几何标志 + 标题 */}
        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-9 h-9 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-primary)] mb-3">
            <PiMark className="w-5 h-5" />
          </div>
          <h1 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
            {siteStatus?.systemName || config.brandName || DEFAULT_BRAND_NAME}
          </h1>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            {mode === "account"
              ? "登录中转站账号并自动拉取 API Key 与模型"
              : "粘贴你的中转站 API Key 直接进入工作台"}
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
                  中转站地址
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
                placeholder={DEFAULT_NEWAPI_URL || "https://your-newapi-domain.com"}
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
            </>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                  API Key
                </label>
                {tokenConsoleUrl && (
                  <a
                    href={tokenConsoleUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
                  >
                    <span>去 {displayHost} 复制 Key</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setLocalError(null);
                  }}
                  placeholder="sk-..."
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
            </div>
          )}

          {errorMessage && (
            <div className="px-3 py-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[12px] text-[var(--status-danger)] leading-snug break-words space-y-1.5">
              <div>{errorMessage}</div>
              {isTurnstileBlocked && mode === "account" && (
                <div className="pt-1 border-t border-[var(--border-hairline)] text-[11px] text-[var(--text-secondary)] space-y-1">
                  <p>
                    当前站点开启了 Cloudflare Turnstile 域名人机校验（本地 localhost 无法通过校验）。部署到站点同域名下即可自动复用网页登录态免登，或先：
                  </p>
                  <div className="flex items-center gap-3">
                    {tokenConsoleUrl && (
                      <a
                        href={tokenConsoleUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--accent)] hover:underline inline-flex items-center gap-1"
                      >
                        <span>打开令牌页复制 Key</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
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
                  </div>
                </div>
              )}
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

        {/* 底部极克制双行小字切换 */}
        <div className="mt-5 pt-4 border-t border-[var(--border-hairline)] flex flex-col items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          <button
            type="button"
            disabled={authBusy}
            onClick={() => {
              setMode((m) => (m === "account" ? "apikey" : "account"));
              setLocalError(null);
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
