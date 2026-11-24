import {
  File,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Presentation,
} from "lucide-react";
import type { OfficeFileCategory } from "../../types";

/** 极简单色 Pi 线条几何标志 */
export function PiMark({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4.5 7.25H19.5M8.75 7.25V17.5M15.25 7.25V15.25C15.25 16.5 16.15 17.25 17.5 17.25"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 单色 Linear 风格文件图标，摒弃高饱和多色渲染 */
export function FileIcon({
  category,
  className = "w-4 h-4",
}: {
  category: OfficeFileCategory;
  className?: string;
}) {
  const iconTone =
    category === "binary" ? "text-[var(--text-muted)]" : "text-[var(--text-secondary)]";

  switch (category) {
    case "excel":
      return <FileSpreadsheet className={`${className} ${iconTone}`} strokeWidth={1.6} />;
    case "word":
      return <FileType className={`${className} ${iconTone}`} strokeWidth={1.6} />;
    case "ppt":
    case "slides":
      return <Presentation className={`${className} ${iconTone}`} strokeWidth={1.6} />;
    case "pdf":
      return <FileText className={`${className} ${iconTone}`} strokeWidth={1.6} />;
    case "markdown":
    case "text":
      return <FileText className={`${className} ${iconTone}`} strokeWidth={1.6} />;
    case "code":
      return <FileCode2 className={`${className} ${iconTone}`} strokeWidth={1.6} />;
    case "image":
      return <FileImage className={`${className} ${iconTone}`} strokeWidth={1.6} />;
    default:
      return <File className={`${className} ${iconTone}`} strokeWidth={1.6} />;
  }
}

export function getFileCategoryLabel(category: OfficeFileCategory): string {
  switch (category) {
    case "excel":
      return "XLSX";
    case "word":
      return "DOCX";
    case "ppt":
      return "PPTX";
    case "slides":
      return "SLIDES";
    case "pdf":
      return "PDF";
    case "markdown":
      return "MD";
    case "code":
      return "CODE";
    case "image":
      return "IMG";
    case "text":
      return "TXT";
    default:
      return "BIN";
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
