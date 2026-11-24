import {
  File,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Presentation,
} from "lucide-react";
import mizurisuLogo from "../../assets/mizurisu-logo.png";
import type { OfficeFileCategory } from "../../types";

/** Mizurisu Agent 官方品牌 Logo */
export function BrandLogo({
  className = "w-6 h-6 rounded-md",
  alt = "Mizurisu Agent",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src={mizurisuLogo}
      alt={alt}
      draggable={false}
      className={`${className} object-cover select-none shrink-0`}
    />
  );
}

/** @deprecated 请优先使用 BrandLogo */
export const PiMark = BrandLogo;

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
