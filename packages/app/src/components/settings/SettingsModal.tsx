import {
  AlertTriangle,
  Check,
  Contrast,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Keyboard,
  KeyRound,
  Loader2,
  LogOut,
  Moon,
  Plus,
  Puzzle,
  RefreshCw,
  Server,
  Shield,
  Sun,
  Trash2,
  Upload,
  User,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createDefaultExtensionHost, listMcpServerTools } from "../../agent/extensions";
import { BUILTIN_SKILLS } from "../../agent/skills";
import { formatQuotaDisplay, maskApiKey } from "../../newapi/auth";
import { getMizurisuConsoleLinks } from "../../newapi/client";
import { getPlatformAdapter } from "../../platform";
import { APP_VERSION, checkLatestRelease, type ReleaseUpdateResult } from "../../platform/updater";
import {
  exportBackupBundle,
  importBackupBundle,
  type BackupBundle,
} from "../../storage/db";
import { useAppStore } from "../../store/useAppStore";
import type { McpServerConfig, ProtocolMode, SkillTemplate } from "../../types";
import { Button, Dialog, Kbd, Tooltip, cn } from "../ui";

type SettingsTab = "account" | "newapi" | "plugins" | "appearance" | "skills" | "data";

const NAV_ITEMS: Array<{ id: SettingsTab; label: string; icon: typeof User }> = [
  { id: "account", label: "账号与令牌", icon: User },
  { id: "newapi", label: "中转站与模型", icon: Server },
  { id: "plugins", label: "插件中心", icon: Puzzle },
  { id: "appearance", label: "外观与快捷键", icon: Contrast },
  { id: "skills", label: "办公技能", icon: Wand2 },
  { id: "data", label: "安全与备份", icon: Shield },
];

export function SettingsContent({ onClose }: { onClose?: () => void }) {
  const {
    config,
    settings,
    models,
    modelsLoading,
    modelsError,
    billing,
    authSession,
    authBusy,
    authError,
    customSkills,
    updateConfig,
    updateSettings,
    toggleHighContrast,
    setShortcutHelpOpen,
    testConnectionAndSync,
    switchActiveToken,
    createAccountToken,
    refreshAccountSession,
    logout,
    saveCustomSkill,
    deleteCustomSkill,
    importSkillMarkdown,
    togglePlugin,
    resetAllData,
    pushToast,
  } = useAppStore();

  const [tab, setTab] = useState<SettingsTab>("account");
  const [showKey, setShowKey] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const [testSuccessMsg, setTestSuccessMsg] = useState<string | null>(null);
  const [newTokenName, setNewTokenName] = useState("Mizurisu Agent");
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [promptDraft, setPromptDraft] = useState(settings.customSystemPrompt ?? "");
  const [promptSavedNotice, setPromptSavedNotice] = useState(false);
  const [redactSecrets, setRedactSecrets] = useState(true);
  const [confirmSecretExport, setConfirmSecretExport] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");
  const [skillPrompt, setSkillPrompt] = useState("");
  const [skillHint, setSkillHint] = useState("");
  const [skillUrlInput, setSkillUrlInput] = useState("");
  const [importingSkillUrl, setImportingSkillUrl] = useState(false);

  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"streamable-http" | "sse">("streamable-http");
  const [mcpToken, setMcpToken] = useState("");
  const [testingMcpId, setTestingMcpId] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<ReleaseUpdateResult | null>(null);

  const importRef = useRef<HTMLInputElement>(null);
  const skillMdInputRef = useRef<HTMLInputElement>(null);
  const siteStatus = authSession?.siteStatus;
  const consoleLinks = getMizurisuConsoleLinks(authSession?.baseUrl || config.baseUrl);
  const highContrastEnabled = Boolean(settings.highContrast);

  const extensionList = useMemo(
    () => createDefaultExtensionHost().listExtensions(settings.enabledPlugins),
    [settings.enabledPlugins]
  );
  const totalEnabledPluginTokens = useMemo(
    () =>
      extensionList
        .filter((e) => e.enabled)
        .reduce((sum, e) => sum + e.estimatedToolTokens, 0),
    [extensionList]
  );

  useEffect(() => {
    setPromptDraft(settings.customSystemPrompt ?? "");
  }, [settings.customSystemPrompt]);

  const handleRefreshAndCheck = async () => {
    if (checkingConnection) return;
    setTokenNotice(null);
    setTokenError(null);
    setCheckingConnection(true);
    try {
      await refreshAccountSession();
      if (authSession?.mode === "account") {
        const synced = await testConnectionAndSync();
        const msg = `连接检测通过，账户会话正常（已同步 ${synced.length} 个模型）`;
        setTokenNotice(msg);
        pushToast(msg, "success");
      } else {
        const syncedCount = useAppStore.getState().models.length;
        const msg = `连接检测通过（已同步 ${syncedCount} 个模型）`;
        setTokenNotice(msg);
        pushToast(msg, "success");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTokenError(msg);
      pushToast(`连接检测失败：${msg}`, "error");
    } finally {
      setCheckingConnection(false);
    }
  };

  const handleTest = async () => {
    setTestSuccessMsg(null);
    try {
      const list = await testConnectionAndSync();
      setTestSuccessMsg(`连接成功，已同步 ${list.length} 个可用模型`);
    } catch {
      // modelsError 由 store 捕获展示
    }
  };

  const handleAddCustomModel = async () => {
    const id = customModelInput.trim();
    if (!id) return;
    if (!config.customModels.includes(id)) {
      await updateConfig({
        customModels: [...config.customModels, id],
        selectedModelId: id,
      });
    }
    setCustomModelInput("");
  };

  const handleRemoveCustomModel = async (id: string) => {
    await updateConfig({
      customModels: config.customModels.filter((m) => m !== id),
    });
  };

  const handleCreateToken = async () => {
    const name = newTokenName.trim() || "Mizurisu Agent";
    setTokenNotice(null);
    setTokenError(null);
    try {
      const created = await createAccountToken(name);
      setTokenNotice(`已创建并启用令牌「${created.name}」`);
      setNewTokenName("Mizurisu Agent");
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSwitchToken = async (tokenId: number) => {
    setTokenNotice(null);
    setTokenError(null);
    try {
      await switchActiveToken(tokenId);
      setTokenNotice("已切换当前使用的 API 令牌并同步模型");
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveCustomPrompt = async (onlyIfDirty = false) => {
    const persisted = settings.customSystemPrompt ?? "";
    if (onlyIfDirty && promptDraft === persisted) {
      return;
    }
    try {
      await updateSettings({
        customSystemPrompt: promptDraft,
      });
      setPromptSavedNotice(true);
      pushToast("自定义办公指令已保存", "success");
    } catch (err) {
      pushToast(
        `保存办公指令失败：${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    }
  };

  const handleAddSkill = async () => {
    if (!skillName.trim() || !skillPrompt.trim()) return;
    const skill: SkillTemplate = {
      id: `custom_${Date.now()}`,
      name: skillName.trim(),
      description: skillDesc.trim() || "自定义办公工作流",
      category: "custom",
      prompt: skillPrompt.trim(),
      systemHint: skillHint.trim() || skillPrompt.trim(),
      builtin: false,
    };
    await saveCustomSkill(skill);
    setSkillName("");
    setSkillDesc("");
    setSkillPrompt("");
    setSkillHint("");
  };

  const runExportBackup = async (includeSecrets: boolean) => {
    if (exportingBackup) return;
    setExportingBackup(true);
    try {
      const bundle = await exportBackupBundle({ includeSecrets });
      const bytes = new TextEncoder().encode(JSON.stringify(bundle, null, 2));
      const filename = `mizurisu-agent-backup-${new Date().toISOString().slice(0, 10)}.json`;
      await getPlatformAdapter().exportFile(
        filename,
        bytes,
        "application/json"
      );
      setConfirmSecretExport(false);
      pushToast(
        includeSecrets
          ? `已导出完整备份（含 API Key，请妥善保管）：${filename}`
          : `已导出安全脱敏备份（不含 API Key）：${filename}`,
        includeSecrets ? "warning" : "success"
      );
    } catch (err) {
      pushToast(
        `导出备份失败：${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    } finally {
      setExportingBackup(false);
    }
  };

  const handleExportBackupClick = () => {
    if (redactSecrets) {
      void runExportBackup(false);
      return;
    }
    setConfirmSecretExport(true);
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupBundle;
      await importBackupBundle(parsed);
      pushToast("备份恢复成功，正在重载工作台…", "success");
      window.location.reload();
    } catch (err) {
      pushToast(
        `导入备份失败：${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    } finally {
      e.target.value = "";
    }
  };

  const activeNav = NAV_ITEMS.find((n) => n.id === tab)!;

  return (
    <div className="flex flex-col sm:flex-row h-full min-h-0 bg-[var(--bg-surface)] text-[var(--text-primary)]">
      {/* 左侧导航栏 (桌面端 184px) */}
      <aside className="sm:w-[184px] shrink-0 border-b sm:border-b-0 sm:border-r border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex flex-col">
        <div className="h-11 px-3 border-b border-[var(--border-hairline)] flex items-center justify-between shrink-0">
          <span className="text-[12px] font-linear-semibold tracking-tight text-[var(--text-primary)]">
            工作台设置
          </span>
          {onClose && (
            <Tooltip content="关闭设置" side="bottom">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                className="sm:hidden"
                aria-label="关闭设置"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>
          )}
        </div>

        <nav className="p-1.5 flex sm:flex-col gap-0.5 overflow-x-auto sm:overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "h-7 px-2.5 rounded-md flex items-center gap-2 text-[12px] whitespace-nowrap shrink-0 transition cursor-pointer linear-focus-ring",
                  active
                    ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-linear-medium"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                )}
              >
                <Icon
                  className={cn(
                    "w-3.5 h-3.5 shrink-0",
                    active ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                  )}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="hidden sm:block mt-auto p-3 border-t border-[var(--border-hairline)] text-[11px] text-[var(--text-muted)] leading-relaxed">
          数据与密钥均保存在本地设备，不经过任何第三方服务器。
        </div>
      </aside>

      {/* 右侧表单区 */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="hidden sm:flex h-11 px-5 border-b border-[var(--border-hairline)] items-center justify-between shrink-0">
          <h2 className="text-[13px] font-linear-semibold text-[var(--text-primary)]">
            {activeNav.label}
          </h2>
          {onClose && (
            <Tooltip content="关闭设置" shortcut="Escape" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="关闭设置"
              >
                <X className="w-4 h-4" />
              </Button>
            </Tooltip>
          )}
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 sm:p-5 space-y-5 text-[12px]">
          {/* Tab 1: 账号与令牌 */}
          {tab === "account" && (
            <>
              <section className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          authSession?.mode !== "guest" && config.apiKey
                            ? "bg-[var(--status-success)]"
                            : "bg-[var(--text-muted)]"
                        )}
                      />
                      <span className="text-[13px] font-linear-semibold text-[var(--text-primary)] truncate">
                        {authSession?.user?.displayName ||
                          authSession?.user?.username ||
                          authSession?.username ||
                          (authSession?.mode === "guest" ? "离线访客模式" : "API Key 直连")}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-muted)]">
                        {authSession?.mode === "account"
                          ? "账号会话"
                          : authSession?.mode === "apikey"
                            ? "Key 直连"
                            : "Guest"}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-[var(--text-muted)] truncate">
                      {authSession?.baseUrl || config.baseUrl || "未绑定中转站地址"}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {authSession && authSession.mode !== "guest" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={authBusy || checkingConnection}
                        onClick={() => void handleRefreshAndCheck()}
                        className="text-[11px]"
                      >
                        <RefreshCw
                          className={cn(
                            "w-3 h-3",
                            (authBusy || checkingConnection) && "animate-spin"
                          )}
                        />
                        <span>刷新并检测连接</span>
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={async () => {
                        await logout();
                        onClose?.();
                      }}
                      className="text-[11px]"
                    >
                      <LogOut className="w-3 h-3" />
                      <span>{authSession?.mode === "guest" ? "前往登录" : "退出登录"}</span>
                    </Button>
                  </div>
                </div>

                {/* 额度统计 */}
                <div className="pt-3 border-t border-[var(--border-hairline)] grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)]">可用余额</div>
                    <div className="mt-0.5 text-[13px] font-mono tabular-nums font-linear-medium text-[var(--text-primary)]">
                      {authSession?.user
                        ? formatQuotaDisplay(authSession.user.quota, siteStatus)
                        : billing?.supported && billing.remainingUsd !== undefined
                          ? `$${billing.remainingUsd.toFixed(4)}`
                          : "--"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)]">已消耗额度</div>
                    <div className="mt-0.5 text-[13px] font-mono tabular-nums text-[var(--text-secondary)]">
                      {authSession?.user
                        ? formatQuotaDisplay(authSession.user.usedQuota, siteStatus)
                        : billing?.usedUsd !== undefined
                          ? `$${billing.usedUsd.toFixed(4)}`
                          : "--"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)]">用户分组</div>
                    <div className="mt-0.5 text-[12px] font-mono text-[var(--text-secondary)] truncate">
                      {authSession?.user?.group || "default"}
                    </div>
                  </div>
                </div>
              </section>

              {(authError || tokenError) && (
                <div className="px-3 py-2 rounded-md border border-[var(--border-hairline)] border-l-2 border-l-[var(--status-danger)] bg-[var(--bg-canvas)] text-[12px] text-[var(--status-danger)]">
                  {tokenError || authError}
                </div>
              )}

              {tokenNotice && (
                <div className="px-3 py-2 rounded-md border border-[var(--border-hairline)] border-l-2 border-l-[var(--status-success)] bg-[var(--bg-canvas)] text-[12px] text-[var(--text-primary)]">
                  {tokenNotice}
                </div>
              )}

              {authSession?.mode === "account" ? (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-[12px] font-linear-semibold text-[var(--text-primary)]">
                        API 令牌列表
                      </h3>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        切换活动令牌或一键生成新的无限额令牌供当前工作台调用
                      </p>
                    </div>
                  </div>

                  {/* 一键新建令牌 */}
                  <div className="flex gap-2">
                    <input
                      value={newTokenName}
                      onChange={(e) => setNewTokenName(e.target.value)}
                      placeholder="新令牌名称，例如 Mizurisu Agent"
                      className="flex-1 h-8 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] linear-focus-ring"
                    />
                    <Button
                      variant="primary"
                      size="md"
                      disabled={authBusy}
                      onClick={handleCreateToken}
                      className="text-[12px]"
                    >
                      {authBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      <span>新建令牌</span>
                    </Button>
                  </div>

                  {/* 令牌列表 */}
                  <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] divide-y divide-[var(--border-hairline)]">
                    {authSession.tokens.length === 0 ? (
                      <div className="p-4 text-center text-[11px] text-[var(--text-muted)]">
                        暂无可用令牌，请点击上方「新建令牌」
                      </div>
                    ) : (
                      authSession.tokens.map((tk) => {
                        const isActive = tk.id === authSession.activeTokenId;
                        const enabled = tk.status === 1;
                        return (
                          <div
                            key={tk.id}
                            className="px-3 py-2.5 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    "w-1.5 h-1.5 rounded-full shrink-0",
                                    enabled
                                      ? "bg-[var(--status-success)]"
                                      : "bg-[var(--text-muted)]"
                                  )}
                                />
                                <span className="font-linear-medium text-[var(--text-primary)] truncate">
                                  {tk.name || `Token #${tk.id}`}
                                </span>
                                {isActive && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--accent-soft)] text-[var(--accent)] font-linear-medium">
                                    当前使用
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--text-muted)]">
                                <span>{maskApiKey(tk.key || tk.maskedKey)}</span>
                                <span>·</span>
                                <span className="tabular-nums">
                                  {tk.unlimitedQuota
                                    ? "无限额度"
                                    : formatQuotaDisplay(tk.remainQuota, siteStatus)}
                                </span>
                              </div>
                            </div>

                            <Button
                              variant={isActive ? "ghost" : "secondary"}
                              size="sm"
                              disabled={isActive || !enabled || authBusy}
                              onClick={() => handleSwitchToken(tk.id)}
                              className="text-[11px]"
                            >
                              {isActive ? (
                                <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">
                                  <Check className="w-3 h-3 text-[var(--accent)]" />
                                  已选
                                </span>
                              ) : (
                                "切换使用"
                              )}
                            </Button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              ) : (
                <section className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <KeyRound className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                    <div className="min-w-0">
                      <div className="font-linear-medium text-[var(--text-primary)]">
                        当前活动密钥
                      </div>
                      <div className="text-[11px] font-mono text-[var(--text-muted)] truncate">
                        {config.apiKey ? maskApiKey(config.apiKey) : "未配置 API Key"}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setTab("newapi")}
                    className="text-[11px]"
                  >
                    修改密钥
                  </Button>
                </section>
              )}

              <section className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3.5 space-y-2.5">
                <div>
                  <div className="text-[12px] font-linear-semibold text-[var(--text-primary)]">
                    Mizurisu 站点控制台直达
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    前往中转站网页端管理令牌密钥、在线充值额度或查看 API 调用消耗明细
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    {
                      label: "站点控制台主页",
                      desc: "账户总览与站点公告",
                      href: consoleLinks.homeUrl,
                    },
                    {
                      label: "令牌管理页",
                      desc: "创建、禁用或复制密钥 (/console/token)",
                      href: consoleLinks.tokenUrl,
                    },
                    {
                      label: "额度充值页",
                      desc: "在线充值或兑换额度 (/console/topup)",
                      href: consoleLinks.topupUrl,
                    },
                    {
                      label: "调用日志页",
                      desc: "核对消费记录与请求详情 (/console/log)",
                      href: consoleLinks.logUrl,
                    },
                  ].map((item) => (
                    <a
                      key={item.label}
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] flex items-center justify-between gap-2 transition linear-focus-ring"
                    >
                      <div className="min-w-0">
                        <div className="font-linear-medium text-[var(--text-primary)] truncate">
                          {item.label}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
                          {item.desc}
                        </div>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    </a>
                  ))}
                </div>
              </section>

              <details className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3.5">
                <summary className="text-[11px] font-linear-medium text-[var(--text-secondary)] cursor-pointer select-none">
                  站点部署与免登集成参考（管理员）
                </summary>
                <div className="mt-2 space-y-1.5">
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    将构建产物部署在站点同域名子路径（如 <code className="font-mono">/agent/</code>）可自动复用登录 Cookie 免登；也可在后台快捷聊天入口填入下方模板实现点击直达并自动擦除地址栏参数：
                  </p>
                  <div className="px-2.5 py-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border-hairline)] font-mono text-[10px] text-[var(--text-secondary)] select-all break-all">
                    https://www.mizurisu.com/agent/#key=&#123;key&#125;&amp;address=&#123;address&#125;
                  </div>
                </div>
              </details>
            </>
          )}

          {/* Tab 2: 中转站与模型 */}
          {tab === "newapi" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block font-linear-medium text-[var(--text-secondary)]">
                  工作台名称
                </label>
                <input
                  value={config.brandName}
                  onChange={(e) => updateConfig({ brandName: e.target.value })}
                  placeholder="Mizurisu Agent"
                  className="w-full h-8 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] linear-focus-ring"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block font-linear-medium text-[var(--text-secondary)]">
                  Mizurisu / 服务站点地址 (Base URL)
                </label>
                <input
                  value={config.baseUrl}
                  onChange={(e) => updateConfig({ baseUrl: e.target.value })}
                  placeholder="https://www.mizurisu.com"
                  className="w-full h-8 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] font-mono linear-focus-ring"
                />
                <p className="text-[11px] text-[var(--text-muted)]">
                  填写根域名即可，系统会自动归一化处理 `/v1` 与 `/v1beta` 路径。
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block font-linear-medium text-[var(--text-secondary)]">
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={config.apiKey}
                    onChange={(e) => updateConfig({ apiKey: e.target.value })}
                    placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full h-8 pl-3 pr-9 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] font-mono linear-focus-ring"
                  />
                  <Tooltip content={showKey ? "隐藏 API Key" : "显示 API Key"} side="left">
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer rounded linear-focus-ring"
                    >
                      {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </Tooltip>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-linear-medium text-[var(--text-secondary)]">
                  协议路由策略
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(
                    [
                      [
                        "compatible",
                        "OpenAI 全兼容模式 (推荐)",
                        "全部模型走 /v1/chat/completions，兼容 Mizurisu 及标准中转服务渠道。",
                      ],
                      [
                        "auto",
                        "原生多协议路由",
                        "Claude 走 /v1/messages，Gemini 走 /v1beta，保留原生思考链。",
                      ],
                    ] as Array<[ProtocolMode, string, string]>
                  ).map(([val, title, desc]) => {
                    const active = config.protocolMode === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => updateConfig({ protocolMode: val })}
                        className={cn(
                          "text-left p-3 rounded-lg border transition cursor-pointer linear-focus-ring",
                          active
                            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                            : "border-[var(--border-hairline)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]"
                        )}
                      >
                        <div className="font-linear-medium text-[var(--text-primary)]">{title}</div>
                        <div className="mt-1 text-[11px] text-[var(--text-muted)] leading-snug">
                          {desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleTest}
                  disabled={modelsLoading}
                  className="text-[12px]"
                >
                  {modelsLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>测试连接并同步模型</span>
                </Button>
                {models.length > 0 && (
                  <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
                    已同步 {models.length} 个可用模型
                  </span>
                )}
              </div>

              {testSuccessMsg && (
                <div className="px-3 py-2 rounded-md border border-[var(--border-hairline)] border-l-2 border-l-[var(--status-success)] bg-[var(--bg-canvas)] text-[var(--text-primary)]">
                  {testSuccessMsg}
                </div>
              )}

              {modelsError && (
                <div className="px-3 py-2 rounded-md border border-[var(--border-hairline)] border-l-2 border-l-[var(--status-danger)] bg-[var(--bg-canvas)] text-[var(--status-danger)] space-y-1">
                  <div>{modelsError}</div>
                  {getPlatformAdapter().kind === "web" && (
                    <p className="text-[11px] text-[var(--text-muted)]">
                      提示：浏览器如遇 CORS 跨域限制，请在服务站点反向代理放行 CORS 或使用 Mizurisu Agent 桌面客户端。
                    </p>
                  )}
                </div>
              )}

              <div className="pt-3 border-t border-[var(--border-hairline)] space-y-2">
                <label className="block font-linear-medium text-[var(--text-secondary)]">
                  手动补充模型 ID
                </label>
                <div className="flex gap-2">
                  <input
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCustomModel();
                      }
                    }}
                    placeholder="例如 claude-sonnet-4-5-20250929"
                    className="flex-1 h-8 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] outline-none focus:border-[var(--border-strong)] font-mono linear-focus-ring"
                  />
                  <Button variant="secondary" size="md" onClick={handleAddCustomModel} className="text-[12px]">
                    <Plus className="w-3.5 h-3.5" />
                    <span>添加</span>
                  </Button>
                </div>

                {config.customModels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {config.customModels.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] font-mono text-[11px] text-[var(--text-secondary)]"
                      >
                        <span>{id}</span>
                        <Tooltip content={`移除自定义模型 ${id}`} side="top">
                          <button
                            type="button"
                            onClick={() => handleRemoveCustomModel(id)}
                            aria-label={`移除 ${id}`}
                            className="text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer rounded linear-focus-ring"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Tooltip>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-[var(--border-hairline)] space-y-3">
                <div className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] flex items-center justify-between gap-3">
                  <div>
                    <div className="font-linear-medium text-[var(--text-primary)]">
                      隐藏非对话模型
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      开启后，模型选择器默认过滤向量（Embedding）、语音、生图等非对话专用模型。
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={!settings.showNonChatModels}
                    onChange={(e) =>
                      updateSettings({ showNonChatModels: !e.target.checked })
                    }
                    className="w-4 h-4 accent-[var(--accent)] cursor-pointer shrink-0"
                    aria-label="隐藏非对话模型"
                  />
                </div>

                <div className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="custom-system-prompt"
                      className="font-linear-medium text-[var(--text-primary)]"
                    >
                      自定义办公指令（全局 System Prompt 补充）
                    </label>
                    {promptSavedNotice && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--status-success)]">
                        <Check className="w-3 h-3" />
                        <span>已保存</span>
                      </span>
                    )}
                  </div>
                  <textarea
                    id="custom-system-prompt"
                    rows={3}
                    value={promptDraft}
                    onChange={(e) => {
                      setPromptSavedNotice(false);
                      setPromptDraft(e.target.value);
                    }}
                    onBlur={() => void handleSaveCustomPrompt(true)}
                    placeholder="例如：默认输出财务严谨口径，币种保留两位小数；报告结尾统一附带风险提示与下一步行动建议..."
                    className="w-full p-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-strong)] resize-y leading-relaxed linear-focus-ring"
                  />
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="text-[11px] text-[var(--text-muted)]">
                      离开输入框或点击右侧按钮时保存，并自动附加到后续每次 AI 对话中。
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleSaveCustomPrompt(false)}
                      className="text-[11px]"
                    >
                      保存指令
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2.5: Pi 插件中心 */}
          {tab === "plugins" && (
            <div className="space-y-4">
              <section className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-linear-semibold text-[var(--text-primary)]">
                    Mizurisu-Pi 扩展插件中心
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    关闭不需要的插件后，其工具定义不会注入上下文，既省 Token 又降低模型误调用。
                  </p>
                </div>
                <span className="font-mono tabular-nums text-[11px] px-2 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)]">
                  已启用工具约 {totalEnabledPluginTokens.toLocaleString()} tokens
                </span>
              </section>

              <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] divide-y divide-[var(--border-hairline)]">
                {extensionList.map((ext) => (
                  <div
                    key={ext.id}
                    className="p-3.5 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-linear-medium text-[var(--text-primary)]">
                          {ext.name}
                        </span>
                        <span className="font-mono text-[10px] px-1.5 py-px rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-muted)]">
                          {ext.id}
                        </span>
                        {ext.toolNames.length > 0 && (
                          <span className="font-mono tabular-nums text-[10px] text-[var(--text-muted)]">
                            {ext.toolNames.length} 工具 · ~{ext.estimatedToolTokens} tokens
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                        {ext.description}
                      </p>
                      {ext.toolNames.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {ext.toolNames.map((tName) => (
                            <span
                              key={tName}
                              className="font-mono text-[10px] px-1.5 py-px rounded bg-[var(--surface-subtle)] text-[var(--text-secondary)]"
                            >
                              {tName}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={ext.enabled}
                      aria-label={`切换插件 ${ext.name}`}
                      onClick={() => void togglePlugin(ext.id, !ext.enabled)}
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition cursor-pointer linear-focus-ring mt-0.5",
                        ext.enabled
                          ? "border-[var(--accent)] bg-[var(--accent)]"
                          : "border-[var(--border-strong)] bg-[var(--bg-elevated)]"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-150",
                          ext.enabled ? "translate-x-[18px]" : "translate-x-[2px]"
                        )}
                      />
                    </button>
                  </div>
                ))}
              </div>

              {/* 免费联网检索与只读保护规则补充配置 */}
              <section className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-3">
                <div className="font-linear-semibold text-[var(--text-primary)]">
                  免费联网源与受保护原件规则
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="block space-y-1">
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      自定义 SearXNG 搜索地址（可选）
                    </span>
                    <input
                      type="text"
                      value={settings.customSearxngUrl || ""}
                      onChange={(e) =>
                        void updateSettings({ customSearxngUrl: e.target.value.trim() })
                      }
                      placeholder="https://searx.example.com"
                      className="w-full h-8 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] font-mono text-[11px] outline-none focus:border-[var(--border-strong)] linear-focus-ring"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      Web 端同域抓取代理（可选）
                    </span>
                    <input
                      type="text"
                      value={settings.webProxyUrl || ""}
                      onChange={(e) =>
                        void updateSettings({ webProxyUrl: e.target.value.trim() })
                      }
                      placeholder="https://www.mizurisu.com/api/fetch"
                      className="w-full h-8 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] font-mono text-[11px] outline-none focus:border-[var(--border-strong)] linear-focus-ring"
                    />
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    受保护只读路径（每行一条，支持 `*` 通配，也可在左侧文件栏点锁图标切换）
                  </span>
                  <textarea
                    rows={2}
                    value={(settings.protectedPaths || []).join("\n")}
                    onChange={(e) =>
                      void updateSettings({
                        protectedPaths: e.target.value
                          .split(/\r?\n/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="例如：&#10;重要合同原件.docx&#10;templates/*.xlsx"
                    className="w-full p-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] font-mono text-[11px] outline-none focus:border-[var(--border-strong)] resize-y linear-focus-ring"
                  />
                </label>
              </section>

              {/* Remote MCP 服务器配置（按需发现省 Token） */}
              <section className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-3">
                <div>
                  <div className="font-linear-semibold text-[var(--text-primary)]">
                    Remote MCP 服务器（Streamable HTTP / SSE，三端通用）
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    接入后仅占用约 200 Token 的单一 `mcp_proxy` 按需发现工具；无启用服务器时 0 Token 开销。
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={mcpName}
                    onChange={(e) => setMcpName(e.target.value)}
                    placeholder="服务名称，如 飞书助手"
                    className="h-8 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[11.5px] outline-none focus:border-[var(--border-strong)] linear-focus-ring"
                  />
                  <select
                    value={mcpTransport}
                    onChange={(e) => setMcpTransport(e.target.value as "streamable-http" | "sse")}
                    className="h-8 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[11.5px] outline-none focus:border-[var(--border-strong)] linear-focus-ring"
                  >
                    <option value="streamable-http">Streamable HTTP</option>
                    <option value="sse">SSE (HTTP POST)</option>
                  </select>
                  <input
                    value={mcpUrl}
                    onChange={(e) => setMcpUrl(e.target.value)}
                    placeholder="Endpoint URL，如 https://mcp.example.com/mcp"
                    className="sm:col-span-2 h-8 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] font-mono text-[11px] outline-none focus:border-[var(--border-strong)] linear-focus-ring"
                  />
                  <input
                    value={mcpToken}
                    onChange={(e) => setMcpToken(e.target.value)}
                    placeholder="Bearer Token（可选，将作为 Authorization 请求头发送）"
                    className="sm:col-span-2 h-8 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] font-mono text-[11px] outline-none focus:border-[var(--border-strong)] linear-focus-ring"
                  />
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!mcpName.trim() || !mcpUrl.trim()}
                  onClick={() => {
                    const nextSrv: McpServerConfig = {
                      id: `mcp_${Date.now().toString(36)}`,
                      name: mcpName.trim(),
                      url: mcpUrl.trim(),
                      transport: mcpTransport,
                      ...(mcpToken.trim()
                        ? { headers: { Authorization: `Bearer ${mcpToken.trim()}` } }
                        : {}),
                      enabled: true,
                    };
                    const prev = settings.mcpServers || [];
                    void updateSettings({ mcpServers: [...prev, nextSrv] }).then(() => {
                      setMcpName("");
                      setMcpUrl("");
                      setMcpToken("");
                      pushToast(`已添加 MCP 服务器「${nextSrv.name}」`, "success");
                    });
                  }}
                  className="text-[11px]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>添加 Remote MCP</span>
                </Button>

                {(settings.mcpServers || []).length > 0 && (
                  <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)]">
                    {(settings.mcpServers || []).map((srv) => (
                      <div
                        key={srv.id}
                        className="px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-linear-medium text-[var(--text-primary)] truncate">
                              {srv.name}
                            </span>
                            <span className="font-mono text-[10px] px-1 rounded bg-[var(--surface-subtle)] text-[var(--text-muted)]">
                              {srv.transport}
                            </span>
                          </div>
                          <div className="font-mono text-[10.5px] text-[var(--text-muted)] truncate">
                            {srv.url}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={testingMcpId === srv.id}
                            onClick={async () => {
                              setTestingMcpId(srv.id);
                              try {
                                const tools = await listMcpServerTools(
                                  srv,
                                  getPlatformAdapter().getFetch(),
                                  true
                                );
                                pushToast(
                                  `MCP「${srv.name}」连接正常，发现 ${tools.length} 个工具`,
                                  "success"
                                );
                              } catch (err) {
                                pushToast(
                                  `MCP 测试失败：${err instanceof Error ? err.message : String(err)}`,
                                  "error"
                                );
                              } finally {
                                setTestingMcpId(null);
                              }
                            }}
                            className="text-[11px]"
                          >
                            {testingMcpId === srv.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3 h-3" />
                            )}
                            <span>测试</span>
                          </Button>
                          <input
                            type="checkbox"
                            checked={srv.enabled}
                            onChange={(e) => {
                              const nextList = (settings.mcpServers || []).map((item) =>
                                item.id === srv.id
                                  ? { ...item, enabled: e.target.checked }
                                  : item
                              );
                              void updateSettings({ mcpServers: nextList });
                            }}
                            aria-label={`启用 MCP ${srv.name}`}
                            className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                          />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => {
                              const nextList = (settings.mcpServers || []).filter(
                                (item) => item.id !== srv.id
                              );
                              void updateSettings({ mcpServers: nextList });
                            }}
                            aria-label={`删除 MCP ${srv.name}`}
                            className="hover:text-[var(--status-danger)]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* Tab 3: 外观与快捷键 */}
          {tab === "appearance" && (
            <div className="space-y-4">
              {/* 深色 / 浅色主题切换 */}
              <section className="p-4 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-3">
                <div>
                  <div className="text-[12px] font-linear-semibold text-[var(--text-primary)]">
                    界面主题色彩
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    基于 OKLCH 感知均匀色域构建，默认推荐暗夜沉静模式以突出文档与表格主体。
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void updateSettings({ theme: "dark" })}
                    aria-pressed={settings.theme === "dark"}
                    className={cn(
                      "px-3 py-2.5 rounded-lg border flex items-center justify-between gap-2 transition cursor-pointer linear-focus-ring",
                      settings.theme === "dark"
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]"
                        : "border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]"
                    )}
                  >
                    <span className="inline-flex items-center gap-2 font-linear-medium">
                      <Moon className="w-3.5 h-3.5" />
                      <span>深色模式 (Dark)</span>
                    </span>
                    {settings.theme === "dark" && (
                      <Check className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void updateSettings({ theme: "light" })}
                    aria-pressed={settings.theme === "light"}
                    className={cn(
                      "px-3 py-2.5 rounded-lg border flex items-center justify-between gap-2 transition cursor-pointer linear-focus-ring",
                      settings.theme === "light"
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]"
                        : "border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]"
                    )}
                  >
                    <span className="inline-flex items-center gap-2 font-linear-medium">
                      <Sun className="w-3.5 h-3.5" />
                      <span>浅色模式 (Light)</span>
                    </span>
                    {settings.theme === "light" && (
                      <Check className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                    )}
                  </button>
                </div>
              </section>

              {/* 高对比度模式 (OKLCH 对比度增强) */}
              <section className="p-4 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Contrast className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                    <span className="text-[12px] font-linear-semibold text-[var(--text-primary)]">
                      高对比度模式（OKLCH 对比度增强）
                    </span>
                    {highContrastEnabled && (
                      <span className="text-[10px] px-1.5 py-px rounded bg-[var(--accent-soft)] text-[var(--accent)] font-linear-medium">
                        已开启
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    同步拉升深色与浅色模式下的文字亮度差、发丝分割线透明度及强调色对比度，改善强光与长时阅读清晰度。
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={highContrastEnabled}
                  aria-label="高对比度模式（OKLCH 对比度增强）"
                  onClick={() => void toggleHighContrast()}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition cursor-pointer linear-focus-ring",
                    highContrastEnabled
                      ? "border-[var(--accent)] bg-[var(--accent)]"
                      : "border-[var(--border-strong)] bg-[var(--bg-elevated)]"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-150",
                      highContrastEnabled ? "translate-x-[18px]" : "translate-x-[2px]"
                    )}
                  />
                </button>
              </section>

              {/* 键盘快捷键速查入口 */}
              <section className="p-4 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Keyboard className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                      <span className="text-[12px] font-linear-semibold text-[var(--text-primary)]">
                        键盘快捷键指南
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      查看命令面板、面板折叠、全屏文档台与会话流全套单键操作。
                    </p>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShortcutHelpOpen(true)}
                  >
                    <Keyboard className="w-3.5 h-3.5" />
                    <span>打开快捷键速查</span>
                    <Kbd keys="?" />
                  </Button>
                </div>

                <div className="pt-2.5 border-t border-[var(--border-hairline)] flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-[var(--text-muted)]">
                  <span className="inline-flex items-center gap-1.5">
                    <Kbd keys={["Mod", "K"]} />
                    <span>命令面板</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Kbd keys="[" />
                    <span>侧栏</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Kbd keys="]" />
                    <span>文档台</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Kbd keys="\" />
                    <span>全屏编辑</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Kbd keys="C" />
                    <span>新建会话</span>
                  </span>
                </div>
              </section>
            </div>
          )}

          {/* Tab 4: 办公技能 */}
          {tab === "skills" && (
            <div className="space-y-5">
              {/* 标准 Pi SKILL.md 导入器 */}
              <div className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-linear-semibold text-[var(--text-primary)]">
                      导入标准 SKILL.md（兼容 Pi / 社区技能）
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      支持带 YAML Frontmatter 的 `.md` 文件或直链 URL，导入后可直接在 `/` 菜单呼出。
                    </p>
                  </div>
                  <div>
                    <input
                      ref={skillMdInputRef}
                      type="file"
                      accept=".md,.markdown"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const raw = await file.text();
                          const skill = await importSkillMarkdown(raw, file.name);
                          pushToast(`已导入 SKILL.md：「${skill.name}」`, "success");
                        } catch (err) {
                          pushToast(
                            `导入 SKILL.md 失败：${err instanceof Error ? err.message : String(err)}`,
                            "error"
                          );
                        } finally {
                          e.target.value = "";
                        }
                      }}
                      className="hidden"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => skillMdInputRef.current?.click()}
                      className="text-[11px]"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>选择 .md 文件</span>
                    </Button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <input
                    value={skillUrlInput}
                    onChange={(e) => setSkillUrlInput(e.target.value)}
                    placeholder="粘贴 SKILL.md 原始链接（如 https://raw.githubusercontent.com/.../SKILL.md）"
                    className="flex-1 min-w-0 h-8 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[11.5px] font-mono outline-none focus:border-[var(--border-strong)] linear-focus-ring"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={importingSkillUrl || !skillUrlInput.trim()}
                    onClick={async () => {
                      const rawUrl = skillUrlInput.trim();
                      if (!rawUrl) return;
                      setImportingSkillUrl(true);
                      try {
                        const res = await getPlatformAdapter().getFetch()(rawUrl);
                        if (!res.ok) {
                          throw new Error(`HTTP ${res.status}`);
                        }
                        const text = await res.text();
                        const nameFromUrl = rawUrl.split("/").pop() || "SKILL.md";
                        const skill = await importSkillMarkdown(text, nameFromUrl);
                        setSkillUrlInput("");
                        pushToast(`已从链接导入技能：「${skill.name}」`, "success");
                      } catch (err) {
                        pushToast(
                          `URL 导入失败：${err instanceof Error ? err.message : String(err)}`,
                          "error"
                        );
                      } finally {
                        setImportingSkillUrl(false);
                      }
                    }}
                    className="text-[11px] shrink-0"
                  >
                    {importingSkillUrl && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>URL 导入</span>
                  </Button>
                </div>
              </div>

              <div className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-2.5">
                <div className="font-linear-semibold text-[var(--text-primary)]">
                  新建自定义办公技能
                </div>
                <input
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  placeholder="技能名称，例如：财务对账单核对"
                  className="w-full h-8 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] outline-none focus:border-[var(--border-strong)] linear-focus-ring"
                />
                <input
                  value={skillDesc}
                  onChange={(e) => setSkillDesc(e.target.value)}
                  placeholder="简短说明（可选）"
                  className="w-full h-8 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] outline-none focus:border-[var(--border-strong)] linear-focus-ring"
                />
                <textarea
                  rows={2}
                  value={skillPrompt}
                  onChange={(e) => setSkillPrompt(e.target.value)}
                  placeholder="填入对话时的默认指令模板..."
                  className="w-full p-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] outline-none focus:border-[var(--border-strong)] resize-none linear-focus-ring"
                />
                <textarea
                  rows={2}
                  value={skillHint}
                  onChange={(e) => setSkillHint(e.target.value)}
                  placeholder="附加系统级约束指令（可选）..."
                  className="w-full p-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] outline-none focus:border-[var(--border-strong)] resize-none linear-focus-ring"
                />
                <Button variant="primary" size="md" onClick={handleAddSkill} className="text-[12px]">
                  <Plus className="w-3.5 h-3.5" />
                  <span>保存技能</span>
                </Button>
              </div>

              <div className="space-y-2">
                <div className="font-linear-medium text-[var(--text-secondary)]">
                  自定义技能 (<span className="tabular-nums">{customSkills.length}</span>)
                </div>
                {customSkills.length === 0 ? (
                  <div className="text-[11px] text-[var(--text-muted)]">暂无自定义技能</div>
                ) : (
                  <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] divide-y divide-[var(--border-hairline)]">
                    {customSkills.map((sk) => (
                      <div
                        key={sk.id}
                        className="px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-linear-medium text-[var(--text-primary)] truncate">
                            {sk.name}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate">
                            {sk.description}
                          </div>
                        </div>
                        <Tooltip content={`删除技能「${sk.name}」`} side="left">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => deleteCustomSkill(sk.id)}
                            aria-label={`删除技能 ${sk.name}`}
                            className="hover:text-[var(--status-danger)]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </Tooltip>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="font-linear-medium text-[var(--text-secondary)]">
                  内置标准技能 (<span className="tabular-nums">{BUILTIN_SKILLS.length}</span>)
                </div>
                <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] divide-y divide-[var(--border-hairline)]">
                  {BUILTIN_SKILLS.map((sk) => (
                    <div key={sk.id} className="px-3 py-2 space-y-0.5">
                      <div className="font-linear-medium text-[var(--text-primary)]">
                        {sk.name}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {sk.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab 5: 安全与备份 */}
          {tab === "data" && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] flex items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Shield className="w-4 h-4 text-[var(--text-muted)] mt-0.5 shrink-0" />
                  <div>
                    <div className="font-linear-medium text-[var(--text-primary)]">
                      删除工作区文件免弹窗确认
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      关闭后，每次 Agent 调用 delete_file 前都会请求确认（Shell 命令始终强制审批）。
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoApproveDelete}
                  onChange={(e) =>
                    updateSettings({ autoApproveDelete: e.target.checked })
                  }
                  aria-label="删除工作区文件免弹窗确认"
                  className="w-4 h-4 accent-[var(--accent)] cursor-pointer shrink-0"
                />
              </div>

              <div className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-3">
                <div className="flex items-center gap-2 font-linear-medium text-[var(--text-primary)]">
                  <Database className="w-4 h-4 text-[var(--text-muted)]" />
                  <span>导出工作区与对话备份</span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  将对话历史、工作区文档与配置导出为单个 JSON 文件，可在网页端、桌面端与移动端间迁移恢复。
                </p>

                <label className="flex items-start justify-between gap-3 p-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] cursor-pointer">
                  <div className="space-y-0.5">
                    <div className="font-linear-medium text-[var(--text-primary)]">
                      安全脱敏模式（不包含 API Key 密钥）
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      推荐保持开启。关闭后导出的 JSON 将明文保留当前 API Key。
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={redactSecrets}
                    onChange={(e) => {
                      setRedactSecrets(e.target.checked);
                      setConfirmSecretExport(false);
                    }}
                    className="w-4 h-4 mt-0.5 accent-[var(--accent)] cursor-pointer shrink-0"
                  />
                </label>

                <div className="px-3 py-2 rounded-md border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 flex items-start gap-2 text-[11px] leading-relaxed text-[var(--text-primary)]">
                  <AlertTriangle className="w-3.5 h-3.5 text-[var(--status-warning)] mt-0.5 shrink-0" />
                  <span>
                    {redactSecrets
                      ? "安全提示：当前已开启安全脱敏模式，导出备份时会自动抹除 API Key 密钥，适合安全归档或分享迁移；恢复后重新填入密钥即可使用。"
                      : "安全警示：你已取消脱敏模式，导出的备份文件将包含明文 API Key 密钥，请勿分享给他人或上传至公共网盘！"}
                  </span>
                </div>

                {confirmSecretExport && !redactSecrets && (
                  <div className="p-2.5 rounded-md border border-[var(--status-warning)]/50 bg-[var(--bg-surface)] space-y-2">
                    <div className="text-[11px] font-linear-medium text-[var(--status-warning)]">
                      二次确认：确定要在备份文件中包含明文 API Key 密钥吗？
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={exportingBackup}
                        onClick={() => void runExportBackup(true)}
                        className="border-transparent bg-[var(--status-warning)] text-black hover:bg-[var(--status-warning)]/90 text-[11px]"
                      >
                        {exportingBackup && <Loader2 className="w-3 h-3 animate-spin" />}
                        <span>确认导出含密钥备份</span>
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setRedactSecrets(true);
                          setConfirmSecretExport(false);
                        }}
                        className="text-[11px]"
                      >
                        切回安全脱敏模式
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={exportingBackup}
                    onClick={handleExportBackupClick}
                    className="text-[12px]"
                  >
                    {exportingBackup ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)]" />
                    ) : (
                      <Download className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    )}
                    <span>
                      {redactSecrets
                        ? "导出脱敏备份 (.json)"
                        : "导出含密钥备份 (.json)"}
                    </span>
                  </Button>
                  <input
                    ref={importRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportBackup}
                    className="hidden"
                  />
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => importRef.current?.click()}
                    className="text-[12px]"
                  >
                    <Upload className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <span>导入备份恢复</span>
                  </Button>
                </div>
              </div>

              <div className="p-3.5 rounded-lg border border-[var(--border-hairline)] border-l-2 border-l-[var(--status-danger)] bg-[var(--bg-canvas)] space-y-2">
                <div className="font-linear-medium text-[var(--status-danger)]">清空本机数据</div>
                {!confirmReset ? (
                  <Button
                    variant="danger"
                    size="md"
                    onClick={() => setConfirmReset(true)}
                    className="text-[12px]"
                  >
                    重置全部会话、文件与配置
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="danger"
                      size="md"
                      onClick={async () => {
                        await resetAllData();
                        setConfirmReset(false);
                      }}
                      className="border-transparent bg-[var(--status-danger)] text-white hover:bg-[var(--status-danger)]/90 text-[12px]"
                    >
                      确认彻底清空
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => setConfirmReset(false)}
                      className="text-[12px]"
                    >
                      取消
                    </Button>
                  </div>
                )}
              </div>

              {/* 版本与免费 GitHub Releases 自动更新检查 */}
              <div className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-linear-semibold text-[var(--text-primary)]">
                      版本信息与更新检查
                    </div>
                    <div className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">
                      当前客户端版本：v{APP_VERSION}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={checkingUpdate}
                    onClick={async () => {
                      setCheckingUpdate(true);
                      try {
                        const res = await checkLatestRelease(getPlatformAdapter().getFetch());
                        setUpdateInfo(res);
                        pushToast(res.message, res.hasUpdate ? "info" : "success");
                      } catch (err) {
                        pushToast(
                          err instanceof Error ? err.message : String(err),
                          "error"
                        );
                      } finally {
                        setCheckingUpdate(false);
                      }
                    }}
                    className="text-[11px]"
                  >
                    {checkingUpdate ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    <span>检查最新版本</span>
                  </Button>
                </div>

                {updateInfo && (
                  <div className="p-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[11px] space-y-1.5">
                    <div className="font-linear-medium text-[var(--text-primary)]">
                      {updateInfo.message}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {updateInfo.downloadUrl && (
                        <a
                          href={updateInfo.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline"
                        >
                          <Download className="w-3 h-3" />
                          <span>下载适配当前系统的安装包</span>
                        </a>
                      )}
                      <a
                        href={updateInfo.releaseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>查看 GitHub Releases</span>
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, commandPaletteOpen, shortcutHelpOpen } =
    useAppStore();

  return (
    <Dialog
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      ariaLabel="工作台设置"
      closeOnEscape={!commandPaletteOpen && !shortcutHelpOpen}
      className="w-full max-w-[780px] h-[82dvh] max-h-[640px] overflow-hidden flex flex-col"
    >
      <SettingsContent onClose={() => setSettingsOpen(false)} />
    </Dialog>
  );
}
