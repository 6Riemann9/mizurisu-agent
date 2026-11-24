import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  StickyNote,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { init as initPptxPreview } from "pptx-preview";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildSlidesHtmlDocument,
  readPptDocument,
  type ParsedPptSlide,
  type PptReadResult,
  type SlideDeckSpec,
  type SlidePageSpec,
} from "../../office";
import { workspaceVfs } from "../../storage/workspace-vfs";
import { useAppStore } from "../../store/useAppStore";

const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.15;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 截断超长文本，避免原生 PPT 转换到 1280×720 幻灯片画布时溢出 */
function clampSlideLine(text: string, maxLen = 140): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

/** 将提取出的单页 PPT 文本与备注转换为高颜值 HTML-First 幻灯片片段 */
function convertPptSlideToHtmlPage(
  slide: ParsedPptSlide,
  index: number,
  total: number,
  deckTitle: string
): SlidePageSpec {
  const title = slide.title?.trim() || `第 ${index + 1} 页`;
  const rawBody = slide.texts
    .slice(1)
    .map((t) => clampSlideLine(t))
    .filter((t) => t.length > 0 && !/^\d+$/.test(t));

  const pageTag = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;

  // 封面页（首页且正文精简时优先铺设封面舞台）
  if (index === 0 && rawBody.length <= 4) {
    const subtitle = rawBody[0] || "已转换为可编辑 HTML-First 幻灯片";
    const metaCards = rawBody.slice(1, 4);
    const metaHtml =
      metaCards.length > 0
        ? `
  <div class="cover-meta-grid">
    ${metaCards
      .map(
        (m, idx) => `
    <div class="cover-meta-card">
      <span class="kpi-label">核心要点 0${idx + 1}</span>
      <span class="card-title">${escapeHtml(clampSlideLine(m, 48))}</span>
    </div>`
      )
      .join("")}
  </div>`
        : "";

    return {
      title,
      notes: slide.notes || undefined,
      html: `
<div class="cover-stage">
  <div class="badge-row">
    <div class="badge is-accent">PRESENTATION DECK</div>
    <div class="badge">共 ${total} 页 · 支持双击改字</div>
  </div>
  <div class="cover-hero">
    <div class="slide-kicker">CONVERTED FROM PPTX</div>
    <h1 class="slide-h1">${escapeHtml(clampSlideLine(title, 64))}</h1>
    <p class="slide-subtitle">${escapeHtml(clampSlideLine(subtitle, 110))}</p>
  </div>${metaHtml}
</div>`,
    };
  }

  let bodyHtml = "";
  if (rawBody.length === 0) {
    bodyHtml = `
<div class="slide-body">
  <div class="bento-card is-accent">
    <div class="card-title">${escapeHtml(title)}</div>
    <p class="card-desc">双击任意文字区域即可直接修改内容，也可在右上角切换 5 套商务主题并导出新版 .pptx。</p>
  </div>
</div>`;
  } else if (rawBody.length <= 5) {
    bodyHtml = `
<div class="slide-body">
  <div class="action-list">
    ${rawBody
      .map(
        (item, idx) => `
    <div class="action-item">
      <span class="action-index">${String(idx + 1).padStart(2, "0")}</span>
      <div class="action-desc" style="font-size: 16px; color: var(--slide-text);">${escapeHtml(item)}</div>
    </div>`
      )
      .join("")}
  </div>
</div>`;
  } else {
    const capped = rawBody.slice(0, 10);
    const mid = Math.ceil(capped.length / 2);
    const leftItems = capped.slice(0, mid);
    const rightItems = capped.slice(mid);
    bodyHtml = `
<div class="slide-body">
  <div class="cols-2">
    <div class="bento-card">
      <div class="card-title">核心要点（上）</div>
      <ul>
        ${leftItems.map((it) => `<li>${escapeHtml(clampSlideLine(it, 84))}</li>`).join("")}
      </ul>
    </div>
    <div class="bento-card">
      <div class="card-title">核心要点（下）</div>
      <ul>
        ${rightItems.map((it) => `<li>${escapeHtml(clampSlideLine(it, 84))}</li>`).join("")}
      </ul>
    </div>
  </div>
</div>`;
  }

  return {
    title,
    notes: slide.notes || undefined,
    html: `
<div class="slide-header">
  <div class="slide-header-main">
    <div class="slide-kicker">SLIDE ${String(index + 1).padStart(2, "0")}</div>
    <h2 class="slide-h2">${escapeHtml(clampSlideLine(title, 56))}</h2>
  </div>
</div>
${bodyHtml}
<div class="slide-footer">
  <span>${escapeHtml(deckTitle)}</span>
  <span>${pageTag}</span>
</div>`,
  };
}

/** 避免静默覆盖已有 .slides.html 文件，冲突时提示或生成带序号新文件名 */
async function resolveSlidesTargetPath(pptPath: string): Promise<string> {
  const stem = pptPath.replace(/\.(pptx|ppt)$/i, "") || "presentation";
  const preferred = `${stem}.slides.html`;
  if (!(await workspaceVfs.exists(preferred))) {
    return preferred;
  }
  const overwrite =
    typeof window !== "undefined" && typeof window.confirm === "function"
      ? window.confirm(
          `工作区已存在「${preferred}」，是否覆盖原文件？\n点击“取消”将自动另存为带序号的新版本文件。`
        )
      : false;
  if (overwrite) {
    return preferred;
  }
  let idx = 2;
  while (idx < 1000) {
    const candidate = `${stem} (${idx}).slides.html`;
    if (!(await workspaceVfs.exists(candidate))) {
      return candidate;
    }
    idx += 1;
  }
  return `${stem}_${Date.now()}.slides.html`;
}

function clampZoom(val: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(val.toFixed(2))));
}

export function PptViewer({ path, bytes }: { path?: string; bytes: Uint8Array }) {
  const openPreview = useAppStore((s) => s.openPreview);
  const pushToast = useAppStore((s) => s.pushToast);
  const appTheme = useAppStore((s) => s.settings.theme);

  const [mode, setMode] = useState<"visual" | "cards">("visual");
  const [parsed, setParsed] = useState<PptReadResult | null>(null);
  const [visualSlideCount, setVisualSlideCount] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);

  const [visualZoom, setVisualZoom] = useState(1);
  const [visualContainerWidth, setVisualContainerWidth] = useState(0);
  const [visualFallbackReason, setVisualFallbackReason] = useState<string | null>(null);
  const [visualLoading, setVisualLoading] = useState(false);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsNotesOpen, setFsNotesOpen] = useState(false);
  const [fsVisualFailed, setFsVisualFailed] = useState(false);
  const [fsStageSize, setFsStageSize] = useState({ width: 0, height: 0 });

  const [converting, setConverting] = useState(false);

  const visualScrollRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const fsStageRef = useRef<HTMLDivElement>(null);
  const fsPreviewContainerRef = useRef<HTMLDivElement>(null);
  const fsPreviewerRef = useRef<ReturnType<typeof initPptxPreview> | null>(null);
  const fsLoadedSlideCountRef = useRef(0);
  const currentIdxRef = useRef(currentIdx);
  currentIdxRef.current = currentIdx;

  // 切换文件或字节变化时重置状态并解析大纲内容与演讲者备注
  useEffect(() => {
    let cancelled = false;
    setCurrentIdx(0);
    setMode("visual");
    setVisualZoom(1);
    setVisualSlideCount(0);
    setVisualFallbackReason(null);
    setIsFullscreen(false);
    setFsNotesOpen(false);
    setFsVisualFailed(false);

    readPptDocument(bytes)
      .then((res) => {
        if (!cancelled) {
          setParsed(res);
          setCurrentIdx(0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setParsed(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bytes, path]);

  // 监听视觉排版容器宽度变化（防抖 150ms），拖宽分栏时自动重适配渲染宽度
  useEffect(() => {
    if (mode !== "visual") return;
    const el = visualScrollRef.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const sync = (immediate = false) => {
      const nextW = el.clientWidth;
      if (immediate) {
        setVisualContainerWidth(nextW);
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setVisualContainerWidth(el.clientWidth);
      }, 150);
    };
    sync(true);

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => sync(false))
        : null;
    observer?.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      observer?.disconnect();
    };
  }, [mode]);

  // 使用 pptx-preview 进行高保真视觉排版渲染，失败时自动平滑回退到大纲播放
  useEffect(() => {
    if (mode !== "visual" || !visualRef.current) return;
    let destroyed = false;
    let previewer: ReturnType<typeof initPptxPreview> | null = null;
    const container = visualRef.current;
    container.innerHTML = "";
    setVisualLoading(true);

    const baseWidth = Math.max(
      280,
      (visualContainerWidth > 0 ? visualContainerWidth : container.clientWidth || 480) - 32
    );
    const renderWidth = Math.round(baseWidth * visualZoom);

    try {
      // 在 list 模式下省略 height 参数，避免 pptx-preview 锁定单页高度产生嵌套滚动条
      previewer = initPptxPreview(container, { width: renderWidth, mode: "list" });
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      previewer
        .preview(copy.buffer)
        .then(() => {
          if (destroyed) return;
          setVisualLoading(false);
          setVisualFallbackReason(null);
          if (previewer && previewer.slideCount > 0) {
            setVisualSlideCount(previewer.slideCount);
          }
          // 消除 pptx-preview 包装层纯黑底色并赋予卡片精致阴影
          const wrapper = container.querySelector(".pptx-preview-wrapper") as HTMLElement | null;
          if (wrapper) {
            wrapper.style.background = "transparent";
          }
          const slideEls = container.querySelectorAll<HTMLElement>(".pptx-preview-slide-wrapper");
          slideEls.forEach((el, idx) => {
            el.style.borderRadius = "6px";
            el.style.boxShadow =
              "0 4px 18px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(128, 128, 128, 0.18)";
            el.style.marginBottom = "16px";
            el.title = "点击同步页码，双击进入全屏放映";
            el.onclick = () => setCurrentIdx(idx);
            el.ondblclick = () => {
              setCurrentIdx(idx);
              setFsVisualFailed(false);
              setIsFullscreen(true);
            };
          });
        })
        .catch((err: unknown) => {
          if (destroyed) return;
          setVisualLoading(false);
          const msg = err instanceof Error ? err.message : String(err);
          setVisualFallbackReason(`视觉排版暂不支持当前文件部分版式（${msg}），已自动切换为大纲播放。`);
          setMode("cards");
        });
    } catch (err) {
      if (!destroyed) {
        setVisualLoading(false);
        const msg = err instanceof Error ? err.message : String(err);
        setVisualFallbackReason(`视觉排版初始化失败（${msg}），已自动切换为大纲播放。`);
        setMode("cards");
      }
    }

    return () => {
      destroyed = true;
      try {
        previewer?.destroy();
      } catch {
        // 忽略销毁时内部节点已移除异常
      }
    };
  }, [bytes, mode, visualContainerWidth, visualZoom]);

  const totalSlides = parsed?.slideCount || visualSlideCount || 0;
  const currentSlide = parsed?.slides[currentIdx];

  // 测量全屏放映舞台尺寸
  useEffect(() => {
    if (!isFullscreen) return;
    const el = fsStageRef.current;
    if (!el) return;
    const sync = () => {
      setFsStageSize({ width: el.clientWidth, height: el.clientHeight });
    };
    sync();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    observer?.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [isFullscreen]);

  // 全屏模式下优先尝试渲染当前页视觉版式，异常时回退暗黑高对比大纲舞台
  useEffect(() => {
    if (!isFullscreen || fsVisualFailed || !fsPreviewContainerRef.current) return;
    if (fsStageSize.width <= 0 || fsStageSize.height <= 0) return;

    let destroyed = false;
    const container = fsPreviewContainerRef.current;
    container.innerHTML = "";
    container.style.transform = "";
    fsLoadedSlideCountRef.current = 0;

    const maxW = Math.max(320, fsStageSize.width - 48);
    const maxH = Math.max(220, fsStageSize.height - 96);
    const stageWidth = Math.round(Math.min(maxW, (maxH * 16) / 9));

    let previewer: ReturnType<typeof initPptxPreview> | null = null;
    try {
      previewer = initPptxPreview(container, { width: stageWidth, mode: "list" });
      fsPreviewerRef.current = previewer;
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      previewer
        .load(copy.buffer)
        .then((pptx) => {
          if (destroyed || !previewer) return;
          const count = pptx.slides?.length || 0;
          fsLoadedSlideCountRef.current = count;
          if (count === 0) {
            setFsVisualFailed(true);
            return;
          }
          // 若 PPTX 为 4:3 等偏方画幅且按 16:9 宽度测算后超出屏高，则等比微缩以完整落入全屏舞台
          const aspectH = pptx.width > 0 ? stageWidth * (pptx.height / pptx.width) : 0;
          if (aspectH > maxH) {
            container.style.transform = `scale(${maxH / aspectH})`;
            container.style.transformOrigin = "center center";
          }
          const safeIdx = Math.max(0, Math.min(count - 1, currentIdxRef.current));
          previewer.renderSingleSlide(safeIdx);
          const wrapper = container.querySelector(".pptx-preview-wrapper") as HTMLElement | null;
          if (wrapper) {
            wrapper.style.background = "transparent";
          }
          const slideEl = container.querySelector(".pptx-preview-slide-wrapper") as HTMLElement | null;
          if (slideEl) {
            slideEl.style.margin = "0 auto";
            slideEl.style.borderRadius = "6px";
            slideEl.style.boxShadow = "0 16px 48px rgba(0, 0, 0, 0.55)";
          }
        })
        .catch(() => {
          if (!destroyed) setFsVisualFailed(true);
        });
    } catch {
      setFsVisualFailed(true);
    }

    return () => {
      destroyed = true;
      fsLoadedSlideCountRef.current = 0;
      fsPreviewerRef.current = null;
      try {
        previewer?.destroy();
      } catch {
        // 忽略全屏预览销毁异常
      }
    };
  }, [isFullscreen, fsVisualFailed, bytes, fsStageSize.width, fsStageSize.height]);

  // 全屏模式下翻页时同步单页视觉渲染
  useEffect(() => {
    if (!isFullscreen || fsVisualFailed) return;
    const previewer = fsPreviewerRef.current;
    const count = fsLoadedSlideCountRef.current;
    if (!previewer || count <= 0) return;
    const safeIdx = Math.max(0, Math.min(count - 1, currentIdx));
    try {
      previewer.renderSingleSlide(safeIdx);
      const slideEl = fsPreviewContainerRef.current?.querySelector(
        ".pptx-preview-slide-wrapper"
      ) as HTMLElement | null;
      if (slideEl) {
        slideEl.style.margin = "0 auto";
        slideEl.style.borderRadius = "6px";
        slideEl.style.boxShadow = "0 16px 48px rgba(0, 0, 0, 0.55)";
      }
    } catch {
      setFsVisualFailed(true);
    }
  }, [currentIdx, isFullscreen, fsVisualFailed]);

  const handleStepSlide = useCallback(
    (delta: number) => {
      if (totalSlides <= 0) return;
      setCurrentIdx((i) => Math.max(0, Math.min(totalSlides - 1, i + delta)));
    },
    [totalSlides]
  );

  // 全屏放映键盘导航（ArrowLeft / ArrowRight / Space / Escape）
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsFullscreen(false);
        return;
      }
      if (
        e.key === "ArrowRight" ||
        e.key === " " ||
        e.key === "PageDown" ||
        e.key === "ArrowDown"
      ) {
        e.preventDefault();
        handleStepSlide(1);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "ArrowUp") {
        e.preventDefault();
        handleStepSlide(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isFullscreen, handleStepSlide]);

  // 一键转为可编辑 HTML-First 幻灯片（.slides.html）
  const handleConvertToEditableSlides = async () => {
    if (!path || converting) return;
    setConverting(true);
    try {
      const pptData = parsed ?? (await readPptDocument(bytes));
      if (!pptData || pptData.slides.length === 0) {
        pushToast("未在该文件中提取到可转换的幻灯片内容", "warning");
        return;
      }

      const fileName = path.split("/").pop() || path;
      const deckTitle = fileName.replace(/\.(pptx|ppt)$/i, "") || "演示文稿";
      const targetPath = await resolveSlidesTargetPath(path);
      const targetTheme = appTheme === "light" ? "consulting-exec" : "linear-dark";

      const spec: SlideDeckSpec = {
        title: deckTitle,
        theme: targetTheme,
        slides: pptData.slides.map((s, idx) =>
          convertPptSlideToHtmlPage(s, idx, pptData.slides.length, deckTitle)
        ),
      };

      const slidesHtml = buildSlidesHtmlDocument(spec);
      await workspaceVfs.writeText(targetPath, slidesHtml, {
        snapshotNote: `由 ${fileName} 转为可编辑幻灯片`,
      });
      openPreview(targetPath);
      pushToast(
        `已转为可编辑幻灯片「${targetPath.split("/").pop()}」，支持双击改字、切主题与导出新版 .pptx`,
        "success"
      );
    } catch (err) {
      pushToast(
        `转换可编辑幻灯片失败：${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-w-0 min-h-0 bg-[var(--bg-canvas)]">
      {/* 自适应顶部工具栏（flex-wrap 避免窄分栏下重叠） */}
      <div className="min-h-9 shrink-0 py-1 px-2.5 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 text-xs select-none">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">
            幻灯片 {totalSlides > 0 ? `· ${totalSlides} 页` : ""}
          </span>

          {/* 模式切换：优先视觉排版，支持大纲播放 */}
          <div className="inline-flex items-center p-0.5 rounded-md bg-[var(--bg-sidebar)] border border-[var(--border-hairline)] shrink-0">
            <button
              type="button"
              onClick={() => {
                setVisualFallbackReason(null);
                setMode("visual");
              }}
              className={`h-6 px-2 rounded-[4px] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                mode === "visual"
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              视觉排版
            </button>
            <button
              type="button"
              onClick={() => setMode("cards")}
              className={`h-6 px-2 rounded-[4px] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                mode === "cards"
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              大纲播放
            </button>
          </div>
        </div>

        {/* 右侧操作区：视觉缩放 + 一键转可编辑幻灯片 + 全屏放映 */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {mode === "visual" && (
            <div className="inline-flex items-center p-0.5 rounded-md bg-[var(--bg-sidebar)] border border-[var(--border-hairline)] shrink-0">
              <button
                type="button"
                disabled={visualZoom <= ZOOM_MIN}
                onClick={() => setVisualZoom((z) => clampZoom(z - ZOOM_STEP))}
                className="w-6 h-6 inline-flex items-center justify-center rounded-[4px] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 cursor-pointer"
                title="缩小"
                aria-label="缩小"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setVisualZoom(1)}
                className="px-1.5 h-6 font-mono tabular-nums text-[11px] min-w-[42px] text-center text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-[4px] cursor-pointer"
                title="点击重置为适配宽度 (100%)"
              >
                {Math.round(visualZoom * 100)}%
              </button>
              <button
                type="button"
                disabled={visualZoom >= ZOOM_MAX}
                onClick={() => setVisualZoom((z) => clampZoom(z + ZOOM_STEP))}
                className="w-6 h-6 inline-flex items-center justify-center rounded-[4px] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 cursor-pointer"
                title="放大"
                aria-label="放大"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {path && (
            <button
              type="button"
              disabled={converting}
              onClick={() => void handleConvertToEditableSlides()}
              className="h-6 inline-flex items-center gap-1 px-2 rounded-[4px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-[11px] font-medium text-white transition-colors cursor-pointer shrink-0 whitespace-nowrap"
              title="提取标题、要点与演说备注生成可编辑幻灯片（支持双击改字、换肤与导出新版 .pptx）"
            >
              {converting ? (
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              ) : (
                <Wand2 className="w-3 h-3 shrink-0" />
              )}
              <span>{converting ? "转换中…" : "转为可编辑幻灯片"}</span>
            </button>
          )}

          <button
            type="button"
            disabled={totalSlides === 0}
            onClick={() => {
              setFsVisualFailed(false);
              setIsFullscreen(true);
            }}
            className="h-6 inline-flex items-center gap-1 px-2 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
            title="全屏放映幻灯片 (支持方向键/空格翻页)"
          >
            <Maximize2 className="w-3 h-3 shrink-0" />
            <span className="hidden sm:inline">全屏放映</span>
          </button>
        </div>
      </div>

      {/* 视觉渲染回退提示条 */}
      {visualFallbackReason && mode === "cards" && (
        <div className="shrink-0 px-3 py-1.5 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[11px] text-[var(--status-warning)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{visualFallbackReason}</span>
          </div>
          <button
            type="button"
            onClick={() => setVisualFallbackReason(null)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0 cursor-pointer"
            title="关闭提示"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 主体展示区 */}
      {mode === "visual" ? (
        <div
          ref={visualScrollRef}
          className="flex-1 min-w-0 min-h-0 overflow-auto p-4 bg-[var(--surface-paper)] relative"
        >
          {visualLoading && (
            <div className="py-6 text-center text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>正在渲染原生视觉排版…</span>
            </div>
          )}
          <div ref={visualRef} className="flex flex-col items-center" />
        </div>
      ) : !parsed || parsed.slides.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-paper)]">
          未能提取到幻灯片内容
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {/* 当前幻灯片大纲舞台 */}
          <div className="flex-1 overflow-auto p-5 flex flex-col items-center justify-center bg-[var(--surface-paper)] min-h-0">
            <div className="w-full max-w-2xl aspect-video rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-[0_2px_10px_rgba(0,0,0,0.18)] p-6 sm:p-8 flex flex-col justify-between overflow-y-auto">
              <div>
                <div className="text-[11px] font-mono tabular-nums text-[var(--accent)] mb-2 tracking-wide">
                  SLIDE {currentIdx + 1} / {parsed.slideCount}
                </div>
                <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-[var(--text-primary)] mb-4">
                  {currentSlide?.title}
                </h2>
                <ul className="space-y-2.5 text-xs sm:text-sm text-[var(--text-secondary)]">
                  {currentSlide?.texts.slice(1).map((t, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 leading-relaxed">
                      <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {currentSlide?.notes && (
              <div className="w-full max-w-2xl mt-3 px-3.5 py-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-xs text-[var(--text-secondary)] flex items-start gap-2.5">
                <StickyNote className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-[var(--text-primary)] mb-0.5 text-[11px]">
                    演讲者备注
                  </div>
                  <p className="whitespace-pre-wrap leading-relaxed">{currentSlide.notes}</p>
                </div>
              </div>
            )}
          </div>

          {/* 翻页与页码条 */}
          <div className="h-9 shrink-0 px-3 border-t border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between gap-2 text-xs select-none">
            <button
              type="button"
              disabled={currentIdx <= 0}
              onClick={() => handleStepSlide(-1)}
              className="h-6 inline-flex items-center gap-1 px-2 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>上一页</span>
            </button>
            <div className="flex items-center gap-1 overflow-x-auto max-w-[60%]">
              {parsed.slides.map((s, idx) => (
                <button
                  key={s.index}
                  type="button"
                  onClick={() => setCurrentIdx(idx)}
                  className={`w-6 h-6 rounded font-mono tabular-nums text-[11px] shrink-0 transition-colors cursor-pointer ${
                    idx === currentIdx
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-strong)] font-medium"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent"
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={currentIdx >= parsed.slideCount - 1}
              onClick={() => handleStepSlide(1)}
              className="h-6 inline-flex items-center gap-1 px-2 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <span>下一页</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 全屏暗黑放映舞台（支持键盘翻页与演说备注开关） */}
      {isFullscreen && totalSlides > 0 && (
        <div
          ref={fsStageRef}
          className="fixed inset-0 z-50 bg-[#050506] flex flex-col items-center justify-center p-6 pb-20 overflow-hidden select-none"
        >
          {!fsVisualFailed ? (
            <div
              ref={fsPreviewContainerRef}
              className="flex items-center justify-center max-w-full max-h-full"
            />
          ) : (
            <div className="w-full max-w-4xl aspect-video rounded-xl border border-white/10 bg-[#121318] shadow-2xl p-8 sm:p-12 flex flex-col justify-between overflow-y-auto text-white">
              <div>
                <div className="text-xs font-mono tabular-nums text-[#818cf8] mb-3 tracking-wider">
                  SLIDE {currentIdx + 1} / {totalSlides}
                </div>
                <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white mb-6">
                  {currentSlide?.title || `第 ${currentIdx + 1} 页`}
                </h2>
                <ul className="space-y-3 text-sm sm:text-base text-white/80">
                  {currentSlide?.texts.slice(1).map((t, idx) => (
                    <li key={idx} className="flex items-start gap-3 leading-relaxed">
                      <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-[#818cf8] shrink-0" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* 演说备注浮动抽屉 */}
          {fsNotesOpen && (
            <div className="fixed bottom-16 left-1/2 -translate-x-1/2 w-[min(680px,calc(100vw-2rem))] max-h-40 overflow-y-auto rounded-lg bg-[#131417]/95 backdrop-blur-md border border-white/15 px-4 py-3 text-xs text-white/85 shadow-2xl">
              <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] font-medium text-white/60">
                <span className="inline-flex items-center gap-1.5">
                  <StickyNote className="w-3.5 h-3.5" />
                  <span>演讲者备注 · 第 {currentIdx + 1} 页</span>
                </span>
                <button
                  type="button"
                  onClick={() => setFsNotesOpen(false)}
                  className="text-white/50 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed select-text">
                {currentSlide?.notes?.trim() ? currentSlide.notes : "本页暂无演讲者备注"}
              </p>
            </div>
          )}

          {/* 屏幕下方克制半透明放映控制条 */}
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#131417]/85 backdrop-blur-md border border-white/10 text-xs text-white/90 shadow-2xl">
            <button
              type="button"
              disabled={currentIdx <= 0}
              onClick={() => handleStepSlide(-1)}
              className="w-6 h-6 inline-flex items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30 transition-colors cursor-pointer"
              title="上一页 (←)"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[11px] tabular-nums px-1 text-white/90">
              {currentIdx + 1} / {totalSlides}
            </span>
            {currentSlide?.title && (
              <span className="hidden sm:inline max-w-[200px] truncate text-[11px] text-white/55 pr-1">
                {currentSlide.title}
              </span>
            )}
            <button
              type="button"
              disabled={currentIdx >= totalSlides - 1}
              onClick={() => handleStepSlide(1)}
              className="w-6 h-6 inline-flex items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30 transition-colors cursor-pointer"
              title="下一页 (→ / Space)"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <span className="w-px h-3.5 bg-white/15" />
            <button
              type="button"
              onClick={() => setFsNotesOpen((v) => !v)}
              className={`h-6 inline-flex items-center gap-1 px-2 rounded-full text-[11px] transition-colors cursor-pointer ${
                fsNotesOpen
                  ? "bg-white/15 text-white"
                  : "text-white/75 hover:bg-white/10 hover:text-white"
              }`}
              title="切换演讲备注面板"
            >
              <StickyNote className="w-3 h-3" />
              <span>备注</span>
            </button>
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
