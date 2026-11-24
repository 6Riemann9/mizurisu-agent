import {
  FileSpreadsheet,
  FileText,
  FileType,
  Image as ImageIcon,
  Paperclip,
  Presentation,
  Send,
  Settings2,
  Sparkles,
  Square,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BUILTIN_SKILLS } from "../../agent/skills";
import { useAppStore } from "../../store/useAppStore";
import { PiMark } from "../common/FileBadge";
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
    title: "本地 JS 数据清洗统计",
    desc: "在隔离 Web Worker 中做精确计算与指标汇总（三端可用）",
    icon: Sparkles,
    prompt:
      "请使用 run_js_analysis 计算 示例_季度销售数据.xlsx 中各区域半年度营收占比排名，并给出 Markdown 汇总表。",
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
  } = useAppStore();

  const [input, setInput] = useState("");
  const [attachedPaths, setAttachedPaths] = useState<string[]>([]);
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
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
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [session?.messages]);

  const handleSend = async (customText?: string) => {
    const text = (customText ?? input).trim();
    if (!text) return;
    setErrorTip(null);
    if (!customText) setInput("");
    const paths = [...attachedPaths];
    const imgs = [...attachedImages];
    setAttachedPaths([]);
    setAttachedImages([]);

    try {
      await sendMessage(text, paths, imgs);
    } catch (err) {
      setErrorTip(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAttachFiles = async (fileList: FileList | File[]) => {
    const list = Array.from(fileList);
    if (list.length === 0) return;
    const imgs = list.filter((f) => f.type.startsWith("image/"));
    const docs = list.filter((f) => !f.type.startsWith("image/"));
    if (docs.length > 0) {
      const metas = await uploadFilesToWorkspace(docs);
      setAttachedPaths((prev) => [...new Set([...prev, ...metas.map((m) => m.path)])]);
    }
    if (imgs.length > 0) {
      setAttachedImages((prev) => [...prev, ...imgs]);
    }
  };

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
              当前处于离线文档体验模式，连接 New-API 中转站或填入 API Key 后即可启用 AI 协同。
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[11px] font-medium text-[var(--text-primary)] transition cursor-pointer"
          >
            <Settings2 className="w-3 h-3 text-[var(--text-muted)]" />
            <span>配置连接</span>
          </button>
        </div>
      )}

      {/* 对话消息流 */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 min-h-0">
        {!session || session.messages.length === 0 ? (
          <div className="max-w-[760px] mx-auto pt-6 sm:pt-14">
            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-9 h-9 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-center text-[var(--text-primary)] mb-3">
                <PiMark className="w-5 h-5" />
              </div>
              <h1 className="text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">
                {config.brandName || "PiDesk"} · 本地三端 Office 工作台
              </h1>
              <p className="mt-1.5 text-[13px] text-[var(--text-muted)] max-w-lg leading-relaxed text-balance">
                直接读写、清洗与生成 Office 文档，所有更改实时同步右侧工作台。
              </p>
            </div>

            {/* 2×2 极简 1px 线框提示项 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {QUICK_STARTERS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => handleSend(item.prompt)}
                    className="text-left p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-surface)] hover:border-[var(--border-strong)] transition cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--text-primary)]">
                      <Icon
                        className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] shrink-0 transition"
                        strokeWidth={1.6}
                      />
                      <span className="truncate">{item.title}</span>
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
          {errorTip && (
            <div className="mb-2 px-3 py-1.5 rounded-md border border-[var(--border-hairline)] border-l-2 border-l-[var(--status-danger)] bg-[var(--bg-surface)] text-[12px] text-[var(--status-danger)] flex items-center justify-between gap-2">
              <span className="truncate">{errorTip}</span>
              <button
                type="button"
                onClick={() => setErrorTip(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {(activeSkill || attachedPaths.length > 0 || attachedImages.length > 0) && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
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
                    onClick={() => setAttachedPaths((prev) => prev.filter((x) => x !== p))}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {attachedImages.map((img, i) => (
                <span
                  key={`${img.name}_${i}`}
                  className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--text-secondary)]"
                >
                  <ImageIcon className="w-3 h-3 text-[var(--text-muted)]" />
                  <span>{img.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachedImages((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] focus-within:border-[var(--border-strong)] transition">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                isStreaming
                  ? "Agent 执行中：输入内容按 Enter 可随时插话引导 (Steer)..."
                  : "输入指令处理工作区文档，Shift + Enter 换行，支持拖拽文件..."
              }
              className="w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-[13.5px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none max-h-44"
            />
            <div className="flex items-center justify-between px-2.5 pb-2 pt-1 border-t border-[var(--border-hairline)]/60">
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
                  className="h-7 px-2 rounded-md inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition cursor-pointer"
                  title="附加 Word / Excel / PPT / PDF / 图片"
                >
                  <Paperclip className="w-3.5 h-3.5 text-[var(--text-muted)]" />
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
                    className="h-7 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-active)] text-[var(--status-danger)] inline-flex items-center gap-1.5 text-[12px] font-medium transition cursor-pointer"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span>停止</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  className="h-7 px-3 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-35 text-white inline-flex items-center gap-1.5 text-[12px] font-medium transition cursor-pointer"
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
