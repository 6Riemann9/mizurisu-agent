import {
  Archive,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileDown,
  FolderOpen,
  Loader2,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BUILTIN_SKILLS } from "../../agent/skills";
import { formatQuotaDisplay, maskApiKey } from "../../newapi/auth";
import { getMizurisuConsoleLinks } from "../../newapi/client";
import {
  buildSlidesHtmlDocument,
  createExcelWorkbook,
  createWordDocument,
} from "../../office";
import { getPlatformAdapter } from "../../platform";
import { workspaceVfs } from "../../storage/workspace-vfs";
import { useAppStore } from "../../store/useAppStore";
import type { ChatSession, WorkspaceFileMeta } from "../../types";
import { FileIcon, formatFileSize } from "../common/FileBadge";

/** 生成工作区不重名的目标文件路径（如 新建表格.xlsx -> 新建表格_2.xlsx） */
async function resolveUniqueWorkspacePath(
  baseName: string,
  ext: string
): Promise<string> {
  const initialPath = `${baseName}${ext}`;
  if (!(await workspaceVfs.exists(initialPath))) {
    return initialPath;
  }
  let index = 2;
  while (index < 1000) {
    const candidate = `${baseName}_${index}${ext}`;
    if (!(await workspaceVfs.exists(candidate))) {
      return candidate;
    }
    index += 1;
  }
  return `${baseName}_${Date.now()}${ext}`;
}

export function Sidebar({
  className = "",
  onUseSkillPrompt,
}: {
  className?: string;
  onUseSkillPrompt?: (prompt: string, skillId: string) => void;
}) {
  const {
    config,
    settings,
    billing,
    billingLoading,
    authSession,
    authBusy,
    sessions,
    activeSessionId,
    files,
    activePreviewPath,
    customSkills,
    activeSkillId,
    createSession,
    selectSession,
    deleteSession,
    renameSession,
    exportSessionMarkdown,
    openPreview,
    uploadFilesToWorkspace,
    deleteWorkspaceFile,
    renameWorkspaceFile,
    exportWorkspaceZip,
    refreshBilling,
    refreshAccountSession,
    setActiveSkill,
    setSettingsOpen,
    setCommandPaletteOpen,
    mountNativeDirectory,
    pushToast,
    logout,
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const [filesOpen, setFilesOpen] = useState(true);
  const [chatsOpen, setChatsOpen] = useState(true);
  const [skillsOpen, setSkillsOpen] = useState(true);
  const [dragOverFiles, setDragOverFiles] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [creatingDoc, setCreatingDoc] = useState(false);

  // 工作区搜索、ZIP 导出、防误删二次确认与文件/会话行内重命名状态
  const [fileQuery, setFileQuery] = useState("");
  const [exportingZip, setExportingZip] = useState(false);
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const confirmDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingFilePath, setEditingFilePath] = useState<string | null>(null);
  const [editingFileName, setEditingFileName] = useState("");
  const [renamingFile, setRenamingFile] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState("");
  const [renamingSession, setRenamingSession] = useState(false);

  useEffect(() => {
    return () => {
      if (confirmDeleteTimerRef.current) {
        clearTimeout(confirmDeleteTimerRef.current);
      }
    };
  }, []);

  // 点击外部或按 Esc 时关闭新建文档下拉菜单
  useEffect(() => {
    if (!createMenuOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setCreateMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setCreateMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [createMenuOpen]);

  /** 一键新建工作区 Office / Markdown 文档并立即在右侧工作台打开 */
  const handleCreateDocument = async (
    kind: "excel" | "word" | "slides" | "markdown"
  ) => {
    if (creatingDoc) return;
    setCreateMenuOpen(false);
    setCreatingDoc(true);
    try {
      let newPath = "";
      if (kind === "excel") {
        newPath = await resolveUniqueWorkspacePath("新建表格", ".xlsx");
        const bytes = await createExcelWorkbook({
          sheets: [
            {
              name: "工作表1",
              headers: ["项目", "负责人", "金额", "状态"],
              rows: [
                ["示例项目 A", "张三", 12800, "进行中"],
                ["示例项目 B", "李四", 24600, "已完成"],
                ["合计", "-", { formula: "SUM(C2:C3)", result: 37400 }, "汇总"],
              ],
              freezeHeader: true,
              columnWidths: [20, 14, 16, 14],
              numberFormats: { 2: "#,##0.00" },
            },
          ],
        });
        await workspaceVfs.writeBytes(newPath, bytes, {
          snapshotNote: "新建 Excel 表格",
        });
      } else if (kind === "word") {
        newPath = await resolveUniqueWorkspacePath("新建文档", ".docx");
        const docTitle = newPath.replace(/\.docx$/i, "");
        const bytes = await createWordDocument({
          title: docTitle,
          subtitle: "Mizurisu Agent 协同文档 · 支持在线排版与导出",
          headerText: docTitle,
          showPageNumbers: true,
          blocks: [
            { type: "heading", level: 2, text: "一、背景与目标" },
            {
              type: "paragraph",
              text: "在此补充文档背景、核心目标或工作进展，也可以在左侧对话区让 AI 协助扩写与润色。",
            },
            { type: "heading", level: 2, text: "二、任务清单" },
            {
              type: "table",
              headers: ["事项", "负责人", "时间节点", "备注"],
              rows: [
                ["", "", "", ""],
                ["", "", "", ""],
              ],
            },
            { type: "heading", level: 2, text: "三、结论与下一步" },
            {
              type: "paragraph",
              text: "在此填写阶段总结与下一步计划。",
            },
          ],
        });
        await workspaceVfs.writeBytes(newPath, bytes, {
          snapshotNote: "新建 Word 文档",
        });
      } else if (kind === "slides") {
        newPath = await resolveUniqueWorkspacePath("新建演示", ".slides.html");
        const deckTitle = newPath.replace(/\.slides\.html$/i, "");
        const themeId =
          settings.theme === "light" ? "consulting-exec" : "linear-dark";
        const html = buildSlidesHtmlDocument({
          title: deckTitle,
          theme: themeId,
          slides: [
            {
              title: deckTitle,
              notes: "封面页：开启顶部「双击改字」即可直接编辑标题与要点。",
              html: `
<div class="cover-stage">
  <div class="badge-row">
    <div class="badge is-accent">PRESENTATION DECK</div>
    <div class="badge">Mizurisu Agent</div>
  </div>
  <div class="cover-hero">
    <div class="slide-kicker">EXECUTIVE OVERVIEW</div>
    <h1 class="slide-h1">${deckTitle}</h1>
    <p class="slide-subtitle">在此输入汇报副标题与核心观点，支持 5 套主题切换与原生 PPTX 导出</p>
  </div>
  <div class="cover-meta-grid">
    <div class="cover-meta-card">
      <span class="kpi-label">汇报团队</span>
      <span class="cover-meta-value">产品与运营</span>
      <span class="kpi-sub">双击舞台文字即可就地修改</span>
    </div>
    <div class="cover-meta-card">
      <span class="kpi-label">目标指标</span>
      <span class="cover-meta-value is-success">+24.0%</span>
      <span class="kpi-sub">支持连接工作区数据自动生成</span>
    </div>
    <div class="cover-meta-card">
      <span class="kpi-label">交付格式</span>
      <span class="cover-meta-value is-accent">PPTX</span>
      <span class="kpi-sub">1280×720 无损比例导出</span>
    </div>
  </div>
</div>`,
            },
            {
              title: "核心议题与推进计划",
              notes: "内容页：对比展示现状洞察与下一步行动。",
              html: `
<div class="slide-header">
  <div class="slide-header-main">
    <div class="slide-kicker">KEY HIGHLIGHTS</div>
    <h2 class="slide-h2">核心议题与行动要点</h2>
  </div>
  <div class="badge-row">
    <div class="badge is-accent">02 / 02</div>
  </div>
</div>
<div class="slide-body">
  <div class="cols-2">
    <div class="bento-card is-accent">
      <div class="card-title">一、现状洞察</div>
      <ul>
        <li>总结当前业务亮点与关键数据表现</li>
        <li>梳理现阶段待解决的核心问题</li>
        <li>结合工作区表格输出量化依据</li>
      </ul>
    </div>
    <div class="bento-card">
      <div class="card-title">二、下一步计划</div>
      <ul>
        <li>明确关键里程碑与交付时间线</li>
        <li>落实责任分工与协作节奏</li>
        <li>设定可追踪的阶段验收标准</li>
      </ul>
    </div>
  </div>
  <div class="callout-strip">
    <span><strong>提示：</strong>点击顶部「双击改字」可直接改写本页内容，完成后可一键导出原生 .pptx。</span>
    <span class="badge">可编辑模板</span>
  </div>
</div>
<div class="slide-footer">
  <span>${deckTitle}</span>
  <span>02 / 02</span>
</div>`,
            },
          ],
        });
        await workspaceVfs.writeText(newPath, html, {
          snapshotNote: "新建幻灯片模板",
        });
      } else {
        newPath = await resolveUniqueWorkspacePath("新建笔记", ".md");
        await workspaceVfs.writeText(newPath, "# 标题\n\n", {
          snapshotNote: "新建 Markdown 文档",
        });
      }

      setFilesOpen(true);
      openPreview(newPath);
      pushToast(`已创建 ${newPath}`, "success");
    } catch (err) {
      pushToast(
        `创建文档失败：${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    } finally {
      setCreatingDoc(false);
    }
  };

  const clearDeleteConfirm = () => {
    if (confirmDeleteTimerRef.current) {
      clearTimeout(confirmDeleteTimerRef.current);
      confirmDeleteTimerRef.current = null;
    }
    setConfirmDeletePath(null);
  };

  const armDeleteConfirm = (path: string) => {
    if (confirmDeleteTimerRef.current) {
      clearTimeout(confirmDeleteTimerRef.current);
    }
    setConfirmDeletePath(path);
    confirmDeleteTimerRef.current = setTimeout(() => {
      setConfirmDeletePath((cur) => (cur === path ? null : cur));
      confirmDeleteTimerRef.current = null;
    }, 3000);
  };

  const platform = getPlatformAdapter();
  const allSkills = [...BUILTIN_SKILLS, ...customSkills];
  const consoleLinks = getMizurisuConsoleLinks(config.baseUrl);
  const isNonGuest = Boolean(authSession && authSession.mode !== "guest");

  const normalizedFileQuery = fileQuery.trim().toLowerCase();
  const filteredFiles = normalizedFileQuery
    ? files.filter(
        (f) =>
          f.name.toLowerCase().includes(normalizedFileQuery) ||
          f.path.toLowerCase().includes(normalizedFileQuery)
      )
    : files;

  const uploadWorkspaceBatch = async (fileList: FileList) => {
    try {
      await uploadFilesToWorkspace(fileList);
    } catch (err) {
      pushToast(
        `导入文件失败：${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      try {
        await uploadWorkspaceBatch(e.target.files);
      } finally {
        e.target.value = "";
      }
    }
  };

  const handleDeleteFile = async (path: string) => {
    clearDeleteConfirm();
    try {
      await deleteWorkspaceFile(path);
    } catch (err) {
      pushToast(
        `删除文件失败：${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteSession(id);
    } catch (err) {
      pushToast(
        `删除会话失败：${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    }
  };

  const handleExportZip = async () => {
    if (files.length === 0 || exportingZip) return;
    setExportingZip(true);
    try {
      await exportWorkspaceZip();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setExportingZip(false);
    }
  };

  const startFileRename = (file: WorkspaceFileMeta) => {
    clearDeleteConfirm();
    setEditingSessionId(null);
    setEditingFilePath(file.path);
    setEditingFileName(file.name);
  };

  const cancelFileRename = () => {
    if (renamingFile) return;
    setEditingFilePath(null);
    setEditingFileName("");
  };

  const commitFileRename = async (file: WorkspaceFileMeta) => {
    if (renamingFile) return;
    const trimmed = editingFileName.trim();
    if (!trimmed) {
      pushToast("文件名不能为空", "error");
      return;
    }
    const parentDir = file.path.includes("/")
      ? file.path.slice(0, file.path.lastIndexOf("/") + 1)
      : "";
    const nextPath = trimmed.includes("/") ? trimmed : `${parentDir}${trimmed}`;
    if (nextPath === file.path) {
      setEditingFilePath(null);
      return;
    }
    setRenamingFile(true);
    try {
      await renameWorkspaceFile(file.path, nextPath);
      setEditingFilePath(null);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setRenamingFile(false);
    }
  };

  const startSessionRename = (session: ChatSession) => {
    setEditingFilePath(null);
    setEditingSessionId(session.id);
    setEditingSessionTitle(session.title);
  };

  const cancelSessionRename = () => {
    if (renamingSession) return;
    setEditingSessionId(null);
    setEditingSessionTitle("");
  };

  const commitSessionRename = async (session: ChatSession) => {
    if (renamingSession) return;
    const nextTitle = editingSessionTitle.trim();
    if (!nextTitle) {
      pushToast("会话名称不能为空", "error");
      return;
    }
    if (nextTitle === session.title) {
      setEditingSessionId(null);
      return;
    }
    setRenamingSession(true);
    try {
      await renameSession(session.id, nextTitle);
      setEditingSessionId(null);
      pushToast("会话名称已更新", "success");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setRenamingSession(false);
    }
  };

  const activeToken = authSession?.tokens.find(
    (t) => t.id === authSession.activeTokenId
  );

  const userName =
    authSession?.user?.displayName ||
    authSession?.user?.username ||
    authSession?.username ||
    (authSession?.mode === "guest" ? "离线访客" : "API Key 用户");

  const quotaDisplay = (() => {
    if (authSession?.mode === "guest") return "离线体验";
    if (authSession?.user) {
      return formatQuotaDisplay(
        authSession.user.quota,
        authSession.siteStatus
      );
    }
    if (billing?.supported && billing.remainingUsd !== undefined) {
      return `$${billing.remainingUsd.toFixed(2)}`;
    }
    if (config.apiKey) return "已连接";
    return "未配置";
  })();

  const tokenSubtitle = (() => {
    if (authSession?.mode === "guest") return "本地沙箱工作台";
    if (activeToken) {
      return `${activeToken.name} · ${maskApiKey(activeToken.key || activeToken.maskedKey)}`;
    }
    if (authSession?.activeApiKey) {
      return maskApiKey(authSession.activeApiKey);
    }
    if (config.apiKey) {
      return maskApiKey(config.apiKey);
    }
    return "无活动令牌";
  })();

  const isConnected = Boolean(authSession && authSession.mode !== "guest" && config.apiKey);

  return (
    <aside
      className={`flex flex-col bg-[var(--bg-sidebar)] border-r border-[var(--border-hairline)] h-full min-h-0 select-none ${className}`}
    >
      {/* 顶部动作：新建会话与 ⌘K 搜索入口 */}
      <div className="p-2 space-y-1 border-b border-[var(--border-hairline)] shrink-0">
        <button
          type="button"
          onClick={() => createSession()}
          className="w-full h-7 px-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)] transition cursor-pointer"
        >
          <MessageSquarePlus className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
          <span>新建会话</span>
        </button>

        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="w-full h-7 px-2 rounded-md hover:bg-[var(--bg-hover)] flex items-center justify-between text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition cursor-pointer"
        >
          <span className="flex items-center gap-2 truncate">
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span>快速跳转 / 命令</span>
          </span>
          <kbd className="text-[10px] font-mono px-1 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-muted)] leading-none">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* 中部：扁平分区折叠列表 (28px h-7 精密行高) */}
      <div className="flex-1 overflow-y-auto px-1.5 py-2 space-y-3 min-h-0">
        {/* 分区 1：工作区文件 */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverFiles(true);
          }}
          onDragLeave={() => setDragOverFiles(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragOverFiles(false);
            if (e.dataTransfer.files?.length) {
              await uploadWorkspaceBatch(e.dataTransfer.files);
            }
          }}
          className={`rounded-md transition ${
            dragOverFiles
              ? "ring-1 ring-[var(--accent)] bg-[var(--accent-soft)]"
              : ""
          }`}
        >
          <div
            onClick={() => setFilesOpen((v) => !v)}
            className="h-6 px-1.5 flex items-center justify-between gap-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
          >
            <div className="flex items-center gap-1 min-w-0">
              {filesOpen ? (
                <ChevronDown className="w-3 h-3 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0" />
              )}
              <span className="truncate">工作区文件</span>
              <span className="tabular-nums text-[10px] opacity-75 shrink-0">({files.length})</span>
            </div>
            <div
              ref={createMenuRef}
              className="relative flex items-center gap-0.5 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                disabled={creatingDoc}
                onClick={() => setCreateMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={createMenuOpen}
                aria-label="新建文档"
                title="新建 Excel / Word / 幻灯片 / Markdown"
                className={`h-5 px-1.5 rounded inline-flex items-center gap-0.5 text-[11px] font-medium transition cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                  createMenuOpen
                    ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                {creatingDoc ? (
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                ) : (
                  <Plus className="w-3 h-3 shrink-0" />
                )}
                <span>新建</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.csv,.tsv,.docx,.pptx,.pdf,.md,.txt,.json,.png,.jpg,.jpeg,.webp"
                onChange={handleUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-5 h-5 rounded hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                title="导入 Office / 文档"
              >
                <Upload className="w-3 h-3" />
              </button>
              <button
                type="button"
                disabled={files.length === 0 || exportingZip}
                onClick={() => void handleExportZip()}
                className="w-5 h-5 rounded hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title={files.length === 0 ? "暂无文件可打包" : "打包导出 ZIP"}
                aria-label="打包导出 ZIP"
              >
                {exportingZip ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Archive className="w-3 h-3" />
                )}
              </button>
              {platform.canMountNativeDir && (
                <button
                  type="button"
                  onClick={() => mountNativeDirectory()}
                  className="w-5 h-5 rounded hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  title="挂载本地目录"
                >
                  <FolderOpen className="w-3 h-3" />
                </button>
              )}

              {createMenuOpen && (
                <div
                  role="menu"
                  aria-label="新建文档类型"
                  className="absolute right-0 top-6 w-48 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl z-30 py-1 overflow-hidden"
                >
                  <div className="px-2.5 py-1 text-[10px] font-medium text-[var(--text-muted)] border-b border-[var(--border-hairline)]">
                    新建工作区文档
                  </div>
                  {(
                    [
                      {
                        kind: "excel",
                        category: "excel",
                        label: "Excel 表格",
                        ext: ".xlsx",
                      },
                      {
                        kind: "word",
                        category: "word",
                        label: "Word 文档",
                        ext: ".docx",
                      },
                      {
                        kind: "slides",
                        category: "slides",
                        label: "高颜值幻灯片",
                        ext: ".slides.html",
                      },
                      {
                        kind: "markdown",
                        category: "markdown",
                        label: "Markdown 文档",
                        ext: ".md",
                      },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.kind}
                      type="button"
                      role="menuitem"
                      onClick={() => void handleCreateDocument(item.kind)}
                      className="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <FileIcon category={item.category} className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">
                        {item.ext}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {filesOpen && (
            <div className="mt-1 space-y-1">
              {files.length > 0 && (
                <div className="px-1">
                  <div className="h-7 px-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] focus-within:border-[var(--border-strong)] flex items-center gap-1.5 transition">
                    <Search className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                    <input
                      type="text"
                      value={fileQuery}
                      onChange={(e) => setFileQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape" && fileQuery) {
                          e.stopPropagation();
                          setFileQuery("");
                        }
                      }}
                      placeholder="搜索工作区文件..."
                      aria-label="搜索工作区文件"
                      className="w-full min-w-0 bg-transparent text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                    />
                    {fileQuery && (
                      <button
                        type="button"
                        onClick={() => setFileQuery("")}
                        className="w-4 h-4 rounded hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0 cursor-pointer"
                        title="清空搜索"
                        aria-label="清空搜索"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-0.5">
                {files.length === 0 ? (
                  <div className="px-2 py-2 text-[11px] text-[var(--text-muted)]">
                    拖拽或点击右上角导入文档
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <div className="px-2 py-3 text-center space-y-1">
                    <div className="text-[11px] text-[var(--text-muted)] truncate">
                      未找到匹配「{fileQuery.trim()}」的文件
                    </div>
                    <button
                      type="button"
                      onClick={() => setFileQuery("")}
                      className="text-[11px] text-[var(--accent)] hover:underline cursor-pointer"
                    >
                      清空筛选
                    </button>
                  </div>
                ) : (
                  filteredFiles.map((f) => {
                    const active = activePreviewPath === f.path;
                    const isEditing = editingFilePath === f.path;

                    if (isEditing) {
                      return (
                        <div
                          key={f.path}
                          onClick={(e) => e.stopPropagation()}
                          className="h-7 px-1.5 rounded-md flex items-center gap-1 bg-[var(--bg-active)] border border-[var(--border-strong)]"
                        >
                          <FileIcon category={f.category} className="w-3.5 h-3.5 shrink-0" />
                          <input
                            type="text"
                            value={editingFileName}
                            autoFocus
                            disabled={renamingFile}
                            onFocus={(e) => {
                              const dotIdx = e.currentTarget.value.lastIndexOf(".");
                              if (dotIdx > 0) {
                                e.currentTarget.setSelectionRange(0, dotIdx);
                              } else {
                                e.currentTarget.select();
                              }
                            }}
                            onChange={(e) => setEditingFileName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void commitFileRename(f);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelFileRename();
                              }
                            }}
                            onBlur={cancelFileRename}
                            className="flex-1 min-w-0 bg-transparent text-[12px] text-[var(--text-primary)] outline-none"
                            aria-label={`重命名文件 ${f.name}`}
                          />
                          <button
                            type="button"
                            disabled={renamingFile}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => void commitFileRename(f)}
                            className="w-5 h-5 rounded hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--accent)] shrink-0 cursor-pointer"
                            title="确认重命名"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={renamingFile}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={cancelFileRename}
                            className="w-5 h-5 rounded hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0 cursor-pointer"
                            title="取消"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    }

                    const isConfirmingDelete = confirmDeletePath === f.path;

                    return (
                      <div
                        key={f.path}
                        onClick={() => {
                          if (!isConfirmingDelete) {
                            openPreview(f.path);
                          }
                        }}
                        className={`group h-7 px-2 rounded-md flex items-center justify-between gap-1.5 text-[12px] cursor-pointer transition ${
                          active
                            ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileIcon category={f.category} className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate" title={f.path}>
                            {f.name}
                          </span>
                        </div>
                        {isConfirmingDelete ? (
                          <div
                            className="flex items-center gap-1 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => void handleDeleteFile(f.path)}
                              className="h-5 px-1.5 rounded bg-[var(--status-danger)] text-white text-[10px] font-medium hover:opacity-90 cursor-pointer whitespace-nowrap"
                              title="再次点击确认删除该文件"
                            >
                              确认删除
                            </button>
                            <button
                              type="button"
                              onClick={clearDeleteConfirm}
                              className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                              title="取消删除"
                              aria-label="取消删除"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="hidden md:inline text-[10px] text-[var(--text-muted)] tabular-nums shrink-0 md:group-hover:hidden">
                              {formatFileSize(f.size)}
                            </span>
                            <div className="flex md:hidden md:group-hover:flex items-center gap-0.5 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startFileRename(f);
                                }}
                                className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                                title="重命名文件"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  armDeleteConfirm(f.path);
                                }}
                                className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
                                title="删除文件"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </section>

        {/* 分区 2：会话历史 */}
        <section>
          <div
            onClick={() => setChatsOpen((v) => !v)}
            className="h-6 px-1.5 flex items-center justify-between text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
          >
            <div className="flex items-center gap-1 min-w-0">
              {chatsOpen ? (
                <ChevronDown className="w-3 h-3 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0" />
              )}
              <span>会话历史</span>
              <span className="tabular-nums text-[10px] opacity-75">({sessions.length})</span>
            </div>
          </div>

          {chatsOpen && (
            <div className="mt-0.5 space-y-0.5">
              {sessions.map((s) => {
                const active = s.id === activeSessionId;
                const isEditing = editingSessionId === s.id;

                if (isEditing) {
                  return (
                    <div
                      key={s.id}
                      onClick={(e) => e.stopPropagation()}
                      className="h-7 px-1.5 rounded-md flex items-center gap-1 bg-[var(--bg-active)] border border-[var(--border-strong)]"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                      <input
                        type="text"
                        value={editingSessionTitle}
                        autoFocus
                        disabled={renamingSession}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setEditingSessionTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void commitSessionRename(s);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelSessionRename();
                          }
                        }}
                        onBlur={cancelSessionRename}
                        className="flex-1 min-w-0 bg-transparent text-[12px] text-[var(--text-primary)] outline-none"
                        aria-label={`重命名会话 ${s.title}`}
                      />
                      <button
                        type="button"
                        disabled={renamingSession}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void commitSessionRename(s)}
                        className="w-5 h-5 rounded hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--accent)] shrink-0 cursor-pointer"
                        title="保存名称"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={renamingSession}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={cancelSessionRename}
                        className="w-5 h-5 rounded hover:bg-[var(--bg-hover)] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0 cursor-pointer"
                        title="取消"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={s.id}
                    onClick={() => selectSession(s.id)}
                    className={`group h-7 px-2 rounded-md flex items-center justify-between gap-1.5 text-[12px] cursor-pointer transition ${
                      active
                        ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                      <span className="truncate">{s.title}</span>
                    </div>
                    <span className="hidden md:inline text-[10px] text-[var(--text-muted)] tabular-nums shrink-0 md:group-hover:hidden">
                      {s.messages.length}
                    </span>
                    <div className="flex md:hidden md:group-hover:flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startSessionRename(s);
                        }}
                        className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                        title="重命名会话"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          exportSessionMarkdown(s.id).catch((err) => {
                            pushToast(
                              err instanceof Error ? err.message : String(err),
                              "error"
                            );
                          });
                        }}
                        className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                        title="导出 Markdown"
                      >
                        <FileDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteSession(s.id);
                        }}
                        className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
                        title="删除会话"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 分区 3：办公技能 */}
        <section>
          <div
            onClick={() => setSkillsOpen((v) => !v)}
            className="h-6 px-1.5 flex items-center justify-between text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
          >
            <div className="flex items-center gap-1 min-w-0">
              {skillsOpen ? (
                <ChevronDown className="w-3 h-3 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0" />
              )}
              <span>办公技能</span>
              <span className="tabular-nums text-[10px] opacity-75">({allSkills.length})</span>
            </div>
          </div>

          {skillsOpen && (
            <div className="mt-0.5 space-y-0.5">
              {allSkills.map((sk) => {
                const active = activeSkillId === sk.id;
                return (
                  <div
                    key={sk.id}
                    onClick={() => setActiveSkill(active ? undefined : sk.id)}
                    title={sk.description}
                    className={`group h-7 px-2 rounded-md flex items-center justify-between gap-1.5 text-[12px] cursor-pointer transition ${
                      active
                        ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Wand2
                        className={`w-3.5 h-3.5 shrink-0 ${
                          active ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
                        }`}
                      />
                      <span className="truncate">{sk.name}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {active && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                      )}
                      {onUseSkillPrompt && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveSkill(sk.id);
                            onUseSkillPrompt(sk.prompt, sk.id);
                          }}
                          className="opacity-75 md:opacity-0 md:group-hover:opacity-100 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
                          title="挂载并填入提示词"
                        >
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* 底部固定极简账户条 */}
      <div className="shrink-0 border-t border-[var(--border-hairline)] px-2.5 py-2 bg-[var(--bg-sidebar)]">
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                isConnected ? "bg-[var(--status-success)]" : "bg-[var(--text-muted)]"
              }`}
            />
            <span className="font-medium text-[var(--text-primary)] truncate">
              {userName}
            </span>
          </div>
          <span className="font-mono text-[11px] text-[var(--text-secondary)] tabular-nums shrink-0">
            {quotaDisplay}
          </span>
        </div>

        <div className="mt-1 flex items-center justify-between gap-1">
          <span className="font-mono text-[10px] text-[var(--text-muted)] truncate">
            {tokenSubtitle}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            {isNonGuest && (
              <button
                type="button"
                onClick={() => {
                  refreshAccountSession().catch(() => refreshBilling());
                }}
                className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                title="刷新余额与会话"
              >
                <RefreshCw
                  className={`w-3 h-3 ${
                    billingLoading || authBusy ? "animate-spin" : ""
                  }`}
                />
              </button>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              title="设置"
            >
              <Settings className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => logout()}
              className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
              title="退出登录"
            >
              <LogOut className="w-3 h-3" />
            </button>
          </div>
        </div>

        <a
          href={consoleLinks.topupUrl}
          target="_blank"
          rel="noreferrer"
          className={
            isNonGuest
              ? "mt-2 h-6.5 px-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] flex items-center justify-between text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
              : "mt-1.5 h-6 px-1.5 rounded flex items-center justify-between text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition"
          }
          title={isNonGuest ? "前往站点控制台管理令牌与充值" : "前往站点控制台登录或充值"}
        >
          <span className="truncate">前往控制台 / 充值</span>
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      </div>
    </aside>
  );
}
