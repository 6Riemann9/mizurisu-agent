import {
  AlertCircle,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileOutput,
  GitBranch,
  Paperclip,
} from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { useAppStore } from "../../store/useAppStore";
import type { ToolCallRecord, UiMessage } from "../../types";

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
  const { openPreview, branchFromMessage, isStreaming } = useAppStore();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  /* 用户消息：克制微浮卡片 (--bg-surface + 1px hairline) */
  if (message.role === "user") {
    return (
      <div className="flex justify-end group">
        <div className="max-w-[88%] sm:max-w-[78%] space-y-1.5">
          <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
            {message.content}
          </div>

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

          {!isStreaming && (
            <div className="flex justify-end opacity-0 group-hover:opacity-100 transition">
              <button
                type="button"
                onClick={() => branchFromMessage(message.id)}
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
    );
  }

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
              >
                {message.content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)] py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              <span>Pi 正在思考与处理文档...</span>
            </div>
          )}

          {!message.isStreaming && (
            <div className="mt-2.5 pt-2 border-t border-[var(--border-hairline)]/60 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
              <div className="flex items-center gap-2 font-mono tabular-nums">
                {message.modelId && <span>{message.modelId}</span>}
                {message.usage && message.usage.totalTokens > 0 && (
                  <span>
                    · {message.usage.inputTokens}+{message.usage.outputTokens} (
                    {message.usage.totalTokens} tok)
                  </span>
                )}
              </div>
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
          )}
        </div>
      )}

      {message.errorMessage && (
        <div className="rounded-md border border-[var(--border-hairline)] border-l-2 border-l-[var(--status-danger)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--status-danger)] flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{message.errorMessage}</span>
        </div>
      )}
    </div>
  );
}
