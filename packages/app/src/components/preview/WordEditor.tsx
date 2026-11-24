import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table/kit";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style/text-style-kit";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  EditorContent,
  Extension,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ChevronUp,
  FileDown,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Palette,
  PanelLeft,
  Plus,
  Quote,
  Redo2,
  Save,
  Search,
  Strikethrough,
  Table2,
  Trash,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPdfDocument } from "../../office/pdf";
import {
  tiptapJsonToPdfSpec,
  tiptapJsonToWordBytes,
  wordBytesToEditorHtml,
} from "../../office/word-editor-bridge";
import { workspaceVfs } from "../../storage/workspace-vfs";
import { useAppStore } from "../../store/useAppStore";

/** 预设商务文字颜色选项 */
const TEXT_COLOR_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "深石板", value: "#1E293B" },
  { label: "品牌靛蓝", value: "#4F46E5" },
  { label: "商务蓝", value: "#2563EB" },
  { label: "翡翠绿", value: "#059669" },
  { label: "琥珀橙", value: "#D97706" },
  { label: "警示红", value: "#DC2626" },
  { label: "紫罗兰", value: "#7C3AED" },
  { label: "沉稳灰", value: "#64748B" },
];

/** 预设荧光高亮色选项 */
const HIGHLIGHT_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "亮黄", value: "#fef08a" },
  { label: "嫩绿", value: "#bbf7d0" },
  { label: "天青", value: "#a5f3fc" },
  { label: "淡蓝", value: "#bfdbfe" },
  { label: "粉红", value: "#fbcfe8" },
  { label: "浅红", value: "#fecaca" },
];

/** 文档大纲标题节点 */
interface OutlineHeadingItem {
  id: string;
  level: 1 | 2 | 3;
  text: string;
  pos: number;
}

/** 文档底部统计指标 */
interface WordDocumentStats {
  words: number;
  charsNoSpace: number;
  paragraphs: number;
}

/** 搜索匹配范围 */
interface SearchMatchRange {
  from: number;
  to: number;
}

interface SearchPluginState {
  query: string;
  activeIndex: number;
  matches: SearchMatchRange[];
  decorations: DecorationSet;
}

const WORD_SEARCH_PLUGIN_KEY = new PluginKey<SearchPluginState>("wordSearchHighlight");
const WORD_SEARCH_META = "wordSearchUpdate";

/** 在 ProseMirror 文档树中收集所有与关键词匹配的非破坏性高亮区间 */
function findMatchesInProseMirrorDoc(
  doc: Editor["state"]["doc"],
  query: string
): SearchMatchRange[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const matches: SearchMatchRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;

    const segments: Array<{ startOffset: number; pmPos: number; text: string }> = [];
    let fullText = "";
    node.forEach((child, childOffset) => {
      if (child.isText && child.text) {
        segments.push({
          startOffset: fullText.length,
          pmPos: pos + 1 + childOffset,
          text: child.text,
        });
        fullText += child.text;
      } else if (child.type.name === "hardBreak") {
        fullText += "\n";
      } else if (child.isLeaf && child.isInline) {
        fullText += " ";
      }
    });

    if (!fullText) return false;

    const lowerText = fullText.toLowerCase();
    let searchFrom = 0;
    while (searchFrom < lowerText.length) {
      const hitIdx = lowerText.indexOf(normalizedQuery, searchFrom);
      if (hitIdx === -1) break;
      const hitEnd = hitIdx + normalizedQuery.length;

      // 将连续匹配区间精确映射回可能跨样式片段的 ProseMirror 文档位置
      let pmFrom = -1;
      let pmTo = -1;
      for (const seg of segments) {
        const segEnd = seg.startOffset + seg.text.length;
        if (segEnd <= hitIdx || seg.startOffset >= hitEnd) continue;
        const localStart = Math.max(0, hitIdx - seg.startOffset);
        const localEnd = Math.min(seg.text.length, hitEnd - seg.startOffset);
        if (pmFrom === -1) pmFrom = seg.pmPos + localStart;
        pmTo = seg.pmPos + localEnd;
      }

      if (pmFrom !== -1 && pmTo > pmFrom) {
        matches.push({ from: pmFrom, to: pmTo });
      }
      searchFrom = hitIdx + Math.max(1, normalizedQuery.length);
    }

    return false;
  });

  return matches;
}

/** 构建搜索高亮 DecorationSet */
function buildSearchDecorations(
  doc: Editor["state"]["doc"],
  matches: SearchMatchRange[],
  activeIndex: number
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  const decos = matches.map((m, idx) => {
    const isActive = idx === activeIndex;
    return Decoration.inline(m.from, m.to, {
      class: isActive
        ? "word-search-hit word-search-hit-active"
        : "word-search-hit",
    });
  });
  return DecorationSet.create(doc, decos);
}

/** 非破坏性查找高亮扩展（基于 ProseMirror Decoration，不影响文档 JSON 与撤销栈） */
const WordSearchHighlight = Extension.create({
  name: "wordSearchHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchPluginState>({
        key: WORD_SEARCH_PLUGIN_KEY,
        state: {
          init: () => ({
            query: "",
            activeIndex: 0,
            matches: [],
            decorations: DecorationSet.empty,
          }),
          apply: (tr, prev, _oldState, newState) => {
            const meta = tr.getMeta(WORD_SEARCH_META) as
              | { query?: string; activeIndex?: number }
              | undefined;
            if (!meta && !tr.docChanged) {
              return prev;
            }
            const nextQuery = meta?.query !== undefined ? meta.query : prev.query;
            const matches = nextQuery.trim()
              ? findMatchesInProseMirrorDoc(newState.doc, nextQuery)
              : [];
            const rawIdx =
              meta?.activeIndex !== undefined ? meta.activeIndex : prev.activeIndex;
            const activeIndex =
              matches.length === 0
                ? 0
                : ((rawIdx % matches.length) + matches.length) % matches.length;
            return {
              query: nextQuery,
              activeIndex,
              matches,
              decorations: buildSearchDecorations(newState.doc, matches, activeIndex),
            };
          },
        },
        props: {
          decorations(state) {
            return WORD_SEARCH_PLUGIN_KEY.getState(state)?.decorations ?? null;
          },
        },
      }),
    ];
  },
});

/** 比较两份二进制字节内容是否完全一致 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** 从文档树实时提取 H1/H2/H3 标题大纲 */
function extractOutlineHeadings(doc: Editor["state"]["doc"]): OutlineHeadingItem[] {
  const items: OutlineHeadingItem[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const rawLevel = Number(node.attrs?.level ?? 1);
      const level: 1 | 2 | 3 = rawLevel <= 1 ? 1 : rawLevel === 2 ? 2 : 3;
      const text = node.textContent.trim();
      if (text) {
        items.push({
          id: `h-${pos}`,
          level,
          text,
          pos,
        });
      }
    }
  });
  return items;
}

/** 计算中英文混排字数、非空白字符数与段落数 */
function computeDocumentStats(doc: Editor["state"]["doc"]): WordDocumentStats {
  let paragraphs = 0;
  const textParts: string[] = [];

  doc.descendants((node) => {
    if (node.isTextblock) {
      paragraphs += 1;
      textParts.push(node.textContent);
      return false;
    }
    return true;
  });

  const combined = textParts.join("\n");
  const charsNoSpace = combined.replace(/\s+/g, "").length;
  const cjkMatches = combined.match(
    /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g
  );
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkTokens = combined
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return {
    words: cjkCount + nonCjkTokens,
    charsNoSpace,
    paragraphs,
  };
}

/** 平滑滚动定位到 ProseMirror 指定位置对应的 DOM 元素 */
function scrollToEditorPos(editor: Editor, pos: number): void {
  try {
    const safePos = Math.max(0, Math.min(pos, editor.state.doc.content.size));
    const domInfo = editor.view.domAtPos(safePos);
    const target =
      domInfo.node instanceof HTMLElement
        ? domInfo.node
        : domInfo.node.parentElement;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } catch {
    // 忽略测试环境或已销毁视图的滚动异常
  }
}

/** 格式化保存时间 */
function formatSavedClock(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

/** 工具栏图标按钮通用样式 */
function toolbarButtonClass(active: boolean, disabled = false): string {
  const base =
    "h-6 min-w-6 px-1.5 inline-flex items-center justify-center gap-1 rounded-[4px] text-[11px] font-medium transition-colors select-none";
  if (disabled) {
    return `${base} text-[var(--text-muted)] opacity-40 cursor-not-allowed`;
  }
  if (active) {
    return `${base} bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/40 cursor-pointer`;
  }
  return `${base} text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent cursor-pointer`;
}

export function WordEditor({
  path,
  bytes,
}: {
  path: string;
  bytes: Uint8Array;
}) {
  const fileName = useMemo(() => path.split("/").pop() || path, [path]);

  const [loadingDoc, setLoadingDoc] = useState(true);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [outlineOpen, setOutlineOpen] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1180 : false
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [highlightMenuOpen, setHighlightMenuOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const colorMenuRef = useRef<HTMLDivElement>(null);
  const highlightMenuRef = useRef<HTMLDivElement>(null);

  // 用于区分自身防抖/手动保存引发的 bytes 回流与外部 AI Agent 更新（保留最近 5 次写回快照防并发回声）
  const lastSelfSavedRef = useRef<Uint8Array[]>([]);
  const prevPathRef = useRef<string | null>(null);
  const isHydratingRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const savingInFlightRef = useRef<Promise<void> | null>(null);
  const pendingResaveRef = useRef(false);
  const dirtyRef = useRef(false);
  const latestPathRef = useRef(path);
  const latestJsonRef = useRef<Record<string, unknown> | null>(null);
  const outlineAdjustedForPathRef = useRef<string | null>(null);

  latestPathRef.current = path;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
      }),
      TableKit.configure({
        table: { resizable: true },
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      TextStyleKit,
      Highlight.configure({
        multicolor: true,
      }),
      WordSearchHighlight,
    ],
    content: "<p></p>",
    editorProps: {
      attributes: {
        class: "outline-none",
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (isHydratingRef.current) return;
      latestJsonRef.current = ed.getJSON() as Record<string, unknown>;
      dirtyRef.current = true;
      setSaveState("unsaved");

      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = window.setTimeout(() => {
        autoSaveTimerRef.current = null;
        void performSaveRef.current("auto");
      }, 1200);
    },
  });

  /** 将指定 JSON 文档打包为 .docx 并写入工作区 VFS */
  const writeDocJsonToVfs = useCallback(
    async (
      targetPath: string,
      json: Record<string, unknown>,
      source: "auto" | "manual"
    ) => {
      const targetName = targetPath.split("/").pop() || targetPath;
      const stem = targetName.replace(/\.docx?$/i, "") || targetName;
      const nextBytes = await tiptapJsonToWordBytes(json, {
        title: stem,
        headerText: targetName,
      });

      // 在写入前登记指纹，防止 VFS 广播触发的 bytes 更新误判为外部修改
      lastSelfSavedRef.current = [...lastSelfSavedRef.current.slice(-4), nextBytes];
      await workspaceVfs.writeBytes(targetPath, nextBytes, {
        snapshotNote: "Word 文档编辑保存",
      });

      if (source === "manual") {
        useAppStore.getState().pushToast(`已保存 Word 文档：${targetName}`, "success");
      }
    },
    []
  );

  const performSave = useCallback(
    async (source: "auto" | "manual") => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }

      if (!editor || editor.isDestroyed) return;
      if (source === "auto" && !dirtyRef.current) return;

      if (savingInFlightRef.current) {
        pendingResaveRef.current = true;
        await savingInFlightRef.current;
        if (pendingResaveRef.current) {
          pendingResaveRef.current = false;
          await performSave(source);
        }
        return;
      }

      const targetPath = latestPathRef.current;
      const snapshotJson = editor.getJSON() as Record<string, unknown>;
      latestJsonRef.current = snapshotJson;
      dirtyRef.current = false;
      setSaveState("saving");

      const task = (async () => {
        try {
          await writeDocJsonToVfs(targetPath, snapshotJson, source);
          if (latestPathRef.current === targetPath) {
            if (dirtyRef.current) {
              setSaveState("unsaved");
            } else {
              setSaveState("saved");
              setLastSavedAt(Date.now());
            }
          }
        } catch (err) {
          dirtyRef.current = true;
          setSaveState("error");
          if (source === "manual") {
            useAppStore
              .getState()
              .pushToast(
                `保存 Word 文档失败：${
                  err instanceof Error ? err.message : String(err)
                }`,
                "error"
              );
          }
        } finally {
          savingInFlightRef.current = null;
        }
      })();

      savingInFlightRef.current = task;
      await task;
    },
    [editor, writeDocJsonToVfs]
  );

  const performSaveRef = useRef(performSave);
  performSaveRef.current = performSave;

  // 根据容器实际宽度自适应初始化大纲面板开关，避免窄分栏挤压正文纸张
  useEffect(() => {
    if (outlineAdjustedForPathRef.current === path) return;
    outlineAdjustedForPathRef.current = path;
    const width = rootRef.current?.clientWidth ?? 0;
    if (width > 0) {
      setOutlineOpen(width >= 780);
    }
  }, [path]);

  // 初次加载与外部修改热刷新（跳过自身保存导致的 bytes 更新）
  useEffect(() => {
    if (!editor) return;

    const isSamePath = prevPathRef.current === path;
    if (
      isSamePath &&
      lastSelfSavedRef.current.some((saved) => bytesEqual(bytes, saved))
    ) {
      return;
    }

    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    const isInitialForPath = !isSamePath;
    prevPathRef.current = path;

    let cancelled = false;
    (async () => {
      try {
        if (isInitialForPath) {
          setLoadingDoc(true);
        }
        setParseError(null);
        const html = await wordBytesToEditorHtml(bytes);
        if (cancelled || editor.isDestroyed) return;

        isHydratingRef.current = true;
        try {
          editor.commands.setContent(html, { emitUpdate: false });
        } finally {
          isHydratingRef.current = false;
        }

        lastSelfSavedRef.current = [];
        latestJsonRef.current = editor.getJSON() as Record<string, unknown>;
        dirtyRef.current = false;
        setSaveState("saved");
        setLastSavedAt(Date.now());
      } catch (err) {
        if (!cancelled) {
          setParseError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoadingDoc(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editor, path, bytes]);

  // 组件卸载或切换路径前若仍有未落盘防抖修改，立即兜底写回一次防止丢字
  useEffect(() => {
    const boundPath = path;
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (dirtyRef.current && latestJsonRef.current) {
        const jsonToFlush = latestJsonRef.current;
        dirtyRef.current = false;
        void writeDocJsonToVfs(boundPath, jsonToFlush, "auto").catch(() => undefined);
      }
    };
  }, [path, writeDocJsonToVfs]);

  // 同步查找关键字到 ProseMirror 装饰插件
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const nextQuery = searchOpen ? searchQuery : "";
    const tr = editor.state.tr.setMeta(WORD_SEARCH_META, {
      query: nextQuery,
      activeIndex: 0,
    });
    editor.view.dispatch(tr);
  }, [editor, searchOpen, searchQuery]);

  // 订阅工具栏激活状态、大纲、统计与搜索命中数
  const uiState = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) {
        return {
          canUndo: false,
          canRedo: false,
          headingLevel: 0 as 0 | 1 | 2 | 3,
          isBold: false,
          isItalic: false,
          isUnderline: false,
          isStrike: false,
          currentColor: "",
          isHighlight: false,
          currentHighlight: "",
          textAlign: "left" as "left" | "center" | "right",
          isBulletList: false,
          isOrderedList: false,
          isBlockquote: false,
          isInTable: false,
          headings: [] as OutlineHeadingItem[],
          stats: { words: 0, charsNoSpace: 0, paragraphs: 0 } as WordDocumentStats,
          searchTotal: 0,
          searchActiveIdx: 0,
        };
      }
      const searchPlugin = WORD_SEARCH_PLUGIN_KEY.getState(ed.state);
      return {
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo(),
        headingLevel: (ed.isActive("heading", { level: 1 })
          ? 1
          : ed.isActive("heading", { level: 2 })
            ? 2
            : ed.isActive("heading", { level: 3 })
              ? 3
              : 0) as 0 | 1 | 2 | 3,
        isBold: ed.isActive("bold"),
        isItalic: ed.isActive("italic"),
        isUnderline: ed.isActive("underline"),
        isStrike: ed.isActive("strike"),
        currentColor: String(ed.getAttributes("textStyle")?.color || ""),
        isHighlight: ed.isActive("highlight"),
        currentHighlight: String(ed.getAttributes("highlight")?.color || ""),
        textAlign: (ed.isActive({ textAlign: "center" })
          ? "center"
          : ed.isActive({ textAlign: "right" })
            ? "right"
            : "left") as "left" | "center" | "right",
        isBulletList: ed.isActive("bulletList"),
        isOrderedList: ed.isActive("orderedList"),
        isBlockquote: ed.isActive("blockquote"),
        isInTable: ed.isActive("table"),
        headings: extractOutlineHeadings(ed.state.doc),
        stats: computeDocumentStats(ed.state.doc),
        searchTotal: searchPlugin?.matches.length ?? 0,
        searchActiveIdx: searchPlugin?.activeIndex ?? 0,
      };
    },
  });

  // 外部点击或 Esc 关闭颜色/高亮浮层
  useEffect(() => {
    if (!colorMenuOpen && !highlightMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (colorMenuOpen && colorMenuRef.current && !colorMenuRef.current.contains(target)) {
        setColorMenuOpen(false);
      }
      if (
        highlightMenuOpen &&
        highlightMenuRef.current &&
        !highlightMenuRef.current.contains(target)
      ) {
        setHighlightMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setColorMenuOpen(false);
        setHighlightMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [colorMenuOpen, highlightMenuOpen]);

  // 快捷键 Ctrl/Cmd+S 立即保存 与 Ctrl/Cmd+F 开关查找面板
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const active = document.activeElement;
      const insideEditor = Boolean(
        rootRef.current && active && rootRef.current.contains(active)
      );

      if (key === "s") {
        const focusedOtherInput =
          !insideEditor &&
          (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement);
        if (insideEditor || (dirtyRef.current && !focusedOtherInput)) {
          e.preventDefault();
          void performSave("manual");
        }
        return;
      }

      if (key === "f" && insideEditor) {
        e.preventDefault();
        setSearchOpen(true);
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [performSave]);

  /** 跳转至上一个或下一个搜索匹配项 */
  const navigateSearchMatch = useCallback(
    (delta: 1 | -1) => {
      if (!editor || editor.isDestroyed) return;
      const pluginState = WORD_SEARCH_PLUGIN_KEY.getState(editor.state);
      if (!pluginState || pluginState.matches.length === 0) return;

      const total = pluginState.matches.length;
      const nextIdx = (pluginState.activeIndex + delta + total) % total;
      const targetMatch = pluginState.matches[nextIdx];

      editor.view.dispatch(
        editor.state.tr.setMeta(WORD_SEARCH_META, {
          query: pluginState.query,
          activeIndex: nextIdx,
        })
      );
      if (targetMatch) {
        scrollToEditorPos(editor, targetMatch.from);
      }
    },
    [editor]
  );

  /** 当搜索关键词变化且存在命中项时自动滚动到首个命中处 */
  useEffect(() => {
    if (!editor || !searchOpen || !searchQuery.trim()) return;
    const pluginState = WORD_SEARCH_PLUGIN_KEY.getState(editor.state);
    const first = pluginState?.matches[0];
    if (first) {
      scrollToEditorPos(editor, first.from);
    }
  }, [editor, searchOpen, searchQuery]);

  /** 导出 PDF 并保存到工作区 */
  const handleExportPdf = useCallback(async () => {
    if (!editor || editor.isDestroyed || exportingPdf) return;
    setExportingPdf(true);
    try {
      const json = editor.getJSON() as Record<string, unknown>;
      const stem = path.replace(/\.docx?$/i, "") || path;
      const fallbackTitle = (stem.split("/").pop() || stem).trim() || "Word 文档";
      let targetPdfPath = `${stem}.pdf`;

      if (await workspaceVfs.exists(targetPdfPath)) {
        const shouldOverwrite =
          typeof window !== "undefined" && typeof window.confirm === "function"
            ? window.confirm(
                `工作区已存在「${targetPdfPath}」，是否覆盖原文件？\n点击“取消”将自动另存为带序号的新版本 PDF。`
              )
            : true;
        if (!shouldOverwrite) {
          let idx = 2;
          while (idx < 1000) {
            const candidate = `${stem} (${idx}).pdf`;
            if (!(await workspaceVfs.exists(candidate))) {
              targetPdfPath = candidate;
              break;
            }
            idx += 1;
          }
        }
      }

      const pdfSpec = tiptapJsonToPdfSpec(json, fallbackTitle);
      const pdfBytes = await createPdfDocument(pdfSpec);
      await workspaceVfs.writeBytes(targetPdfPath, pdfBytes, {
        snapshotNote: `由 ${fileName} 导出 PDF`,
      });
      useAppStore
        .getState()
        .pushToast(`已导出 PDF 至工作区：${targetPdfPath}`, "success");
    } catch (err) {
      useAppStore
        .getState()
        .pushToast(
          `导出 PDF 失败：${err instanceof Error ? err.message : String(err)}`,
          "error"
        );
    } finally {
      setExportingPdf(false);
    }
  }, [editor, exportingPdf, fileName, path]);

  const statusText = useMemo(() => {
    if (saveState === "saving") return "正在保存…";
    if (saveState === "unsaved") return "有未保存修改（自动保存中）";
    if (saveState === "error") return "保存失败，请点击重试";
    return lastSavedAt ? `已保存 ${formatSavedClock(lastSavedAt)}` : "已保存";
  }, [lastSavedAt, saveState]);

  if (parseError) {
    return (
      <div className="p-4 m-4 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-xs text-[var(--status-danger)]">
        Word 文档编辑载入失败：{parseError}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="flex flex-col h-full min-h-0 bg-[var(--bg-canvas)] outline-none"
    >
      {/* 顶部专业富文本工具栏（flex-wrap 自适应，绝不重叠） */}
      <div className="shrink-0 px-2.5 py-1.5 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex flex-wrap items-center gap-x-1 gap-y-1 text-xs select-none">
        {/* 撤销 / 重做 */}
        <div className="inline-flex items-center gap-0.5 pr-1.5 mr-0.5 border-r border-[var(--border-hairline)]">
          <button
            type="button"
            disabled={!uiState?.canUndo}
            onClick={() => editor?.chain().focus().undo().run()}
            className={toolbarButtonClass(false, !uiState?.canUndo)}
            title="撤销 (Ctrl/Cmd+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!uiState?.canRedo}
            onClick={() => editor?.chain().focus().redo().run()}
            className={toolbarButtonClass(false, !uiState?.canRedo)}
            title="重做 (Ctrl/Cmd+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 段落样式：正文 / H1 / H2 / H3 */}
        <div className="inline-flex items-center gap-0.5 pr-1.5 mr-0.5 border-r border-[var(--border-hairline)]">
          <button
            type="button"
            onClick={() => editor?.chain().focus().setParagraph().run()}
            className={toolbarButtonClass(uiState?.headingLevel === 0)}
            title="正文段落"
          >
            正文
          </button>
          {([1, 2, 3] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() =>
                editor?.chain().focus().toggleHeading({ level: lvl }).run()
              }
              className={toolbarButtonClass(uiState?.headingLevel === lvl)}
              title={`标题 ${lvl}`}
            >
              H{lvl}
            </button>
          ))}
        </div>

        {/* 字符格式：粗体 / 斜体 / 下划线 / 删除线 / 文字颜色 / 荧光高亮 */}
        <div className="inline-flex items-center gap-0.5 pr-1.5 mr-0.5 border-r border-[var(--border-hairline)]">
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            className={toolbarButtonClass(Boolean(uiState?.isBold))}
            title="加粗 (Ctrl/Cmd+B)"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            className={toolbarButtonClass(Boolean(uiState?.isItalic))}
            title="斜体 (Ctrl/Cmd+I)"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            className={toolbarButtonClass(Boolean(uiState?.isUnderline))}
            title="下划线 (Ctrl/Cmd+U)"
          >
            <Underline className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleStrike().run()}
            className={toolbarButtonClass(Boolean(uiState?.isStrike))}
            title="删除线"
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </button>

          {/* 文字色快速选择 */}
          <div className="relative" ref={colorMenuRef}>
            <button
              type="button"
              onClick={() => {
                setColorMenuOpen((v) => !v);
                setHighlightMenuOpen(false);
              }}
              className={toolbarButtonClass(Boolean(uiState?.currentColor))}
              title="文字颜色"
            >
              <Palette className="w-3.5 h-3.5" />
              <span
                className="w-2.5 h-1 rounded-full border border-black/15"
                style={{
                  backgroundColor: uiState?.currentColor || "#1E293B",
                }}
              />
            </button>
            {colorMenuOpen && (
              <div className="absolute left-0 top-7 z-40 w-44 p-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl space-y-2">
                <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                  <span>文字颜色</span>
                  <button
                    type="button"
                    onClick={() => {
                      editor?.chain().focus().unsetColor().run();
                      setColorMenuOpen(false);
                    }}
                    className="text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    重置默认
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {TEXT_COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => {
                        editor?.chain().focus().setColor(preset.value).run();
                        setColorMenuOpen(false);
                      }}
                      className="h-6 rounded border border-[var(--border-hairline)] flex items-center justify-center hover:scale-105 transition-transform cursor-pointer"
                      style={{ backgroundColor: preset.value }}
                      title={preset.label}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 荧光高亮快速选择 */}
          <div className="relative" ref={highlightMenuRef}>
            <button
              type="button"
              onClick={() => {
                setHighlightMenuOpen((v) => !v);
                setColorMenuOpen(false);
              }}
              className={toolbarButtonClass(Boolean(uiState?.isHighlight))}
              title="荧光高亮"
            >
              <Highlighter className="w-3.5 h-3.5" />
              <span
                className="w-2.5 h-1 rounded-full border border-black/15"
                style={{
                  backgroundColor: uiState?.currentHighlight || "#fef08a",
                }}
              />
            </button>
            {highlightMenuOpen && (
              <div className="absolute left-0 top-7 z-40 w-40 p-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl space-y-2">
                <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                  <span>荧光高亮</span>
                  <button
                    type="button"
                    onClick={() => {
                      editor?.chain().focus().unsetHighlight().run();
                      setHighlightMenuOpen(false);
                    }}
                    className="text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    清除
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {HIGHLIGHT_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => {
                        editor
                          ?.chain()
                          .focus()
                          .setHighlight({ color: preset.value })
                          .run();
                        setHighlightMenuOpen(false);
                      }}
                      className="h-6 rounded border border-black/15 hover:scale-105 transition-transform cursor-pointer"
                      style={{ backgroundColor: preset.value }}
                      title={preset.label}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 段落对齐：左对齐 / 居中 / 右对齐 */}
        <div className="inline-flex items-center gap-0.5 pr-1.5 mr-0.5 border-r border-[var(--border-hairline)]">
          <button
            type="button"
            onClick={() => editor?.chain().focus().setTextAlign("left").run()}
            className={toolbarButtonClass(uiState?.textAlign === "left")}
            title="左对齐"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().setTextAlign("center").run()}
            className={toolbarButtonClass(uiState?.textAlign === "center")}
            title="居中对齐"
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().setTextAlign("right").run()}
            className={toolbarButtonClass(uiState?.textAlign === "right")}
            title="右对齐"
          >
            <AlignRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 列表与块级元素：无序列表 / 有序列表 / 引用 / 分割线 */}
        <div className="inline-flex items-center gap-0.5 pr-1.5 mr-0.5 border-r border-[var(--border-hairline)]">
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            className={toolbarButtonClass(Boolean(uiState?.isBulletList))}
            title="无序列表"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            className={toolbarButtonClass(Boolean(uiState?.isOrderedList))}
            title="有序列表"
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
            className={toolbarButtonClass(Boolean(uiState?.isBlockquote))}
            title="引用块"
          >
            <Quote className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().setHorizontalRule().run()}
            className={toolbarButtonClass(false)}
            title="插入分割线"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 表格操作区 */}
        <div className="inline-flex flex-wrap items-center gap-0.5 pr-1.5 mr-0.5 border-r border-[var(--border-hairline)]">
          <button
            type="button"
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
            className={toolbarButtonClass(false)}
            title="插入表格 (3×3)"
          >
            <Table2 className="w-3.5 h-3.5" />
            <span>插入表格</span>
          </button>
          {uiState?.isInTable && (
            <>
              <button
                type="button"
                onClick={() => editor?.chain().focus().addRowAfter().run()}
                className={toolbarButtonClass(false)}
                title="在下方加行"
              >
                <Plus className="w-3 h-3" />
                <span>加行</span>
              </button>
              <button
                type="button"
                onClick={() => editor?.chain().focus().deleteRow().run()}
                className={toolbarButtonClass(false)}
                title="删除当前行"
              >
                <span>删行</span>
              </button>
              <button
                type="button"
                onClick={() => editor?.chain().focus().addColumnAfter().run()}
                className={toolbarButtonClass(false)}
                title="在右侧加列"
              >
                <Plus className="w-3 h-3" />
                <span>加列</span>
              </button>
              <button
                type="button"
                onClick={() => editor?.chain().focus().deleteColumn().run()}
                className={toolbarButtonClass(false)}
                title="删除当前列"
              >
                <span>删列</span>
              </button>
              <button
                type="button"
                onClick={() => editor?.chain().focus().deleteTable().run()}
                className="h-6 px-1.5 inline-flex items-center gap-0.5 rounded-[4px] text-[11px] font-medium text-[var(--status-danger)] hover:bg-[var(--bg-hover)] cursor-pointer"
                title="删除整个表格"
              >
                <Trash className="w-3 h-3" />
                <span>删表</span>
              </button>
            </>
          )}
        </div>

        {/* 辅助操作区：大纲 / 查找 / 导出 PDF / 保存 */}
        <div className="inline-flex flex-wrap items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={() => setOutlineOpen((v) => !v)}
            className={toolbarButtonClass(outlineOpen)}
            title="切换文档大纲目录"
          >
            <PanelLeft className="w-3.5 h-3.5" />
            <span>大纲</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchOpen((v) => {
                const next = !v;
                if (next) {
                  window.requestAnimationFrame(() => {
                    searchInputRef.current?.focus();
                    searchInputRef.current?.select();
                  });
                }
                return next;
              });
            }}
            className={toolbarButtonClass(searchOpen)}
            title="查找正文 (Ctrl/Cmd+F)"
          >
            <Search className="w-3.5 h-3.5" />
            <span>查找</span>
          </button>
          <button
            type="button"
            disabled={exportingPdf || loadingDoc}
            onClick={() => void handleExportPdf()}
            className="h-6 inline-flex items-center gap-1 px-2 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-hover)] text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50 cursor-pointer"
            title="将当前文档导出为 PDF 并保存到工作区"
          >
            {exportingPdf ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <FileDown className="w-3 h-3" />
            )}
            <span>{exportingPdf ? "导出中…" : "导出 PDF"}</span>
          </button>
          <button
            type="button"
            disabled={saveState === "saving" || loadingDoc}
            onClick={() => void performSave("manual")}
            className="h-6 inline-flex items-center gap-1 px-2.5 rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-active)] text-[11px] font-medium text-[var(--text-primary)] transition-colors disabled:opacity-50 cursor-pointer"
            title="保存 .docx (Ctrl/Cmd+S)"
          >
            <Save className="w-3 h-3 text-[var(--accent)]" />
            <span>{saveState === "saving" ? "保存中…" : "保存 .docx"}</span>
          </button>
        </div>
      </div>

      {/* 查找栏（Ctrl/Cmd+F 呼出） */}
      {searchOpen && (
        <div className="shrink-0 px-3 py-1.5 border-b border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex flex-wrap items-center gap-2 text-xs">
          <div className="relative flex-1 min-w-[160px] max-w-[280px]">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  navigateSearchMatch(e.shiftKey ? -1 : 1);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setSearchOpen(false);
                  setSearchQuery("");
                  editor?.commands.focus();
                }
              }}
              placeholder="输入关键词查找文档内容..."
              className="w-full h-6 pl-7 pr-2 rounded border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
            />
          </div>
          <span className="text-[11px] font-mono tabular-nums text-[var(--text-muted)]">
            {searchQuery.trim()
              ? uiState && uiState.searchTotal > 0
                ? `${uiState.searchActiveIdx + 1} / ${uiState.searchTotal}`
                : "0 匹配"
              : "等待输入"}
          </span>
          <div className="inline-flex items-center gap-0.5">
            <button
              type="button"
              disabled={!uiState?.searchTotal}
              onClick={() => navigateSearchMatch(-1)}
              className={toolbarButtonClass(false, !uiState?.searchTotal)}
              title="上一个匹配 (Shift+Enter)"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={!uiState?.searchTotal}
              onClick={() => navigateSearchMatch(1)}
              className={toolbarButtonClass(false, !uiState?.searchTotal)}
              title="下一个匹配 (Enter)"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                setSearchQuery("");
                editor?.commands.focus();
              }}
              className={toolbarButtonClass(false)}
              title="关闭查找 (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 主体工作区：左侧可折叠大纲 + 中间 A4 白纸编辑画布 */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {outlineOpen && (
          <aside className="w-48 shrink-0 border-r border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex flex-col min-h-0 select-none">
            <div className="h-8 shrink-0 px-3 border-b border-[var(--border-hairline)] flex items-center justify-between text-[11px] font-medium text-[var(--text-secondary)]">
              <span>文档大纲</span>
              <span className="font-mono tabular-nums text-[10px] text-[var(--text-muted)]">
                {uiState?.headings.length ?? 0}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {!uiState || uiState.headings.length === 0 ? (
                <div className="px-2 py-4 text-[11px] text-[var(--text-muted)] leading-relaxed">
                  暂无标题，使用工具栏 H1 / H2 / H3 创建章节大纲。
                </div>
              ) : (
                uiState.headings.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (!editor) return;
                      scrollToEditorPos(editor, item.pos + 1);
                      editor.chain().focus().setTextSelection(item.pos + 1).run();
                    }}
                    className={`w-full text-left px-2 py-1 rounded text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] truncate transition-colors cursor-pointer ${
                      item.level === 1
                        ? "font-semibold"
                        : item.level === 2
                          ? "pl-4"
                          : "pl-6 text-[var(--text-muted)]"
                    }`}
                    title={item.text}
                  >
                    {item.text}
                  </button>
                ))
              )}
            </div>
          </aside>
        )}

        {/* 居中 A4 纸张画布 */}
        <div className="flex-1 overflow-auto bg-[var(--surface-paper)] p-4 sm:p-6 min-h-0">
          {loadingDoc ? (
            <div className="max-w-[794px] mx-auto rounded-md bg-white/90 text-[#64748B] p-12 flex items-center justify-center gap-2 text-xs shadow-sm">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
              <span>正在解析 Word 文档内容…</span>
            </div>
          ) : (
            <div className="word-editor-paper mx-auto">
              <EditorContent editor={editor} />
            </div>
          )}
        </div>
      </div>

      {/* 底部文档字数与保存状态栏 */}
      <div className="h-7 shrink-0 px-3 border-t border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex items-center justify-between gap-3 text-[11px] text-[var(--text-muted)] select-none">
        <div className="flex items-center gap-3 font-mono tabular-nums truncate">
          <span>字数 {uiState?.stats.words ?? 0}</span>
          <span>字符(不含空格) {uiState?.stats.charsNoSpace ?? 0}</span>
          <span>段落 {uiState?.stats.paragraphs ?? 0}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              saveState === "saving"
                ? "bg-[var(--accent)] animate-pulse"
                : saveState === "unsaved"
                  ? "bg-[var(--status-warning)]"
                  : saveState === "error"
                    ? "bg-[var(--status-danger)]"
                    : "bg-[var(--status-success)]"
            }`}
          />
          <span
            className={
              saveState === "error"
                ? "text-[var(--status-danger)]"
                : saveState === "unsaved"
                  ? "text-[var(--text-secondary)]"
                  : ""
            }
          >
            {statusText}
          </span>
        </div>
      </div>
    </div>
  );
}

export default WordEditor;
