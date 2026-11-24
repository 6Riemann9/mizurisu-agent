import {
  Download,
  File,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  History,
  Maximize2,
  Minimize2,
  Presentation,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { detectFileCategory, getFileExtension, inferMimeType } from "../../office";
import { workspaceVfs } from "../../storage/workspace-vfs";
import { useAppStore } from "../../store/useAppStore";
import type { FileSnapshot, OfficeFileCategory } from "../../types";
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
      return <FileSpreadsheet className={cls} />;
    case "word":
      return <FileType className={cls} />;
    case "ppt":
    case "slides":
      return <Presentation className={cls} />;
    case "pdf":
    case "markdown":
    case "text":
      return <FileText className={cls} />;
    case "code":
      return <FileCode2 className={cls} />;
    case "image":
      return <FileImage className={cls} />;
    default:
      return <File className={cls} />;
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
    closePreview,
    exportWorkspaceFile,
  } = useAppStore();

  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [snapshots, setSnapshots] = useState<FileSnapshot[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHistoryOpen(false);
    if (!activePreviewPath) {
      setBytes(null);
      setSnapshots([]);
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
        if (!cancelled) setBytes(null);
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
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-[var(--bg-canvas)] border-l border-[var(--border-hairline)]">
        <FileText className="w-6 h-6 text-[var(--text-muted)] mb-2.5 stroke-[1.5]" />
        <p className="text-xs text-[var(--text-muted)] max-w-[260px] leading-relaxed">
          点击左侧工作区中的 Excel / Word / PPT / PDF，即可在此处实时预览或直接编辑。
        </p>
      </div>
    );
  }

  const category = detectFileCategory(activePreviewPath);
  const formatTag = getFormatTag(activePreviewPath, category);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg-canvas)] border-l border-[var(--border-hairline)] relative">
      {/* 极简对齐顶栏：h-11 (44px) */}
      <header className="h-11 shrink-0 px-3 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <MonochromeFileIcon category={category} className="w-3.5 h-3.5" />
          <span
            className="text-xs font-medium text-[var(--text-primary)] truncate"
            title={activePreviewPath}
          >
            {activePreviewPath}
          </span>
          <span className="shrink-0 text-[10px] font-mono tracking-wider uppercase text-[var(--text-muted)] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-hairline)]">
            {formatTag}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0 relative" ref={historyRef}>
          {snapshots.length > 0 && (
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className={`inline-flex items-center gap-1 h-7 px-1.5 rounded-md border text-[11px] transition-colors ${
                historyOpen
                  ? "bg-[var(--bg-active)] border-[var(--border-strong)] text-[var(--text-primary)]"
                  : "border-transparent hover:border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
              title="版本快照与回滚"
            >
              <History className="w-3.5 h-3.5" />
              <span className="font-mono tabular-nums text-[10px]">{snapshots.length}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => exportWorkspaceFile(activePreviewPath)}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="导出 / 分享"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setPreviewExpanded(!previewExpanded)}
            className="hidden md:inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title={previewExpanded ? "退出全屏展开" : "全屏展开文档台"}
          >
            {previewExpanded ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => closePreview()}
            className="hidden md:inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="关闭预览"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          {historyOpen && (
            <div className="absolute right-0 top-9 w-72 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl z-40 overflow-hidden">
              <div className="px-3 py-2 text-[11px] font-medium text-[var(--text-secondary)] border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between">
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
                      <div className="truncate font-medium text-[var(--text-primary)]">
                        {snap.note || "历史版本"}
                      </div>
                      <div className="text-[10px] font-mono tabular-nums text-[var(--text-muted)] mt-0.5">
                        {new Date(snap.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
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
                      className="inline-flex items-center gap-1 h-6 px-2 rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-active)] text-[var(--text-primary)] text-[11px] shrink-0 transition-colors disabled:opacity-50"
                    >
                      <RotateCcw className="w-3 h-3 text-[var(--accent)]" />
                      <span>回滚</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* 主体内容 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {category === "excel" && <ExcelViewer path={activePreviewPath} bytes={bytes} />}
        {category === "word" && <WordViewer bytes={bytes} />}
        {category === "ppt" && <PptViewer bytes={bytes} />}
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
              <button
                type="button"
                onClick={() => exportWorkspaceFile(activePreviewPath)}
                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-active)] text-xs font-medium text-[var(--text-primary)] transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span>导出到本地查看</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
