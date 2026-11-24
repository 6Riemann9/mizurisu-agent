import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

let workerConfigured = false;

export function ensurePdfWorkerConfigured(): void {
  if (workerConfigured) return;
  workerConfigured = true;
  if (typeof window !== "undefined" && typeof Worker !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
}

export interface PdfPageText {
  pageNumber: number;
  text: string;
}

export interface PdfReadResult {
  pageCount: number;
  pages: PdfPageText[];
  title?: string;
}

export interface CreatePdfSpec {
  title: string;
  subtitle?: string;
  paragraphs: string[];
}

export async function readPdfDocument(
  bytes: Uint8Array,
  options?: { startPage?: number; endPage?: number }
): Promise<PdfReadResult> {
  ensurePdfWorkerConfigured();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;
  const total = doc.numPages;
  const start = Math.max(1, options?.startPage ?? 1);
  const end = Math.min(total, options?.endPage ?? total);

  const meta = await doc.getMetadata().catch(() => null);
  const title = (meta?.info as { Title?: string } | undefined)?.Title;

  const pages: PdfPageText[] = [];
  for (let p = start; p <= end; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ pageNumber: p, text: lines });
  }

  return {
    pageCount: total,
    pages,
    title,
  };
}

function hasNonAscii(text: string): boolean {
  return /[^\x00-\x7F]/.test(text);
}

function canUseCanvasRendering(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("2d"));
  } catch {
    return false;
  }
}

async function createPdfViaCanvasPages(spec: CreatePdfSpec): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(spec.title);
  pdfDoc.setCreator("Mizurisu Agent");

  const pageW = 1190;
  const pageH = 1684;
  const marginX = 96;
  const maxWidth = pageW - marginX * 2;

  const renderPageCanvas = () => {
    const canvas = document.createElement("canvas");
    canvas.width = pageW;
    canvas.height = pageH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, pageW, pageH);
    return { canvas, ctx };
  };

  let { canvas, ctx } = renderPageCanvas();
  let y = 110;

  const commitPage = async () => {
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1];
    const bin = atob(base64);
    const pngBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) pngBytes[i] = bin.charCodeAt(i);
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([595, 842]);
    page.drawImage(pngImage, { x: 0, y: 0, width: 595, height: 842 });
  };

  // 绘制标题
  ctx.fillStyle = "#1E1B4B";
  ctx.font = 'bold 42px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(spec.title, marginX, y, maxWidth);
  y += 56;

  if (spec.subtitle) {
    ctx.fillStyle = "#64748B";
    ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(spec.subtitle, marginX, y, maxWidth);
    y += 46;
  }

  ctx.strokeStyle = "#E2E8F0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(marginX, y);
  ctx.lineTo(pageW - marginX, y);
  ctx.stroke();
  y += 46;

  ctx.fillStyle = "#1E293B";
  ctx.font = '26px "PingFang SC", "Microsoft YaHei", sans-serif';
  const lineHeight = 42;

  for (const para of spec.paragraphs) {
    let line = "";
    for (const ch of para) {
      if (ch === "\n") {
        ctx.fillText(line, marginX, y);
        line = "";
        y += lineHeight;
      } else {
        const test = line + ch;
        if (ctx.measureText(test).width > maxWidth && line.length > 0) {
          ctx.fillText(line, marginX, y);
          line = ch;
          y += lineHeight;
        } else {
          line = test;
        }
      }
      if (y > pageH - 110) {
        await commitPage();
        ({ canvas, ctx } = renderPageCanvas());
        ctx.fillStyle = "#1E293B";
        ctx.font = '26px "PingFang SC", "Microsoft YaHei", sans-serif';
        y = 110;
      }
    }
    if (line) {
      ctx.fillText(line, marginX, y);
      y += lineHeight;
    }
    y += 18;
    if (y > pageH - 110) {
      await commitPage();
      ({ canvas, ctx } = renderPageCanvas());
      ctx.fillStyle = "#1E293B";
      ctx.font = '26px "PingFang SC", "Microsoft YaHei", sans-serif';
      y = 110;
    }
  }

  await commitPage();
  const saved = await pdfDoc.save();
  return new Uint8Array(saved);
}

/**
 * 生成 PDF 文档：
 * - 包含非 ASCII（如中文）且存在浏览器 Canvas 时，通过高清离屏 Canvas 页面渲染以保证 100% 不乱码
 * - 纯 ASCII 或无 Canvas 环境时直接写入 pdf-lib 标准矢量文本
 */
export async function createPdfDocument(spec: CreatePdfSpec): Promise<Uint8Array> {
  const fullText = [spec.title, spec.subtitle || "", ...spec.paragraphs].join("\n");
  if (hasNonAscii(fullText) && canUseCanvasRendering()) {
    return await createPdfViaCanvasPages(spec);
  }

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(spec.title);
  pdfDoc.setCreator("Mizurisu Agent");

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const sanitizeWinAnsi = (s: string) => s.replace(/[^\x20-\x7E\n]/g, "?");

  let page = pdfDoc.addPage([595, 842]);
  let y = 780;

  page.drawText(sanitizeWinAnsi(spec.title), {
    x: 48,
    y,
    size: 20,
    font: boldFont,
    color: rgb(0.12, 0.11, 0.29),
  });
  y -= 28;

  if (spec.subtitle) {
    page.drawText(sanitizeWinAnsi(spec.subtitle), {
      x: 48,
      y,
      size: 12,
      font,
      color: rgb(0.39, 0.45, 0.55),
    });
    y -= 24;
  }

  const fontSize = 11;
  const maxWidth = 499;
  for (const rawPara of spec.paragraphs) {
    const words = sanitizeWinAnsi(rawPara).split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && line) {
        page.drawText(line, { x: 48, y, size: fontSize, font, color: rgb(0.12, 0.16, 0.23) });
        y -= 17;
        line = word;
        if (y < 60) {
          page = pdfDoc.addPage([595, 842]);
          y = 780;
        }
      } else {
        line = candidate;
      }
    }
    if (line) {
      page.drawText(line, { x: 48, y, size: fontSize, font, color: rgb(0.12, 0.16, 0.23) });
      y -= 24;
    }
    if (y < 60) {
      page = pdfDoc.addPage([595, 842]);
      y = 780;
    }
  }

  const saved = await pdfDoc.save();
  return new Uint8Array(saved);
}

export async function mergePdfDocuments(filesBytes: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const bytes of filesBytes) {
    const src = await PDFDocument.load(bytes);
    const copied = await merged.copyPages(src, src.getPageIndices());
    for (const p of copied) merged.addPage(p);
  }
  const out = await merged.save();
  return new Uint8Array(out);
}
