import {
  AlertCircle,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileOutput,
  GitBranch,
  Paperclip,
  Pencil,
  RotateCcw,
  Settings,
  X,
} from "lucide-react";
import {
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { classifyApiError, getMizurisuConsoleLinks } from "../../newapi/client";
import { useAppStore } from "../../store/useAppStore";
import type { ToolCallRecord, UiMessage } from "../../types";

/** 递归提取 React 节点中的纯文本，兼容 rehype-highlight 拆分后的代码高亮树 */
function extractTextFromReactNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractTextFromReactNode).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractTextFromReactNode(node.props.children);
  }
  return "";
}

/** Markdown 代码块包装器：右上角提供一键复制代码按钮 */
function MarkdownPreBlock({
  children,
  node: _node,
  className,
  ...props
}: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) {
  const [codeCopied, setCodeCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopyCode = async () => {
    const rawCode = extractTextFromReactNode(children).replace(/\n$/, "");
    if (!rawCode) return;
    await navigator.clipboard.writeText(rawCode).catch(() => undefined);
    setCodeCopied(true);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCodeCopied(false), 1500);
  };

  return (
    <div className="relative group/code my-3">
      <button
        type="button"
        onClick={handleCopyCode}
        className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 bg-black/60 hover:bg-black/80 text-[11px] text-zinc-300 hover:text-white opacity-90 sm:opacity-0 sm:group-hover/code:opacity-100 focus:opacity-100 transition cursor-pointer backdrop-blur-sm"
        title="复制代码"
      >
        {codeCopied ? (
          <>
            <Check className="w-3 h-3 text-[var(--status-success)]" />
            <span>已复制</span>
          </>
        ) : (
          <>
            <Copy className="w-3 h-3" />
            <span>复制代码</span>
          </>
        )}
      </button>
      <pre {...props} className={`${className ?? ""} !my-0 pr-20`}>
        {children}
      </pre>
    </div>
  );
}

/** Linear Activity Timeline 单行状态轨 */
function ToolCallItem({ tool }: { tool: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const { openPreview } = useAppStore();

  const dotColor =
    tool.status === "running"
      ? "bg-[var(--accent)] animate-pulse"
      : tool.status === "success"
        ? "bg-[var(--status-success)]"
        : "bg-[var(--status-danger)]";

  return (
    <div className="text-[12px]">
      <div
        onClick={() => setExpanded((v) => !v)}
        className="min-h-[28px] px-2 py-1 rounded-md hover:bg-[var(--bg-hover)] flex items-center justify-between gap-2 cursor-pointer transition"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
          <span className="font-mono text-[12px] text-[var(--text-primary)] truncate">
            {tool.name}
          </span>
          {typeof tool.args?.path === "string" && (
            <span className="font-mono text-[11px] text-[var(--text-muted)] truncate">
              {tool.args.path}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {tool.modifiedPath && tool.status === "success" && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openPreview(tool.modifiedPath!);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:border-[var(--accent)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
            >
              <FileOutput className="w-3 h-3 text-[var(--accent)]" />
              <span>预览文档</span>
            </button>
          )}
          {tool.durationMs !== undefined && (
            <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
              {tool.durationMs}ms
            </span>
          )}
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
          ) : (
            <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="ml-2.5 pl-3 my-1 border-l border-[var(--border-hairline)] space-y-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
              入参
            </div>
            <pre className="p-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[11px] font-mono text-[var(--text-secondary)] overflow-x-auto max-h-40">
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          </div>
          {tool.resultText && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
                出参
              </div>
              <pre className="p-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[11px] font-mono text-[var(--text-secondary)] overflow-x-auto max-h-48 whitespace-pre-wrap">
                {tool.resultText.slice(0, 2500)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MessageItem({ message }: { message: UiMessage }) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const [lightboxImage, setLightboxImage] = useState<{
    name: string;
    dataUrl: string;
  } | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    config,
    openPreview,
    branchFromMessage,
    editAndResendMessage,
    regenerateMessage,
    setSettingsOpen,
    pushToast,
    isStreaming,
  } = useAppStore();

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!lightboxImage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxImage(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxImage]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content).catch(() => undefined);
    setCopied(true);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  const handleSaveEdit = async () => {
    const trimmed = editDraft.trim();
    if (!trimmed) return;
    setEditing(false);
    try {
      await editAndResendMessage(message.id, trimmed);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleRegenerate = async () => {
    try {
      await regenerateMessage(message.id);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  /* 用户消息：克制微浮卡片 (--bg-surface + 1px hairline) */
  if (message.role === "user") {
    return (
      <>
        <div className="flex justify-end group">
          <div className="max-w-[88%] sm:max-w-[78%] space-y-1.5 w-full flex flex-col items-end">
            {editing ? (
              <div className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2.5 space-y-2">
                <textarea
                  rows={3}
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setEditing(false);
                      setEditDraft(message.content);
                    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSaveEdit();
                    }
                  }}
                  className="w-full resize-y bg-[var(--bg-canvas)] rounded-md border border-[var(--border-hairline)] focus:border-[var(--border-strong)] px-2.5 py-2 text-[13px] leading-relaxed text-[var(--text-primary)] outline-none max-h-60"
                />
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setEditDraft(message.content);
                    }}
                    className="h-7 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-hover)] text-[11.5px] text-[var(--text-secondary)] transition cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={!editDraft.trim()}
                    onClick={handleSaveEdit}
                    className="h-7 px-2.5 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-white text-[11.5px] font-medium transition cursor-pointer"
                  >
                    保存并重发
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
                {message.content}
              </div>
            )}

            {message.images && message.images.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {message.images.map((img, idx) => (
                  <button
                    key={`${img.name}_${idx}`}
                    type="button"
                    onClick={() => setLightboxImage(img)}
                    title={`点击放大查看 ${img.name}`}
                    className="group/img relative w-16 h-16 rounded-md overflow-hidden border border-[var(--border-hairline)] hover:border-[var(--border-strong)] bg-[var(--bg-surface)] transition cursor-pointer"
                  >
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="w-full h-full object-cover group-hover/img:scale-105 transition-transform"
                    />
                  </button>
                ))}
              </div>
            )}

            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {message.attachments.map((att) => (
                  <button
                    key={att.path}
                    type="button"
                    onClick={() => openPreview(att.path)}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition cursor-pointer"
                  >
                    <Paperclip className="w-3 h-3 text-[var(--text-muted)]" />
                    <span className="font-mono">{att.name}</span>
                  </button>
                ))}
              </div>
            )}

            {!isStreaming && !editing && (
              <div className="flex justify-end items-center gap-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
                <button
                  type="button"
                  onClick={() => {
                    setEditDraft(message.content);
                    setEditing(true);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  title="修改内容并重新发送"
                >
                  <Pencil className="w-3 h-3" />
                  <span>编辑重发</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    branchFromMessage(message.id).catch((err) => {
                      pushToast(err instanceof Error ? err.message : String(err), "error");
                    });
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  title="从这条消息新建分支重试"
                >
                  <GitBranch className="w-3 h-3" />
                  <span>从此处分支重跑</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 图片轻量放大弹窗 */}
        {lightboxImage && (
          <div
            className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-[2px] flex flex-col items-center justify-center p-4"
            onClick={() => setLightboxImage(null)}
            role="dialog"
            aria-modal="true"
            aria-label={lightboxImage.name}
          >
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              aria-label="关闭大图预览"
              className="absolute top-4 right-4 w-8 h-8 rounded-full border border-white/15 bg-black/60 hover:bg-black/80 text-white inline-flex items-center justify-center transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={lightboxImage.dataUrl}
              alt={lightboxImage.name}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-[84vh] rounded-lg border border-white/15 object-contain shadow-2xl"
            />
            <div className="mt-2.5 text-[12px] font-mono text-zinc-300 truncate max-w-[90vw]">
              {lightboxImage.name}
            </div>
          </div>
        )}
      </>
    );
  }

  const errorDiagnosis = message.errorMessage
    ? classifyApiError(message.errorMessage, config.baseUrl)
    : null;
  const consoleLinks = getMizurisuConsoleLinks(config.baseUrl);

  /* 助手回答：直接排版在主画布上 */
  return (
    <div className="space-y-2.5">
      {/* 思考过程折叠 */}
      {message.thinking && (
        <div className="border-l-2 border-[var(--border-strong)] pl-3 py-0.5">
          <button
            type="button"
            onClick={() => setThinkingOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition cursor-pointer"
          >
            <Brain className="w-3.5 h-3.5 shrink-0" />
            <span>思考过程</span>
            {message.isStreaming && !message.content && (
              <span className="animate-pulse">· 推理中</span>
            )}
            {thinkingOpen ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
          {thinkingOpen && (
            <div className="mt-1.5 text-[12px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
              {message.thinking}
            </div>
          )}
        </div>
      )}

      {/* Linear Activity Timeline 工具执行状态轨 */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="border-l border-[var(--border-hairline)] pl-1.5 space-y-0.5">
          {message.toolCalls.map((tool) => (
            <ToolCallItem key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      {/* 主体回答直接排版在画布上 */}
      {(message.content || message.isStreaming) && (
        <div>
          {message.content ? (
            <div className="prose-chat">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  pre: MarkdownPreBlock,
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)] py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              <span>Mizurisu Agent 正在处理...</span>
            </div>
          )}

          {!message.isStreaming && (
            <div className="mt-2.5 pt-2 border-t border-[var(--border-hairline)]/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
              <div className="flex items-center gap-2 font-mono tabular-nums min-w-0">
                {message.modelId && <span className="truncate">{message.modelId}</span>}
                {message.usage && message.usage.totalTokens > 0 && (
                  <span className="shrink-0">
                    · {message.usage.inputTokens}+{message.usage.outputTokens} (
                    {message.usage.totalTokens} tok)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  disabled={isStreaming}
                  onClick={handleRegenerate}
                  className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] disabled:opacity-40 transition cursor-pointer"
                  title="基于上一条提问重新生成回答"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>重新生成</span>
                </button>
                {message.content && (
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-[var(--status-success)]" />
                        <span>已复制</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>复制</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {message.errorMessage && errorDiagnosis && (
        <div className="rounded-md border border-[var(--border-hairline)] border-l-2 border-l-[var(--status-danger)] bg-[var(--bg-surface)] px-3 py-2.5 text-[12px] space-y-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-[var(--status-danger)] shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-0.5">
              <div className="font-medium text-[var(--status-danger)]">
                {errorDiagnosis.title}
              </div>
              <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
                {errorDiagnosis.advice}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pl-5 text-[11px]">
            <button
              type="button"
              disabled={isStreaming}
              onClick={handleRegenerate}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] text-[var(--text-primary)] disabled:opacity-40 transition cursor-pointer"
            >
              <RotateCcw className="w-3 h-3 text-[var(--accent)]" />
              <span>重试生成</span>
            </button>
            {errorDiagnosis.suggestOpenSettings && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                <Settings className="w-3 h-3 text-[var(--text-muted)]" />
                <span>打开设置</span>
              </button>
            )}
            {errorDiagnosis.suggestBillingConsole && (
              <a
                href={consoleLinks.topupUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
              >
                <span>前往控制台充值</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </div>

          <details className="pl-5 text-[11px] text-[var(--text-muted)]">
            <summary className="cursor-pointer hover:text-[var(--text-secondary)] select-none">
              查看原始报错细节
            </summary>
            <div className="mt-1 font-mono text-[10.5px] break-all opacity-90">
              {message.errorMessage}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
