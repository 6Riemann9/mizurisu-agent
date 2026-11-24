import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  Save,
  StickyNote,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SLIDE_THEMES,
  exportHtmlSlidesToPptxBytes,
  getSlideThemeStyles,
  parseSlidesHtmlDocument,
  sanitizeSlideCss,
  sanitizeSlideHtml,
  switchSlidesHtmlTheme,
  updateSlideInHtmlDocument,
  validateSlidesHtml,
  type SlideThemeId,
  type SlideValidationReport,
} from "../../office";
import { getPlatformAdapter } from "../../platform";
import { workspaceVfs } from "../../storage/workspace-vfs";

const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;
const THUMB_WIDTH = 112;
const THUMB_HEIGHT = 63;
const THUMB_SCALE = THUMB_WIDTH / SLIDE_WIDTH;
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function buildPptxPaths(slidesPath: string): { pptxPath: string; pptxFilename: string } {
  const clean = slidesPath
    .replace(/\.(slides|deck)\.html$/i, "")
    .replace(/\.html?$/i, "");
  const pptxPath = `${clean || "presentation"}.pptx`;
  const pptxFilename = pptxPath.split("/").pop() || "presentation.pptx";
  return { pptxPath, pptxFilename };
}

function useContainerSize(
  ref: React.RefObject<HTMLDivElement | null>,
  active: boolean
): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const syncSize = () => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    };
    syncSize();
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      } else {
        syncSize();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, active]);

  return size;
}

export function SlidesViewer({
  path,
  bytes,
}: {
  path: string;
  bytes: Uint8Array;
}) {
  const htmlText = useMemo(() => new TextDecoder("utf-8").decode(bytes), [bytes]);
  const deck = useMemo(() => parseSlidesHtmlDocument(htmlText), [htmlText]);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [viewMode, setViewMode] = useState<"stage" | "source">("stage");
  const [doubleClickEdit, setDoubleClickEdit] = useState(false);
  const [isEditingSlide, setIsEditingSlide] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);

  const [issuesOpen, setIssuesOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [themeSwitching, setThemeSwitching] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [sourceDraft, setSourceDraft] = useState(htmlText);
  const [sourceDirty, setSourceDirty] = useState(false);
  const [sourceSaving, setSourceSaving] = useState(false);

  const [validation, setValidation] = useState<SlideValidationReport>(() => ({
    ok: true,
    slideCount: deck.slides.length,
    issues: [],
  }));

  const rootRef = useRef<HTMLDivElement>(null);
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const slideSectionRef = useRef<HTMLElement>(null);
  const issuesRef = useRef<HTMLDivElement>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const exportDoneTimerRef = useRef<number | null>(null);

  const stageSize = useContainerSize(stageContainerRef, viewMode === "stage");
  const fullscreenSize = useContainerSize(fullscreenRef, isFullscreen);

  // 切换文件时重置状态
  useEffect(() => {
    setCurrentIdx(0);
    setViewMode("stage");
    setIsEditingSlide(false);
    setIsFullscreen(false);
    setIssuesOpen(false);
    setThemeMenuOpen(false);
    setActionError(null);
    setExportDone(false);
    setSourceDraft(htmlText);
    setSourceDirty(false);
  }, [path]);

  // 外部更新（如 Agent 修改或主题切换）同步源码草稿
  useEffect(() => {
    if (!sourceDirty) {
      setSourceDraft(htmlText);
    }
  }, [htmlText, sourceDirty]);

  // 当页数缩减时保证游标不越界
  useEffect(() => {
    setCurrentIdx((prev) =>
      deck.slides.length === 0 ? 0 : Math.min(prev, deck.slides.length - 1)
    );
  }, [deck.slides.length]);

  // 离屏防溢出与 CSS 白名单校验
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      try {
        const report = validateSlidesHtml(htmlText);
        if (!cancelled) {
          setValidation(report);
        }
      } catch {
        // 忽略非浏览器环境离屏测算异常
      }
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [htmlText]);

  // 清理导出成功提示定时器
  useEffect(() => {
    return () => {
      if (exportDoneTimerRef.current !== null) {
        window.clearTimeout(exportDoneTimerRef.current);
      }
    };
  }, []);

  // 外部点击与 Esc 关闭悬浮面板
  useEffect(() => {
    if (!issuesOpen && !themeMenuOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (issuesOpen && issuesRef.current && !issuesRef.current.contains(target)) {
        setIssuesOpen(false);
      }
      if (themeMenuOpen && themeMenuRef.current && !themeMenuRef.current.contains(target)) {
        setThemeMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIssuesOpen(false);
        setThemeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [issuesOpen, themeMenuOpen]);

  const totalSlides = deck.slides.length;
  const currentSlide = deck.slides[currentIdx];

  // 同步当前幻灯片 DOM 内容（处于 inline 编辑时不覆盖用户光标与选区，并强制经安全清洗）
  useEffect(() => {
    const el = slideSectionRef.current;
    if (!el || isEditingSlide || !currentSlide) return;
    const safeHtml = sanitizeSlideHtml(currentSlide.html);
    if (el.innerHTML !== safeHtml) {
      el.innerHTML = safeHtml;
    }
  }, [currentSlide, isEditingSlide, viewMode, currentIdx]);

  // 当前页缩略图自动滚动到视野内
  useEffect(() => {
    const btn = thumbRefs.current[currentIdx];
    if (btn && typeof btn.scrollIntoView === "function") {
      btn.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }, [currentIdx]);

  const stageScale = useMemo(() => {
    if (stageSize.width <= 0 || stageSize.height <= 0) return 0.36;
    return Math.max(
      0.1,
      Math.min(
        (stageSize.width - 32) / SLIDE_WIDTH,
        (stageSize.height - 32) / SLIDE_HEIGHT
      )
    );
  }, [stageSize.width, stageSize.height]);

  const fullscreenScale = useMemo(() => {
    if (fullscreenSize.width <= 0 || fullscreenSize.height <= 0) return 0.75;
    return Math.max(
      0.15,
      Math.min(
        (fullscreenSize.width - 48) / SLIDE_WIDTH,
        (fullscreenSize.height - 88) / SLIDE_HEIGHT
      )
    );
  }, [fullscreenSize.width, fullscreenSize.height]);

  const activeThemeMeta = useMemo(
    () => SLIDE_THEMES.find((t) => t.id === deck.theme) ?? SLIDE_THEMES[0],
    [deck.theme]
  );

  const scopedCss = useMemo(
    () =>
      getSlideThemeStyles(deck.theme) +
      (deck.customCss ? `\n${sanitizeSlideCss(deck.customCss)}` : ""),
    [deck.theme, deck.customCss]
  );

  const commitInlineSlideEdit = useCallback(
    async (nextInnerHtml: string): Promise<string> => {
      setIsEditingSlide(false);
      const safeNextHtml = sanitizeSlideHtml(nextInnerHtml);
      const slide = deck.slides[currentIdx];
      if (!slide || safeNextHtml === slide.html) return htmlText;
      try {
        setActionError(null);
        const nextDoc = updateSlideInHtmlDocument(htmlText, currentIdx + 1, {
          html: safeNextHtml,
        });
        await workspaceVfs.writeText(path, nextDoc, {
          snapshotNote: `双击改字：第 ${currentIdx + 1} 页`,
        });
        return nextDoc;
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
        return htmlText;
      }
    },
    [currentIdx, deck.slides, htmlText, path]
  );

  const handleSaveSource = useCallback(async () => {
    if (sourceSaving || !sourceDirty) return;
    setSourceSaving(true);
    setActionError(null);
    try {
      await workspaceVfs.writeText(path, sourceDraft, {
        snapshotNote: "手动编辑幻灯片 HTML 源码",
      });
      setSourceDirty(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSourceSaving(false);
    }
  }, [path, sourceDirty, sourceDraft, sourceSaving]);

  // 源码模式下 Ctrl/Cmd+S 保存
  useEffect(() => {
    if (viewMode !== "source") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      const active = document.activeElement;
      if (rootRef.current && active && rootRef.current.contains(active)) {
        e.preventDefault();
        void handleSaveSource();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewMode, handleSaveSource]);

  // 全屏放映键盘控制（ArrowLeft / ArrowRight / Space / Escape）
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsFullscreen(false);
        return;
      }
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown" || e.key === "ArrowDown") {
        e.preventDefault();
        setCurrentIdx((i) => Math.min(Math.max(0, totalSlides - 1), i + 1));
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "ArrowUp") {
        e.preventDefault();
        setCurrentIdx((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isFullscreen, totalSlides]);

  const handleSelectSlide = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(Math.max(0, totalSlides - 1), idx));
      if (isEditingSlide && slideSectionRef.current) {
        slideSectionRef.current.blur();
      }
      setCurrentIdx(clamped);
    },
    [isEditingSlide, totalSlides]
  );

  const handleSwitchTheme = async (themeId: SlideThemeId) => {
    setThemeMenuOpen(false);
    if (themeId === deck.theme) return;
    const targetMeta = SLIDE_THEMES.find((t) => t.id === themeId);
    setThemeSwitching(true);
    setActionError(null);
    try {
      const baseHtml =
        isEditingSlide && slideSectionRef.current
          ? await commitInlineSlideEdit(slideSectionRef.current.innerHTML)
          : htmlText;
      const nextHtml = switchSlidesHtmlTheme(baseHtml, themeId);
      await workspaceVfs.writeText(path, nextHtml, {
        snapshotNote: `切换幻灯片风格: ${targetMeta?.name || themeId}`,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setThemeSwitching(false);
    }
  };

  const handleExportPptx = async () => {
    if (exporting || totalSlides === 0) return;
    setExporting(true);
    setActionError(null);
    setExportDone(false);
    try {
      let latestHtml = htmlText;
      if (isEditingSlide && slideSectionRef.current) {
        latestHtml = await commitInlineSlideEdit(slideSectionRef.current.innerHTML);
      } else if (viewMode === "source" && sourceDirty) {
        await workspaceVfs.writeText(path, sourceDraft, {
          snapshotNote: "导出 PPTX 前同步源码修改",
        });
        setSourceDirty(false);
        latestHtml = sourceDraft;
      }

      const { pptxPath, pptxFilename } = buildPptxPaths(path);
      const pptxBytes = await exportHtmlSlidesToPptxBytes(latestHtml, pptxFilename);
      await workspaceVfs.writeBytes(pptxPath, pptxBytes, {
        snapshotNote: `由 ${path.split("/").pop() || path} 导出`,
      });
      await getPlatformAdapter().exportFile(pptxFilename, pptxBytes, PPTX_MIME);

      setExportDone(true);
      if (exportDoneTimerRef.current !== null) {
        window.clearTimeout(exportDoneTimerRef.current);
      }
      exportDoneTimerRef.current = window.setTimeout(() => {
        setExportDone(false);
      }, 2200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(`导出 PPTX 失败：${message}`);
    } finally {
      setExporting(false);
    }
  };

  const issueCount = validation.issues.length;
  const issuePagesSet = useMemo(() => {
    const set = new Set<number>();
    for (const issue of validation.issues) {
      if (issue.slideIndex >= 1) {
        set.add(issue.slideIndex - 1);
      }
    }
    return set;
  }, [validation.issues]);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (isFullscreen || isEditingSlide || viewMode !== "stage") return;
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable)
        ) {
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          handleSelectSlide(currentIdx + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          handleSelectSlide(currentIdx - 1);
        }
      }}
      className="flex flex-col h-full min-h-0 bg-[var(--bg-canvas)] outline-none relative"
    >
      {/* 顶部自适应极简工具栏（窄屏与分栏下自动换行，防止按钮重叠与挤出视口） */}
      <div className="min-h-9 shrink-0 py-1 px-2 border-b border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 text-xs select-none">
        {/* 左侧：页码 + 防溢出体检徽章 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="inline-flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              disabled={currentIdx <= 0 || totalSlides === 0}
              onClick={() => handleSelectSlide(currentIdx - 1)}
              className="w-4.5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
              title="上一页"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-0.5 font-mono text-[11px] tabular-nums text-[var(--text-primary)] whitespace-nowrap">
              {totalSlides > 0 ? `${currentIdx + 1} / ${totalSlides}` : "0 / 0"}
            </span>
            <button
              type="button"
              disabled={currentIdx >= totalSlides - 1 || totalSlides === 0}
              onClick={() => handleSelectSlide(currentIdx + 1)}
              className="w-4.5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
              title="下一页"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="relative shrink-0" ref={issuesRef}>
            <button
              type="button"
              onClick={() => {
                setIssuesOpen((v) => !v);
                setThemeMenuOpen(false);
              }}
              className={`h-6 inline-flex items-center gap-1 px-1.5 rounded-[4px] border text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                issuesOpen
                  ? "bg-[var(--bg-active)] border-[var(--border-strong)] text-[var(--text-primary)]"
                  : "border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
              title="查看 1280×720 防溢出与 CSS 白名单体检报告"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  issueCount === 0
                    ? "bg-[var(--status-success)]"
                    : "bg-[var(--status-warning)]"
                }`}
              />
              <span className="tabular-nums">
                {issueCount === 0 ? "0 溢出" : `${issueCount} 处体检`}
              </span>
            </button>

            {issuesOpen && (
              <div className="absolute left-0 top-8 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl z-40 overflow-hidden">
                <div className="px-3 py-2 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[var(--text-primary)]">
                    幻灯片防溢出体检清单
                  </span>
                  <span className="text-[10px] font-mono tabular-nums text-[var(--text-muted)]">
                    {issueCount === 0 ? "PASS" : `${issueCount} ISSUES`}
                  </span>
                </div>
                {issueCount === 0 ? (
                  <div className="px-3 py-3 text-[11px] text-[var(--text-secondary)] flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] shrink-0" />
                    <span>
                      全部 {totalSlides} 页通过 1280×720 边界与幻灯片格式引擎白名单校验。
                    </span>
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto divide-y divide-[var(--border-hairline)]">
                    {validation.issues.map((issue, idx) => {
                      const hasSlide = issue.slideIndex >= 1 && issue.slideIndex <= totalSlides;
                      return (
                        <button
                          key={`${issue.code}_${issue.slideIndex}_${idx}`}
                          type="button"
                          onClick={() => {
                            if (hasSlide) {
                              setViewMode("stage");
                              handleSelectSlide(issue.slideIndex - 1);
                            }
                            setIssuesOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-[var(--bg-hover)] transition-colors flex items-start gap-2 cursor-pointer"
                        >
                          <span
                            className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                              issue.severity === "error"
                                ? "bg-[var(--status-danger)]"
                                : "bg-[var(--status-warning)]"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-medium text-[var(--text-primary)]">
                                {hasSlide ? `第 ${issue.slideIndex} 页` : "全局样式"}
                              </span>
                              <span className="text-[10px] font-mono text-[var(--text-muted)] truncate">
                                {issue.code}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)] leading-relaxed">
                              {issue.message}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：风格切换 + 视图切换 + 双击改字 + 导出 PPTX + 全屏放映 */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {/* 5 套风格下拉 */}
          <div className="relative shrink-0" ref={themeMenuRef}>
            <button
              type="button"
              disabled={themeSwitching}
              onClick={() => {
                setThemeMenuOpen((v) => !v);
                setIssuesOpen(false);
              }}
              aria-label="切换幻灯片风格"
              className="h-6 inline-flex items-center gap-1 px-1.5 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[11px] text-[var(--text-primary)] transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              title="切换 5 套演示风格"
            >
              <span
                className="w-1.5 h-1.5 rounded-full border border-white/20 shrink-0"
                style={{ backgroundColor: activeThemeMeta?.accentHex || "#5e6ad2" }}
              />
              <span className="max-w-[66px] truncate">{activeThemeMeta?.name || deck.theme}</span>
              <ChevronDown className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
            </button>

            {themeMenuOpen && (
              <div className="absolute left-0 sm:left-auto sm:right-0 top-8 w-60 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl z-40 overflow-hidden py-1">
                {SLIDE_THEMES.map((theme) => {
                  const active = theme.id === deck.theme;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => void handleSwitchTheme(theme.id)}
                      className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                        active ? "bg-[var(--bg-active)]" : "hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3.5 h-3.5 rounded-[3px] border border-white/15 shrink-0 flex items-center justify-center"
                          style={{ backgroundColor: theme.bgHex }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: theme.accentHex }}
                          />
                        </span>
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium text-[var(--text-primary)] truncate">
                            {theme.name}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] truncate">
                            {theme.subtitle}
                          </div>
                        </div>
                      </div>
                      {active && <Check className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 演示 / 源码 分段切换 */}
          <div className="inline-flex items-center p-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-hairline)] shrink-0">
            <button
              type="button"
              onClick={() => setViewMode("stage")}
              className={`h-5 px-1.5 rounded-[4px] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === "stage"
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              演示
            </button>
            <button
              type="button"
              onClick={() => {
                if (isEditingSlide && slideSectionRef.current) {
                  slideSectionRef.current.blur();
                }
                setViewMode("source");
              }}
              className={`h-5 px-1.5 rounded-[4px] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === "source"
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              源码
            </button>
          </div>

          {/* 双击改字开关 */}
          <button
            type="button"
            aria-pressed={doubleClickEdit}
            onClick={() => {
              if (doubleClickEdit && isEditingSlide && slideSectionRef.current) {
                slideSectionRef.current.blur();
              }
              setDoubleClickEdit((v) => !v);
            }}
            className={`h-6 inline-flex items-center gap-1 px-1.5 rounded-[4px] border text-[11px] font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
              doubleClickEdit
                ? "bg-[var(--accent-soft)] border-[var(--accent)]/60 text-[var(--text-primary)]"
                : "border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            title="开启后双击舞台中的文字即可直接修改并失焦保存"
          >
            <Pencil
              className={`w-3 h-3 shrink-0 ${
                doubleClickEdit ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
              }`}
            />
            <span>双击改字</span>
          </button>

          {/* 导出 PPTX 主动作按钮 */}
          <button
            type="button"
            disabled={exporting || totalSlides === 0}
            onClick={() => void handleExportPptx()}
            className="h-6 inline-flex items-center gap-1 px-1.5 rounded-[4px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-[11px] font-medium text-white transition-colors cursor-pointer shrink-0 whitespace-nowrap"
            title="使用幻灯片格式引擎将当前幻灯片无损导出为原生可编辑 .pptx"
          >
            {exporting ? (
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            ) : exportDone ? (
              <Check className="w-3 h-3 shrink-0" />
            ) : (
              <Download className="w-3 h-3 shrink-0" />
            )}
            <span>{exporting ? "导出中…" : exportDone ? "已导出" : "导出 PPTX"}</span>
          </button>

          {/* 全屏放映 */}
          <button
            type="button"
            disabled={totalSlides === 0}
            onClick={() => {
              if (isEditingSlide && slideSectionRef.current) {
                slideSectionRef.current.blur();
              }
              setViewMode("stage");
              setIsFullscreen(true);
            }}
            className="w-6 h-6 inline-flex items-center justify-center rounded-[4px] border border-transparent hover:border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 transition-colors cursor-pointer shrink-0"
            title="全屏放映"
            aria-label="全屏放映"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 操作错误提示条 */}
      {actionError && (
        <div className="shrink-0 px-3 py-1.5 border-b border-[var(--border-hairline)] border-l-2 border-l-[var(--status-danger)] bg-[var(--bg-surface)] text-[11px] text-[var(--status-danger)] flex items-center justify-between gap-2">
          <span className="truncate">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 主体：演示舞台 或 HTML 源码编辑器 */}
      {viewMode === "source" ? (
        <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-canvas)]">
          <div className="h-8 shrink-0 px-3 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between text-[11px]">
            <span className="text-[var(--text-muted)] font-mono truncate">
              HTML-First 幻灯片源码（1280×720）
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {sourceDirty ? (
                <>
                  <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-warning)]" />
                    <span>未保存</span>
                  </span>
                  <button
                    type="button"
                    disabled={sourceSaving}
                    onClick={() => void handleSaveSource()}
                    className="h-5 inline-flex items-center gap-1 px-2 rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-active)] text-[11px] font-medium text-[var(--text-primary)] cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3 h-3 text-[var(--accent)]" />
                    <span>{sourceSaving ? "保存中…" : "保存"}</span>
                  </button>
                </>
              ) : (
                <span className="font-mono tabular-nums text-[10px] text-[var(--text-muted)]">
                  {sourceDraft.split(/\r?\n/).length} 行
                </span>
              )}
            </div>
          </div>
          <textarea
            value={sourceDraft}
            spellCheck={false}
            onChange={(e) => {
              setSourceDraft(e.target.value);
              setSourceDirty(true);
            }}
            className="flex-1 w-full resize-none bg-[var(--bg-canvas)] p-4 text-[12px] font-mono leading-relaxed text-[var(--text-primary)] outline-none min-h-0 selection:bg-[var(--accent-soft)]"
          />
        </div>
      ) : totalSlides === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-[var(--surface-paper)] text-xs text-[var(--text-muted)] gap-2">
          <span>未解析到幻灯片页面（请确认文档包含 &lt;section class=&quot;slide&quot;&gt; 节点）。</span>
          <button
            type="button"
            onClick={() => setViewMode("source")}
            className="h-7 px-2.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] cursor-pointer"
          >
            查看源码
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* 中部 16:9 无损舞台 */}
          <div
            ref={stageContainerRef}
            className="flex-1 min-h-0 overflow-hidden bg-[var(--surface-paper)] flex items-center justify-center relative"
          >
            {doubleClickEdit && (
              <div className="absolute top-2.5 right-3 z-10 px-2 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)]/90 text-[10px] text-[var(--text-secondary)] pointer-events-none">
                {isEditingSlide ? "编辑中 · 点击空白处或按 Esc 自动保存" : "双击画布文字即可编辑"}
              </div>
            )}

            <div
              data-theme={deck.theme}
              className={`mizurisu-slide-scope relative shrink-0 rounded-[6px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.3)] ring-1 ${
                isEditingSlide
                  ? "ring-[var(--accent)]"
                  : "ring-[var(--border-hairline)]"
              }`}
              style={{
                width: Math.round(SLIDE_WIDTH * stageScale),
                height: Math.round(SLIDE_HEIGHT * stageScale),
              }}
            >
              <style>{scopedCss}</style>
              <div
                style={{
                  width: SLIDE_WIDTH,
                  height: SLIDE_HEIGHT,
                  transform: `scale(${stageScale})`,
                  transformOrigin: "top left",
                }}
              >
                <section
                  ref={slideSectionRef}
                  className="slide outline-none"
                  data-slide-index={currentIdx + 1}
                  data-title={currentSlide?.title || ""}
                  data-notes={currentSlide?.notes || ""}
                  contentEditable={isEditingSlide}
                  suppressContentEditableWarning
                  style={{
                    width: SLIDE_WIDTH,
                    height: SLIDE_HEIGHT,
                    position: "relative",
                    overflow: "hidden",
                    cursor: doubleClickEdit
                      ? isEditingSlide
                        ? "text"
                        : "pointer"
                      : "default",
                  }}
                  onDoubleClick={(e) => {
                    if (!doubleClickEdit) return;
                    e.stopPropagation();
                    if (!isEditingSlide) {
                      e.currentTarget.contentEditable = "true";
                      setIsEditingSlide(true);
                      e.currentTarget.focus();
                    }
                  }}
                  onBlur={(e) => {
                    if (!isEditingSlide) return;
                    if (
                      e.relatedTarget &&
                      e.currentTarget.contains(e.relatedTarget as Node)
                    ) {
                      return;
                    }
                    void commitInlineSlideEdit(e.currentTarget.innerHTML);
                  }}
                  onKeyDown={(e) => {
                    if (isEditingSlide && e.key === "Escape") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                />
              </div>
            </div>
          </div>

          {/* 底部缩略图胶片条 + 可折叠演讲者备注 */}
          <div className="shrink-0 border-t border-[var(--border-hairline)] bg-[var(--bg-sidebar)]">
            <div
              data-theme={deck.theme}
              className="mizurisu-slide-scope px-3 py-2 flex items-center gap-2 overflow-x-auto"
            >
              <style>{scopedCss}</style>
              {deck.slides.map((slide, idx) => {
                const selected = idx === currentIdx;
                const hasIssue = issuePagesSet.has(idx);
                return (
                  <button
                    key={`${idx}_${slide.title}`}
                    ref={(el) => {
                      thumbRefs.current[idx] = el;
                    }}
                    type="button"
                    onClick={() => handleSelectSlide(idx)}
                    title={slide.title || `第 ${idx + 1} 页`}
                    className={`group relative shrink-0 text-left rounded-[4px] overflow-hidden transition-all cursor-pointer bg-[var(--bg-canvas)] ${
                      selected
                        ? "border border-[var(--accent)]"
                        : "border border-[var(--border-hairline)] hover:border-[var(--border-strong)] opacity-80 hover:opacity-100"
                    }`}
                    style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
                  >
                    <div
                      className="pointer-events-none select-none text-left"
                      style={{
                        width: SLIDE_WIDTH,
                        height: SLIDE_HEIGHT,
                        transform: `scale(${THUMB_SCALE})`,
                        transformOrigin: "top left",
                        textAlign: "left",
                      }}
                    >
                      <section
                        className="slide"
                        data-slide-index={idx + 1}
                        style={{
                          width: SLIDE_WIDTH,
                          height: SLIDE_HEIGHT,
                          position: "relative",
                          overflow: "hidden",
                        }}
                        dangerouslySetInnerHTML={{ __html: sanitizeSlideHtml(slide.html) }}
                      />
                    </div>
                    <span
                      className={`absolute bottom-1 left-1 px-1 rounded text-[9px] font-mono tabular-nums leading-tight ${
                        selected
                          ? "bg-[var(--accent)] text-white"
                          : "bg-black/60 text-white/85"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    {hasIssue && (
                      <span
                        className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--status-warning)]"
                        title="该页有体检提醒"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* 简洁可折叠演讲者备注栏 */}
            <div className="border-t border-[var(--border-hairline)]">
              <button
                type="button"
                onClick={() => setNotesOpen((v) => !v)}
                className="w-full h-7 px-3 flex items-center justify-between gap-2 bg-[var(--bg-sidebar)] hover:bg-[var(--bg-hover)] text-[11px] transition-colors cursor-pointer select-none"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StickyNote className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                  <span className="font-medium text-[var(--text-secondary)] shrink-0">
                    演讲者备注
                  </span>
                  {!notesOpen && currentSlide?.notes && (
                    <span className="text-[var(--text-muted)] truncate">
                      {currentSlide.notes}
                    </span>
                  )}
                </div>
                {notesOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                )}
              </button>
              {notesOpen && (
                <div className="max-h-20 overflow-y-auto px-3 py-2 bg-[var(--bg-surface)] border-t border-[var(--border-hairline)] text-[11.5px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
                  {currentSlide?.notes?.trim()
                    ? currentSlide.notes
                    : "本页暂无演讲者备注"}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 全屏放映模式 */}
      {isFullscreen && totalSlides > 0 && currentSlide && (
        <div
          ref={fullscreenRef}
          className="fixed inset-0 z-50 bg-[#050506] flex items-center justify-center overflow-hidden select-none"
        >
          <div
            data-theme={deck.theme}
            className="mizurisu-slide-scope relative shrink-0 rounded-[4px] overflow-hidden shadow-2xl"
            style={{
              width: Math.round(SLIDE_WIDTH * fullscreenScale),
              height: Math.round(SLIDE_HEIGHT * fullscreenScale),
            }}
          >
            <style>{scopedCss}</style>
            <div
              style={{
                width: SLIDE_WIDTH,
                height: SLIDE_HEIGHT,
                transform: `scale(${fullscreenScale})`,
                transformOrigin: "top left",
              }}
            >
              <section
                className="slide"
                data-slide-index={currentIdx + 1}
                style={{
                  width: SLIDE_WIDTH,
                  height: SLIDE_HEIGHT,
                  position: "relative",
                  overflow: "hidden",
                }}
                dangerouslySetInnerHTML={{ __html: sanitizeSlideHtml(currentSlide.html) }}
              />
            </div>
          </div>

          {/* 屏幕下方克制半透明翻页条 */}
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#131417]/80 backdrop-blur-md border border-white/10 text-xs text-white/90 shadow-2xl">
            <button
              type="button"
              disabled={currentIdx <= 0}
              onClick={() => handleSelectSlide(currentIdx - 1)}
              className="w-6 h-6 inline-flex items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30 transition-colors cursor-pointer"
              title="上一页 (←)"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[11px] tabular-nums px-1 text-white/90">
              {currentIdx + 1} / {totalSlides}
            </span>
            {currentSlide.title && (
              <span className="hidden sm:inline max-w-[200px] truncate text-[11px] text-white/55 pr-1">
                {currentSlide.title}
              </span>
            )}
            <button
              type="button"
              disabled={currentIdx >= totalSlides - 1}
              onClick={() => handleSelectSlide(currentIdx + 1)}
              className="w-6 h-6 inline-flex items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30 transition-colors cursor-pointer"
              title="下一页 (→ / Space)"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <span className="w-px h-3.5 bg-white/15" />
            <button
              type="button"
              onClick={() => setIsFullscreen(false)}
              className="h-6 inline-flex items-center gap-1 px-2 rounded-full hover:bg-white/10 text-[11px] text-white/75 hover:text-white transition-colors cursor-pointer"
              title="退出全屏 (Esc)"
            >
              <Minimize2 className="w-3 h-3" />
              <span>退出</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
