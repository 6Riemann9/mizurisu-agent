import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { useRef, useState } from "react";
import { BUILTIN_SKILLS } from "../../agent/skills";
import { formatQuotaDisplay, maskApiKey } from "../../newapi/auth";
import { getPlatformAdapter } from "../../platform";
import { useAppStore } from "../../store/useAppStore";
import { FileIcon, formatFileSize } from "../common/FileBadge";

export function Sidebar({
  className = "",
  onUseSkillPrompt,
}: {
  className?: string;
  onUseSkillPrompt?: (prompt: string, skillId: string) => void;
}) {
  const {
    config,
    billing,
    billingLoading,
    authSession,
    authBusy,
    sessions,
    activeSessionId,
    files,
    activePreviewPath,
    customSkills,
    activeSkillId,
    createSession,
    selectSession,
    deleteSession,
    openPreview,
    uploadFilesToWorkspace,
    deleteWorkspaceFile,
    refreshBilling,
    refreshAccountSession,
    setActiveSkill,
    setSettingsOpen,
    setCommandPaletteOpen,
    mountNativeDirectory,
    logout,
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filesOpen, setFilesOpen] = useState(true);
  const [chatsOpen, setChatsOpen] = useState(true);
  const [skillsOpen, setSkillsOpen] = useState(true);
  const [dragOverFiles, setDragOverFiles] = useState(false);

  const platform = getPlatformAdapter();
  const allSkills = [...BUILTIN_SKILLS, ...customSkills];

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      await uploadFilesToWorkspace(e.target.files);
      e.target.value = "";
    }
  };

  const activeToken = authSession?.tokens.find(
    (t) => t.id === authSession.activeTokenId
  );

  const userName =
    authSession?.user?.displayName ||
    authSession?.user?.username ||
    authSession?.username ||
    (authSession?.mode === "guest" ? "离线访客" : "API Key 用户");

  const quotaDisplay = (() => {
    if (authSession?.mode === "guest") return "离线体验";
    if (authSession?.user) {
      return formatQuotaDisplay(
        authSession.user.quota,
        authSession.siteStatus
      );
    }
    if (billing?.supported && billing.remainingUsd !== undefined) {
      return `$${billing.remainingUsd.toFixed(2)}`;
    }
    if (config.apiKey) return "已连接";
    return "未配置";
  })();

  const tokenSubtitle = (() => {
    if (authSession?.mode === "guest") return "本地沙箱工作台";
    if (activeToken) {
      return `${activeToken.name} · ${maskApiKey(activeToken.key || activeToken.maskedKey)}`;
    }
    if (authSession?.activeApiKey) {
      return maskApiKey(authSession.activeApiKey);
    }
    if (config.apiKey) {
      return maskApiKey(config.apiKey);
    }
    return "无活动令牌";
  })();

  const isConnected = Boolean(authSession && authSession.mode !== "guest" && config.apiKey);

  return (
    <aside
      className={`flex flex-col bg-[var(--bg-sidebar)] border-r border-[var(--border-hairline)] h-full min-h-0 select-none ${className}`}
    >
      {/* 顶部动作：新建会话与 ⌘K 搜索入口 */}
      <div className="p-2 space-y-1 border-b border-[var(--border-hairline)] shrink-0">
        <button
          type="button"
          onClick={() => createSession()}
          className="w-full h-7 px-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)] transition cursor-pointer"
        >
          <MessageSquarePlus className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
          <span>新建会话</span>
        </button>

        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="w-full h-7 px-2 rounded-md hover:bg-[var(--bg-hover)] flex items-center justify-between text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition cursor-pointer"
        >
          <span className="flex items-center gap-2 truncate">
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span>快速跳转 / 命令</span>
          </span>
          <kbd className="text-[10px] font-mono px-1 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-muted)] leading-none">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* 中部：扁平分区折叠列表 (28px h-7 精密行高) */}
      <div className="flex-1 overflow-y-auto px-1.5 py-2 space-y-3 min-h-0">
        {/* 分区 1：工作区文件 */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverFiles(true);
          }}
          onDragLeave={() => setDragOverFiles(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragOverFiles(false);
            if (e.dataTransfer.files?.length) {
              await uploadFilesToWorkspace(e.dataTransfer.files);
            }
          }}
          className={`rounded-md transition ${
            dragOverFiles
              ? "ring-1 ring-[var(--accent)] bg-[var(--accent-soft)]"
              : ""
          }`}
        >
          <div
            onClick={() => setFilesOpen((v) => !v)}
            className="h-6 px-1.5 flex items-center justify-between text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
          >
            <div className="flex items-center gap-1 min-w-0">
              {filesOpen ? (
                <ChevronDown className="w-3 h-3 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0" />
              )}
              <span>工作区文件</span>
              <span className="tabular-nums text-[10px] opacity-75">({files.length})</span>
            </div>
            <div
              className="flex items-center gap-0.5 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.csv,.tsv,.docx,.pptx,.pdf,.md,.txt,.json,.png,.jpg,.jpeg,.webp"
                onChange={handleUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-5 h-5 rounded hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                title="导入 Office / 文档"
              >
                <Upload className="w-3 h-3" />
              </button>
              {platform.canMountNativeDir && (
                <button
                  type="button"
                  onClick={() => mountNativeDirectory()}
                  className="w-5 h-5 rounded hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  title="挂载本地目录"
                >
                  <FolderOpen className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {filesOpen && (
            <div className="mt-0.5 space-y-0.5">
              {files.length === 0 ? (
                <div className="px-2 py-2 text-[11px] text-[var(--text-muted)]">
                  拖拽或点击右上角导入文档
                </div>
              ) : (
                files.map((f) => {
                  const active = activePreviewPath === f.path;
                  return (
                    <div
                      key={f.path}
                      onClick={() => openPreview(f.path)}
                      className={`group h-7 px-2 rounded-md flex items-center justify-between gap-1.5 text-[12px] cursor-pointer transition ${
                        active
                          ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileIcon category={f.category} className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{f.name}</span>
                      </div>
                      <span className="text-[10px] text-[var(--text-muted)] tabular-nums shrink-0 group-hover:hidden">
                        {formatFileSize(f.size)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteWorkspaceFile(f.path);
                        }}
                        className="hidden group-hover:inline-flex w-5 h-5 items-center justify-center rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)] hover:text-[var(--status-danger)] shrink-0 cursor-pointer"
                        title="删除文件"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>

        {/* 分区 2：会话历史 */}
        <section>
          <div
            onClick={() => setChatsOpen((v) => !v)}
            className="h-6 px-1.5 flex items-center justify-between text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
          >
            <div className="flex items-center gap-1 min-w-0">
              {chatsOpen ? (
                <ChevronDown className="w-3 h-3 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0" />
              )}
              <span>会话历史</span>
              <span className="tabular-nums text-[10px] opacity-75">({sessions.length})</span>
            </div>
          </div>

          {chatsOpen && (
            <div className="mt-0.5 space-y-0.5">
              {sessions.map((s) => {
                const active = s.id === activeSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => selectSession(s.id)}
                    className={`group h-7 px-2 rounded-md flex items-center justify-between gap-1.5 text-[12px] cursor-pointer transition ${
                      active
                        ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                      <span className="truncate">{s.title}</span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)] tabular-nums shrink-0 group-hover:hidden">
                      {s.messages.length}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(s.id);
                      }}
                      className="hidden group-hover:inline-flex w-5 h-5 items-center justify-center rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)] hover:text-[var(--status-danger)] shrink-0 cursor-pointer"
                      title="删除会话"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 分区 3：办公技能 */}
        <section>
          <div
            onClick={() => setSkillsOpen((v) => !v)}
            className="h-6 px-1.5 flex items-center justify-between text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
          >
            <div className="flex items-center gap-1 min-w-0">
              {skillsOpen ? (
                <ChevronDown className="w-3 h-3 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0" />
              )}
              <span>办公技能</span>
              <span className="tabular-nums text-[10px] opacity-75">({allSkills.length})</span>
            </div>
          </div>

          {skillsOpen && (
            <div className="mt-0.5 space-y-0.5">
              {allSkills.map((sk) => {
                const active = activeSkillId === sk.id;
                return (
                  <div
                    key={sk.id}
                    onClick={() => setActiveSkill(active ? undefined : sk.id)}
                    title={sk.description}
                    className={`group h-7 px-2 rounded-md flex items-center justify-between gap-1.5 text-[12px] cursor-pointer transition ${
                      active
                        ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Wand2
                        className={`w-3.5 h-3.5 shrink-0 ${
                          active ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
                        }`}
                      />
                      <span className="truncate">{sk.name}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {active && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                      )}
                      {onUseSkillPrompt && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveSkill(sk.id);
                            onUseSkillPrompt(sk.prompt, sk.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
                          title="挂载并填入提示词"
                        >
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* 底部固定极简账户条 */}
      <div className="shrink-0 border-t border-[var(--border-hairline)] px-2.5 py-2 bg-[var(--bg-sidebar)]">
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                isConnected ? "bg-[var(--status-success)]" : "bg-[var(--text-muted)]"
              }`}
            />
            <span className="font-medium text-[var(--text-primary)] truncate">
              {userName}
            </span>
          </div>
          <span className="font-mono text-[11px] text-[var(--text-secondary)] tabular-nums shrink-0">
            {quotaDisplay}
          </span>
        </div>

        <div className="mt-1 flex items-center justify-between gap-1">
          <span className="font-mono text-[10px] text-[var(--text-muted)] truncate">
            {tokenSubtitle}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            {authSession && authSession.mode !== "guest" && (
              <button
                type="button"
                onClick={() => {
                  refreshAccountSession().catch(() => refreshBilling());
                }}
                className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                title="刷新余额与会话"
              >
                <RefreshCw
                  className={`w-3 h-3 ${
                    billingLoading || authBusy ? "animate-spin" : ""
                  }`}
                />
              </button>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              title="设置"
            >
              <Settings className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => logout()}
              className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
              title="退出登录"
            >
              <LogOut className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
