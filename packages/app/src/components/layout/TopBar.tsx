import {
  CircleQuestionMark,
  FolderOpen,
  Moon,
  PanelLeft,
  PanelRight,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { getPlatformAdapter } from "../../platform";
import { useAppStore } from "../../store/useAppStore";
import { BrandLogo } from "../common/FileBadge";
import { Button, Kbd, Tooltip, cn } from "../ui";

/**
 * 静谧工作台顶栏：左侧展示 Linear 风格会话与文档面包屑，右侧收敛为低噪微控件。
 * 模型与思考强度切换已下沉至对话输入框旁的 ComposerControls。
 */
export function TopBar({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const {
    config,
    settings,
    authSession,
    sessions,
    activeSessionId,
    files,
    activePreviewPath,
    previewOpen,
    setPreviewOpen,
    openPreview,
    setMobileTab,
    setCommandPaletteOpen,
    setShortcutHelpOpen,
    toggleTheme,
    setSettingsOpen,
    mountNativeDirectory,
  } = useAppStore();

  const platform = getPlatformAdapter();

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const sessionTitle = activeSession?.title || "新对话";

  const showPreviewCrumb = Boolean(activePreviewPath && previewOpen);
  const previewFileName = activePreviewPath
    ? activePreviewPath.split("/").pop() || activePreviewPath
    : "";

  const userDisplay =
    authSession?.user?.displayName ||
    authSession?.user?.username ||
    authSession?.username ||
    (authSession?.mode === "guest" ? "离线访客" : "API Key");

  const isConnected = Boolean(authSession && authSession.mode !== "guest" && config.apiKey);

  const handleTogglePreview = () => {
    if (!previewOpen && !activePreviewPath && files.length > 0) {
      openPreview(files[0].path);
      return;
    }
    setPreviewOpen(!previewOpen);
  };

  const handleFocusPreviewBreadcrumb = () => {
    if (!activePreviewPath) return;
    setPreviewOpen(true);
    setMobileTab("preview");
    const previewEl = document.querySelector<HTMLElement>("[data-preview-pane]");
    previewEl?.focus({ preventScroll: true });
  };

  return (
    <header className="h-11 shrink-0 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 flex items-center justify-between gap-2 select-none z-40">
      {/* 左侧：侧栏折叠开关 + 品牌标志 + 会话/文档面包屑 */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <Tooltip content="切换侧边栏" shortcut="[" side="bottom">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
            className="hidden md:inline-flex text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>

        <BrandLogo
          className="w-5 h-5 rounded-[5px] shrink-0"
          alt={config.brandName || "Mizurisu Agent"}
        />

        <nav
          aria-label="当前工作区上下文"
          className="flex items-center gap-1 min-w-0 flex-1 pl-0.5"
        >
          <span
            className={cn(
              "min-w-0 truncate text-[13px] font-linear-medium tracking-[-0.01em]",
              showPreviewCrumb
                ? "text-[var(--text-secondary)]"
                : "text-[var(--text-primary)]"
            )}
          >
            {sessionTitle}
          </span>

          {showPreviewCrumb && activePreviewPath && (
            <>
              <span
                className="text-[12px] text-[var(--text-dim)] shrink-0 px-0.5"
                aria-hidden="true"
              >
                /
              </span>
              <Tooltip content={`聚焦文档台 · ${activePreviewPath}`} side="bottom">
                <button
                  type="button"
                  onClick={handleFocusPreviewBreadcrumb}
                  className="min-w-0 max-w-[140px] sm:max-w-[220px] lg:max-w-[300px] px-1.5 py-0.5 rounded-[5px] text-[13px] font-linear-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] truncate transition-colors cursor-pointer linear-focus-ring"
                >
                  {previewFileName}
                </button>
              </Tooltip>
            </>
          )}
        </nav>
      </div>

      {/* 右侧：精简微胶囊与无边框图标入口 */}
      <div className="flex items-center gap-1 shrink-0">
        <Tooltip content="搜索命令与文件" shortcut={["Mod", "K"]} side="bottom">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label="打开命令面板"
            className="px-1.5 sm:px-2 gap-1.5 text-[12px] bg-[var(--surface-subtle)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)]"
          >
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
            <span className="hidden lg:inline">搜索命令</span>
            <Kbd keys={["Mod", "K"]} className="hidden sm:inline-flex" />
          </Button>
        </Tooltip>

        {platform.canMountNativeDir && (
          <Tooltip
            content={
              settings.mountedNativeDir
                ? `已挂载: ${settings.mountedNativeDir}`
                : "挂载本地工作目录"
            }
            side="bottom"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => mountNativeDirectory()}
              className="hidden md:inline-flex px-2 gap-1.5 text-[12px]"
            >
              <FolderOpen className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
              <span className="max-w-[96px] truncate">
                {settings.mountedNativeDir
                  ? settings.mountedNativeDir.split(/[\\/]/).pop()
                  : "挂载目录"}
              </span>
            </Button>
          </Tooltip>
        )}

        <Tooltip content="切换 Office 文档台" shortcut="]" side="bottom">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTogglePreview}
            aria-pressed={previewOpen}
            className={cn(
              "hidden md:inline-flex px-2 gap-1.5 text-[12px]",
              previewOpen
                ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            <PanelRight
              className={cn(
                "w-3.5 h-3.5 shrink-0",
                previewOpen ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
              )}
            />
            <span>文档台</span>
          </Button>
        </Tooltip>

        <Tooltip content="键盘快捷键" shortcut="?" side="bottom">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShortcutHelpOpen(true)}
            aria-label="键盘快捷键"
          >
            <CircleQuestionMark className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>

        <Tooltip
          content={settings.theme === "dark" ? "切换至浅色主题" : "切换至深色主题"}
          side="bottom"
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleTheme()}
            aria-label={settings.theme === "dark" ? "切换至浅色主题" : "切换至深色主题"}
          >
            {settings.theme === "dark" ? (
              <Sun className="w-3.5 h-3.5" />
            ) : (
              <Moon className="w-3.5 h-3.5" />
            )}
          </Button>
        </Tooltip>

        <Tooltip content="账号与工作台设置" shortcut={["Mod", ","]} side="bottom">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            aria-label="账号与工作台设置"
            className="px-1.5 sm:px-2 gap-1.5 text-[12px]"
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                isConnected ? "bg-[var(--status-success)]" : "bg-[var(--text-muted)]"
              )}
            />
            <span className="hidden sm:inline max-w-[90px] truncate text-[var(--text-primary)]">
              {userDisplay}
            </span>
            <Settings className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
