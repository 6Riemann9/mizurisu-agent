import { ChevronLeft, ChevronRight, StickyNote } from "lucide-react";
import { init as initPptxPreview } from "pptx-preview";
import { useEffect, useRef, useState } from "react";
import { readPptDocument, type PptReadResult } from "../../office";

export function PptViewer({ bytes }: { bytes: Uint8Array }) {
  const [mode, setMode] = useState<"cards" | "visual">("cards");
  const [parsed, setParsed] = useState<PptReadResult | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [visualError, setVisualError] = useState<string | null>(null);
  const visualRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    readPptDocument(bytes)
      .then((res) => {
        if (!cancelled) {
          setParsed(res);
          setCurrentIdx(0);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  useEffect(() => {
    if (mode !== "visual" || !visualRef.current) return;
    let destroyed = false;
    let previewer: ReturnType<typeof initPptxPreview> | null = null;
    const container = visualRef.current;
    container.innerHTML = "";
    setVisualError(null);

    try {
      const width = Math.max(320, container.clientWidth - 32);
      const height = Math.round((width * 9) / 16);
      previewer = initPptxPreview(container, { width, height, mode: "list" });
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      previewer.preview(copy.buffer).catch((err: unknown) => {
        if (!destroyed) {
          setVisualError(err instanceof Error ? err.message : String(err));
        }
      });
    } catch (err) {
      setVisualError(err instanceof Error ? err.message : String(err));
    }

    return () => {
      destroyed = true;
      try {
        previewer?.destroy();
      } catch {
        // 忽略销毁时内部节点已移除异常
      }
    };
  }, [bytes, mode]);

  const currentSlide = parsed?.slides[currentIdx];

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg-canvas)]">
      {/* 统一 h-9 子工具栏 */}
      <div className="h-9 shrink-0 px-3 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between gap-2 text-xs select-none">
        <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
          幻灯片 {parsed ? `· ${parsed.slideCount} 页` : ""}
        </span>
        <div className="inline-flex items-center p-0.5 rounded-md bg-[var(--bg-sidebar)] border border-[var(--border-hairline)]">
          <button
            type="button"
            onClick={() => setMode("cards")}
            className={`h-6 px-2.5 rounded-[4px] text-[11px] font-medium transition-colors ${
              mode === "cards"
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            大纲播放
          </button>
          <button
            type="button"
            onClick={() => setMode("visual")}
            className={`h-6 px-2.5 rounded-[4px] text-[11px] font-medium transition-colors ${
              mode === "visual"
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            视觉排版
          </button>
        </div>
      </div>

      {mode === "visual" ? (
        <div className="flex-1 overflow-auto p-4 bg-[var(--surface-paper)] min-h-0">
          {visualError ? (
            <div className="p-3.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-strong)] text-xs text-[var(--status-warning)]">
              视觉渲染降级提示：{visualError}（请切换回「大纲播放」查看完整页面内容与备注）
            </div>
          ) : (
            <div ref={visualRef} className="space-y-4 flex flex-col items-center" />
          )}
        </div>
      ) : !parsed || parsed.slides.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-paper)]">
          未能提取到幻灯片内容
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* 当前幻灯片舞台 */}
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
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
              className="h-6 inline-flex items-center gap-1 px-2 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 disabled:pointer-events-none transition-colors"
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
                  className={`w-6 h-6 rounded font-mono tabular-nums text-[11px] shrink-0 transition-colors ${
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
              onClick={() => setCurrentIdx((i) => Math.min(parsed.slideCount - 1, i + 1))}
              className="h-6 inline-flex items-center gap-1 px-2 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              <span>下一页</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
