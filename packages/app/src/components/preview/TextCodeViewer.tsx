import { Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { getFileExtension } from "../../office";
import { workspaceVfs } from "../../storage/workspace-vfs";
import type { OfficeFileCategory } from "../../types";

function buildCodeMarkdownFence(source: string, lang: string): string {
  const longestRun = [...source.matchAll(/`+/g)].reduce(
    (max, m) => Math.max(max, m[0].length),
    2
  );
  const fence = "`".repeat(longestRun + 1);
  return `${fence}${lang}\n${source}\n${fence}`;
}

export function TextCodeViewer({
  path,
  bytes,
  category,
}: {
  path: string;
  bytes: Uint8Array;
  category: OfficeFileCategory;
}) {
  const isMarkdown = category === "markdown";
  const isCode = category === "code";
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"render" | "edit">(isMarkdown ? "render" : "edit");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef(text);
  const dirtyRef = useRef(dirty);
  const savingRef = useRef(saving);

  textRef.current = text;
  dirtyRef.current = dirty;
  savingRef.current = saving;

  useEffect(() => {
    setText(new TextDecoder("utf-8").decode(bytes));
    setDirty(false);
    setMode(category === "markdown" ? "render" : "edit");
  }, [bytes, path, category]);

  const handleSave = useCallback(async () => {
    if (savingRef.current || !dirtyRef.current) return;
    setSaving(true);
    try {
      await workspaceVfs.writeText(path, textRef.current, {
        snapshotNote: "手动编辑文本保存",
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [path]);

  // Ctrl/Cmd+S 快捷键保存
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      const activeEl = document.activeElement;
      const insideViewer = Boolean(
        rootRef.current && activeEl && rootRef.current.contains(activeEl)
      );
      const focusedOtherInput =
        activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement;

      if (insideViewer || (dirtyRef.current && !focusedOtherInput)) {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  const lineCount = useMemo(() => (text ? text.split(/\r?\n/).length : 0), [text]);
  const codeFenceMarkdown = useMemo(() => {
    if (!isCode) return "";
    const ext = getFileExtension(path);
    return buildCodeMarkdownFence(text, ext);
  }, [isCode, path, text]);

  return (
    <div ref={rootRef} tabIndex={-1} className="flex flex-col h-full min-h-0 bg-[var(--bg-canvas)] outline-none">
      {/* 统一 h-9 子工具栏 */}
      <div className="h-9 shrink-0 px-3 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between gap-2 text-xs select-none">
        <div className="inline-flex items-center p-0.5 rounded-md bg-[var(--bg-sidebar)] border border-[var(--border-hairline)]">
          <button
            type="button"
            onClick={() => setMode("render")}
            className={`h-6 px-2.5 rounded-[4px] text-[11px] font-medium transition-colors ${
              mode === "render"
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            阅读视图
          </button>
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={`h-6 px-2.5 rounded-[4px] text-[11px] font-medium transition-colors ${
              mode === "edit"
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            源码编辑
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          {dirty ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                <span
                  className="w-1.5 h-1.5 rounded-full bg-[var(--status-warning)]"
                  aria-hidden="true"
                />
                <span>未保存</span>
              </span>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="h-6 inline-flex items-center gap-1.5 px-2 rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-active)] text-[11px] font-medium text-[var(--text-primary)] transition-colors disabled:opacity-50"
                title="保存修改 (Ctrl/Cmd+S)"
              >
                <Save className="w-3 h-3 text-[var(--accent)]" />
                <span>{saving ? "保存中…" : "保存"}</span>
                <kbd className="hidden sm:inline text-[10px] font-mono text-[var(--text-muted)]">
                  ⌘S
                </kbd>
              </button>
            </>
          ) : (
            <span className="text-[10px] font-mono tabular-nums text-[var(--text-muted)]">
              {lineCount} 行
            </span>
          )}
        </div>
      </div>

      {mode === "render" ? (
        <div className="flex-1 overflow-auto bg-[var(--surface-paper)] p-5 min-h-0">
          {isMarkdown ? (
            <div className="max-w-3xl mx-auto rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.14)] prose-chat">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {text}
              </ReactMarkdown>
            </div>
          ) : isCode ? (
            <div className="max-w-4xl mx-auto prose-chat">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {codeFenceMarkdown}
              </ReactMarkdown>
            </div>
          ) : (
            <pre className="max-w-3xl mx-auto rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 text-xs font-mono leading-relaxed whitespace-pre-wrap text-[var(--text-primary)] shadow-[0_1px_3px_rgba(0,0,0,0.14)]">
              {text || "(空文件)"}
            </pre>
          )}
        </div>
      ) : (
        <textarea
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          className="flex-1 w-full resize-none bg-[var(--bg-canvas)] p-4 text-[12px] font-mono leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none min-h-0 selection:bg-[var(--accent-soft)]"
        />
      )}
    </div>
  );
}
