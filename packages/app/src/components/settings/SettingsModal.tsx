import {
  AlertTriangle,
  Check,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Server,
  Shield,
  Trash2,
  Upload,
  User,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BUILTIN_SKILLS } from "../../agent/skills";
import { formatQuotaDisplay, maskApiKey } from "../../newapi/auth";
import { getMizurisuConsoleLinks } from "../../newapi/client";
import { getPlatformAdapter } from "../../platform";
import {
  exportBackupBundle,
  importBackupBundle,
  type BackupBundle,
} from "../../storage/db";
import { useAppStore } from "../../store/useAppStore";
import type { ProtocolMode, SkillTemplate } from "../../types";

type SettingsTab = "account" | "newapi" | "skills" | "data";

const NAV_ITEMS: Array<{ id: SettingsTab; label: string; icon: typeof User }> = [
  { id: "account", label: "账号与令牌", icon: User },
  { id: "newapi", label: "中转站与模型", icon: Server },
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
    testConnectionAndSync,
    switchActiveToken,
    createAccountToken,
    refreshAccountSession,
    logout,
    saveCustomSkill,
    deleteCustomSkill,
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

  const importRef = useRef<HTMLInputElement>(null);
  const siteStatus = authSession?.siteStatus;
  const consoleLinks = getMizurisuConsoleLinks(authSession?.baseUrl || config.baseUrl);

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
      {/* 左侧导航栏 (桌面端 180px) */}
      <aside className="sm:w-[180px] shrink-0 border-b sm:border-b-0 sm:border-r border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex flex-col">
        <div className="h-11 px-3 border-b border-[var(--border-hairline)] flex items-center justify-between shrink-0">
          <span className="text-[12px] font-semibold tracking-tight text-[var(--text-primary)]">
            工作台设置
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="sm:hidden w-6 h-6 rounded hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--text-muted)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
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
                className={`h-7 px-2.5 rounded-md flex items-center gap-2 text-[12px] whitespace-nowrap shrink-0 transition cursor-pointer ${
                  active
                    ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    active ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                  }`}
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
          <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
            {activeNav.label}
          </h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-md hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
              aria-label="关闭设置"
            >
              <X className="w-4 h-4" />
            </button>
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
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          authSession?.mode !== "guest" && config.apiKey
                            ? "bg-[var(--status-success)]"
                            : "bg-[var(--text-muted)]"
                        }`}
                      />
                      <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
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
                      <button
                        type="button"
                        disabled={authBusy || checkingConnection}
                        onClick={() => void handleRefreshAndCheck()}
                        className="h-7 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${
                            authBusy || checkingConnection ? "animate-spin" : ""
                          }`}
                        />
                        <span>刷新并检测连接</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        await logout();
                        onClose?.();
                      }}
                      className="h-7 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1.5 text-[11px] text-[var(--status-danger)] transition cursor-pointer"
                    >
                      <LogOut className="w-3 h-3" />
                      <span>{authSession?.mode === "guest" ? "前往登录" : "退出登录"}</span>
                    </button>
                  </div>
                </div>

                {/* 额度统计 */}
                <div className="pt-3 border-t border-[var(--border-hairline)] grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)]">可用余额</div>
                    <div className="mt-0.5 text-[13px] font-mono tabular-nums font-medium text-[var(--text-primary)]">
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
                      <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">
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
                      className="flex-1 h-8 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                    />
                    <button
                      type="button"
                      disabled={authBusy}
                      onClick={handleCreateToken}
                      className="h-8 px-3 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white text-[12px] font-medium inline-flex items-center gap-1.5 shrink-0 transition cursor-pointer"
                    >
                      {authBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      <span>新建令牌</span>
                    </button>
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
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                    enabled
                                      ? "bg-[var(--status-success)]"
                                      : "bg-[var(--text-muted)]"
                                  }`}
                                />
                                <span className="font-medium text-[var(--text-primary)] truncate">
                                  {tk.name || `Token #${tk.id}`}
                                </span>
                                {isActive && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--accent-soft)] text-[var(--accent)] font-medium">
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

                            <button
                              type="button"
                              disabled={isActive || !enabled || authBusy}
                              onClick={() => handleSwitchToken(tk.id)}
                              className={`h-7 px-2.5 rounded-md text-[11px] font-medium border shrink-0 transition cursor-pointer ${
                                isActive
                                  ? "border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-default"
                                  : "border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] disabled:opacity-40"
                              }`}
                            >
                              {isActive ? (
                                <span className="inline-flex items-center gap-1">
                                  <Check className="w-3 h-3 text-[var(--accent)]" />
                                  已选
                                </span>
                              ) : (
                                "切换使用"
                              )}
                            </button>
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
                      <div className="font-medium text-[var(--text-primary)]">
                        当前活动密钥
                      </div>
                      <div className="text-[11px] font-mono text-[var(--text-muted)] truncate">
                        {config.apiKey ? maskApiKey(config.apiKey) : "未配置 API Key"}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab("newapi")}
                    className="h-7 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-primary)] shrink-0 cursor-pointer"
                  >
                    修改密钥
                  </button>
                </section>
              )}

              <section className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3.5 space-y-2.5">
                <div>
                  <div className="text-[12px] font-semibold text-[var(--text-primary)]">
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
                      className="px-3 py-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] flex items-center justify-between gap-2 transition"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--text-primary)] truncate">
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
                <summary className="text-[11px] font-medium text-[var(--text-secondary)] cursor-pointer select-none">
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
                <label className="block font-medium text-[var(--text-secondary)]">
                  工作台名称
                </label>
                <input
                  value={config.brandName}
                  onChange={(e) => updateConfig({ brandName: e.target.value })}
                  placeholder="Mizurisu Agent"
                  className="w-full h-8 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block font-medium text-[var(--text-secondary)]">
                  Mizurisu / 服务站点地址 (Base URL)
                </label>
                <input
                  value={config.baseUrl}
                  onChange={(e) => updateConfig({ baseUrl: e.target.value })}
                  placeholder="https://www.mizurisu.com"
                  className="w-full h-8 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] font-mono"
                />
                <p className="text-[11px] text-[var(--text-muted)]">
                  填写根域名即可，系统会自动归一化处理 `/v1` 与 `/v1beta` 路径。
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block font-medium text-[var(--text-secondary)]">
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={config.apiKey}
                    onChange={(e) => updateConfig({ apiKey: e.target.value })}
                    placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full h-8 pl-3 pr-9 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-medium text-[var(--text-secondary)]">
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
                        className={`text-left p-3 rounded-lg border transition cursor-pointer ${
                          active
                            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                            : "border-[var(--border-hairline)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]"
                        }`}
                      >
                        <div className="font-medium text-[var(--text-primary)]">{title}</div>
                        <div className="mt-1 text-[11px] text-[var(--text-muted)] leading-snug">
                          {desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={modelsLoading}
                  className="h-8 px-3.5 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium inline-flex items-center gap-1.5 disabled:opacity-50 transition cursor-pointer"
                >
                  {modelsLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>测试连接并同步模型</span>
                </button>
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
                <label className="block font-medium text-[var(--text-secondary)]">
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
                    className="flex-1 h-8 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] outline-none focus:border-[var(--border-strong)] font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomModel}
                    className="h-8 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1 text-[var(--text-primary)] cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>添加</span>
                  </button>
                </div>

                {config.customModels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {config.customModels.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] font-mono text-[11px] text-[var(--text-secondary)]"
                      >
                        <span>{id}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomModel(id)}
                          className="text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-[var(--border-hairline)] space-y-3">
                <div className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">
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
                      className="font-medium text-[var(--text-primary)]"
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
                    className="w-full p-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-strong)] resize-y leading-relaxed"
                  />
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="text-[11px] text-[var(--text-muted)]">
                      离开输入框或点击右侧按钮时保存，并自动附加到后续每次 AI 对话中。
                    </span>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleSaveCustomPrompt(false)}
                      className="h-7 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[11px] font-medium text-[var(--text-primary)] shrink-0 cursor-pointer transition"
                    >
                      保存指令
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: 办公技能 */}
          {tab === "skills" && (
            <div className="space-y-5">
              <div className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-2.5">
                <div className="font-semibold text-[var(--text-primary)]">
                  新建自定义办公技能
                </div>
                <input
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  placeholder="技能名称，例如：财务对账单核对"
                  className="w-full h-8 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] outline-none focus:border-[var(--border-strong)]"
                />
                <input
                  value={skillDesc}
                  onChange={(e) => setSkillDesc(e.target.value)}
                  placeholder="简短说明（可选）"
                  className="w-full h-8 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] outline-none focus:border-[var(--border-strong)]"
                />
                <textarea
                  rows={2}
                  value={skillPrompt}
                  onChange={(e) => setSkillPrompt(e.target.value)}
                  placeholder="填入对话时的默认指令模板..."
                  className="w-full p-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] outline-none focus:border-[var(--border-strong)] resize-none"
                />
                <textarea
                  rows={2}
                  value={skillHint}
                  onChange={(e) => setSkillHint(e.target.value)}
                  placeholder="附加系统级约束指令（可选）..."
                  className="w-full p-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] outline-none focus:border-[var(--border-strong)] resize-none"
                />
                <button
                  type="button"
                  onClick={handleAddSkill}
                  className="h-8 px-3 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>保存技能</span>
                </button>
              </div>

              <div className="space-y-2">
                <div className="font-medium text-[var(--text-secondary)]">
                  自定义技能 ({customSkills.length})
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
                          <div className="font-medium text-[var(--text-primary)] truncate">
                            {sk.name}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate">
                            {sk.description}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteCustomSkill(sk.id)}
                          className="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="font-medium text-[var(--text-secondary)]">
                  内置标准技能 ({BUILTIN_SKILLS.length})
                </div>
                <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] divide-y divide-[var(--border-hairline)]">
                  {BUILTIN_SKILLS.map((sk) => (
                    <div key={sk.id} className="px-3 py-2 space-y-0.5">
                      <div className="font-medium text-[var(--text-primary)]">
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

          {/* Tab 4: 安全与备份 */}
          {tab === "data" && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] flex items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Shield className="w-4 h-4 text-[var(--text-muted)] mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">
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
                  className="w-4 h-4 accent-[var(--accent)] cursor-pointer shrink-0"
                />
              </div>

              <div className="p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-3">
                <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
                  <Database className="w-4 h-4 text-[var(--text-muted)]" />
                  <span>导出工作区与对话备份</span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  将对话历史、工作区文档与配置导出为单个 JSON 文件，可在网页端、桌面端与移动端间迁移恢复。
                </p>

                <label className="flex items-start justify-between gap-3 p-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] cursor-pointer">
                  <div className="space-y-0.5">
                    <div className="font-medium text-[var(--text-primary)]">
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
                    <div className="text-[11px] font-medium text-[var(--status-warning)]">
                      二次确认：确定要在备份文件中包含明文 API Key 密钥吗？
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={exportingBackup}
                        onClick={() => void runExportBackup(true)}
                        className="h-7 px-2.5 rounded-md bg-[var(--status-warning)] text-black font-medium text-[11px] inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        {exportingBackup && <Loader2 className="w-3 h-3 animate-spin" />}
                        <span>确认导出含密钥备份</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRedactSecrets(true);
                          setConfirmSecretExport(false);
                        }}
                        className="h-7 px-2.5 rounded-md border border-[var(--border-hairline)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        切回安全脱敏模式
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={exportingBackup}
                    onClick={handleExportBackupClick}
                    className="h-8 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1.5 text-[var(--text-primary)] cursor-pointer disabled:opacity-50"
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
                  </button>
                  <input
                    ref={importRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportBackup}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => importRef.current?.click()}
                    className="h-8 px-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1.5 text-[var(--text-primary)] cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <span>导入备份恢复</span>
                  </button>
                </div>
              </div>

              <div className="p-3.5 rounded-lg border border-[var(--border-hairline)] border-l-2 border-l-[var(--status-danger)] bg-[var(--bg-canvas)] space-y-2">
                <div className="font-medium text-[var(--status-danger)]">清空本机数据</div>
                {!confirmReset ? (
                  <button
                    type="button"
                    onClick={() => setConfirmReset(true)}
                    className="h-8 px-3 rounded-md border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] text-[var(--status-danger)] cursor-pointer"
                  >
                    重置全部会话、文件与配置
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await resetAllData();
                        setConfirmReset(false);
                      }}
                      className="h-8 px-3 rounded-md bg-[var(--status-danger)] text-white cursor-pointer"
                    >
                      确认彻底清空
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmReset(false)}
                      className="h-8 px-3 rounded-md border border-[var(--border-hairline)] text-[var(--text-secondary)] cursor-pointer"
                    >
                      取消
                    </button>
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
  const { settingsOpen, setSettingsOpen } = useAppStore();

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !useAppStore.getState().commandPaletteOpen) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, setSettingsOpen]);

  if (!settingsOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-3 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          setSettingsOpen(false);
        }
      }}
    >
      <div className="w-full max-w-[760px] h-[82vh] max-h-[620px] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[0_24px_64px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col">
        <SettingsContent onClose={() => setSettingsOpen(false)} />
      </div>
    </div>
  );
}
