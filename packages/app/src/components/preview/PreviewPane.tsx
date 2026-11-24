import {
  Download,
  File,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  History,
  Loader2,
  Maximize2,
  Minimize2,
  Presentation,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  createPdfDocument,
  createWordDocument,
  detectFileCategory,
  getFileExtension,
  inferMimeType,
  markdownToPdfSpec,
  markdownToWordSpec,
} from "../../office";
import { workspaceVfs } from "../../storage/workspace-vfs";
import { useAppStore } from "../../store/useAppStore";
import type { FileSnapshot, OfficeFileCategory } from "../../types";
import { ErrorBoundary } from "../common/ErrorBoundary";
import { Button, Tooltip, cn } from "../ui";
import { ExcelViewer } from "./ExcelViewer";
import { PdfViewer } from "./PdfViewer";
import { PptViewer } from "./PptViewer";
import { SlidesViewer } from "./SlidesViewer";
import { TextCodeViewer } from "./TextCodeViewer";
import { WordViewer } from "./WordViewer";

function MonochromeFileIcon({
  category,
  className = "w-3.5 h-3.5",
}: {
  category: OfficeFileCategory;
  className?: string;
}) {
  const cls = `${className} text-[var(--text-secondary)] shrink-0`;
  switch (category) {
    case "excel":
      return <FileSpreadsheet className={cls} strokeWidth={1.6} />;
    case "word":
      return <FileType className={cls} strokeWidth={1.6} />;
    case "ppt":
    case "slides":
      return <Presentation className={cls} strokeWidth={1.6} />;
    case "pdf":
    case "markdown":
    case "text":
      return <FileText className={cls} strokeWidth={1.6} />;
    case "code":
      return <FileCode2 className={cls} strokeWidth={1.6} />;
    case "image":
      return <FileImage className={cls} strokeWidth={1.6} />;
    default:
      return <File className={cls} strokeWidth={1.6} />;
  }
}

const CATEGORY_FORMAT_FALLBACK: Record<OfficeFileCategory, string> = {
  excel: "XLSX",
  word: "DOCX",
  ppt: "PPTX",
  slides: "SLIDES",
  pdf: "PDF",
  markdown: "MD",
  code: "CODE",
  image: "IMG",
  text: "TXT",
  binary: "BIN",
};

function getFormatTag(path: string, category: OfficeFileCategory): string {
  if (category === "slides") return "SLIDES";
  const ext = getFileExtension(path);
  return ext ? ext.toUpperCase() : CATEGORY_FORMAT_FALLBACK[category];
}

export function PreviewPane() {
  const {
    activePreviewPath,
    previewRevision,
    previewExpanded,
    setPreviewExpanded,
    openPreview,
    closePreview,
    exportWorkspaceFile,
    pushToast,
  } = useAppStore();

  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [snapshots, setSnapshots] = useState<FileSnapshot[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [convertingFormat, setConvertingFormat] = useState<"docx" | "pdf" | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHistoryOpen(false);
    setSnapshots([]);
    if (!activePreviewPath) {
      setBytes(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [data, snaps] = await Promise.all([
          workspaceVfs.readBytes(activePreviewPath),
          workspaceVfs.getSnapshots(activePreviewPath),
        ]);
        if (!cancelled) {
          setBytes(data);
          setSnapshots(snaps);
        }
      } catch {
        if (!cancelled) {
          setBytes(null);
          setSnapshots([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePreviewPath, previewRevision]);

  useEffect(() => {
    if (!historyOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHistoryOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [historyOpen]);

  useEffect(() => {
    if (!activePreviewPath || !bytes) {
      setImageUrl(null);
      return;
    }
    const cat = detectFileCategory(activePreviewPath);
    if (cat !== "image") {
      setImageUrl(null);
      return;
    }
    const copy = new Uint8Array(bytes);
    const url = URL.createObjectURL(
      new Blob([copy], { type: inferMimeType(activePreviewPath) })
    );
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [activePreviewPath, bytes]);

  if (!activePreviewPath || !bytes) {
    return (
      <div
        data-preview-pane
        tabIndex={-1}
        className="h-full flex flex-col items-center justify-center p-6 text-center bg-[var(--bg-canvas)] border-l border-[var(--border-hairline)] outline-none"
      >
        <FileText className="w-6 h-6 text-[var(--text-muted)] mb-2.5 stroke-[1.5]" />
        <p className="text-xs text-[var(--text-muted)] max-w-[260px] leading-relaxed">
          点击左侧工作区中的 Excel / Word / PPT / PDF，即可在此处实时预览或直接编辑。
        </p>
      </div>
    );
  }

  const category = detectFileCategory(activePreviewPath);
  const formatTag = getFormatTag(activePreviewPath, category);
  const isMarkdown =
    category === "markdown" || /\.(md|mdx|markdown)$/i.test(activePreviewPath);

  /** 为避免静默覆盖已有目标文件，若用户取消覆盖则自动生成带序号的新文件名 */
  const resolveConversionTargetPath = async (
    stem: string,
    ext: "docx" | "pdf"
  ): Promise<string> => {
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
  };

  const handleConvertMarkdown = async (targetFormat: "docx" | "pdf") => {
    if (!activePreviewPath || !bytes || convertingFormat) return;
    setConvertingFormat(targetFormat);
    const formatLabel = targetFormat === "docx" ? "Word" : "PDF";
    try {
      const sourceText = new TextDecoder("utf-8").decode(bytes);
      const stem = activePreviewPath.replace(/\.(md|mdx|markdown)$/i, "");
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
        `已转存 ${formatLabel} 至工作区并打开预览，可点击右上角导出下载：${targetPath}`,
        "success"
      );
    } catch (err) {
      pushToast(
        `转存 ${targetFormat.toUpperCase()} 失败：${
          err instanceof Error ? err.message : String(err)
        }`,
        "error"
      );
    } finally {
      setConvertingFormat(null);
    }
  };

  return (
    <div
      data-preview-pane
      tabIndex={-1}
      className="flex flex-col h-full min-h-0 bg-[var(--bg-canvas)] border-l border-[var(--border-hairline)] relative outline-none"
    >
      {/* 极简自适应顶栏：保持 h-11 基准高度与 TopBar 齐平，窄屏自动折行保护文件名始终可见 */}
      <header className="@container min-h-11 py-1 shrink-0 px-3 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex flex-wrap items-center justify-between gap-x-2 gap-y-1 select-none">
        <div className="flex items-center gap-2 min-w-[120px] flex-1">
          <MonochromeFileIcon category={category} className="w-3.5 h-3.5" />
          <Tooltip content={activePreviewPath} side="bottom">
            <span className="text-[12px] font-linear-medium text-[var(--text-primary)] truncate">
              {activePreviewPath}
            </span>
          </Tooltip>
          <span className="shrink-0 text-[10px] font-mono tracking-wider uppercase text-[var(--text-muted)] px-1.5 py-0.5 rounded-[4px] bg-[var(--surface-subtle)] border border-[var(--border-hairline)]">
            {formatTag}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-auto relative" ref={historyRef}>
          {isMarkdown && (
            <>
              <Tooltip content="将当前 Markdown 文档转存为 Word (.docx)" side="bottom">
                <Button
                  variant="secondary"
                  size="xs"
                  disabled={convertingFormat !== null}
                  onClick={() => void handleConvertMarkdown("docx")}
                  className="h-7 px-2 text-[11px] bg-[var(--bg-canvas)]"
                >
                  {convertingFormat === "docx" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <FileType className="w-3 h-3" />
                  )}
                  <span>{convertingFormat === "docx" ? "转换中…" : "转存 Word"}</span>
                </Button>
              </Tooltip>
              <Tooltip content="将当前 Markdown 文档转存为 PDF 并预览" side="bottom">
                <Button
                  variant="secondary"
                  size="xs"
                  disabled={convertingFormat !== null}
                  onClick={() => void handleConvertMarkdown("pdf")}
                  className="h-7 px-2 text-[11px] bg-[var(--bg-canvas)]"
                >
                  {convertingFormat === "pdf" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <FileText className="w-3 h-3" />
                  )}
                  <span>{convertingFormat === "pdf" ? "转换中…" : "转存 PDF"}</span>
                </Button>
              </Tooltip>
            </>
          )}

          {snapshots.length > 0 && (
            <Tooltip content="版本快照与回滚" side="bottom">
              <Button
                variant={historyOpen ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setHistoryOpen((v) => !v)}
                aria-expanded={historyOpen}
                aria-label="版本快照与回滚"
                className={cn(
                  "h-7 px-1.5 gap-1 text-[11px]",
                  historyOpen &&
                    "bg-[var(--bg-active)] border-[var(--border-strong)] text-[var(--text-primary)]"
                )}
              >
                <History className="w-3.5 h-3.5" />
                <span className="font-mono tabular-nums text-[10px]">{snapshots.length}</span>
              </Button>
            </Tooltip>
          )}

          <Tooltip content="导出 / 分享" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => exportWorkspaceFile(activePreviewPath)}
              aria-label="导出或分享"
            >
              <Download className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>

          <Tooltip
            content={
              previewExpanded
                ? "还原为分栏视图"
                : "全屏展开工作台，畅享完整原生 Office 工具栏"
            }
            shortcut="\\"
            side="bottom"
          >
            <Button
              variant={previewExpanded ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setPreviewExpanded(!previewExpanded)}
              aria-label={previewExpanded ? "还原分栏" : "展开编辑"}
              aria-pressed={previewExpanded}
              className={cn(
                "hidden md:inline-flex h-7 px-2 text-[11px]",
                previewExpanded
                  ? "bg-[var(--accent-soft)] border-[var(--accent)]/45 text-[var(--text-primary)] hover:bg-[var(--accent-soft)]"
                  : "border border-[var(--border-hairline)] bg-[var(--bg-canvas)]"
              )}
            >
              {previewExpanded ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden @[380px]:inline">还原分栏</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden @[380px]:inline">展开编辑</span>
                </>
              )}
            </Button>
          </Tooltip>

          <Tooltip content="关闭文档台" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => closePreview()}
              aria-label="关闭预览"
              className="hidden md:inline-flex"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>

          {historyOpen && (
            <div className="absolute right-0 top-9 w-72 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-[var(--shadow-popover)] z-40 overflow-hidden">
              <div className="px-3 py-2 text-[11px] font-linear-medium text-[var(--text-secondary)] border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between">
                <span>版本快照回滚</span>
                <span className="font-mono tabular-nums text-[10px] text-[var(--text-muted)]">
                  {snapshots.length} 条记录
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-[var(--border-hairline)]">
                {snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="px-3 py-2 hover:bg-[var(--bg-hover)] flex items-center justify-between gap-2 text-xs transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-linear-medium text-[var(--text-primary)]">
                        {snap.note || "历史版本"}
                      </div>
                      <div className="text-[10px] font-mono tabular-nums text-[var(--text-muted)] mt-0.5">
                        {new Date(snap.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="xs"
                      disabled={restoringId === snap.id}
                      onClick={async () => {
                        setRestoringId(snap.id);
                        try {
                          await workspaceVfs.restoreSnapshot(snap.id, activePreviewPath);
                          setHistoryOpen(false);
                        } finally {
                          setRestoringId(null);
                        }
                      }}
                    >
                      <RotateCcw className="w-3 h-3 text-[var(--accent)]" />
                      <span>回滚</span>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* 主体内容（面板级容错保护，防止异常文档渲染拖垮整个工作台） */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ErrorBoundary
          scope="panel"
          title="文档预览渲染异常"
          resetKey={`${activePreviewPath}-${previewRevision}`}
          fallbackActions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => exportWorkspaceFile(activePreviewPath)}
            >
              <Download className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <span>导出原文件</span>
            </Button>
          }
        >
          {category === "excel" && <ExcelViewer path={activePreviewPath} bytes={bytes} />}
          {category === "word" && <WordViewer path={activePreviewPath} bytes={bytes} />}
          {category === "ppt" && <PptViewer path={activePreviewPath} bytes={bytes} />}
          {category === "slides" && <SlidesViewer path={activePreviewPath} bytes={bytes} />}
          {category === "pdf" && <PdfViewer bytes={bytes} />}
          {(category === "markdown" || category === "code" || category === "text") && (
            <TextCodeViewer path={activePreviewPath} bytes={bytes} category={category} />
          )}
          {category === "image" && imageUrl && (
            <div className="h-full overflow-auto p-6 flex items-center justify-center bg-[var(--surface-paper)]">
              <img
                src={imageUrl}
                alt={activePreviewPath}
                className="max-w-full max-h-full rounded-md border border-[var(--border-hairline)] shadow-sm object-contain"
              />
            </div>
          )}
          {category === "binary" && (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-[var(--surface-paper)]">
              <div className="max-w-xs rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 space-y-3">
                <File className="w-6 h-6 text-[var(--text-muted)] mx-auto stroke-[1.5]" />
                <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                  该文件类型不支持在线预览（{bytes.byteLength} 字节）。
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => exportWorkspaceFile(activePreviewPath)}
                >
                  <Download className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                  <span>导出到本地查看</span>
                </Button>
              </div>
            </div>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}
