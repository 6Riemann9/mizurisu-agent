import { FileText, FolderKanban, MessageSquare, Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { LoginView } from "../auth/LoginView";
import { ApprovalDialog } from "../chat/ApprovalDialog";
import { ChatPane } from "../chat/ChatPane";
import { CommandPalette } from "../command/CommandPalette";
import { PreviewPane } from "../preview/PreviewPane";
import { SettingsContent, SettingsModal } from "../settings/SettingsModal";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const MIN_PREVIEW_WIDTH = 340;
const MAX_PREVIEW_WIDTH = 960;

function clampPreviewWidth(
  width: number,
  viewportWidth?: number,
  sidebarOpen?: boolean
): number {
  const effectiveViewport =
    viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1280);
  const reservedWidth = sidebarOpen ? 500 : 340;
  const maxAllowed = Math.min(
    MAX_PREVIEW_WIDTH,
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
    mobileTab,
    setMobileTab,
    statusBanner,
    files,
    updateSettings,
  } = useAppStore();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [externalDraft, setExternalDraft] = useState<string | undefined>(undefined);
  const [draggingWidth, setDraggingWidth] = useState<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startResize = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const initialWidth = settings.previewWidth || 520;
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
        updateSettings({ previewWidth: latestWidth }).catch(() => undefined);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [settings.previewWidth, sidebarOpen, updateSettings, viewportWidth]
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
    draggingWidth ?? settings.previewWidth ?? 520,
    viewportWidth,
    sidebarOpen
  );

  return (
    <div className="h-full w-full min-w-0 flex flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <TopBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />

      {statusBanner && (
        <div className="px-4 py-1 bg-[var(--bg-surface)] border-b border-[var(--border-hairline)] text-[12px] text-[var(--text-secondary)] flex items-center justify-center gap-2 shrink-0 min-w-0 overflow-hidden">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] shrink-0" />
          <span className="truncate">{statusBanner}</span>
        </div>
      )}

      {/* 桌面三栏布局 */}
      <div className="hidden md:flex flex-1 min-w-0 min-h-0 overflow-hidden">
        {sidebarOpen && !previewExpanded && (
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
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="调整预览栏宽度"
                onMouseDown={startResize}
                className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-[var(--accent)]/60 active:bg-[var(--accent)] transition-colors z-10"
                title="拖拽调整预览栏宽度"
              />
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
      <div className="flex md:hidden flex-1 flex-col min-w-0 min-h-0 overflow-hidden">
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
                className={`min-w-0 px-1 flex flex-col items-center justify-center gap-0.5 transition cursor-pointer ${
                  active
                    ? "text-[var(--text-primary)] font-medium"
                    : "text-[var(--text-muted)]"
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    active ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
                  }`}
                />
                <span className="truncate max-w-full">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <SettingsModal />
      <ApprovalDialog />
      <CommandPalette />
    </div>
  );
}
