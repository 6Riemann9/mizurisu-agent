import { ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { useEffect, useRef, useState } from "react";
import { ensurePdfWorkerConfigured } from "../../office";

export function PdfViewer({ bytes }: { bytes: Uint8Array }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    (async () => {
      try {
        setError(null);
        ensurePdfWorkerConfigured();
        loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(bytes),
          verbosity: 0,
        });
        const pdf = await loadingTask.promise;
        if (cancelled || !containerRef.current) return;
        setPageCount(pdf.numPages);
        const host = containerRef.current;
        host.innerHTML = "";

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = "rounded-[4px] bg-white max-w-full h-auto";
          canvas.style.boxShadow =
            "0 1px 3px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--border-hairline)";
          host.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      loadingTask?.destroy().catch(() => undefined);
    };
  }, [bytes, scale]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg-canvas)]">
      {/* 统一 h-9 子工具栏 */}
      <div className="h-9 shrink-0 px-3 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between gap-2 text-xs select-none">
        <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
          PDF · 共 {pageCount} 页
        </span>
        <div className="inline-flex items-center p-0.5 rounded-md bg-[var(--bg-sidebar)] border border-[var(--border-hairline)]">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.6, Number((s - 0.2).toFixed(2))))}
            className="w-6 h-6 inline-flex items-center justify-center rounded-[4px] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="缩小"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setScale(1.25)}
            className="px-1.5 h-6 font-mono tabular-nums text-[11px] min-w-[46px] text-center text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-[4px] transition-colors"
            title="点击重置缩放"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(2.5, Number((s + 0.2).toFixed(2))))}
            className="w-6 h-6 inline-flex items-center justify-center rounded-[4px] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="放大"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {error ? (
        <div className="p-4 m-4 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-xs text-[var(--status-danger)]">
          PDF 渲染失败：{error}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex-1 overflow-auto p-5 bg-[var(--surface-paper)] flex flex-col items-center gap-4 min-h-0"
        />
      )}
    </div>
  );
}
