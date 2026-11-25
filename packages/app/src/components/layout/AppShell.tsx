import { FileText, FolderKanban, MessageSquare, Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import { kvGet, kvSet } from "../../storage/db";
import { useAppStore } from "../../store/useAppStore";
import { LoginView } from "../auth/LoginView";
import { ApprovalDialog } from "../chat/ApprovalDialog";
import { ChatPane } from "../chat/ChatPane";
import { QuestionnaireDialog } from "../chat/QuestionnaireDialog";
import { CommandPalette } from "../command/CommandPalette";
import { ShortcutHelpModal } from "../command/ShortcutHelpModal";
import { PreviewPane } from "../preview/PreviewPane";
import { SettingsContent, SettingsModal } from "../settings/SettingsModal";
import { Tooltip, cn } from "../ui";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const MIN_PREVIEW_WIDTH = 340;
const MIN_CHAT_WIDTH = 320;
const SIDEBAR_WIDTH = 240;
const RESIZER_WIDTH = 4;
const DEFAULT_PREVIEW_WIDTH = 520;
const WIDE_DEFAULT_PREVIEW_WIDTH = 600;
const PREVIEW_WIDTH_CUSTOMIZED_KEY = "preview_width_customized";

function getDefaultPreviewWidth(viewportWidth: number): number {
  return viewportWidth >= 1440 ? WIDE_DEFAULT_PREVIEW_WIDTH : DEFAULT_PREVIEW_WIDTH;
}

function getMaxPreviewWidth(viewportWidth: number): number {
  return Math.max(520, viewportWidth - MIN_CHAT_WIDTH);
}

function clampPreviewWidth(
  width: number,
  viewportWidth?: number,
  sidebarOpen?: boolean
): number {
  const effectiveViewport =
    viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1280);
  const dynamicMax = getMaxPreviewWidth(effectiveViewport);
  const reservedWidth =
    (sidebarOpen ? SIDEBAR_WIDTH : 0) + MIN_CHAT_WIDTH + RESIZER_WIDTH;
  const maxAllowed = Math.min(
    dynamicMax,
    Math.max(MIN_PREVIEW_WIDTH, effectiveViewport - reservedWidth)
  );
  return Math.round(Math.min(Math.max(width, MIN_PREVIEW_WIDTH), maxAllowed));
}

export function AppShell() {
  const {
    authSession,
    settings,
    previewOpen,
    previewExpanded,
    activePreviewPath,
    settingsOpen,
    commandPaletteOpen,
    shortcutHelpOpen,
    pendingApproval,
    pendingQuestionnaire,
    mobileTab,
    setMobileTab,
    statusBanner,
    files,
    updateSettings,
    setPreviewOpen,
    setPreviewExpanded,
    openPreview,
    createSession,
    setShortcutHelpOpen,
    setSettingsOpen,
  } = useAppStore();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [externalDraft, setExternalDraft] = useState<string | undefined>(undefined);
  const [draggingWidth, setDraggingWidth] = useState<number | null>(null);
  const [hasCustomPreviewWidth, setHasCustomPreviewWidth] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280
  );

  // 切换左侧栏；若当前处于文档台全屏展开态，则同步退出全屏并显现侧栏
  const handleToggleSidebar = useCallback(() => {
    if (previewExpanded) {
      setPreviewExpanded(false);
      setSidebarOpen(true);
      return;
    }
    setSidebarOpen((v) => !v);
  }, [previewExpanded, setPreviewExpanded]);

  // 注册 Linear 风格工作台全局单键快捷键与 Mod+, 设置入口
  useGlobalShortcuts({
    modalOpen:
      !authSession ||
      settingsOpen ||
      commandPaletteOpen ||
      shortcutHelpOpen ||
      Boolean(pendingApproval) ||
      Boolean(pendingQuestionnaire),
    onToggleSidebar: handleToggleSidebar,
    onTogglePreview: () => {
      if (!previewOpen && !activePreviewPath && files.length > 0) {
        openPreview(files[0].path);
        return;
      }
      setPreviewOpen(!previewOpen);
    },
    onToggleExpandPreview: () => {
      if (!previewOpen) {
        const targetPath = activePreviewPath || files[0]?.path;
        if (targetPath) {
          openPreview(targetPath);
          setPreviewExpanded(true);
          return;
        }
      }
      setPreviewExpanded(!previewExpanded);
    },
    onNewSession: () => {
      createSession()
        .then(() =>
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("mizurisu:focus-composer"));
          }, 30)
        )
        .catch(() => undefined);
    },
    onFocusComposer: () => {
      if (mobileTab !== "chat") {
        setMobileTab("chat");
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("mizurisu:focus-composer"));
        }, 0);
        return;
      }
      window.dispatchEvent(new CustomEvent("mizurisu:focus-composer"));
    },
    onToggleShortcutHelp: () => {
      setShortcutHelpOpen(!shortcutHelpOpen);
    },
    onOpenSettings: () => {
      if (!authSession) return;
      setSettingsOpen(true);
    },
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 检查用户是否曾显式拖拽调整过右侧工作台宽度（未调整时在 1440px+ 大屏默认给足 600px）
  useEffect(() => {
    let cancelled = false;
    kvGet<boolean>(PREVIEW_WIDTH_CUSTOMIZED_KEY)
      .then((customized) => {
        if (!cancelled) {
          setHasCustomPreviewWidth(Boolean(customized));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [authSession, settings.previewWidth]);

  const hasSavedCustomWidth =
    hasCustomPreviewWidth ||
    (typeof settings.previewWidth === "number" &&
      settings.previewWidth > 0 &&
      settings.previewWidth !== DEFAULT_PREVIEW_WIDTH);

  const preferredPreviewWidth = hasSavedCustomWidth
    ? settings.previewWidth
    : getDefaultPreviewWidth(viewportWidth);

  const startResize = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const initialWidth = preferredPreviewWidth;
      let latestWidth = clampPreviewWidth(initialWidth, viewportWidth, sidebarOpen);
      setDraggingWidth(latestWidth);

      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: MouseEvent) => {
        latestWidth = clampPreviewWidth(
          window.innerWidth - moveEvent.clientX,
          window.innerWidth,
          sidebarOpen
        );
        setDraggingWidth(latestWidth);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        setDraggingWidth(null);
        setHasCustomPreviewWidth(true);
        kvSet(PREVIEW_WIDTH_CUSTOMIZED_KEY, true).catch(() => undefined);
        updateSettings({ previewWidth: latestWidth }).catch(() => undefined);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [preferredPreviewWidth, sidebarOpen, updateSettings, viewportWidth]
  );

  useEffect(() => {
    if (!previewOpen) {
      setDraggingWidth(null);
    }
  }, [previewOpen]);

  // 未登录时渲染极简登录门户
  if (!authSession) {
    return <LoginView />;
  }

  const handleUseSkillPrompt = (prompt: string) => {
    setExternalDraft(prompt);
    setMobileTab("chat");
  };

  const effectivePreviewWidth = clampPreviewWidth(
    draggingWidth ?? preferredPreviewWidth,
    viewportWidth,
    sidebarOpen
  );

  return (
    <div className="h-dvh w-full min-w-0 flex flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <TopBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={handleToggleSidebar}
      />

      {statusBanner && (
        <div className="px-4 py-1 bg-[var(--bg-surface)] border-b border-[var(--border-hairline)] text-[12px] text-[var(--text-secondary)] flex items-center justify-center gap-2 shrink-0 min-w-0 overflow-hidden">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] shrink-0" />
          <span className="truncate">{statusBanner}</span>
        </div>
      )}

      {/* 桌面三栏布局 */}
      <div className="hidden md:flex flex-1 min-w-0 min-h-0 overflow-hidden">
        {sidebarOpen && !(previewExpanded && previewOpen) && (
          <Sidebar
            className="w-[240px] shrink-0"
            onUseSkillPrompt={handleUseSkillPrompt}
          />
        )}

        <main
          className={`min-w-0 min-h-0 flex-1 overflow-hidden ${
            previewExpanded && previewOpen ? "hidden" : "flex flex-col"
          }`}
        >
          <ChatPane
            draftExternal={externalDraft}
            onClearExternalDraft={() => setExternalDraft(undefined)}
          />
        </main>

        {previewOpen && (
          <>
            {!previewExpanded && (
              <Tooltip
                content="拖拽调整文档台宽度"
                side="left"
                disabled={draggingWidth !== null}
              >
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整文档台宽度"
                  onMouseDown={startResize}
                  className="group relative w-1 -mx-[2px] shrink-0 cursor-col-resize bg-transparent z-10 select-none"
                >
                  {/* 极克制发丝分隔线：常态隐形复用文档台边框，仅在悬停或拖拽时显现细亮强调线 */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all duration-150",
                      draggingWidth !== null
                        ? "w-[2px] bg-[var(--accent)]"
                        : "w-px bg-transparent group-hover:w-[2px] group-hover:bg-[var(--accent)]/75"
                    )}
                  />
                </div>
              </Tooltip>
            )}
            <section
              style={previewExpanded ? undefined : { width: effectivePreviewWidth }}
              className={
                previewExpanded
                  ? "min-w-0 min-h-0 flex-1 overflow-hidden"
                  : "min-w-0 min-h-0 shrink-0 overflow-hidden"
              }
            >
              <PreviewPane />
            </section>
          </>
        )}
      </div>

      {/* 移动端单栏 + 底部 4 Tab 极简导航 */}
      <div className="flex md:hidden flex-1 flex-col min-w-0 min-h-0 max-h-dvh overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {mobileTab === "chat" && (
            <ChatPane
              draftExternal={externalDraft}
              onClearExternalDraft={() => setExternalDraft(undefined)}
            />
          )}
          {mobileTab === "files" && (
            <Sidebar
              className="w-full min-w-0 border-r-0"
              onUseSkillPrompt={handleUseSkillPrompt}
            />
          )}
          {mobileTab === "preview" && <PreviewPane />}
          {mobileTab === "settings" && (
            <div className="h-full min-w-0 min-h-0 overflow-hidden bg-[var(--bg-surface)]">
              <SettingsContent />
            </div>
          )}
        </div>

        <nav
          className="min-h-13 pt-1.5 shrink-0 min-w-0 overflow-hidden border-t border-[var(--border-hairline)] bg-[var(--bg-sidebar)] grid grid-cols-4 text-[11px]"
          style={{ paddingBottom: "calc(0.375rem + var(--safe-bottom))" }}
        >
          {(
            [
              ["chat", "对话", MessageSquare],
              ["files", `工作区(${files.length})`, FolderKanban],
              ["preview", "文档台", FileText],
              ["settings", "设置", Settings],
            ] as const
          ).map(([id, label, Icon]) => {
            const active = mobileTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMobileTab(id)}
                className={cn(
                  "min-w-0 px-1 flex flex-col items-center justify-center gap-0.5 transition cursor-pointer linear-focus-ring",
                  active
                    ? "text-[var(--text-primary)] font-linear-medium"
                    : "text-[var(--text-muted)]"
                )}
              >
                <Icon
                  className={cn(
                    "w-4 h-4 shrink-0",
                    active ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
                  )}
                />
                <span className="truncate max-w-full tabular-nums">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <SettingsModal />
      <ApprovalDialog />
      <QuestionnaireDialog />
      <CommandPalette />
      <ShortcutHelpModal />
    </div>
  );
}
