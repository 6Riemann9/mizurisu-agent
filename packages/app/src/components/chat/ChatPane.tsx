import {
  AlertCircle,
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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { BUILTIN_SKILLS } from "../../agent/skills";
import {
  DEFAULT_BRAND_NAME,
  classifyApiError,
  getMizurisuConsoleLinks,
} from "../../newapi/client";
import { useAppStore } from "../../store/useAppStore";
import type { SkillTemplate, WorkspaceFileMeta } from "../../types";
import { BrandLogo, FileIcon, formatFileSize } from "../common/FileBadge";
import { Button, Tooltip, cn } from "../ui";
import { ComposerControls } from "./ComposerControls";
import { MessageItem } from "./MessageItem";
import { TodoBoard } from "./TodoBoard";
import { TokenBurdenBar } from "./TokenBurdenBar";

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

type ComposerPopoverTrigger =
  | { kind: "file"; query: string; start: number; end: number; anchor: string }
  | { kind: "skill"; query: string; start: number; end: number; anchor: string };

/** 根据光标位置解析 @ 引用文件或 / 唤起技能的上下文触发器 */
function detectComposerTrigger(
  value: string,
  cursor: number
): ComposerPopoverTrigger | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, safeCursor);

  // 优先匹配光标前的 @查询片段（任意非空白非@字符）
  const atMatch = before.match(/@([^\s@]*)$/);
  if (atMatch && atMatch.index !== undefined) {
    return {
      kind: "file",
      query: atMatch[1],
      start: atMatch.index,
      end: safeCursor,
      anchor: `file:${atMatch.index}`,
    };
  }

  // 当输入处于首词 /命令阶段（以 / 开头且无空白）时触发技能列表
  const slashMatch = before.match(/^\/([^\s]*)$/);
  if (slashMatch) {
    return {
      kind: "skill",
      query: slashMatch[1],
      start: 0,
      end: safeCursor,
      anchor: "skill:0",
    };
  }

  return null;
}

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
    files,
    customSkills,
    activeSkillId,
    composerDraft,
    sendMessage,
    abortRun,
    uploadFilesToWorkspace,
    setActiveSkill,
    setSettingsOpen,
    dismissOnboarding,
    clearComposerDraft,
    pushToast,
  } = useAppStore();

  const [input, setInput] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [dismissedAnchor, setDismissedAnchor] = useState<string | null>(null);
  const [popoverIndex, setPopoverIndex] = useState(0);
  const [attachedPaths, setAttachedPaths] = useState<string[]>([]);
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<Array<{ file: File; url: string }>>([]);
  const [errorTip, setErrorTip] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const popoverListRef = useRef<HTMLDivElement>(null);

  const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const allSkills = useMemo(
    () => [...BUILTIN_SKILLS, ...customSkills],
    [customSkills]
  );
  const activeSkill = allSkills.find((s) => s.id === activeSkillId);

  const focusTextareaAt = useCallback((pos?: number) => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      if (typeof pos === "number") {
        const clamped = Math.max(0, Math.min(pos, el.value.length));
        el.setSelectionRange(clamped, clamped);
      }
    });
  }, []);

  // 响应全局 `/` 聚焦工作区输入快捷键事件
  useEffect(() => {
    const onFocusComposer = () => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
      setCursorPos(end);
    };
    window.addEventListener("mizurisu:focus-composer", onFocusComposer);
    return () => window.removeEventListener("mizurisu:focus-composer", onFocusComposer);
  }, []);

  useEffect(() => {
    if (draftExternal) {
      setInput(draftExternal);
      setCursorPos(draftExternal.length);
      setDismissedAnchor(null);
      onClearExternalDraft?.();
      focusTextareaAt(draftExternal.length);
    }
  }, [draftExternal, onClearExternalDraft, focusTextareaAt]);

  useEffect(() => {
    if (composerDraft) {
      setInput(composerDraft);
      setCursorPos(composerDraft.length);
      setDismissedAnchor(null);
      clearComposerDraft();
      focusTextareaAt(composerDraft.length);
    }
  }, [composerDraft, clearComposerDraft, focusTextareaAt]);

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

  // 解析当前光标所处的 @ / / 上下文浮层
  const rawTrigger = useMemo(
    () => detectComposerTrigger(input, cursorPos),
    [input, cursorPos]
  );

  const activeTrigger =
    rawTrigger && rawTrigger.anchor !== dismissedAnchor ? rawTrigger : null;

  // 若光标离开已忽略的触发点，重置忽略状态以便下次继续触发
  useEffect(() => {
    if (dismissedAnchor && (!rawTrigger || rawTrigger.anchor !== dismissedAnchor)) {
      setDismissedAnchor(null);
    }
  }, [rawTrigger, dismissedAnchor]);

  // 根据浮层类型筛选工作区文件或办公技能
  const filteredFiles = useMemo<WorkspaceFileMeta[]>(() => {
    if (!activeTrigger || activeTrigger.kind !== "file") return [];
    const q = activeTrigger.query.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) =>
        f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
  }, [activeTrigger, files]);

  const filteredSkills = useMemo<SkillTemplate[]>(() => {
    if (!activeTrigger || activeTrigger.kind !== "skill") return [];
    const q = activeTrigger.query.trim().toLowerCase();
    if (!q) return allSkills;
    return allSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
    );
  }, [activeTrigger, allSkills]);

  const popoverCount =
    activeTrigger?.kind === "file"
      ? filteredFiles.length
      : activeTrigger?.kind === "skill"
        ? filteredSkills.length
        : 0;

  const clampedPopoverIndex =
    popoverCount === 0 ? 0 : Math.min(popoverIndex, popoverCount - 1);

  // 键盘切换高亮项时自动滚动到可视区域内
  useEffect(() => {
    if (!activeTrigger || !popoverListRef.current) return;
    const activeEl = popoverListRef.current.querySelector<HTMLElement>(
      `[data-popover-idx="${clampedPopoverIndex}"]`
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeTrigger, clampedPopoverIndex]);

  // 点击输入工作台外部时收起 @ / / 浮层
  useEffect(() => {
    if (!activeTrigger) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (composerRef.current && !composerRef.current.contains(e.target as Node)) {
        setDismissedAnchor(activeTrigger.anchor);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [activeTrigger]);

  const canSend = Boolean(
    input.trim() || attachedImages.length > 0 || attachedPaths.length > 0
  );

  const handleSelectFileItem = useCallback(
    (file: WorkspaceFileMeta) => {
      if (!activeTrigger || activeTrigger.kind !== "file") return;
      setAttachedPaths((prev) =>
        prev.includes(file.path) ? prev : [...prev, file.path]
      );
      const nextInput =
        input.slice(0, activeTrigger.start) + input.slice(activeTrigger.end);
      setInput(nextInput);
      setCursorPos(activeTrigger.start);
      setPopoverIndex(0);
      setDismissedAnchor(null);
      focusTextareaAt(activeTrigger.start);
    },
    [activeTrigger, input, focusTextareaAt]
  );

  const handleSelectSkillItem = useCallback(
    (skill: SkillTemplate) => {
      if (!activeTrigger || activeTrigger.kind !== "skill") return;
      setActiveSkill(skill.id);
      const tail = input.slice(activeTrigger.end);
      const cleanedTail = activeTrigger.start === 0 ? tail.replace(/^\s+/, "") : tail;
      const nextInput = input.slice(0, activeTrigger.start) + cleanedTail;
      setInput(nextInput);
      setCursorPos(activeTrigger.start);
      setPopoverIndex(0);
      setDismissedAnchor(null);
      focusTextareaAt(activeTrigger.start);
    },
    [activeTrigger, input, setActiveSkill, focusTextareaAt]
  );

  const handleInsertAtTrigger = () => {
    const el = textareaRef.current;
    const start = el ? el.selectionStart : input.length;
    const end = el ? el.selectionEnd : input.length;
    setDismissedAnchor(null);
    setPopoverIndex(0);

    // 若光标前已是 @ 触发态，仅聚焦唤起列表而不重复插入
    if (start === end && start > 0 && input[start - 1] === "@") {
      setCursorPos(start);
      focusTextareaAt(start);
      return;
    }

    const nextInput = `${input.slice(0, start)}@${input.slice(end)}`;
    const nextPos = start + 1;
    setInput(nextInput);
    setCursorPos(nextPos);
    focusTextareaAt(nextPos);
  };

  const handleInsertSlashTrigger = () => {
    setDismissedAnchor(null);
    setPopoverIndex(0);

    // 若当前已在首词 / 命令阶段，直接聚焦并将光标移至命令片段末尾
    if (/^\/[^\s]*$/.test(input)) {
      setCursorPos(input.length);
      focusTextareaAt(input.length);
      return;
    }

    if (input.startsWith("/")) {
      const firstSpace = input.search(/\s/);
      const endPos = firstSpace >= 0 ? firstSpace : input.length;
      setCursorPos(endPos);
      focusTextareaAt(endPos);
      return;
    }

    const nextInput = `/${input}`;
    setInput(nextInput);
    setCursorPos(1);
    focusTextareaAt(1);
  };

  const handleSend = async (customText?: string) => {
    const text = (customText ?? input).trim();
    const paths = [...attachedPaths];
    const imgs = [...attachedImages];
    if (!text && paths.length === 0 && imgs.length === 0) return;

    setErrorTip(null);
    if (!customText) {
      setInput("");
      setCursorPos(0);
      setDismissedAnchor(null);
      setPopoverIndex(0);
    }
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

  const handleTextareaKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }

    // 当 @ 文件或 / 技能浮层处于打开态时，优先接管导航与确认按键，绝不误发送消息
    if (activeTrigger) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (popoverCount > 0) {
          setPopoverIndex((clampedPopoverIndex + 1) % popoverCount);
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (popoverCount > 0) {
          setPopoverIndex((clampedPopoverIndex - 1 + popoverCount) % popoverCount);
        }
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (activeTrigger.kind === "file" && filteredFiles[clampedPopoverIndex]) {
          handleSelectFileItem(filteredFiles[clampedPopoverIndex]);
        } else if (
          activeTrigger.kind === "skill" &&
          filteredSkills[clampedPopoverIndex]
        ) {
          handleSelectSkillItem(filteredSkills[clampedPopoverIndex]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDismissedAnchor(activeTrigger.anchor);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        handleSend();
      }
    }
  };

  const syncCursorFromTarget = (el: HTMLTextAreaElement) => {
    setCursorPos(el.selectionStart ?? el.value.length);
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
        <div className="absolute inset-3 z-30 rounded-lg border border-dashed border-[var(--accent)] bg-[var(--bg-surface)]/95 flex items-center justify-center text-[13px] font-linear-medium text-[var(--text-primary)] pointer-events-none">
          松开即可导入文件到工作区并附带至对话
        </div>
      )}

      {/* 未配置 Key 单行极薄离线提示条 */}
      {(!config.baseUrl || !config.apiKey) && (
        <div className="px-4 py-1.5 border-b border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex items-center justify-between gap-3 text-[12px] shrink-0">
          <div className="flex items-center gap-2 min-w-0 text-[var(--text-secondary)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-warning)] shrink-0" />
            <span className="truncate">
              当前处于离线文档体验模式，连接 Mizurisu / 模型中转服务或填入 API Key 后即可启用 AI 协同。
            </span>
          </div>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="w-3 h-3 text-[var(--text-muted)]" />
            <span>配置连接</span>
          </Button>
        </div>
      )}

      {/* 对话消息流 / 克制办公启动台 */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 min-h-0">
        {!session || session.messages.length === 0 ? (
          <div className="@container max-w-[760px] mx-auto pt-4 sm:pt-8 space-y-6">
            {/* 沉静工作台主标头（去堆叠边框盒） */}
            <div className="flex flex-col items-center text-center">
              <BrandLogo className="w-8 h-8 rounded-lg mb-3" />
              <h1 className="text-[16px] font-linear-semibold tracking-tight text-[var(--text-primary)]">
                {config.brandName || DEFAULT_BRAND_NAME} · 智能办公工作台
              </h1>
              <p className="mt-1.5 text-[13px] text-[var(--text-muted)] max-w-md leading-relaxed text-balance">
                直接读写、清洗与生成 Excel / Word / PPT / PDF 文档，所有改动实时同步右侧工作台。
              </p>
              <div className="mt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => attachRef.current?.click()}
                >
                  <Upload className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  <span>上传本地文档</span>
                </Button>
              </div>
            </div>

            {/* 极轻单行三步流程提示（无重边框，可一键关闭） */}
            {!settings.onboardingDismissed && (
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--text-muted)]">
                <span className="tabular-nums">1. 上传文档</span>
                <span aria-hidden="true" className="opacity-45">
                  ·
                </span>
                <span className="tabular-nums">2. 选场景或用 @ / 提问</span>
                <span aria-hidden="true" className="opacity-45">
                  ·
                </span>
                <span className="tabular-nums">3. 右侧实时预览导出</span>
                <Tooltip content="不再显示此指引" side="top">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => dismissOnboarding()}
                    aria-label="关闭使用指引"
                    className="size-5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </Tooltip>
              </div>
            )}

            {/* 2×2 克制高价值场景卡片（基于容器宽度自适应不截断） */}
            <div className="grid grid-cols-1 @[520px]:grid-cols-2 gap-2.5">
              {QUICK_STARTERS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => handleSend(item.prompt)}
                    className="min-w-0 text-left p-3.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-subtle)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] transition-[background-color,border-color] duration-150 cursor-pointer group linear-focus-ring"
                  >
                    <div className="flex items-start gap-2 text-[13px] font-linear-medium text-[var(--text-primary)]">
                      <Icon
                        className="w-3.5 h-3.5 mt-0.5 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] shrink-0 transition-colors"
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

      {/* 底部 Linear Composer 工作台 */}
      <div className="px-4 sm:px-6 pb-4 pt-1 shrink-0">
        <div className="max-w-[760px] mx-auto">
          <TodoBoard todos={session?.todos} />
          <TokenBurdenBar />
          {errorTip && errorDiagnosis && (
            <div className="mb-2 px-3 py-2.5 rounded-md border border-[var(--border-hairline)] border-l-2 border-l-[var(--status-danger)] bg-[var(--bg-surface)] text-[12px] space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
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
                <Tooltip content="关闭错误提示" side="top">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setErrorTip(null)}
                    aria-label="关闭错误提示"
                    className="size-5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </Tooltip>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-5 text-[11px]">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings2 className="w-3 h-3 text-[var(--text-muted)]" />
                  <span>打开设置</span>
                </Button>
                <a
                  href={consoleLinks.topupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-[5px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] text-[11px] font-linear-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition linear-focus-ring"
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
                    >
                      <Tooltip content={item.file.name} side="top">
                        <img
                          src={item.url}
                          alt={item.file.name}
                          className="w-full h-full object-cover"
                        />
                      </Tooltip>
                      <Tooltip content={`移除图片 ${item.file.name}`} side="top">
                        <button
                          type="button"
                          onClick={() =>
                            setAttachedImages((prev) => prev.filter((_, idx) => idx !== i))
                          }
                          aria-label={`移除图片 ${item.file.name}`}
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/75 text-white flex items-center justify-center opacity-85 hover:opacity-100 transition cursor-pointer linear-focus-ring"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              )}

              {(activeSkill || attachedPaths.length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {activeSkill && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md border border-[var(--border-strong)] bg-[var(--accent-soft)] text-[var(--text-primary)]">
                      <Wand2 className="w-3 h-3 text-[var(--accent)]" />
                      <span className="font-linear-medium">{activeSkill.name}</span>
                      <Tooltip content="取消挂载技能" side="top">
                        <button
                          type="button"
                          onClick={() => setActiveSkill(undefined)}
                          aria-label={`取消挂载技能 ${activeSkill.name}`}
                          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer linear-focus-ring rounded"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Tooltip>
                    </span>
                  )}
                  {attachedPaths.map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--text-secondary)]"
                    >
                      <FileText className="w-3 h-3 text-[var(--text-muted)]" />
                      <span className="font-mono">{p}</span>
                      <Tooltip content={`移除附件 ${p}`} side="top">
                        <button
                          type="button"
                          onClick={() =>
                            setAttachedPaths((prev) => prev.filter((x) => x !== p))
                          }
                          aria-label={`移除附件 ${p}`}
                          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer linear-focus-ring rounded"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Tooltip>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Composer 输入框主体与上下文浮层宿主 */}
          <div
            ref={composerRef}
            className="relative rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] focus-within:border-[var(--border-strong)] focus-within:shadow-[var(--ring-focus)] transition-[border-color,box-shadow] duration-150"
          >
            {/* @ 引用工作区文件 / / 唤起办公技能 上浮面板 */}
            {activeTrigger && (
              <div
                role="listbox"
                aria-label={
                  activeTrigger.kind === "file"
                    ? "引用工作区文件"
                    : "选择办公技能"
                }
                className="absolute left-0 right-0 bottom-full mb-1.5 z-40 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-popover)] overflow-hidden"
              >
                <div className="px-2.5 py-1.5 border-b border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                  <span className="font-linear-medium text-[var(--text-secondary)]">
                    {activeTrigger.kind === "file"
                      ? "引用工作区文件"
                      : "选择办公技能"}
                  </span>
                  <span className="hidden sm:inline tabular-nums">
                    ↑↓ 选择 · Enter/Tab 确认 · Esc 关闭
                  </span>
                </div>

                <div
                  ref={popoverListRef}
                  className="max-h-56 overflow-y-auto p-1 space-y-0.5"
                >
                  {activeTrigger.kind === "file" ? (
                    filteredFiles.length === 0 ? (
                      <div className="py-5 text-center text-[12px] text-[var(--text-muted)]">
                        {files.length === 0
                          ? "工作区暂无文件，可拖拽或点击下方附件按钮上传"
                          : "未匹配到符合条件的工作区文件"}
                      </div>
                    ) : (
                      filteredFiles.map((file, idx) => {
                        const selected = idx === clampedPopoverIndex;
                        const attached = attachedPaths.includes(file.path);
                        return (
                          <button
                            key={file.path}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            data-popover-idx={idx}
                            onMouseEnter={() => setPopoverIndex(idx)}
                            onMouseDown={(e) => {
                              // 阻止输入框失焦闪烁，直接完成选文件插入
                              e.preventDefault();
                              handleSelectFileItem(file);
                            }}
                            className={cn(
                              "w-full h-7 px-2 rounded-md flex items-center justify-between gap-2 text-left text-[12px] transition-colors cursor-pointer",
                              selected
                                ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                            )}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <FileIcon
                                category={file.category}
                                className="w-3.5 h-3.5 shrink-0"
                              />
                              <span className="font-mono truncate font-linear-medium text-[var(--text-primary)]">
                                {file.name}
                              </span>
                              {file.path !== file.name && (
                                <span className="font-mono text-[10.5px] text-[var(--text-muted)] truncate">
                                  {file.path}
                                </span>
                              )}
                            </span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              {attached && (
                                <span className="text-[10px] px-1.5 py-px rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                                  已附加
                                </span>
                              )}
                              <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
                                {formatFileSize(file.size)}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )
                  ) : filteredSkills.length === 0 ? (
                    <div className="py-5 text-center text-[12px] text-[var(--text-muted)]">
                      未匹配到办公技能，按 Esc 关闭后可直接输入提问
                    </div>
                  ) : (
                    filteredSkills.map((skill, idx) => {
                      const selected = idx === clampedPopoverIndex;
                      const mounted = skill.id === activeSkillId;
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          data-popover-idx={idx}
                          onMouseEnter={() => setPopoverIndex(idx)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleSelectSkillItem(skill);
                          }}
                          className={cn(
                            "w-full min-h-[28px] px-2 py-1 rounded-md flex items-center justify-between gap-2 text-left text-[12px] transition-colors cursor-pointer",
                            selected
                              ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                          )}
                        >
                          <span className="flex items-center gap-2 min-w-0 flex-1">
                            <Wand2
                              className={cn(
                                "w-3.5 h-3.5 shrink-0",
                                selected || mounted
                                  ? "text-[var(--accent)]"
                                  : "text-[var(--text-muted)]"
                              )}
                            />
                            <span className="font-linear-medium text-[var(--text-primary)] shrink-0">
                              {skill.name}
                            </span>
                            <span className="text-[11px] text-[var(--text-muted)] truncate">
                              {skill.description}
                            </span>
                          </span>
                          {mounted && (
                            <span className="text-[10px] px-1.5 py-px rounded border border-[var(--accent)]/35 bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
                              已挂载
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setPopoverIndex(0);
                syncCursorFromTarget(e.currentTarget);
              }}
              onClick={(e) => syncCursorFromTarget(e.currentTarget)}
              onKeyUp={(e) => {
                if (
                  e.key === "ArrowLeft" ||
                  e.key === "ArrowRight" ||
                  e.key === "Home" ||
                  e.key === "End"
                ) {
                  syncCursorFromTarget(e.currentTarget);
                }
              }}
              onSelect={(e) => syncCursorFromTarget(e.currentTarget)}
              onPaste={handlePaste}
              onKeyDown={handleTextareaKeyDown}
              placeholder={
                isStreaming
                  ? "Agent 执行中：输入内容按 Enter 可随时插话引导 (Steer)..."
                  : "输入指令处理文档，输入 @ 引用文件或 / 唤起办公技能，Shift + Enter 换行..."
              }
              className="w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-[13.5px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none max-h-44"
            />

            {/* 底部控制栏：左侧模型/思考微胶囊 + 附件/@// 按钮，右侧停止与发送 */}
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1.5 border-t border-[var(--border-hairline)]/60 flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-1 min-w-0">
                <ComposerControls />

                <span className="h-3.5 w-px bg-[var(--border-hairline)] mx-0.5 hidden sm:block shrink-0" />

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

                <Tooltip content="附加 Word / Excel / PPT / PDF / 图片" side="top">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => attachRef.current?.click()}
                    aria-label="附加工作区文档或图片"
                    className="h-6 px-1.5 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <Paperclip className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    <span className="hidden lg:inline">附件</span>
                  </Button>
                </Tooltip>

                <Tooltip content="引用工作区文件" shortcut="@" side="top">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleInsertAtTrigger}
                    aria-label="插入 @ 引用工作区文件"
                    className="h-6 min-w-6 px-1.5 rounded-md font-mono text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    @
                  </Button>
                </Tooltip>

                <Tooltip content="唤起办公技能" shortcut="/" side="top">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleInsertSlashTrigger}
                    aria-label="填入 / 唤起办公技能"
                    className="h-6 min-w-6 px-1.5 rounded-md font-mono text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    /
                  </Button>
                </Tooltip>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                {isStreaming && (
                  <Tooltip content="立即中止当前生成" side="top">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => abortRun()}
                    >
                      <Square className="w-3 h-3 fill-current" />
                      <span>停止</span>
                    </Button>
                  </Tooltip>
                )}

                <Tooltip
                  content={isStreaming ? "发送插话引导" : "发送指令"}
                  shortcut="Enter"
                  side="top"
                >
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSend()}
                    disabled={!canSend}
                  >
                    <Send className="w-3 h-3" />
                    <span>{isStreaming ? "插话引导" : "发送"}</span>
                    <span
                      aria-hidden="true"
                      className="hidden sm:inline text-[10px] font-mono opacity-65 leading-none"
                    >
                      ↵
                    </span>
                  </Button>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
