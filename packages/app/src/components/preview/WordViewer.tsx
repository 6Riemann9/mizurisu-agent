import { renderAsync } from "docx-preview";
import { useEffect, useRef, useState } from "react";
import { readWordDocument } from "../../office";

export function WordViewer({ bytes }: { bytes: Uint8Array }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"rich" | "text">("rich");
  const [plainText, setPlainText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
        } else {
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

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg-canvas)]">
      {/* 统一 h-9 子工具栏 */}
      <div className="h-9 shrink-0 px-3 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between gap-2 text-xs select-none">
        <span className="text-[11px] text-[var(--text-muted)]">Word 文档</span>
        <div className="inline-flex items-center p-0.5 rounded-md bg-[var(--bg-sidebar)] border border-[var(--border-hairline)]">
          <button
            type="button"
            onClick={() => setMode("rich")}
            className={`h-6 px-2.5 rounded-[4px] text-[11px] font-medium transition-colors ${
              mode === "rich"
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            排版预览
          </button>
          <button
            type="button"
            onClick={() => setMode("text")}
            className={`h-6 px-2.5 rounded-[4px] text-[11px] font-medium transition-colors ${
              mode === "text"
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            纯文本提取
          </button>
        </div>
      </div>

      {error ? (
        <div className="p-4 m-4 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-xs text-[var(--status-danger)]">
          Word 解析失败：{error}
        </div>
      ) : mode === "rich" ? (
        <div
          ref={containerRef}
          className="flex-1 overflow-auto bg-[var(--surface-paper)] min-h-0"
        />
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
