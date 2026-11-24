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
import { Button, Tooltip, cn } from "../ui";

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

/** 提取工具调用中关键目标文件或路径摘要，用于单行时间线高密度展示 */
function getToolTargetLabel(tool: ToolCallRecord): string | null {
  const args = tool.args || {};
  const singleKeys = ["path", "outputPath", "sourcePath", "dataPath"] as const;
  for (const key of singleKeys) {
    const val = args[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  if (tool.modifiedPath && tool.modifiedPath.trim()) {
    return tool.modifiedPath.trim();
  }
  const listKeys = ["dataPaths", "paths"] as const;
  for (const key of listKeys) {
    const val = args[key];
    if (Array.isArray(val)) {
      const items = val.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (items.length === 1) return items[0];
      if (items.length > 1) return `${items[0]} 等 ${items.length} 项`;
    }
  }
  return null;
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
      <Tooltip content={codeCopied ? "已复制代码" : "复制代码"} side="top">
        <button
          type="button"
          onClick={handleCopyCode}
          aria-label="复制代码"
          className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 bg-black/60 hover:bg-black/80 text-[11px] text-zinc-300 hover:text-white opacity-90 sm:opacity-0 sm:group-hover/code:opacity-100 focus:opacity-100 transition cursor-pointer backdrop-blur-sm linear-focus-ring"
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
      </Tooltip>
      <pre {...props} className={`${className ?? ""} !my-0 pr-20`}>
        {children}
      </pre>
    </div>
  );
}

/** Linear Activity Timeline 单步工具执行节点（左侧 1px 竖线串起，状态圆点居线居中，单行 26px 高密度排版） */
function ToolCallItem({
  tool,
  isFirst,
  isLast,
}: {
  tool: ToolCallRecord;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { openPreview } = useAppStore();

  const dotColor =
    tool.status === "running"
      ? "bg-[var(--accent)] animate-pulse"
      : tool.status === "success"
        ? "bg-[var(--status-success)]"
        : tool.status === "blocked"
          ? "bg-[var(--status-warning)]"
          : "bg-[var(--status-danger)]";

  const targetLabel = getToolTargetLabel(tool);

  return (
    <div className="relative flex items-stretch text-[12px]">
      {/* 左侧 1px 时间线轨道与居中状态圆点 */}
      <div className="relative w-5 shrink-0 flex justify-center" aria-hidden="true">
        {!isFirst && (
          <span className="absolute top-0 h-[13px] left-1/2 -translate-x-1/2 w-px bg-[var(--border-hairline)]" />
        )}
        {(!isLast || expanded) && (
          <span className="absolute top-[13px] bottom-0 left-1/2 -translate-x-1/2 w-px bg-[var(--border-hairline)]" />
        )}
        <span
          className={cn(
            "relative z-10 mt-[9.5px] w-[7px] h-[7px] rounded-full shrink-0 ring-2 ring-[var(--bg-canvas)]",
            dotColor
          )}
        />
      </div>

      {/* 右侧 26px 单行高密度信息与可展开详情 */}
      <div className="flex-1 min-w-0">
        <div className="h-[26px] px-1.5 rounded-[5px] hover:bg-[var(--bg-hover)] flex items-center justify-between gap-2 transition-colors">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex-1 min-w-0 h-full flex items-center gap-2 text-left cursor-pointer linear-focus-ring rounded-[4px]"
          >
            <span className="font-mono text-[11.5px] font-linear-medium text-[var(--text-primary)] truncate shrink-0 max-w-[165px]">
              {tool.name}
            </span>
            {targetLabel && (
              <span className="font-mono text-[11px] text-[var(--text-muted)] truncate">
                {targetLabel}
              </span>
            )}
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            {tool.modifiedPath && tool.status === "success" && (
              <Tooltip content={`在右侧工作台预览 ${tool.modifiedPath}`} side="top">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    openPreview(tool.modifiedPath!);
                  }}
                  className="h-5 px-1.5 rounded-[4px] text-[10.5px]"
                >
                  <FileOutput className="w-3 h-3 text-[var(--accent)]" />
                  <span>预览文档</span>
                </Button>
              </Tooltip>
            )}

            {tool.durationMs !== undefined && (
              <span className="font-mono tabular-nums text-[10.5px] text-[var(--text-muted)]">
                {tool.durationMs}ms
              </span>
            )}

            <Tooltip content={expanded ? "收起参数与返回" : "展开入参与出参"} side="top">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? "收起工具调用详情" : "展开工具调用详情"}
                className="w-4 h-4 rounded inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer linear-focus-ring"
              >
                {expanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>
            </Tooltip>
          </div>
        </div>

        {expanded && (
          <div className="pl-1.5 pr-1 pt-1 pb-2 space-y-2">
            <div>
              <div className="text-[10px] font-linear-medium uppercase tracking-wider text-[var(--text-muted)] mb-1">
                入参
              </div>
              <pre className="p-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[11px] font-mono text-[var(--text-secondary)] overflow-x-auto max-h-40">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            </div>
            {tool.resultText && (
              <div>
                <div className="text-[10px] font-linear-medium uppercase tracking-wider text-[var(--text-muted)] mb-1">
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
    const hasMediaOrAttachment =
      Boolean(message.attachments?.length) || Boolean(message.images?.length);
    if (!trimmed && !hasMediaOrAttachment) return;
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

  const handleBranch = () => {
    branchFromMessage(message.id).catch((err) => {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    });
  };

  /* 用户消息：克制微浮卡片 (--bg-surface + 1px hairline) */
  if (message.role === "user") {
    const canSaveEdit = Boolean(
      editDraft.trim() ||
        (message.attachments && message.attachments.length > 0) ||
        (message.images && message.images.length > 0)
    );

    return (
      <>
        <div className="flex justify-end group">
          <div className="max-w-[88%] sm:max-w-[78%] space-y-1.5 w-full flex flex-col items-end">
            {editing ? (
              <div className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2.5 space-y-2 shadow-[var(--shadow-popover)]">
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
                  <Tooltip content="放弃修改" shortcut="Escape" side="top">
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => {
                        setEditing(false);
                        setEditDraft(message.content);
                      }}
                    >
                      取消
                    </Button>
                  </Tooltip>
                  <Tooltip
                    content="保存修改并重新发送"
                    shortcut={["Mod", "Enter"]}
                    side="top"
                  >
                    <Button
                      variant="primary"
                      size="xs"
                      disabled={!canSaveEdit}
                      onClick={handleSaveEdit}
                    >
                      保存并重发
                    </Button>
                  </Tooltip>
                </div>
              </div>
            ) : message.content ? (
              <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
                {message.content}
              </div>
            ) : null}

            {message.images && message.images.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {message.images.map((img, idx) => (
                  <Tooltip key={`${img.name}_${idx}`} content={`放大查看 ${img.name}`} side="top">
                    <button
                      type="button"
                      onClick={() => setLightboxImage(img)}
                      aria-label={`放大查看图片 ${img.name}`}
                      className="group/img relative w-16 h-16 rounded-md overflow-hidden border border-[var(--border-hairline)] hover:border-[var(--border-strong)] bg-[var(--bg-surface)] transition cursor-pointer linear-focus-ring"
                    >
                      <img
                        src={img.dataUrl}
                        alt={img.name}
                        className="w-full h-full object-cover group-hover/img:scale-105 transition-transform"
                      />
                    </button>
                  </Tooltip>
                ))}
              </div>
            )}

            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {message.attachments.map((att) => (
                  <Tooltip
                    key={att.path}
                    content={`在右侧文档台预览 ${att.name}`}
                    side="top"
                  >
                    <button
                      type="button"
                      onClick={() => openPreview(att.path)}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition cursor-pointer linear-focus-ring"
                    >
                      <Paperclip className="w-3 h-3 text-[var(--text-muted)]" />
                      <span className="font-mono">{att.name}</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
            )}

            {!isStreaming && !editing && (
              <div className="flex justify-end items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition">
                <Tooltip content="修改内容并重新发送" side="top">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setEditDraft(message.content);
                      setEditing(true);
                    }}
                    className="h-6 px-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>编辑重发</span>
                  </Button>
                </Tooltip>
                <Tooltip content="从这条消息新建分支重试" side="top">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleBranch}
                    className="h-6 px-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <GitBranch className="w-3 h-3" />
                    <span>从此处分支重跑</span>
                  </Button>
                </Tooltip>
              </div>
            )}
          </div>
        </div>

        {/* 图片轻量放大灯箱 */}
        {lightboxImage && (
          <div
            className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-[2px] flex flex-col items-center justify-center p-4"
            onClick={() => setLightboxImage(null)}
            role="dialog"
            aria-modal="true"
            aria-label={lightboxImage.name}
          >
            <Tooltip content="关闭大图预览" shortcut="Escape" side="left">
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                aria-label="关闭大图预览"
                className="absolute top-4 right-4 w-8 h-8 rounded-full border border-white/15 bg-black/60 hover:bg-black/80 text-white inline-flex items-center justify-center transition cursor-pointer linear-focus-ring"
              >
                <X className="w-4 h-4" />
              </button>
            </Tooltip>
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
          <Tooltip content={thinkingOpen ? "收起思考过程" : "展开思考过程"} side="top">
            <button
              type="button"
              onClick={() => setThinkingOpen((v) => !v)}
              aria-expanded={thinkingOpen}
              className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition cursor-pointer linear-focus-ring rounded"
            >
              <Brain className="w-3.5 h-3.5 shrink-0" />
              <span className="font-linear-medium">思考过程</span>
              {message.isStreaming && !message.content && (
                <span className="animate-pulse">· 推理中</span>
              )}
              {thinkingOpen ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
          </Tooltip>
          {thinkingOpen && (
            <div className="mt-1.5 text-[12px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
              {message.thinking}
            </div>
          )}
        </div>
      )}

      {/* Linear Activity Timeline 工具执行状态轨 */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="space-y-0 py-0.5" role="list" aria-label="工具执行时间线">
          {message.toolCalls.map((tool, index) => (
            <ToolCallItem
              key={tool.id}
              tool={tool}
              isFirst={index === 0}
              isLast={index === message.toolCalls!.length - 1}
            />
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
              <div className="flex items-center gap-1 shrink-0">
                <Tooltip content="从当前位置新建分支会话" side="top">
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={isStreaming}
                    onClick={handleBranch}
                    className="h-6 px-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <GitBranch className="w-3 h-3" />
                    <span>分支对话</span>
                  </Button>
                </Tooltip>

                <Tooltip content="基于上一条提问重新生成回答" side="top">
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={isStreaming}
                    onClick={handleRegenerate}
                    className="h-6 px-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>重新生成</span>
                  </Button>
                </Tooltip>

                {message.content && (
                  <Tooltip content={copied ? "已复制全部回复" : "复制助手回复内容"} side="top">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={handleCopy}
                      className="h-6 px-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
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
                    </Button>
                  </Tooltip>
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
              <div className="font-linear-medium text-[var(--status-danger)]">
                {errorDiagnosis.title}
              </div>
              <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
                {errorDiagnosis.advice}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pl-5 text-[11px]">
            <Tooltip content="重新发起当前回合生成" side="top">
              <Button
                variant="secondary"
                size="xs"
                disabled={isStreaming}
                onClick={handleRegenerate}
              >
                <RotateCcw className="w-3 h-3 text-[var(--accent)]" />
                <span>重试生成</span>
              </Button>
            </Tooltip>
            {errorDiagnosis.suggestOpenSettings && (
              <Tooltip content="打开中转站、模型与密钥设置" side="top">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings className="w-3 h-3 text-[var(--text-muted)]" />
                  <span>打开设置</span>
                </Button>
              </Tooltip>
            )}
            {errorDiagnosis.suggestBillingConsole && (
              <Tooltip content="前往 Mizurisu 控制台充值或检查令牌" side="top">
                <a
                  href={consoleLinks.topupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-[5px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] text-[11px] font-linear-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition linear-focus-ring"
                >
                  <span>前往控制台充值</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </Tooltip>
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
