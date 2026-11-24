import {
  AlertCircle,
  ArrowRight,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FileType,
  Paperclip,
  Presentation,
  Send,
  Settings2,
  Sparkles,
  Square,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { BUILTIN_SKILLS } from "../../agent/skills";
import {
  DEFAULT_BRAND_NAME,
  classifyApiError,
  getMizurisuConsoleLinks,
} from "../../newapi/client";
import { useAppStore } from "../../store/useAppStore";
import { BrandLogo } from "../common/FileBadge";
import { MessageItem } from "./MessageItem";

const QUICK_STARTERS = [
  {
    title: "分析示例销售表并写汇总",
    desc: "读取示例_季度销售数据.xlsx，生成包含同比计算与结论的汇报表格",
    icon: FileSpreadsheet,
    prompt:
      "请检查工作区中的 示例_季度销售数据.xlsx，总结各区域营收表现，并新建一份包含总计与增长分析的新工作表。",
  },
  {
    title: "生成正式 Word 业务报告",
    desc: "输出含标题层级、要点列表、数据对照表与页码的 .docx 文档",
    icon: FileType,
    prompt:
      "请结合 示例_季度销售数据.xlsx 的数据，为我生成一份结构清晰的《半年度业务复盘与Q3规划报告.docx》。",
  },
  {
    title: "制作高颜值演示 PPT",
    desc: "结合销售数据生成含 KPI 巨字看板、Bento 双栏、SVG 图表与演讲备注的 .slides.html",
    icon: Presentation,
    prompt:
      "请先读取工作区中的 示例_季度销售数据.xlsx，再使用 slides_create 工具生成一份 5 页高颜值的《半年度销售复盘汇报.slides.html》，包含封面页、KPI 巨字核心指标看板、Bento 双栏区域对比、内联 SVG 营收柱状图与行动建议页，并为每页附上精炼演讲者备注（如当前运行环境支持，也可同步导出同名 .pptx）。",
  },
  {
    title: "多文档合同核查与数据清洗",
    desc: "跨表格与文档提取关键条款、比对口径差异并运行隔离 JS 精确统计汇总",
    icon: Sparkles,
    prompt:
      "请检查当前工作区中的文档与表格（如 示例_季度销售数据.xlsx），使用数据分析与文档读取工具完成口径校验、数据清洗与异常排查，并输出结构化的对比核查汇总。",
  },
];

export function ChatPane({
  draftExternal,
  onClearExternalDraft,
}: {
  draftExternal?: string;
  onClearExternalDraft?: () => void;
}) {
  const {
    config,
    settings,
    sessions,
    activeSessionId,
    isStreaming,
    customSkills,
    activeSkillId,
    sendMessage,
    abortRun,
    uploadFilesToWorkspace,
    setActiveSkill,
    setSettingsOpen,
    dismissOnboarding,
    pushToast,
  } = useAppStore();

  const [input, setInput] = useState("");
  const [attachedPaths, setAttachedPaths] = useState<string[]>([]);
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<Array<{ file: File; url: string }>>([]);
  const [errorTip, setErrorTip] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);

  const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const allSkills = [...BUILTIN_SKILLS, ...customSkills];
  const activeSkill = allSkills.find((s) => s.id === activeSkillId);

  useEffect(() => {
    if (draftExternal) {
      setInput(draftExternal);
      onClearExternalDraft?.();
    }
  }, [draftExternal, onClearExternalDraft]);

  useEffect(() => {
    if (!feedRef.current) return;
    if (!session || session.messages.length === 0) {
      feedRef.current.scrollTop = 0;
      return;
    }
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [session?.id, session?.messages]);

  // 为已附加图片生成 ObjectURL 并在变更或卸载时释放，避免内存泄漏
  useEffect(() => {
    if (attachedImages.length === 0) {
      setImagePreviews([]);
      return;
    }
    const nextPreviews = attachedImages.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setImagePreviews(nextPreviews);
    return () => {
      for (const item of nextPreviews) {
        URL.revokeObjectURL(item.url);
      }
    };
  }, [attachedImages]);

  const canSend = Boolean(
    input.trim() || attachedImages.length > 0 || attachedPaths.length > 0
  );

  const handleSend = async (customText?: string) => {
    const text = (customText ?? input).trim();
    const paths = [...attachedPaths];
    const imgs = [...attachedImages];
    if (!text && paths.length === 0 && imgs.length === 0) return;

    setErrorTip(null);
    if (!customText) setInput("");
    setAttachedPaths([]);
    setAttachedImages([]);

    try {
      await sendMessage(text, paths, imgs);
    } catch (err) {
      if (!customText) {
        if (text) {
          setInput((prev) => prev || text);
        }
        if (paths.length > 0) {
          setAttachedPaths((prev) => [...new Set([...paths, ...prev])]);
        }
        if (imgs.length > 0) {
          setAttachedImages((prev) => [...imgs, ...prev]);
        }
      }
      setErrorTip(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAttachFiles = async (fileList: FileList | File[]) => {
    const list = Array.from(fileList);
    if (list.length === 0) return;
    const imgs = list.filter((f) => f.type.startsWith("image/"));
    const docs = list.filter((f) => !f.type.startsWith("image/"));
    if (docs.length > 0) {
      try {
        const metas = await uploadFilesToWorkspace(docs);
        setAttachedPaths((prev) => [...new Set([...prev, ...metas.map((m) => m.path)])]);
      } catch (err) {
        pushToast(
          err instanceof Error ? err.message : "上传文档到工作区失败",
          "error"
        );
      }
    }
    if (imgs.length > 0) {
      setAttachedImages((prev) => [...prev, ...imgs]);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const pastedImages: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          const ext = (file.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
          const namedFile =
            file.name && file.name !== "image.png"
              ? file
              : new File([file], `clipboard-${Date.now()}-${i + 1}.${ext || "png"}`, {
                  type: file.type || "image/png",
                });
          pastedImages.push(namedFile);
        }
      }
    }

    if (pastedImages.length > 0) {
      if (!e.clipboardData.getData("text/plain")) {
        e.preventDefault();
      }
      setAttachedImages((prev) => [...prev, ...pastedImages]);
      pushToast(`已从剪贴板附加 ${pastedImages.length} 张图片`, "info");
    }
  };

  const errorDiagnosis = errorTip ? classifyApiError(errorTip, config.baseUrl) : null;
  const consoleLinks = getMizurisuConsoleLinks(config.baseUrl);

  return (
    <div
      className="flex flex-col h-full min-h-0 bg-[var(--bg-canvas)] relative"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files?.length) {
          await handleAttachFiles(e.dataTransfer.files);
        }
      }}
    >
      {dragging && (
        <div className="absolute inset-3 z-30 rounded-lg border border-dashed border-[var(--accent)] bg-[var(--bg-surface)]/95 flex items-center justify-center text-[13px] font-medium text-[var(--text-primary)] pointer-events-none">
          松开即可导入文件到工作区并附带至对话
        </div>
      )}

      {/* 未配置 Key 克制提示条 */}
      {(!config.baseUrl || !config.apiKey) && (
        <div className="px-4 py-1.5 border-b border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex items-center justify-between gap-3 text-[12px] shrink-0">
          <div className="flex items-center gap-2 min-w-0 text-[var(--text-secondary)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-warning)] shrink-0" />
            <span className="truncate">
              当前处于离线文档体验模式，连接 Mizurisu / 模型中转服务或填入 API Key 后即可启用 AI 协同。
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="shrink-0 whitespace-nowrap inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[11px] font-medium text-[var(--text-primary)] transition cursor-pointer"
          >
            <Settings2 className="w-3 h-3 text-[var(--text-muted)]" />
            <span>配置连接</span>
          </button>
        </div>
      )}

      {/* 对话消息流 */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 min-h-0">
        {!session || session.messages.length === 0 ? (
          <div className="@container max-w-[760px] mx-auto pt-2 sm:pt-6 space-y-5">
            <div className="flex flex-col items-center text-center">
              <BrandLogo className="w-11 h-11 rounded-xl mb-3" />
              <h1 className="text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">
                {config.brandName || DEFAULT_BRAND_NAME} · 智能办公启动台
              </h1>
              <p className="mt-1.5 text-[13px] text-[var(--text-muted)] max-w-lg leading-relaxed text-balance">
                直接读写、清洗与生成 Excel / Word / PPT / PDF 文档，所有改动实时同步右侧工作台。
              </p>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => attachRef.current?.click()}
                  className="h-8 px-3.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[12px] font-medium text-[var(--text-primary)] inline-flex items-center gap-2 transition cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>上传本地文档开始处理</span>
                </button>
              </div>
            </div>

            {/* 可关闭的首次使用三步轻量指引 */}
            {!settings.onboardingDismissed && (
              <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2.5 flex items-center justify-between gap-3 text-[12px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--text-secondary)] min-w-0">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[10px] font-semibold inline-flex items-center justify-center">
                      1
                    </span>
                    <span>上传文档</span>
                  </span>
                  <ArrowRight className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[10px] font-semibold inline-flex items-center justify-center">
                      2
                    </span>
                    <span>选场景或提问</span>
                  </span>
                  <ArrowRight className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[10px] font-semibold inline-flex items-center justify-center">
                      3
                    </span>
                    <span>右侧实时预览/导出</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => dismissOnboarding()}
                  aria-label="关闭使用指引"
                  title="不再显示此指引"
                  className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* 2×2 极简 1px 线框高价值场景卡片（基于容器宽度自适应，避免三栏挤压截断标题） */}
            <div className="grid grid-cols-1 @[520px]:grid-cols-2 gap-2.5">
              {QUICK_STARTERS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => handleSend(item.prompt)}
                    className="min-w-0 text-left p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-surface)] hover:border-[var(--border-strong)] transition cursor-pointer group"
                  >
                    <div className="flex items-start gap-2 text-[13px] font-medium text-[var(--text-primary)]">
                      <Icon
                        className="w-3.5 h-3.5 mt-0.5 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] shrink-0 transition"
                        strokeWidth={1.6}
                      />
                      <span className="leading-snug line-clamp-2">{item.title}</span>
                    </div>
                    <p className="mt-1.5 text-[12px] text-[var(--text-muted)] leading-relaxed line-clamp-2">
                      {item.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="max-w-[760px] mx-auto space-y-6">
            {session.messages.map((m) => (
              <MessageItem key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>

      {/* 底部精致 1px 细边框输入器 */}
      <div className="px-4 sm:px-6 pb-4 pt-1 shrink-0">
        <div className="max-w-[760px] mx-auto">
          {errorTip && errorDiagnosis && (
            <div className="mb-2 px-3 py-2.5 rounded-md border border-[var(--border-hairline)] border-l-2 border-l-[var(--status-danger)] bg-[var(--bg-surface)] text-[12px] space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
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
                <button
                  type="button"
                  onClick={() => setErrorTip(null)}
                  aria-label="关闭错误提示"
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] text-[var(--text-primary)] transition cursor-pointer"
                >
                  <Settings2 className="w-3 h-3 text-[var(--text-muted)]" />
                  <span>打开设置</span>
                </button>
                <a
                  href={consoleLinks.topupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
                >
                  <span>前往控制台</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          )}

          {(activeSkill || attachedPaths.length > 0 || imagePreviews.length > 0) && (
            <div className="mb-2 space-y-1.5">
              {imagePreviews.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {imagePreviews.map((item, i) => (
                    <div
                      key={`${item.file.name}_${i}_${item.file.size}`}
                      className="relative group w-14 h-14 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-hidden shrink-0"
                      title={item.file.name}
                    >
                      <img
                        src={item.url}
                        alt={item.file.name}
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setAttachedImages((prev) => prev.filter((_, idx) => idx !== i))
                        }
                        aria-label={`移除图片 ${item.file.name}`}
                        className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/75 text-white flex items-center justify-center opacity-85 hover:opacity-100 transition cursor-pointer"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {(activeSkill || attachedPaths.length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {activeSkill && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md border border-[var(--border-strong)] bg-[var(--accent-soft)] text-[var(--text-primary)]">
                      <Wand2 className="w-3 h-3 text-[var(--accent)]" />
                      <span>{activeSkill.name}</span>
                      <button
                        type="button"
                        onClick={() => setActiveSkill(undefined)}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}
                  {attachedPaths.map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--text-secondary)]"
                    >
                      <FileText className="w-3 h-3 text-[var(--text-muted)]" />
                      <span className="font-mono">{p}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setAttachedPaths((prev) => prev.filter((x) => x !== p))
                        }
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] focus-within:border-[var(--border-strong)] transition">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (canSend) {
                    handleSend();
                  }
                }
              }}
              placeholder={
                isStreaming
                  ? "Agent 执行中：输入内容按 Enter 可随时插话引导 (Steer)..."
                  : "输入指令处理工作区文档，Shift + Enter 换行，支持拖拽文件或粘贴截图..."
              }
              className="w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-[13.5px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none max-h-44"
            />
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1 border-t border-[var(--border-hairline)]/60">
              <div className="flex items-center gap-2 min-w-0">
                <input
                  ref={attachRef}
                  type="file"
                  multiple
                  accept=".xlsx,.xls,.csv,.tsv,.docx,.pptx,.pdf,.md,.txt,.json,.png,.jpg,.jpeg,.webp"
                  onChange={async (e) => {
                    if (e.target.files?.length) {
                      await handleAttachFiles(e.target.files);
                      e.target.value = "";
                    }
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => attachRef.current?.click()}
                  className="h-7 px-2 rounded-md inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition cursor-pointer whitespace-nowrap shrink-0"
                  title="附加 Word / Excel / PPT / PDF / 图片"
                >
                  <Paperclip className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                  <span className="hidden sm:inline">附加文件</span>
                </button>
                <span className="hidden md:inline font-mono text-[11px] text-[var(--text-muted)] truncate">
                  {config.selectedModelId}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {isStreaming && (
                  <button
                    type="button"
                    onClick={() => abortRun()}
                    className="h-7 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-active)] text-[var(--status-danger)] inline-flex items-center gap-1.5 text-[12px] font-medium transition cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span>停止</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleSend()}
                  disabled={!canSend}
                  className="h-7 px-3 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-35 text-white inline-flex items-center gap-1.5 text-[12px] font-medium transition cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Send className="w-3 h-3" />
                  <span>{isStreaming ? "插话引导" : "发送"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
