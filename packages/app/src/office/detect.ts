import type { OfficeFileCategory } from "../types";

const EXCEL_EXTS = new Set(["xlsx", "xlsm", "xls", "csv", "tsv"]);
const WORD_EXTS = new Set(["docx"]);
const PPT_EXTS = new Set(["pptx"]);
const PDF_EXTS = new Set(["pdf"]);
const MARKDOWN_EXTS = new Set(["md", "mdx", "markdown"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const CODE_EXTS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "yaml",
  "yml",
  "toml",
  "html",
  "css",
  "scss",
  "py",
  "rs",
  "go",
  "java",
  "sql",
  "sh",
  "ps1",
  "xml",
]);
const TEXT_EXTS = new Set(["txt", "log", "env", "ini", "conf"]);

export function getFileExtension(path: string): string {
  const base = path.split("/").pop() || path;
  const idx = base.lastIndexOf(".");
  if (idx <= 0 || idx === base.length - 1) return "";
  return base.slice(idx + 1).toLowerCase();
}

export function detectFileCategory(path: string): OfficeFileCategory {
  const lower = path.toLowerCase();
  if (lower.endsWith(".slides.html") || lower.endsWith(".deck.html")) {
    return "slides";
  }
  const ext = getFileExtension(path);
  if (EXCEL_EXTS.has(ext)) return "excel";
  if (WORD_EXTS.has(ext)) return "word";
  if (PPT_EXTS.has(ext)) return "ppt";
  if (PDF_EXTS.has(ext)) return "pdf";
  if (MARKDOWN_EXTS.has(ext)) return "markdown";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (CODE_EXTS.has(ext)) return "code";
  if (TEXT_EXTS.has(ext)) return "text";
  return "binary";
}

export function inferMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".slides.html") || lower.endsWith(".deck.html")) {
    return "text/html;charset=utf-8";
  }
  const ext = getFileExtension(path);
  switch (ext) {
    case "xlsx":
    case "xlsm":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls":
      return "application/vnd.ms-excel";
    case "csv":
      return "text/csv;charset=utf-8";
    case "tsv":
      return "text/tab-separated-values;charset=utf-8";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "pdf":
      return "application/pdf";
    case "md":
    case "markdown":
      return "text/markdown;charset=utf-8";
    case "json":
      return "application/json;charset=utf-8";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "gif":
      return "image/gif";
    default: {
      const cat = detectFileCategory(path);
      if (cat === "code" || cat === "text" || cat === "markdown") {
        return "text/plain;charset=utf-8";
      }
      return "application/octet-stream";
    }
  }
}

export function isTextReadableCategory(category: OfficeFileCategory): boolean {
  return category === "markdown" || category === "code" || category === "text";
}
