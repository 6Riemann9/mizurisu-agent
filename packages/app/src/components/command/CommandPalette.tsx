import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  Contrast,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  FileType,
  Keyboard,
  KeyRound,
  LogOut,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Moon,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Trash2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BUILTIN_SKILLS } from "../../agent/skills";
import { maskApiKey } from "../../newapi/auth";
import { getMizurisuConsoleLinks, inferModelMetadata } from "../../newapi/client";
import {
  createPdfDocument,
  createWordDocument,
  markdownToPdfSpec,
  markdownToWordSpec,
} from "../../office";
import { workspaceVfs } from "../../storage/workspace-vfs";
import { useAppStore } from "../../store/useAppStore";
import { FileIcon, formatFileSize } from "../common/FileBadge";
import { Button, Dialog, Kbd, Tooltip, cn } from "../ui";

interface CommandItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords: string;
  active?: boolean;
  danger?: boolean;
  shortcut?: string[];
  filePath?: string;
  icon: ReactNode;
  run: () => void | Promise<void>;
}

/** 解析 Markdown 转存路径，避免静默覆盖工作区已有同名文档 */
async function resolveConversionTargetPath(
  stem: string,
  ext: "docx" | "pdf"
): Promise<string> {
  const preferredPath = `${stem}.${ext}`;
  if (!(await workspaceVfs.exists(preferredPath))) {
    return preferredPath;
  }
  const shouldOverwrite =
    typeof window !== "undefined" && typeof window.confirm === "function"
      ? window.confirm(
          `工作区已存在「${preferredPath}」，是否覆盖原文件？\n点击“取消”将自动另存为带序号的新版本文件。`
        )
      : false;
  if (shouldOverwrite) {
    return preferredPath;
  }
  let index = 2;
  while (index < 1000) {
    const candidate = `${stem} (${index}).${ext}`;
    if (!(await workspaceVfs.exists(candidate))) {
      return candidate;
    }
    index += 1;
  }
  return `${stem}_${Date.now()}.${ext}`;
}

export function CommandPalette() {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setShortcutHelpOpen,
    config,
    settings,
    models,
    files,
    sessions,
    activeSessionId,
    customSkills,
    activeSkillId,
    authSession,
    previewOpen,
    previewExpanded,
    activePreviewPath,
    createSession,
    toggleTheme,
    toggleHighContrast,
    setSettingsOpen,
    setPreviewOpen,
    setPreviewExpanded,
    updateConfig,
    updateSettings,
    openPreview,
    deleteWorkspaceFile,
    exportWorkspaceFile,
    setActiveSkill,
    switchActiveToken,
    refreshAccountSession,
    exportWorkspaceZip,
    exportSessionMarkdown,
    pushToast,
    logout,
  } = useAppStore();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const rootQueryRef = useRef("");
  const pendingRestoreFileIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 全局监听 Mod+K 开关命令面板（Esc 由 Dialog 统一接管并还原焦点）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!useAppStore.getState().commandPaletteOpen);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setCommandPaletteOpen]);

  // 每次打开面板时重置检索词与子菜单层级
  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      setActiveFilePath(null);
      rootQueryRef.current = "";
      pendingRestoreFileIdRef.current = null;
    }
  }, [commandPaletteOpen]);

  const activeFile = useMemo(
    () => (activeFilePath ? files.find((f) => f.path === activeFilePath) ?? null : null),
    [activeFilePath, files]
  );

  // 若子菜单对应的文件在外部被删除，自动退回第一级
  useEffect(() => {
    if (activeFilePath && !activeFile) {
      setActiveFilePath(null);
      setQuery(rootQueryRef.current);
      setSelectedIndex(0);
    }
  }, [activeFilePath, activeFile]);

  const convertMarkdownFile = useCallback(
    async (filePath: string, targetFormat: "docx" | "pdf") => {
      const formatLabel = targetFormat === "docx" ? "Word" : "PDF";
      pushToast(`正在将文档转存为 ${formatLabel}…`, "info", { durationMs: 2200 });
      const bytes = await workspaceVfs.readBytes(filePath);
      const sourceText = new TextDecoder("utf-8").decode(bytes);
      const stem = filePath.replace(/\.(md|mdx|markdown)$/i, "");
      const fallbackTitle = (stem.split("/").pop() || stem).trim() || "导出文档";
      const targetPath = await resolveConversionTargetPath(stem, targetFormat);

      const generatedBytes =
        targetFormat === "docx"
          ? await createWordDocument(markdownToWordSpec(sourceText, fallbackTitle))
          : await createPdfDocument(markdownToPdfSpec(sourceText, fallbackTitle));

      await workspaceVfs.writeBytes(targetPath, generatedBytes, {
        snapshotNote: `从 Markdown 转存 ${formatLabel}`,
      });
      openPreview(targetPath);
      pushToast(
        `已转存 ${formatLabel} 至工作区并打开预览：${targetPath}`,
        "success"
      );
    },
    [openPreview, pushToast]
  );

  // 一级全部命令与资源列表
  const rootItems = useMemo<CommandItem[]>(() => {
    const allSkills = [...BUILTIN_SKILLS, ...customSkills];
    const rawModelList =
      models.length > 0
        ? models
        : config.selectedModelId
          ? [inferModelMetadata(config.selectedModelId, config)]
          : [];
    const modelList = settings.showNonChatModels
      ? rawModelList
      : rawModelList.filter(
          (m) => m.isChatCapable !== false || m.id === config.selectedModelId
        );
    const activeSession = sessions.find((s) => s.id === activeSessionId);
    const consoleLinks = getMizurisuConsoleLinks(
      authSession?.baseUrl || config.baseUrl
    );

    const commands: CommandItem[] = [
      {
        id: "action:new-session",
        group: "快捷操作",
        label: "新建办公会话",
        hint: "重置当前对话上下文",
        keywords: "new chat session 新建 会话 对话",
        shortcut: ["C"],
        icon: <MessageSquarePlus className="w-3.5 h-3.5" />,
        run: async () => {
          await createSession();
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("mizurisu:focus-composer"));
          }, 30);
        },
      },
      {
        id: "action:shortcut-help",
        group: "快捷操作",
        label: "显示键盘快捷键速查",
        hint: "单键导航与工作流快捷键指南",
        keywords: "shortcut keyboard help 快捷键 键盘 指南 速查",
        shortcut: ["?"],
        icon: <Keyboard className="w-3.5 h-3.5" />,
        run: () => setShortcutHelpOpen(true),
      },
      {
        id: "action:toggle-sidebar",
        group: "快捷操作",
        label: "折叠 / 展开左侧工作区栏",
        hint: "快捷显隐会话与工作区文件栏",
        keywords: "sidebar collapse expand toggle 侧边栏 折叠 展开 工作区栏",
        shortcut: ["["],
        icon: <PanelLeft className="w-3.5 h-3.5" />,
        run: () => {
          // 交由全局快捷键引擎统一切换 AppShell 侧栏状态（待弹窗关闭且 modalOpen 归零后触发）
          setTimeout(() => {
            if (!useAppStore.getState().commandPaletteOpen) {
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "[" }));
            }
          }, 30);
        },
      },
      {
        id: "action:toggle-preview",
        group: "快捷操作",
        label: previewOpen ? "收起右侧文档台" : "展开右侧文档台",
        hint: previewOpen ? "隐藏 Office 预览与编辑面板" : "显示 Office 预览与编辑面板",
        keywords: "preview office document 文档台 预览 收起 展开",
        shortcut: ["]"],
        icon: <PanelRight className="w-3.5 h-3.5" />,
        run: () => {
          if (!previewOpen && !activePreviewPath && files.length > 0) {
            openPreview(files[0].path);
            return;
          }
          setPreviewOpen(!previewOpen);
        },
      },
      {
        id: "action:toggle-preview-expanded",
        group: "快捷操作",
        label: previewExpanded ? "还原文档台分栏视图" : "全屏展开右侧文档台",
        hint: "全屏畅享 Word / Excel 原生工具栏",
        keywords: "fullscreen expand preview office 全屏 文档台 展开 编辑",
        shortcut: ["\\"],
        icon: previewExpanded ? (
          <Minimize2 className="w-3.5 h-3.5" />
        ) : (
          <Maximize2 className="w-3.5 h-3.5" />
        ),
        run: () => {
          if (!previewOpen) {
            const target = activePreviewPath || files[0]?.path;
            if (!target) {
              pushToast("当前工作区暂无可全屏展开的文档", "info");
              return;
            }
            openPreview(target);
            setPreviewExpanded(true);
            return;
          }
          setPreviewExpanded(!previewExpanded);
        },
      },
      {
        id: "action:toggle-high-contrast",
        group: "快捷操作",
        label: settings.highContrast ? "关闭高对比度模式" : "开启高对比度模式",
        hint: "OKLCH 对比度增强",
        keywords: "contrast high-contrast accessibility oklch 高对比度 无障碍",
        active: Boolean(settings.highContrast),
        icon: <Contrast className="w-3.5 h-3.5" />,
        run: () => toggleHighContrast(),
      },
      {
        id: "action:toggle-theme",
        group: "快捷操作",
        label: settings.theme === "dark" ? "切换到浅色主题" : "切换到深色主题",
        hint: settings.theme === "dark" ? "Light" : "Dark",
        keywords: "theme dark light 主题 暗色 浅色",
        icon:
          settings.theme === "dark" ? (
            <Sun className="w-3.5 h-3.5" />
          ) : (
            <Moon className="w-3.5 h-3.5" />
          ),
        run: () => toggleTheme(),
      },
      {
        id: "action:export-workspace-zip",
        group: "快捷操作",
        label: "打包下载工作区 ZIP",
        hint: files.length > 0 ? `共 ${files.length} 个文件` : "工作区暂无文件",
        keywords: "zip export workspace archive download 打包 下载 工作区 导出",
        icon: <Archive className="w-3.5 h-3.5" />,
        run: () => exportWorkspaceZip(),
      },
      {
        id: "action:export-session-markdown",
        group: "快捷操作",
        label: "导出当前会话为 Markdown",
        hint: activeSession?.title || "归档当前对话记录",
        keywords: "export markdown session chat 导出 会话 对话 记录",
        icon: <FileDown className="w-3.5 h-3.5" />,
        run: () => {
          if (!activeSessionId) {
            pushToast("当前没有可导出的会话", "warning");
            return;
          }
          return exportSessionMarkdown(activeSessionId);
        },
      },
      {
        id: "action:toggle-non-chat-models",
        group: "快捷操作",
        label: settings.showNonChatModels
          ? "隐藏非对话模型"
          : "显示非对话模型（向量/语音/生图）",
        hint: settings.showNonChatModels ? "当前显示全部" : "当前仅对话模型",
        keywords: "model filter embedding tts image 隐藏 显示 非对话 模型",
        icon: settings.showNonChatModels ? (
          <EyeOff className="w-3.5 h-3.5" />
        ) : (
          <Eye className="w-3.5 h-3.5" />
        ),
        run: async () => {
          const nextShow = !settings.showNonChatModels;
          await updateSettings({ showNonChatModels: nextShow });
          pushToast(
            nextShow ? "已显示非对话模型" : "已隐藏非对话专用模型",
            "info"
          );
        },
      },
      {
        id: "action:open-console-topup",
        group: "快捷操作",
        label: "前往 Mizurisu 控制台充值 / 管理令牌",
        hint: consoleLinks.topupUrl,
        keywords: "console topup token billing mizurisu 控制台 充值 额度 令牌",
        icon: <ExternalLink className="w-3.5 h-3.5" />,
        run: () => {
          window.open(consoleLinks.topupUrl, "_blank", "noopener,noreferrer");
        },
      },
      {
        id: "action:open-console-token",
        group: "快捷操作",
        label: "前往 Mizurisu 令牌管理页",
        hint: consoleLinks.tokenUrl,
        keywords: "console token key api mizurisu 令牌 管理 控制台",
        icon: <KeyRound className="w-3.5 h-3.5" />,
        run: () => {
          window.open(consoleLinks.tokenUrl, "_blank", "noopener,noreferrer");
        },
      },
      {
        id: "action:open-settings",
        group: "快捷操作",
        label: "打开设置与账号管理",
        keywords: "settings config token 设置 中转站 令牌 外观",
        shortcut: ["Mod", ","],
        icon: <Settings className="w-3.5 h-3.5" />,
        run: () => setSettingsOpen(true),
      },
    ];

    if (authSession && authSession.mode !== "guest") {
      commands.push({
        id: "action:refresh-account",
        group: "快捷操作",
        label: "同步账户额度与可用模型",
        keywords: "refresh sync billing quota 刷新 额度 同步",
        icon: <RefreshCw className="w-3.5 h-3.5" />,
        run: () => refreshAccountSession(),
      });
    }

    commands.push({
      id: "action:logout",
      group: "快捷操作",
      label: "退出登录",
      hint: authSession?.username || authSession?.user?.username || "返回登录门户",
      keywords: "logout signout 退出 登出 注销",
      icon: <LogOut className="w-3.5 h-3.5" />,
      run: () => logout(),
    });

    for (const m of modelList) {
      const active = m.id === config.selectedModelId;
      commands.push({
        id: `model:${m.id}`,
        group: "切换模型",
        label: m.id,
        hint: m.tags && m.tags.length > 0 ? m.tags.join(" · ") : m.providerGroup,
        keywords: `model 模型 ${m.id} ${m.providerGroup} ${(m.tags || []).join(" ")}`,
        active,
        icon: <Cpu className="w-3.5 h-3.5" />,
        run: () => updateConfig({ selectedModelId: m.id }),
      });
    }

    for (const f of files) {
      commands.push({
        id: `file:${f.path}`,
        group: "工作区文件（按 → 展开操作）",
        label: f.name,
        hint:
          f.path !== f.name
            ? f.path
            : `${f.category.toUpperCase()} · ${formatFileSize(f.size)}`,
        keywords: `file doc open 打开 文件 操作 ${f.name} ${f.path} ${f.category}`,
        filePath: f.path,
        icon: <FileIcon category={f.category} className="w-3.5 h-3.5" />,
        run: () => openPreview(f.path),
      });
    }

    for (const sk of allSkills) {
      const active = activeSkillId === sk.id;
      commands.push({
        id: `skill:${sk.id}`,
        group: "启用办公技能",
        label: sk.name,
        hint: active ? "点击取消挂载" : sk.description,
        keywords: `skill 技能 ${sk.name} ${sk.description}`,
        active,
        icon: <Wand2 className="w-3.5 h-3.5" />,
        run: () => setActiveSkill(active ? undefined : sk.id),
      });
    }

    if (authSession?.tokens && authSession.tokens.length > 0) {
      for (const tk of authSession.tokens) {
        const active = authSession.activeTokenId === tk.id;
        commands.push({
          id: `token:${tk.id}`,
          group: "切换 API 令牌",
          label: tk.name || `Token #${tk.id}`,
          hint: maskApiKey(tk.key || tk.maskedKey),
          keywords: `token key api 令牌 ${tk.name}`,
          active,
          icon: <KeyRound className="w-3.5 h-3.5" />,
          run: () => switchActiveToken(tk.id),
        });
      }
    }

    return commands;
  }, [
    models,
    config,
    files,
    sessions,
    activeSessionId,
    customSkills,
    activeSkillId,
    authSession,
    settings.theme,
    settings.highContrast,
    settings.showNonChatModels,
    previewOpen,
    previewExpanded,
    activePreviewPath,
    createSession,
    setShortcutHelpOpen,
    toggleTheme,
    toggleHighContrast,
    setPreviewOpen,
    setPreviewExpanded,
    setSettingsOpen,
    refreshAccountSession,
    exportWorkspaceZip,
    exportSessionMarkdown,
    updateSettings,
    pushToast,
    logout,
    updateConfig,
    openPreview,
    setActiveSkill,
    switchActiveToken,
  ]);

  // 二级文件上下文动作列表
  const submenuItems = useMemo<CommandItem[]>(() => {
    if (!activeFile) return [];
    const isMarkdown =
      activeFile.category === "markdown" || /\.(md|mdx|markdown)$/i.test(activeFile.path);

    const actions: CommandItem[] = [
      {
        id: "sub:preview",
        group: "文件操作",
        label: "在右侧文档台预览",
        hint: activeFile.path,
        keywords: "preview open 预览 打开 文档台",
        icon: <Eye className="w-3.5 h-3.5" />,
        run: () => openPreview(activeFile.path),
      },
      {
        id: "sub:export",
        group: "文件操作",
        label: "导出 / 下载文件",
        hint: formatFileSize(activeFile.size),
        keywords: "export download save 导出 下载 保存",
        icon: <Download className="w-3.5 h-3.5" />,
        run: () => exportWorkspaceFile(activeFile.path),
      },
    ];

    if (isMarkdown) {
      actions.push(
        {
          id: "sub:convert-docx",
          group: "格式转存",
          label: "转存为正式 Word (.docx)",
          hint: "生成 .docx 并打开预览",
          keywords: "word docx convert export 转存 转换 导出",
          icon: <FileType className="w-3.5 h-3.5" />,
          run: () => convertMarkdownFile(activeFile.path, "docx"),
        },
        {
          id: "sub:convert-pdf",
          group: "格式转存",
          label: "转存为可搜索 PDF (.pdf)",
          hint: "生成含中文文本层的 PDF 并打开预览",
          keywords: "pdf convert export 转存 转换 导出",
          icon: <FileText className="w-3.5 h-3.5" />,
          run: () => convertMarkdownFile(activeFile.path, "pdf"),
        }
      );
    }

    actions.push({
      id: "sub:delete",
      group: "危险操作",
      label: "删除工作区文件",
      hint: "删除后可在 6 秒内撤销",
      keywords: "delete remove trash 删除 移除",
      danger: true,
      icon: <Trash2 className="w-3.5 h-3.5" />,
      run: () => deleteWorkspaceFile(activeFile.path),
    });

    return actions;
  }, [
    activeFile,
    convertMarkdownFile,
    deleteWorkspaceFile,
    exportWorkspaceFile,
    openPreview,
  ]);

  const currentPool = activeFile ? submenuItems : rootItems;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return currentPool;
    const terms = q.split(/\s+/).filter(Boolean);
    return currentPool.filter((item) => {
      const hay = `${item.label} ${item.hint || ""} ${item.group} ${item.keywords}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [currentPool, query]);

  // 从二级菜单返回一级时自动定位到原文件条目
  useEffect(() => {
    if (!activeFile && pendingRestoreFileIdRef.current) {
      const targetId = pendingRestoreFileIdRef.current;
      pendingRestoreFileIdRef.current = null;
      const idx = filtered.findIndex((item) => item.id === targetId);
      setSelectedIndex(idx >= 0 ? idx : 0);
    }
  }, [activeFile, filtered]);

  const clampedIndex =
    filtered.length === 0 ? 0 : Math.min(selectedIndex, filtered.length - 1);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>(
      `[data-cmd-idx="${clampedIndex}"]`
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex]);

  const closePalette = useCallback(() => {
    setActiveFilePath(null);
    setCommandPaletteOpen(false);
  }, [setCommandPaletteOpen]);

  const enterFileSubmenu = useCallback(
    (filePath: string) => {
      rootQueryRef.current = query;
      setActiveFilePath(filePath);
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [query]
  );

  const exitFileSubmenu = useCallback(() => {
    if (!activeFilePath) return;
    pendingRestoreFileIdRef.current = `file:${activeFilePath}`;
    setActiveFilePath(null);
    setQuery(rootQueryRef.current);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [activeFilePath]);

  const executeItem = useCallback(
    (item?: CommandItem) => {
      if (!item) return;
      closePalette();
      Promise.resolve(item.run()).catch((err) => {
        pushToast(err instanceof Error ? err.message : String(err), "error");
      });
    },
    [closePalette, pushToast]
  );

  // 分组渲染同时保持全局扁平下标以支持键盘上下移动
  const grouped: Array<{
    group: string;
    entries: Array<{ item: CommandItem; index: number }>;
  }> = [];
  const groupIndexMap = new Map<string, number>();
  filtered.forEach((item, index) => {
    let gIdx = groupIndexMap.get(item.group);
    if (gIdx === undefined) {
      gIdx = grouped.length;
      groupIndexMap.set(item.group, gIdx);
      grouped.push({ group: item.group, entries: [] });
    }
    grouped[gIdx].entries.push({ item, index });
  });

  return (
    <Dialog
      open={commandPaletteOpen}
      onClose={closePalette}
      ariaLabel="命令面板"
      initialFocusRef={inputRef}
      overlayClassName="items-start justify-center pt-[12vh] sm:pt-[13vh] px-4"
      className="w-full max-w-[560px] overflow-hidden"
    >
      {/* 二级文件上下文菜单顶部返回条 */}
      {activeFile && (
        <div className="h-9 px-3 border-b border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex items-center justify-between gap-2 text-[12px]">
          <div className="flex items-center gap-1.5 min-w-0">
            <Button
              variant="ghost"
              size="xs"
              onClick={exitFileSubmenu}
              className="px-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>返回全部命令</span>
            </Button>
            <span className="text-[var(--text-dim)]">/</span>
            <span className="inline-flex items-center gap-1.5 min-w-0 text-[var(--text-primary)] font-linear-medium">
              <FileIcon category={activeFile.category} className="w-3.5 h-3.5" />
              <span className="truncate">{activeFile.name}</span>
            </span>
          </div>
          <Tooltip content="返回第一级命令" shortcut="←" side="bottom">
            <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--text-muted)] shrink-0">
              <Kbd keys="←" />
            </span>
          </Tooltip>
        </div>
      )}

      {/* 搜索输入栏 */}
      <div className="h-11 px-3.5 border-b border-[var(--border-hairline)] flex items-center gap-2.5 bg-[var(--bg-surface)]">
        <Search className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (filtered.length > 0) {
                setSelectedIndex((prev) => (prev + 1) % filtered.length);
              }
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (filtered.length > 0) {
                setSelectedIndex(
                  (prev) => (prev - 1 + filtered.length) % filtered.length
                );
              }
            } else if (e.key === "ArrowRight" && !activeFile) {
              const current = filtered[clampedIndex];
              const el = e.currentTarget;
              const atEnd =
                (el.selectionStart ?? 0) === el.value.length &&
                (el.selectionEnd ?? 0) === el.value.length;
              if (current?.filePath && (!query || atEnd)) {
                e.preventDefault();
                enterFileSubmenu(current.filePath);
              }
            } else if (e.key === "ArrowLeft" && activeFile) {
              const el = e.currentTarget;
              const atStart =
                (el.selectionStart ?? 0) === 0 && (el.selectionEnd ?? 0) === 0;
              if (!query || atStart) {
                e.preventDefault();
                exitFileSubmenu();
              }
            } else if (e.key === "Backspace" && activeFile && query === "") {
              e.preventDefault();
              exitFileSubmenu();
            } else if (e.key === "Enter") {
              e.preventDefault();
              executeItem(filtered[clampedIndex]);
            }
          }}
          placeholder={
            activeFile
              ? `筛选「${activeFile.name}」的可用操作...`
              : "输入命令、模型、文件、技能或令牌..."
          }
          className="flex-1 min-w-0 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
        />
        <Kbd keys="Escape" />
      </div>

      {/* 命令列表 */}
      <div
        ref={listRef}
        className="max-h-[348px] overflow-y-auto p-1.5 space-y-2 bg-[var(--bg-surface)]"
      >
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-[var(--text-muted)]">
            {activeFile ? "未找到匹配的文件操作" : "未找到匹配的命令或资源"}
          </div>
        ) : (
          grouped.map(({ group, entries }) => (
            <div key={group}>
              <div className="px-2.5 py-1 text-[10px] font-linear-medium uppercase tracking-wider text-[var(--text-muted)]">
                {group}
              </div>
              <div className="space-y-0.5">
                {entries.map(({ item, index }) => {
                  const selected = index === clampedIndex;
                  const hasFileSubmenu = Boolean(item.filePath && !activeFile);
                  return (
                    <div
                      key={item.id}
                      data-cmd-idx={index}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={cn(
                        "group/row w-full h-8 rounded-md flex items-center justify-between gap-1.5 transition",
                        selected
                          ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => executeItem(item)}
                        className="flex-1 min-w-0 h-full px-2.5 flex items-center justify-between gap-2 text-left text-[12px] cursor-pointer linear-focus-ring rounded-md"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={cn(
                              "shrink-0",
                              item.danger
                                ? "text-[var(--status-danger)]"
                                : selected
                                  ? "text-[var(--text-primary)]"
                                  : "text-[var(--text-muted)]"
                            )}
                          >
                            {item.icon}
                          </span>
                          <span
                            className={cn(
                              "truncate font-linear-medium",
                              item.danger
                                ? "text-[var(--status-danger)]"
                                : "text-[var(--text-primary)]"
                            )}
                          >
                            {item.label}
                          </span>
                          {item.hint && (
                            <span className="truncate text-[11px] text-[var(--text-muted)] font-mono">
                              {item.hint}
                            </span>
                          )}
                        </div>

                        <span className="flex items-center gap-1.5 shrink-0">
                          {item.active && (
                            <Check className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                          )}
                          {item.shortcut && <Kbd keys={item.shortcut} />}
                        </span>
                      </button>

                      {hasFileSubmenu && (
                        <Tooltip content="展开文件二级操作菜单" shortcut="→" side="left">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              enterFileSubmenu(item.filePath!);
                            }}
                            aria-label={`打开 ${item.label} 的操作菜单`}
                            className={cn(
                              "mr-1.5 h-6 px-1.5 rounded-[5px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] hover:border-[var(--border-strong)] inline-flex items-center gap-1 text-[10.5px] font-linear-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition shrink-0 cursor-pointer linear-focus-ring",
                              selected
                                ? "opacity-100"
                                : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                            )}
                          >
                            <span>操作</span>
                            <ArrowRight className="w-2.5 h-2.5" />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 底部快捷键提示栏 */}
      <div className="h-8 px-3.5 border-t border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
          <span className="inline-flex items-center gap-1 shrink-0">
            <Kbd keys={["↑", "↓"]} />
            <span>选择</span>
          </span>
          <span className="inline-flex items-center gap-1 shrink-0">
            <Kbd keys="Enter" />
            <span>执行</span>
          </span>
          {activeFile ? (
            <span className="hidden sm:inline-flex items-center gap-1 shrink-0">
              <Kbd keys="←" />
              <span>返回命令</span>
            </span>
          ) : (
            <span className="hidden sm:inline-flex items-center gap-1 shrink-0">
              <Kbd keys="→" />
              <span>文件子菜单</span>
            </span>
          )}
          <span className="hidden md:inline-flex items-center gap-1 shrink-0">
            <Kbd keys={["Mod", "K"]} />
            <span>开关</span>
          </span>
        </div>
        <span className="tabular-nums shrink-0">{filtered.length} 项</span>
      </div>
    </Dialog>
  );
}
