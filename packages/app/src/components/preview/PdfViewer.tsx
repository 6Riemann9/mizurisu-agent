import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Maximize,
  PanelLeft,
  Printer,
  RotateCw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensurePdfWorkerConfigured } from "../../office";
import { useAppStore } from "../../store/useAppStore";

type TextContent = Awaited<ReturnType<pdfjsLib.PDFPageProxy["getTextContent"]>>;

interface PageSize {
  width: number;
  height: number;
}

interface TextItemRange {
  itemIndex: number;
  start: number;
  end: number;
}

interface PageSearchIndex {
  pageNumber: number;
  fullText: string;
  ranges: TextItemRange[];
}

interface SearchMatch {
  pageNumber: number;
  start: number;
  end: number;
  itemIndices: number[];
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;
const THUMB_WIDTH = 100;

function isCancellationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name || "";
  const message = (err as { message?: string }).message || "";
  return (
    name === "RenderingCancelledException" ||
    name === "AbortException" ||
    message.includes("Rendering cancelled") ||
    message.includes("TextLayer task cancelled")
  );
}

/** 根据文本项构建页面搜索索引，同时兼容中文无空格拼接与英文单词间自动留白 */
function buildPageSearchIndex(pageNumber: number, textContent: TextContent): PageSearchIndex {
  const ranges: TextItemRange[] = [];
  let fullText = "";
  let itemIndex = 0;

  for (const rawItem of textContent.items) {
    if (!("str" in rawItem)) continue;
    const str = rawItem.str ?? "";
    const hasEOL = Boolean((rawItem as { hasEOL?: boolean }).hasEOL);

    if (str.length > 0 && fullText.length > 0) {
      const prevChar = fullText[fullText.length - 1];
      const nextChar = str[0];
      const prevIsAsciiWord = /[A-Za-z0-9.,;:!?)]/.test(prevChar);
      const nextIsAsciiWord = /[A-Za-z0-9(]/.test(nextChar);
      if (prevIsAsciiWord && nextIsAsciiWord) {
        fullText += " ";
      }
    }

    const start = fullText.length;
    fullText += str;
    const end = fullText.length;

    ranges.push({ itemIndex, start, end });
    itemIndex += 1;

    if (hasEOL && !fullText.endsWith("\n") && !fullText.endsWith(" ")) {
      fullText += "\n";
    }
  }

  return { pageNumber, fullText, ranges };
}

/** 构造用于复制全文的整洁段落文本 */
function formatCopyText(pages: PageSearchIndex[]): string {
  return pages
    .map((p) => {
      const cleaned = p.fullText
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return pages.length > 1 ? `--- 第 ${p.pageNumber} 页 ---\n${cleaned}` : cleaned;
    })
    .filter((block) => block.length > 0)
    .join("\n\n");
}

function clampScale(val: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number(val.toFixed(2))));
}

/** 计算旋转后的未缩放基准宽高 */
function getRotatedBaseSize(size: PageSize, rotation: number): PageSize {
  return rotation % 180 === 0
    ? size
    : { width: size.height, height: size.width };
}

export function PdfViewer({ bytes }: { bytes: Uint8Array }) {
  const pushToast = useAppStore((s) => s.pushToast);

  const rootRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const pageWrapperRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const thumbCanvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const thumbBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const textContentCacheRef = useRef<Map<number, TextContent>>(new Map());
  const renderedTextLayersRef = useRef<Map<number, pdfjsLib.TextLayer>>(new Map());
  const applyHighlightsRef = useRef<(pageNumber: number) => void>(() => undefined);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const pointerInsideRef = useRef(false);
  const programmaticScrollUntilRef = useRef(0);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [baseSizes, setBaseSizes] = useState<PageSize[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");

  const [thumbsOpen, setThumbsOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true
  );
  const [zoomMode, setZoomMode] = useState<"auto" | "width" | "manual">("auto");
  const [manualScale, setManualScale] = useState(1.25);
  const [rotation, setRotation] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [pageSearchData, setPageSearchData] = useState<PageSearchIndex[]>([]);

  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 监听主阅读区宽度变化（带轻度防抖），用于「适配页宽」与初始自动适配
  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sync = (immediate = false) => {
      const nextW = el.clientWidth;
      if (immediate) {
        setContainerWidth(nextW);
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setContainerWidth(el.clientWidth);
      }, 120);
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
  }, [thumbsOpen, error]);

  // 当前有效缩放比
  const effectiveScale = useMemo(() => {
    const firstSize = baseSizes[0];
    if (!firstSize) return manualScale;
    const rotatedFirst = getRotatedBaseSize(firstSize, rotation);
    const availW = Math.max(240, containerWidth - 40);
    const widthFit = clampScale(availW / rotatedFirst.width);
    if (zoomMode === "width") {
      return containerWidth > 0 ? widthFit : 1.0;
    }
    if (zoomMode === "auto") {
      return containerWidth > 0 ? Math.min(1.25, widthFit) : 1.0;
    }
    return manualScale;
  }, [baseSizes, rotation, containerWidth, zoomMode, manualScale]);

  // 1. 加载 PDF 文档、记录基准页面尺寸并提取全文索引
  useEffect(() => {
    let cancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;

    setLoading(true);
    setError(null);
    setPdfDoc(null);
    setPageCount(0);
    setBaseSizes([]);
    setCurrentPage(1);
    setPageInput("1");
    setRotation(0);
    setZoomMode("auto");
    setPageSearchData([]);
    setActiveMatchIdx(0);
    textContentCacheRef.current.clear();
    renderedTextLayersRef.current.clear();
    pdfDocRef.current = null;
    mainScrollRef.current?.scrollTo({ top: 0 });

    (async () => {
      try {
        ensurePdfWorkerConfigured();
        loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(bytes),
          useWorkerFetch: false,
          verbosity: 0,
        });
        const pdf = await loadingTask.promise;
        if (cancelled) {
          loadingTask.destroy().catch(() => undefined);
          return;
        }

        pdfDocRef.current = pdf;
        setPdfDoc(pdf);
        setPageCount(pdf.numPages);

        // 先读取第 1 页用于预估其余未读取页面的占位尺寸
        const firstPage = await pdf.getPage(1);
        if (cancelled) return;
        const firstVp = firstPage.getViewport({ scale: 1, rotation: 0 });
        const initialSizes: PageSize[] = Array.from({ length: pdf.numPages }, () => ({
          width: firstVp.width,
          height: firstVp.height,
        }));
        setBaseSizes(initialSizes);
        setLoading(false);

        // 逐页补齐精确尺寸并提取文本内容用于全文搜索与复制全文
        const exactSizes = [...initialSizes];
        const extractedSearchPages: PageSearchIndex[] = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          if (cancelled) return;
          const page = p === 1 ? firstPage : await pdf.getPage(p);
          if (cancelled) return;
          const vp = page.getViewport({ scale: 1, rotation: 0 });
          exactSizes[p - 1] = { width: vp.width, height: vp.height };

          const textContent = await page.getTextContent();
          if (cancelled) return;
          textContentCacheRef.current.set(p, textContent);
          extractedSearchPages.push(buildPageSearchIndex(p, textContent));
        }

        if (!cancelled) {
          setBaseSizes(exactSizes);
          setPageSearchData(extractedSearchPages);
        }
      } catch (err) {
        if (!cancelled && !isCancellationError(err)) {
          setLoading(false);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      pdfDocRef.current = null;
      loadingTask?.destroy().catch(() => undefined);
    };
  }, [bytes]);

  // 计算全文搜索命中列表
  const searchMatches = useMemo<SearchMatch[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || pageSearchData.length === 0) return [];

    const matches: SearchMatch[] = [];
    for (const pageData of pageSearchData) {
      const lower = pageData.fullText.toLowerCase();
      let fromIndex = 0;
      while (fromIndex < lower.length) {
        const hitIdx = lower.indexOf(q, fromIndex);
        if (hitIdx < 0) break;
        const hitEnd = hitIdx + q.length;
        const itemIndices: number[] = [];
        for (const r of pageData.ranges) {
          if (r.end > hitIdx && r.start < hitEnd) {
            itemIndices.push(r.itemIndex);
          }
        }
        matches.push({
          pageNumber: pageData.pageNumber,
          start: hitIdx,
          end: hitEnd,
          itemIndices,
        });
        fromIndex = hitIdx + Math.max(1, q.length);
      }
    }
    return matches;
  }, [pageSearchData, searchQuery]);

  // 保证 activeMatchIdx 在有效范围
  useEffect(() => {
    setActiveMatchIdx((prev) => {
      if (searchMatches.length === 0) return 0;
      return Math.min(prev, searchMatches.length - 1);
    });
  }, [searchMatches.length]);

  /** 将当前搜索高亮应用到指定页（或全部已渲染页）的 textLayer.textDivs */
  const applySearchHighlightsToPage = useCallback(
    (pageNumber: number) => {
      const textLayer = renderedTextLayersRef.current.get(pageNumber);
      if (!textLayer) return;

      const divs = textLayer.textDivs;
      for (const div of divs) {
        div.classList.remove("pdf-search-hit", "pdf-search-hit-active", "is-active");
      }

      if (!searchQuery.trim() || searchMatches.length === 0) return;

      const pageMatches = searchMatches.filter((m) => m.pageNumber === pageNumber);
      if (pageMatches.length === 0) return;

      const activeMatch = searchMatches[activeMatchIdx];
      const activeIndices = new Set<number>(
        activeMatch && activeMatch.pageNumber === pageNumber ? activeMatch.itemIndices : []
      );
      const hitIndices = new Set<number>();
      for (const m of pageMatches) {
        for (const idx of m.itemIndices) {
          hitIndices.add(idx);
        }
      }

      for (const idx of hitIndices) {
        const span = divs[idx];
        if (!span) continue;
        const isActive = activeIndices.has(idx);
        span.classList.add("pdf-search-hit");
        if (isActive) {
          span.classList.add("pdf-search-hit-active", "is-active");
        }
      }
    },
    [searchMatches, activeMatchIdx, searchQuery]
  );

  // 通过 ref 保持最新高亮函数，避免搜索词或命中游标变化时触发整个 Canvas/TextLayer 重绘
  applyHighlightsRef.current = applySearchHighlightsToPage;

  // 搜索词或当前命中序号变更时刷新所有已渲染页的高亮
  useEffect(() => {
    for (const pageNum of renderedTextLayersRef.current.keys()) {
      applySearchHighlightsToPage(pageNum);
    }
  }, [applySearchHighlightsToPage]);

  // 2. 渲染主视图每页 Canvas 与可选中复制 TextLayer
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;
    let cancelled = false;
    const activeRenderTasks: pdfjsLib.RenderTask[] = [];
    const activeTextLayers: pdfjsLib.TextLayer[] = [];
    renderedTextLayersRef.current.clear();

    // 优先渲染第 1 页或当前页附近，保证大文档首屏响应速度
    const pageOrder: number[] = Array.from({ length: pageCount }, (_, i) => i + 1);

    (async () => {
      for (const pageNum of pageOrder) {
        if (cancelled) return;
        const wrapper = pageWrapperRefs.current.get(pageNum);
        const canvas = canvasRefs.current.get(pageNum);
        const textDiv = textLayerRefs.current.get(pageNum);
        if (!wrapper || !canvas || !textDiv) continue;

        try {
          const page = await pdfDoc.getPage(pageNum);
          if (cancelled) return;

          const viewport = page.getViewport({ scale: effectiveScale, rotation });
          const cssWidth = Math.floor(viewport.width);
          const cssHeight = Math.floor(viewport.height);

          wrapper.style.width = `${cssWidth}px`;
          wrapper.style.height = `${cssHeight}px`;
          wrapper.style.setProperty("--total-scale-factor", String(effectiveScale));
          wrapper.style.setProperty("--scale-round-x", "1px");
          wrapper.style.setProperty("--scale-round-y", "1px");

          const dpr = Math.min(
            typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
            2
          );
          canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
          canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
          canvas.style.width = `${cssWidth}px`;
          canvas.style.height = `${cssHeight}px`;

          const renderTask = page.render({
            canvas,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          });
          activeRenderTasks.push(renderTask);
          await renderTask.promise;
          if (cancelled) return;

          textDiv.innerHTML = "";
          const textContent =
            textContentCacheRef.current.get(pageNum) ?? (await page.getTextContent());
          if (cancelled) return;
          textContentCacheRef.current.set(pageNum, textContent);

          const textLayer = new pdfjsLib.TextLayer({
            textContentSource: textContent,
            container: textDiv,
            viewport,
          });
          activeTextLayers.push(textLayer);
          await textLayer.render();
          if (cancelled) return;

          renderedTextLayersRef.current.set(pageNum, textLayer);
          applyHighlightsRef.current(pageNum);
        } catch (err) {
          if (cancelled || isCancellationError(err)) return;
          setError(err instanceof Error ? err.message : String(err));
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const task of activeRenderTasks) {
        try {
          task.cancel();
        } catch {
          // 忽略已结束任务取消异常
        }
      }
      for (const tl of activeTextLayers) {
        try {
          tl.cancel();
        } catch {
          // 忽略已结束文本层取消异常
        }
      }
    };
  }, [pdfDoc, pageCount, effectiveScale, rotation]);

  // 3. 左侧缩略图栏展开时按当前旋转角度渲染低分辨率缩略图
  useEffect(() => {
    if (!pdfDoc || pageCount === 0 || !thumbsOpen) return;
    let cancelled = false;
    const activeTasks: pdfjsLib.RenderTask[] = [];

    (async () => {
      for (let p = 1; p <= pageCount; p++) {
        if (cancelled) return;
        const canvas = thumbCanvasRefs.current.get(p);
        if (!canvas) continue;
        try {
          const page = await pdfDoc.getPage(p);
          if (cancelled) return;
          const baseVp = page.getViewport({ scale: 1, rotation });
          const thumbScale = THUMB_WIDTH / Math.max(1, baseVp.width);
          const thumbVp = page.getViewport({ scale: thumbScale, rotation });
          const dpr = Math.min(
            typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
            1.5
          );
          canvas.width = Math.max(1, Math.floor(thumbVp.width * dpr));
          canvas.height = Math.max(1, Math.floor(thumbVp.height * dpr));
          canvas.style.width = `${Math.floor(thumbVp.width)}px`;
          canvas.style.height = `${Math.floor(thumbVp.height)}px`;

          const task = page.render({
            canvas,
            viewport: thumbVp,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          });
          activeTasks.push(task);
          await task.promise;
        } catch (err) {
          if (cancelled || isCancellationError(err)) return;
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const task of activeTasks) {
        try {
          task.cancel();
        } catch {
          // 忽略缩略图取消异常
        }
      }
    };
  }, [pdfDoc, pageCount, rotation, thumbsOpen]);

  // 4. 滚动时通过 IntersectionObserver 自动同步当前可见页码
  useEffect(() => {
    const rootEl = mainScrollRef.current;
    if (!rootEl || pageCount === 0 || typeof IntersectionObserver === "undefined") return;

    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < programmaticScrollUntilRef.current) return;
        for (const entry of entries) {
          const pageAttr = Number(
            (entry.target as HTMLElement).getAttribute("data-page-number")
          );
          if (Number.isFinite(pageAttr) && pageAttr >= 1) {
            ratios.set(pageAttr, entry.isIntersecting ? entry.intersectionRatio : 0);
          }
        }
        let bestPage = 0;
        let bestRatio = 0;
        for (const [p, ratio] of ratios.entries()) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestPage = p;
          }
        }
        if (bestPage >= 1) {
          setCurrentPage(bestPage);
          if (document.activeElement !== pageInputRef.current) {
            setPageInput(String(bestPage));
          }
        }
      },
      {
        root: rootEl,
        threshold: [0.05, 0.25, 0.5, 0.75],
      }
    );

    for (let p = 1; p <= pageCount; p++) {
      const wrapper = pageWrapperRefs.current.get(p);
      if (wrapper) observer.observe(wrapper);
    }

    return () => observer.disconnect();
  }, [pageCount, effectiveScale, rotation, thumbsOpen, error]);

  // 当前页变化时把缩略图导航滚动至可视区
  useEffect(() => {
    if (!thumbsOpen) return;
    const btn = thumbBtnRefs.current.get(currentPage);
    if (btn && typeof btn.scrollIntoView === "function") {
      btn.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [currentPage, thumbsOpen]);

  /** 平滑跳转至指定页 */
  const scrollToPage = useCallback(
    (targetPage: number) => {
      if (pageCount <= 0) return;
      const clamped = Math.max(1, Math.min(pageCount, Math.floor(targetPage)));
      setCurrentPage(clamped);
      setPageInput(String(clamped));
      programmaticScrollUntilRef.current = Date.now() + 450;
      const el = pageWrapperRefs.current.get(clamped);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [pageCount]
  );

  /** 跳转到指定搜索命中项并滚动居中展示 */
  const focusSearchMatch = useCallback(
    (matchIdx: number) => {
      if (searchMatches.length === 0) return;
      const normalized =
        ((matchIdx % searchMatches.length) + searchMatches.length) %
        searchMatches.length;
      setActiveMatchIdx(normalized);
      const match = searchMatches[normalized];
      if (!match) return;

      const textLayer = renderedTextLayersRef.current.get(match.pageNumber);
      const targetSpan =
        textLayer && match.itemIndices.length > 0
          ? textLayer.textDivs[match.itemIndices[0]]
          : undefined;

      setCurrentPage(match.pageNumber);
      setPageInput(String(match.pageNumber));
      programmaticScrollUntilRef.current = Date.now() + 500;

      if (targetSpan && typeof targetSpan.scrollIntoView === "function") {
        targetSpan.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        const pageEl = pageWrapperRefs.current.get(match.pageNumber);
        pageEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    [searchMatches]
  );

  // 搜索词变更且命中不为空时，自动定位到首个命中结果
  const prevSearchQueryRef = useRef("");
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed && trimmed !== prevSearchQueryRef.current && searchMatches.length > 0) {
      focusSearchMatch(0);
    }
    prevSearchQueryRef.current = trimmed;
  }, [searchQuery, searchMatches, focusSearchMatch]);

  // 监听 Ctrl+F / Cmd+F 快捷键呼出全文搜索栏
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "f") return;
      const active = document.activeElement;
      const focusedInside = Boolean(
        rootRef.current && active && rootRef.current.contains(active)
      );
      const otherInputFocused =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);

      if (focusedInside || (pointerInsideRef.current && !otherInputFocused)) {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleCommitPageInput = () => {
    const num = Number(pageInput.trim());
    if (Number.isFinite(num) && num >= 1) {
      scrollToPage(num);
    } else {
      setPageInput(String(currentPage));
    }
  };

  const handleCopyFullText = async () => {
    if (pageSearchData.length === 0) {
      pushToast("文档文本仍在解析中或无可提取文字", "warning");
      return;
    }
    const text = formatCopyText(pageSearchData);
    if (!text) {
      pushToast("该 PDF 可能是纯图片扫描件，未检测到可选中文字", "warning");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      pushToast(`已复制 PDF 全文（共 ${pageCount} 页）`, "success");
    } catch (err) {
      pushToast(
        `复制全文失败：${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    }
  };

  const handlePrintPdf = async () => {
    if (!pdfDoc || pageCount === 0 || printing) return;
    setPrinting(true);
    try {
      const pageImages: string[] = [];
      for (let p = 1; p <= pageCount; p++) {
        const existingCanvas = canvasRefs.current.get(p);
        if (existingCanvas && existingCanvas.width > 0 && existingCanvas.height > 0) {
          pageImages.push(existingCanvas.toDataURL("image/png"));
          continue;
        }
        // 若仍有页面尚未轮到渲染，打印前临时高清离屏补渲
        const page = await pdfDoc.getPage(p);
        const printVp = page.getViewport({ scale: 1.5, rotation });
        const offCanvas = document.createElement("canvas");
        offCanvas.width = Math.floor(printVp.width);
        offCanvas.height = Math.floor(printVp.height);
        await page.render({ canvas: offCanvas, viewport: printVp }).promise;
        pageImages.push(offCanvas.toDataURL("image/png"));
      }

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.setAttribute("aria-hidden", "true");
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc || !iframe.contentWindow) {
        iframe.remove();
        window.print();
        return;
      }

      doc.open();
      doc.write(
        `<!DOCTYPE html><html><head><title>打印 PDF</title><style>
          @page { margin: 0; }
          html, body { margin: 0; padding: 0; background: #fff; }
          .print-page { width: 100%; display: block; page-break-after: always; break-after: page; }
          .print-page:last-child { page-break-after: auto; break-after: auto; }
        </style></head><body></body></html>`
      );
      doc.close();

      await Promise.all(
        pageImages.map(
          (src) =>
            new Promise<void>((resolve) => {
              const img = doc.createElement("img");
              img.className = "print-page";
              img.onload = () => resolve();
              img.onerror = () => resolve();
              img.src = src;
              doc.body.appendChild(img);
            })
        )
      );

      const cleanupIframe = () => {
        setTimeout(() => {
          iframe.remove();
        }, 500);
      };
      iframe.contentWindow.addEventListener("afterprint", cleanupIframe, { once: true });
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(cleanupIframe, 8000);
    } catch (err) {
      pushToast(
        `触发打印失败：${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    } finally {
      setPrinting(false);
    }
  };

  const pageNumbers = useMemo(
    () => Array.from({ length: pageCount }, (_, i) => i + 1),
    [pageCount]
  );

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onMouseEnter={() => {
        pointerInsideRef.current = true;
      }}
      onMouseLeave={() => {
        pointerInsideRef.current = false;
      }}
      className="flex flex-col h-full min-w-0 min-h-0 bg-[var(--bg-canvas)] outline-none"
    >
      {/* 顶部自适应工具栏（flex-wrap 防止窄分栏下重叠） */}
      <div className="min-h-9 shrink-0 py-1 px-2.5 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 text-xs select-none">
        {/* 左侧：缩略图开关 + 翻页与直达页码 */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <button
            type="button"
            aria-pressed={thumbsOpen}
            onClick={() => setThumbsOpen((v) => !v)}
            className={`w-6 h-6 inline-flex items-center justify-center rounded-[4px] border transition-colors cursor-pointer shrink-0 ${
              thumbsOpen
                ? "bg-[var(--bg-active)] border-[var(--border-strong)] text-[var(--text-primary)]"
                : "border-transparent hover:border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            title={thumbsOpen ? "收起页面缩略图" : "展开页面缩略图"}
            aria-label="切换页面缩略图"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>

          <div className="inline-flex items-center gap-0.5 rounded-md bg-[var(--bg-sidebar)] border border-[var(--border-hairline)] px-1 py-0.5 shrink-0">
            <button
              type="button"
              disabled={currentPage <= 1 || pageCount === 0}
              onClick={() => scrollToPage(currentPage - 1)}
              className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
              title="上一页"
              aria-label="上一页"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <input
              ref={pageInputRef}
              type="text"
              inputMode="numeric"
              value={pageInput}
              disabled={pageCount === 0}
              onChange={(e) => setPageInput(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={handleCommitPageInput}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCommitPageInput();
                  e.currentTarget.blur();
                }
              }}
              aria-label="跳转页码"
              className="w-8 h-5 text-center font-mono tabular-nums text-[11px] bg-[var(--bg-surface)] border border-[var(--border-hairline)] focus:border-[var(--accent)] rounded text-[var(--text-primary)] outline-none"
            />
            <span className="text-[11px] text-[var(--text-muted)] tabular-nums pr-1 whitespace-nowrap">
              / 共 {pageCount} 页
            </span>

            <button
              type="button"
              disabled={currentPage >= pageCount || pageCount === 0}
              onClick={() => scrollToPage(currentPage + 1)}
              className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
              title="下一页"
              aria-label="下一页"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 右侧：缩放 + 适配页宽 + 旋转 + 搜索 + 复制全文 + 打印 */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <div className="inline-flex items-center p-0.5 rounded-md bg-[var(--bg-sidebar)] border border-[var(--border-hairline)] shrink-0">
            <button
              type="button"
              onClick={() => {
                setZoomMode("manual");
                setManualScale(clampScale(effectiveScale - 0.15));
              }}
              className="w-6 h-6 inline-flex items-center justify-center rounded-[4px] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              title="缩小"
              aria-label="缩小"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoomMode("manual");
                setManualScale(Math.abs(effectiveScale - 1) < 0.03 ? 1.25 : 1);
              }}
              className="px-1.5 h-6 font-mono tabular-nums text-[11px] min-w-[44px] text-center text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-[4px] transition-colors cursor-pointer"
              title="点击在 100% / 125% 之间重置缩放"
            >
              {Math.round(effectiveScale * 100)}%
            </button>
            <button
              type="button"
              onClick={() => {
                setZoomMode("manual");
                setManualScale(clampScale(effectiveScale + 0.15));
              }}
              className="w-6 h-6 inline-flex items-center justify-center rounded-[4px] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              title="放大"
              aria-label="放大"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            aria-pressed={zoomMode === "width"}
            onClick={() =>
              setZoomMode((m) => {
                if (m === "width") {
                  setManualScale(clampScale(effectiveScale));
                  return "manual";
                }
                return "width";
              })
            }
            className={`h-6 inline-flex items-center gap-1 px-1.5 rounded-[4px] border text-[11px] font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
              zoomMode === "width"
                ? "bg-[var(--accent-soft)] border-[var(--accent)]/60 text-[var(--text-primary)]"
                : "border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            title="按主阅读区宽度自动适配页面"
          >
            <Maximize className="w-3 h-3 shrink-0" />
            <span>适配页宽</span>
          </button>

          <button
            type="button"
            disabled={pageCount === 0}
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="w-6 h-6 inline-flex items-center justify-center rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 transition-colors cursor-pointer shrink-0"
            title="顺时针旋转 90°"
            aria-label="顺时针旋转 90°"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            aria-pressed={searchOpen}
            disabled={pageCount === 0}
            onClick={() => {
              setSearchOpen((prev) => {
                const next = !prev;
                if (next) {
                  requestAnimationFrame(() => searchInputRef.current?.focus());
                }
                return next;
              });
            }}
            className={`h-6 inline-flex items-center gap-1 px-1.5 rounded-[4px] border text-[11px] font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap disabled:opacity-35 ${
              searchOpen
                ? "bg-[var(--accent-soft)] border-[var(--accent)]/60 text-[var(--text-primary)]"
                : "border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            title="全文搜索 (Ctrl+F)"
          >
            <Search className="w-3 h-3 shrink-0" />
            <span className="hidden sm:inline">搜索</span>
          </button>

          <button
            type="button"
            disabled={pageCount === 0}
            onClick={() => void handleCopyFullText()}
            className="h-6 inline-flex items-center gap-1 px-1.5 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
            title="复制 PDF 全部页文字"
          >
            <Copy className="w-3 h-3 shrink-0" />
            <span className="hidden sm:inline">复制全文</span>
          </button>

          <button
            type="button"
            disabled={pageCount === 0 || printing}
            onClick={() => void handlePrintPdf()}
            className="w-6 h-6 inline-flex items-center justify-center rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 transition-colors cursor-pointer shrink-0"
            title="打印 PDF"
            aria-label="打印 PDF"
          >
            <Printer className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 全文搜索栏（Ctrl+F 呼出） */}
      {searchOpen && (
        <div className="shrink-0 px-3 py-1.5 border-b border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 flex-1 min-w-[180px] max-w-md h-7 px-2 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] focus-within:border-[var(--accent)]">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (searchMatches.length > 0) {
                    focusSearchMatch(e.shiftKey ? activeMatchIdx - 1 : activeMatchIdx + 1);
                  }
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setSearchOpen(false);
                }
              }}
              placeholder="输入关键词搜索 PDF 全文..."
              aria-label="搜索 PDF 全文"
              className="flex-1 min-w-0 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="w-4 h-4 rounded hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                title="清空搜索词"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] font-mono tabular-nums text-[var(--text-secondary)] px-1">
              {searchQuery.trim()
                ? searchMatches.length > 0
                  ? `第 ${activeMatchIdx + 1} / ${searchMatches.length} 个匹配`
                  : "0 个匹配"
                : "输入关键词定位"}
            </span>
            <button
              type="button"
              disabled={searchMatches.length === 0}
              onClick={() => focusSearchMatch(activeMatchIdx - 1)}
              className="h-6 inline-flex items-center gap-0.5 px-1.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 cursor-pointer"
              title="上一个匹配 (Shift+Enter)"
            >
              <ChevronUp className="w-3 h-3" />
              <span>上一个</span>
            </button>
            <button
              type="button"
              disabled={searchMatches.length === 0}
              onClick={() => focusSearchMatch(activeMatchIdx + 1)}
              className="h-6 inline-flex items-center gap-0.5 px-1.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 cursor-pointer"
              title="下一个匹配 (Enter)"
            >
              <span>下一个</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              className="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              title="关闭搜索 (Esc)"
              aria-label="关闭搜索"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {error ? (
        <div className="p-4 m-4 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-xs text-[var(--status-danger)]">
          PDF 渲染失败：{error}
        </div>
      ) : (
        <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
          {/* 左侧可折叠缩略图导航栏 */}
          {thumbsOpen && pageCount > 0 && (
            <aside
              aria-label="PDF 页面缩略图导航"
              className="w-[126px] shrink-0 border-r border-[var(--border-hairline)] bg-[var(--bg-sidebar)] overflow-y-auto p-2.5 space-y-2.5 select-none"
            >
              {pageNumbers.map((pageNum) => {
                const active = pageNum === currentPage;
                const hasMatch = searchMatches.some((m) => m.pageNumber === pageNum);
                return (
                  <button
                    key={pageNum}
                    ref={(el) => {
                      if (el) thumbBtnRefs.current.set(pageNum, el);
                      else thumbBtnRefs.current.delete(pageNum);
                    }}
                    type="button"
                    onClick={() => scrollToPage(pageNum)}
                    className={`w-full flex flex-col items-center gap-1 p-1 rounded-md transition-colors cursor-pointer ${
                      active
                        ? "bg-[var(--bg-active)] ring-1.5 ring-[var(--accent)]"
                        : "hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <div className="relative rounded-[3px] overflow-hidden bg-white shadow-sm ring-1 ring-[var(--border-hairline)]">
                      <canvas
                        ref={(el) => {
                          if (el) thumbCanvasRefs.current.set(pageNum, el);
                          else thumbCanvasRefs.current.delete(pageNum);
                        }}
                        className="block bg-white"
                      />
                      {hasMatch && (
                        <span
                          className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-black/20"
                          title="该页包含搜索匹配"
                        />
                      )}
                    </div>
                    <span
                      className={`text-[10px] font-mono tabular-nums ${
                        active
                          ? "text-[var(--text-primary)] font-semibold"
                          : "text-[var(--text-muted)]"
                      }`}
                    >
                      {pageNum}
                    </span>
                  </button>
                );
              })}
            </aside>
          )}

          {/* 主阅读滚动区：每页外层 relative wrapper 固定 viewport 尺寸并叠加 TextLayer */}
          <div
            ref={mainScrollRef}
            className="flex-1 min-w-0 min-h-0 overflow-auto p-5 bg-[var(--surface-paper)] flex flex-col items-center gap-4"
          >
            {loading && pageCount === 0 && (
              <div className="py-12 text-xs text-[var(--text-muted)]">
                正在解析 PDF 文档…
              </div>
            )}

            {pageNumbers.map((pageNum) => {
              const rawSize = baseSizes[pageNum - 1] ?? { width: 595, height: 842 };
              const rotatedBase = getRotatedBaseSize(rawSize, rotation);
              const approxW = Math.floor(rotatedBase.width * effectiveScale);
              const approxH = Math.floor(rotatedBase.height * effectiveScale);
              return (
                <div
                  key={pageNum}
                  data-page-number={pageNum}
                  ref={(el) => {
                    if (el) pageWrapperRefs.current.set(pageNum, el);
                    else pageWrapperRefs.current.delete(pageNum);
                  }}
                  className="relative rounded-[4px] bg-white shrink-0 overflow-hidden"
                  style={{
                    width: approxW,
                    height: approxH,
                    boxShadow:
                      "0 1px 3px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--border-hairline)",
                    ["--total-scale-factor" as string]: String(effectiveScale),
                    ["--scale-round-x" as string]: "1px",
                    ["--scale-round-y" as string]: "1px",
                  }}
                >
                  <canvas
                    ref={(el) => {
                      if (el) canvasRefs.current.set(pageNum, el);
                      else canvasRefs.current.delete(pageNum);
                    }}
                    className="block bg-white select-none pointer-events-none"
                  />
                  <div
                    ref={(el) => {
                      if (el) textLayerRefs.current.set(pageNum, el);
                      else textLayerRefs.current.delete(pageNum);
                    }}
                    className="textLayer pdf-text-layer"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
