import { renderAsync } from "docx-preview";
import { Loader2, Printer } from "lucide-react";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { readWordDocument } from "../../office";

const WordEditor = lazy(() => import("./WordEditor"));

type WordViewMode = "edit" | "rich" | "text";
const ZOOM_LEVELS = [0.75, 1, 1.25, 1.5] as const;
type ZoomLevel = (typeof ZOOM_LEVELS)[number];

/** 使用隐藏 iframe 打印 docx-preview 渲染内容，避免带入工作台侧栏与工具栏 */
function printRenderedWordHtml(contentEl: HTMLElement | null): void {
  if (typeof window === "undefined") return;
  if (!contentEl || !contentEl.innerHTML.trim()) {
    window.print();
    return;
  }

  try {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      document.body.removeChild(iframe);
      window.print();
      return;
    }

    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>打印 Word 文档</title>
<style>
  @page { margin: 12mm; }
  html, body { margin: 0; padding: 0; background: #ffffff; color: #111214; }
  .docx-wrapper { background: transparent !important; padding: 0 !important; }
  .docx-wrapper > section.docx { box-shadow: none !important; margin: 0 auto 12px !important; }
</style>
</head>
<body>${contentEl.innerHTML}</body>
</html>`);
    doc.close();

    const cleanup = () => {
      window.setTimeout(() => {
        iframe.remove();
      }, 300);
    };

    win.focus();
    win.addEventListener("afterprint", cleanup, { once: true });
    win.print();
    window.setTimeout(cleanup, 3000);
  } catch {
    window.print();
  }
}

export function WordViewer({
  path,
  bytes,
}: {
  path?: string;
  bytes: Uint8Array;
}) {
  const hasPath = Boolean(path);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevPathRef = useRef<string | undefined>(path);

  const [mode, setMode] = useState<WordViewMode>(() => (path ? "edit" : "rich"));
  const [zoom, setZoom] = useState<ZoomLevel>(1);
  const [richSize, setRichSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [plainText, setPlainText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 切换文件或从无路径切换为有路径时自动对齐默认模式
  useEffect(() => {
    const prevPath = prevPathRef.current;
    prevPathRef.current = path;
    if (!path) {
      setMode((curr) => (curr === "edit" ? "rich" : curr));
      return;
    }
    if (path !== prevPath) {
      setMode("edit");
      setZoom(1);
      setError(null);
    }
  }, [path]);

  // 仅在「原版排版」或「纯文本提取」模式下解析渲染（编辑模式交由 WordEditor 接管）
  useEffect(() => {
    if (mode === "edit") {
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        if (mode === "rich" && containerRef.current) {
          containerRef.current.innerHTML = "";
          await renderAsync(copy.buffer, containerRef.current, undefined, {
            inWrapper: true,
            ignoreWidth: true,
            breakPages: true,
          });
          if (!cancelled && containerRef.current) {
            setRichSize({
              width: containerRef.current.scrollWidth,
              height: containerRef.current.scrollHeight,
            });
          }
        } else if (mode === "text") {
          const res = await readWordDocument(bytes);
          if (!cancelled) setPlainText(res.text);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes, mode]);

  // 监听 docx-preview 容器尺寸变化，保证缩放容器宽高与内容严格同步
  useEffect(() => {
    if (mode !== "rich") return;
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setRichSize({
        width: el.scrollWidth,
        height: el.scrollHeight,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]);

  const useScaledWrapper = mode === "rich" && zoom !== 1 && richSize.width > 0;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg-canvas)]">
      {/* 统一子工具栏：模式切换 + 原版排版缩放与打印控制 */}
      <div className="min-h-9 shrink-0 px-3 py-1 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex flex-wrap items-center justify-between gap-2 text-xs select-none">
        <div className="inline-flex items-center p-0.5 rounded-md bg-[var(--bg-sidebar)] border border-[var(--border-hairline)]">
          {hasPath && (
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={`h-6 px-2.5 rounded-[4px] text-[11px] font-medium transition-colors cursor-pointer ${
                mode === "edit"
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              文档编辑
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode("rich")}
            className={`h-6 px-2.5 rounded-[4px] text-[11px] font-medium transition-colors cursor-pointer ${
              mode === "rich"
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            原版排版
          </button>
          <button
            type="button"
            onClick={() => setMode("text")}
            className={`h-6 px-2.5 rounded-[4px] text-[11px] font-medium transition-colors cursor-pointer ${
              mode === "text"
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            纯文本提取
          </button>
        </div>

        {mode === "rich" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex items-center p-0.5 rounded-md bg-[var(--bg-sidebar)] border border-[var(--border-hairline)]">
              {ZOOM_LEVELS.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setZoom(lvl)}
                  className={`h-6 px-2 rounded-[4px] text-[11px] font-mono tabular-nums transition-colors cursor-pointer ${
                    zoom === lvl
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] font-medium"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                  title={`缩放 ${Math.round(lvl * 100)}%`}
                >
                  {Math.round(lvl * 100)}%
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => printRenderedWordHtml(containerRef.current)}
              className="h-7 inline-flex items-center gap-1 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-hover)] text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              title="打印原版排版文档"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>打印</span>
            </button>
          </div>
        ) : (
          <span className="text-[11px] text-[var(--text-muted)]">
            {mode === "edit" ? "Tiptap 原生编辑" : "纯文本视图"}
          </span>
        )}
      </div>

      {mode === "edit" && path ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <Suspense
            fallback={
              <div className="h-full flex items-center justify-center gap-2 bg-[var(--surface-paper)] text-xs text-[var(--text-muted)]">
                <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                <span>正在加载 Word 富文本编辑器…</span>
              </div>
            }
          >
            <WordEditor path={path} bytes={bytes} />
          </Suspense>
        </div>
      ) : error ? (
        <div className="p-4 m-4 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-xs text-[var(--status-danger)]">
          Word 解析失败：{error}
        </div>
      ) : mode === "rich" ? (
        <div className="flex-1 overflow-auto bg-[var(--surface-paper)] min-h-0">
          <div
            style={
              useScaledWrapper
                ? {
                    width: `${Math.ceil(richSize.width * zoom)}px`,
                    height: `${Math.ceil(richSize.height * zoom)}px`,
                    margin: "0 auto",
                    position: "relative",
                  }
                : undefined
            }
          >
            <div
              ref={containerRef}
              style={
                useScaledWrapper
                  ? {
                      width: `${richSize.width}px`,
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                    }
                  : undefined
              }
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto bg-[var(--surface-paper)] p-5 min-h-0">
          <pre className="max-w-3xl mx-auto rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--text-primary)] font-sans shadow-[0_1px_3px_rgba(0,0,0,0.14)]">
            {plainText || "(空文档)"}
          </pre>
        </div>
      )}
    </div>
  );
}
