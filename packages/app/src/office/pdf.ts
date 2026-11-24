import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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

export type PdfSection =
  | { type: "heading"; level?: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "table"; headers?: string[]; rows: string[][] };

export interface CreatePdfSpec {
  title: string;
  subtitle?: string;
  paragraphs?: string[];
  sections?: PdfSection[];
  footerText?: string;
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

/** 收集规格中全部文本，用于判断是否包含中文等非 ASCII 字符 */
function collectSpecText(spec: CreatePdfSpec): string {
  const parts: string[] = [spec.title, spec.subtitle || "", spec.footerText || ""];
  if (spec.paragraphs) {
    parts.push(...spec.paragraphs);
  }
  if (spec.sections) {
    for (const sec of spec.sections) {
      if (sec.type === "heading" || sec.type === "paragraph") {
        parts.push(sec.text);
      } else if (sec.type === "bullets") {
        parts.push(...sec.items);
      } else if (sec.type === "table") {
        if (sec.headers) parts.push(...sec.headers);
        for (const row of sec.rows) {
          parts.push(...row);
        }
      }
    }
  }
  return parts.join("\n");
}

/** 将 paragraphs 与 sections 统一归并为结构化渲染序列，向下兼容纯 paragraphs 调用 */
function resolvePdfSections(spec: CreatePdfSpec): PdfSection[] {
  const result: PdfSection[] = [];
  if (spec.paragraphs && spec.paragraphs.length > 0) {
    for (const text of spec.paragraphs) {
      result.push({ type: "paragraph", text });
    }
  }
  if (spec.sections && spec.sections.length > 0) {
    result.push(...spec.sections);
  }
  return result;
}

/** 按比例与最小宽度约束自动分配表格列宽 */
function computeColumnWidths(
  colCount: number,
  maxWidth: number,
  headers: string[] | undefined,
  rows: string[][],
  measureHeader: (text: string) => number,
  measureCell: (text: string) => number,
  padX: number,
  minColWidth: number
): number[] {
  if (colCount <= 0) return [];
  const rawWidths = new Array<number>(colCount).fill(minColWidth);
  if (headers) {
    for (let c = 0; c < colCount; c++) {
      const w = measureHeader(headers[c] ?? "") + padX * 2;
      if (w > rawWidths[c]) rawWidths[c] = w;
    }
  }
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      const w = measureCell(row[c] ?? "") + padX * 2;
      if (w > rawWidths[c]) rawWidths[c] = w;
    }
  }

  const effectiveMin = Math.min(minColWidth, maxWidth / colCount);
  const clamped = rawWidths.map((w) => Math.max(effectiveMin, w));
  const total = clamped.reduce((acc, w) => acc + w, 0);

  if (total <= maxWidth) {
    // 剩余空间按既有比例分配，使表格对齐页面宽度
    const extra = maxWidth - total;
    return clamped.map((w) => w + (extra * w) / total);
  }

  // 超宽时按可压缩余量缩减，同时守住最小列宽
  const reducible = clamped.map((w) => Math.max(0, w - effectiveMin));
  const reducibleSum = reducible.reduce((acc, r) => acc + r, 0);
  const overflow = total - maxWidth;
  if (reducibleSum <= 0.001) {
    return new Array<number>(colCount).fill(maxWidth / colCount);
  }
  return clamped.map((w, idx) => w - (overflow * reducible[idx]) / reducibleSum);
}

/** Canvas 文本自动换行（支持中英文混排、显式换行及超长连续串拆行） */
function wrapTextCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const normalized = (text || "").replace(/\r\n/g, "\n");
  const rawLines = normalized.split("\n");
  const out: string[] = [];

  for (const rawLine of rawLines) {
    if (!rawLine) {
      out.push("");
      continue;
    }
    const tokens = rawLine.match(/[A-Za-z0-9_./:-]+|\s+|./g) || [rawLine];
    let current = "";
    for (const token of tokens) {
      const candidate = current + token;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current.trimEnd()) {
        out.push(current.trimEnd());
        current = token.trimStart();
      } else {
        current = token;
      }
      // 单个超长词超出最大宽度时按字符拆行
      while (current && ctx.measureText(current).width > maxWidth) {
        let cut = current.length - 1;
        while (cut > 1 && ctx.measureText(current.slice(0, cut)).width > maxWidth) {
          cut -= 1;
        }
        out.push(current.slice(0, cut));
        current = current.slice(cut);
      }
    }
    if (current || rawLine === "") {
      out.push(current.trimEnd());
    }
  }
  return out.length > 0 ? out : [""];
}

/** 离屏 Canvas 高清渲染（支持中文、多级标题、列表、自动换行表格、分页与页眉页脚） */
async function createPdfViaCanvasPages(spec: CreatePdfSpec): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(spec.title);
  pdfDoc.setCreator("Mizurisu Agent");

  const pageW = 1190;
  const pageH = 1684;
  const marginX = 96;
  const maxWidth = pageW - marginX * 2;
  const firstPageTopY = 108;
  const nextPageTopY = 136;
  const bottomLimit = pageH - 118;

  const pages: Array<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> = [];

  const createCanvasPage = (isFirst: boolean) => {
    const canvas = document.createElement("canvas");
    canvas.width = pageW;
    canvas.height = pageH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, pageW, pageH);
    pages.push({ canvas, ctx });
    return { canvas, ctx, startY: isFirst ? firstPageTopY : nextPageTopY };
  };

  let current = createCanvasPage(true);
  let ctx = current.ctx;
  let y = current.startY;
  let pageStartY = current.startY;

  const startNewPage = () => {
    current = createCanvasPage(false);
    ctx = current.ctx;
    y = current.startY;
    pageStartY = current.startY;
  };

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > bottomLimit && y > pageStartY + 10) {
      startNewPage();
    }
  };

  // 绘制主标题（支持自动换行）
  ctx.fillStyle = "#1E1B4B";
  ctx.font = 'bold 42px "PingFang SC", "Microsoft YaHei", sans-serif';
  const titleLines = wrapTextCanvas(ctx, spec.title, maxWidth);
  for (const line of titleLines) {
    ctx.fillText(line, marginX, y);
    y += 54;
  }

  if (spec.subtitle) {
    ctx.fillStyle = "#64748B";
    ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif';
    const subLines = wrapTextCanvas(ctx, spec.subtitle, maxWidth);
    for (const line of subLines) {
      ctx.fillText(line, marginX, y);
      y += 34;
    }
    y += 10;
  }

  ctx.strokeStyle = "#E2E8F0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(marginX, y);
  ctx.lineTo(pageW - marginX, y);
  ctx.stroke();
  y += 42;

  const sections = resolvePdfSections(spec);
  const fontFamily = '"PingFang SC", "Microsoft YaHei", sans-serif';

  for (const sec of sections) {
    if (sec.type === "heading") {
      const level = sec.level ?? 1;
      const fontSize = level === 1 ? 34 : level === 2 ? 28 : 24;
      const lineHeight = level === 1 ? 46 : level === 2 ? 40 : 35;
      const spaceBefore = level === 1 ? 18 : level === 2 ? 14 : 10;
      const spaceAfter = level === 1 ? 12 : level === 2 ? 8 : 6;

      y += spaceBefore;
      ctx.font = `bold ${fontSize}px ${fontFamily}`;
      ctx.fillStyle = level === 1 ? "#1E1B4B" : level === 2 ? "#1E293B" : "#334155";
      const lines = wrapTextCanvas(ctx, sec.text, maxWidth);
      // 标题尽量避免孤立在页底
      ensureSpace(lines.length * lineHeight + 48);
      for (const line of lines) {
        ensureSpace(lineHeight);
        ctx.font = `bold ${fontSize}px ${fontFamily}`;
        ctx.fillStyle = level === 1 ? "#1E1B4B" : level === 2 ? "#1E293B" : "#334155";
        ctx.fillText(line, marginX, y);
        y += lineHeight;
      }
      y += spaceAfter;
      continue;
    }

    if (sec.type === "paragraph") {
      ctx.font = `25px ${fontFamily}`;
      ctx.fillStyle = "#1E293B";
      const lineHeight = 40;
      const lines = wrapTextCanvas(ctx, sec.text, maxWidth);
      for (const line of lines) {
        ensureSpace(lineHeight);
        ctx.font = `25px ${fontFamily}`;
        ctx.fillStyle = "#1E293B";
        if (line) {
          ctx.fillText(line, marginX, y);
        }
        y += lineHeight;
      }
      y += 14;
      continue;
    }

    if (sec.type === "bullets") {
      const lineHeight = 38;
      const bulletIndent = 40;
      ctx.font = `24px ${fontFamily}`;
      for (const item of sec.items) {
        const lines = wrapTextCanvas(ctx, item, maxWidth - bulletIndent);
        lines.forEach((line, idx) => {
          ensureSpace(lineHeight);
          ctx.font = `24px ${fontFamily}`;
          ctx.fillStyle = "#4F46E5";
          if (idx === 0) {
            ctx.fillText("•", marginX + 12, y);
          }
          ctx.fillStyle = "#1E293B";
          ctx.fillText(line, marginX + bulletIndent, y);
          y += lineHeight;
        });
        y += 6;
      }
      y += 12;
      continue;
    }

    if (sec.type === "table") {
      const colCount = Math.max(
        sec.headers?.length ?? 0,
        ...sec.rows.map((r) => r.length)
      );
      if (colCount === 0) continue;

      const cellPadX = 16;
      const cellPadY = 14;
      const cellFontSize = 21;
      const cellLineHeight = 30;
      const headerFont = `bold ${cellFontSize}px ${fontFamily}`;
      const bodyFont = `${cellFontSize}px ${fontFamily}`;

      const colWidths = computeColumnWidths(
        colCount,
        maxWidth,
        sec.headers,
        sec.rows,
        (t) => {
          ctx.font = headerFont;
          return ctx.measureText(t).width;
        },
        (t) => {
          ctx.font = bodyFont;
          return ctx.measureText(t).width;
        },
        cellPadX,
        100
      );

      const measureRowLayout = (cells: string[], isHeader: boolean) => {
        ctx.font = isHeader ? headerFont : bodyFont;
        const wrappedCells = Array.from({ length: colCount }, (_, c) =>
          wrapTextCanvas(ctx, cells[c] ?? "", Math.max(40, colWidths[c] - cellPadX * 2))
        );
        const maxLines = Math.max(1, ...wrappedCells.map((lines) => lines.length));
        const height = maxLines * cellLineHeight + cellPadY * 2;
        return { wrappedCells, height };
      };

      const drawTableRow = (
        cells: string[],
        isHeader: boolean,
        rowIndex: number
      ) => {
        const { wrappedCells, height } = measureRowLayout(cells, isHeader);
        // Canvas 中 y 为基线偏下，表格从 topY = y - 24 开始绘制矩形更自然
        const topY = y - 24;
        if (topY + height > bottomLimit && y > pageStartY + 10) {
          startNewPage();
          if (!isHeader && sec.headers && sec.headers.length > 0) {
            drawTableRow(sec.headers, true, -1);
          }
        }

        const drawTop = y - 24;
        let x = marginX;
        for (let c = 0; c < colCount; c++) {
          const w = colWidths[c];
          ctx.fillStyle = isHeader
            ? "#312E81"
            : rowIndex % 2 === 1
              ? "#F8FAFC"
              : "#FFFFFF";
          ctx.fillRect(x, drawTop, w, height);
          ctx.strokeStyle = isHeader ? "#312E81" : "#CBD5E1";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x, drawTop, w, height);

          ctx.font = isHeader ? headerFont : bodyFont;
          ctx.fillStyle = isHeader ? "#FFFFFF" : "#1E293B";
          const cellLines = wrappedCells[c];
          for (let li = 0; li < cellLines.length; li++) {
            const textY = drawTop + cellPadY + cellFontSize + li * cellLineHeight;
            ctx.fillText(cellLines[li], x + cellPadX, textY);
          }
          x += w;
        }
        y = drawTop + height + 24;
      };

      y += 8;
      if (sec.headers && sec.headers.length > 0) {
        const headerLayout = measureRowLayout(sec.headers, true);
        const firstRowHeight =
          sec.rows.length > 0 ? measureRowLayout(sec.rows[0], false).height : 0;
        if (y - 24 + headerLayout.height + firstRowHeight > bottomLimit && y > pageStartY + 10) {
          startNewPage();
        }
        drawTableRow(sec.headers, true, -1);
      }

      sec.rows.forEach((row, idx) => {
        drawTableRow(row, false, idx);
      });
      y += 14;
    }
  }

  // 在全部页面绘制统一的页眉（第 2 页起）与页脚页码
  const totalPages = pages.length;
  const footerLabel = spec.footerText?.trim() || "Mizurisu Agent";
  pages.forEach(({ ctx: pCtx }, idx) => {
    if (idx > 0) {
      pCtx.font = `20px ${fontFamily}`;
      pCtx.fillStyle = "#94A3B8";
      pCtx.fillText(spec.title, marginX, 64, maxWidth - 160);
      pCtx.strokeStyle = "#E2E8F0";
      pCtx.lineWidth = 1.5;
      pCtx.beginPath();
      pCtx.moveTo(marginX, 82);
      pCtx.lineTo(pageW - marginX, 82);
      pCtx.stroke();
    }

    pCtx.strokeStyle = "#E2E8F0";
    pCtx.lineWidth = 1.5;
    pCtx.beginPath();
    pCtx.moveTo(marginX, pageH - 86);
    pCtx.lineTo(pageW - marginX, pageH - 86);
    pCtx.stroke();

    pCtx.font = `20px ${fontFamily}`;
    pCtx.fillStyle = "#64748B";
    pCtx.fillText(footerLabel, marginX, pageH - 46, maxWidth - 220);

    const pageStr = `第 ${idx + 1} / ${totalPages} 页`;
    const pageStrWidth = pCtx.measureText(pageStr).width;
    pCtx.fillText(pageStr, pageW - marginX - pageStrWidth, pageH - 46);
  });

  // 统一将所有 Canvas 转为 PNG 并写入 PDF
  for (const { canvas: pageCanvas } of pages) {
    const dataUrl = pageCanvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1];
    const bin = atob(base64);
    const pngBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) pngBytes[i] = bin.charCodeAt(i);
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([595, 842]);
    page.drawImage(pngImage, { x: 0, y: 0, width: 595, height: 842 });
  }

  const saved = await pdfDoc.save();
  return new Uint8Array(saved);
}

/** 清理 WinAnsi 标准字体不支持的字符，保留 ASCII 与项目符号 • (\u2022) */
function sanitizeWinAnsi(s: string): string {
  return (s || "")
    .replace(/\r\n/g, "\n")
    .replace(/[^\x20-\x7E\n\u2022]/g, "?");
}

/** pdf-lib 矢量文本自动换行（支持显式换行与超长无空格串按字符切分） */
function wrapTextPdfLib(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  const normalized = sanitizeWinAnsi(text);
  const rawLines = normalized.split("\n");
  const out: string[] = [];

  for (const rawLine of rawLines) {
    if (!rawLine) {
      out.push("");
      continue;
    }
    const words = rawLine.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) {
        out.push(line);
        line = "";
      }
      // 单词本身超过列宽时按字符拆行
      let remaining = word;
      while (remaining && font.widthOfTextAtSize(remaining, fontSize) > maxWidth) {
        let cut = remaining.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(remaining.slice(0, cut), fontSize) > maxWidth) {
          cut -= 1;
        }
        out.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut);
      }
      line = remaining;
    }
    if (line) {
      out.push(line);
    }
  }
  return out.length > 0 ? out : [""];
}

/**
 * 生成 PDF 文档：
 * - 包含非 ASCII（如中文）且存在浏览器 Canvas 时，通过高清离屏 Canvas 页面渲染以保证 100% 不乱码
 * - 纯 ASCII 或无 Canvas 环境时直接写入 pdf-lib 标准矢量文本
 */
export async function createPdfDocument(spec: CreatePdfSpec): Promise<Uint8Array> {
  const fullText = collectSpecText(spec);
  if (hasNonAscii(fullText) && canUseCanvasRendering()) {
    return await createPdfViaCanvasPages(spec);
  }

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(spec.title);
  pdfDoc.setCreator("Mizurisu Agent");

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 595;
  const pageH = 842;
  const marginX = 48;
  const maxWidth = pageW - marginX * 2;
  const firstPageTopY = 784;
  const nextPageTopY = 770;
  const bottomLimit = 64;

  let page: PDFPage = pdfDoc.addPage([pageW, pageH]);
  let y = firstPageTopY;
  let pageTopY = firstPageTopY;

  const startNewPage = () => {
    page = pdfDoc.addPage([pageW, pageH]);
    y = nextPageTopY;
    pageTopY = nextPageTopY;
  };

  const ensureSpace = (neededHeight: number) => {
    if (y - neededHeight < bottomLimit && y < pageTopY - 6) {
      startNewPage();
    }
  };

  // 绘制主标题与副标题
  const titleLines = wrapTextPdfLib(spec.title, boldFont, 20, maxWidth);
  for (const line of titleLines) {
    page.drawText(line, {
      x: marginX,
      y,
      size: 20,
      font: boldFont,
      color: rgb(0.12, 0.11, 0.29),
    });
    y -= 26;
  }

  if (spec.subtitle) {
    const subLines = wrapTextPdfLib(spec.subtitle, font, 12, maxWidth);
    for (const line of subLines) {
      page.drawText(line, {
        x: marginX,
        y,
        size: 12,
        font,
        color: rgb(0.39, 0.45, 0.55),
      });
      y -= 17;
    }
    y -= 4;
  }

  // 标题分隔线
  page.drawLine({
    start: { x: marginX, y: y + 4 },
    end: { x: pageW - marginX, y: y + 4 },
    thickness: 0.8,
    color: rgb(0.89, 0.91, 0.94),
  });
  y -= 18;

  const sections = resolvePdfSections(spec);

  for (const sec of sections) {
    if (sec.type === "heading") {
      const level = sec.level ?? 1;
      const fontSize = level === 1 ? 16 : level === 2 ? 13.5 : 11.5;
      const lineHeight = level === 1 ? 22 : level === 2 ? 19 : 16;
      const spaceBefore = level === 1 ? 8 : level === 2 ? 6 : 4;
      const spaceAfter = level === 1 ? 6 : level === 2 ? 5 : 4;
      const color =
        level === 1
          ? rgb(0.12, 0.11, 0.29)
          : level === 2
            ? rgb(0.12, 0.16, 0.23)
            : rgb(0.2, 0.25, 0.33);

      y -= spaceBefore;
      const lines = wrapTextPdfLib(sec.text, boldFont, fontSize, maxWidth);
      ensureSpace(lines.length * lineHeight + 24);
      for (const line of lines) {
        ensureSpace(lineHeight);
        page.drawText(line, { x: marginX, y, size: fontSize, font: boldFont, color });
        y -= lineHeight;
      }
      y -= spaceAfter;
      continue;
    }

    if (sec.type === "paragraph") {
      const fontSize = 11;
      const lineHeight = 16;
      const lines = wrapTextPdfLib(sec.text, font, fontSize, maxWidth);
      for (const line of lines) {
        ensureSpace(lineHeight);
        if (line) {
          page.drawText(line, {
            x: marginX,
            y,
            size: fontSize,
            font,
            color: rgb(0.12, 0.16, 0.23),
          });
        }
        y -= lineHeight;
      }
      y -= 8;
      continue;
    }

    if (sec.type === "bullets") {
      const fontSize = 10.5;
      const lineHeight = 15.5;
      const bulletIndent = 18;
      for (const item of sec.items) {
        const lines = wrapTextPdfLib(item, font, fontSize, maxWidth - bulletIndent);
        lines.forEach((line, idx) => {
          ensureSpace(lineHeight);
          if (idx === 0) {
            page.drawText("\u2022", {
              x: marginX + 5,
              y,
              size: fontSize,
              font: boldFont,
              color: rgb(0.31, 0.27, 0.9),
            });
          }
          page.drawText(line, {
            x: marginX + bulletIndent,
            y,
            size: fontSize,
            font,
            color: rgb(0.12, 0.16, 0.23),
          });
          y -= lineHeight;
        });
        y -= 3;
      }
      y -= 6;
      continue;
    }

    if (sec.type === "table") {
      const colCount = Math.max(
        sec.headers?.length ?? 0,
        ...sec.rows.map((r) => r.length)
      );
      if (colCount === 0) continue;

      const cellPadX = 7;
      const cellPadY = 6;
      const cellFontSize = 9.5;
      const cellLineHeight = 13;

      const colWidths = computeColumnWidths(
        colCount,
        maxWidth,
        sec.headers,
        sec.rows,
        (t) => boldFont.widthOfTextAtSize(sanitizeWinAnsi(t), cellFontSize),
        (t) => font.widthOfTextAtSize(sanitizeWinAnsi(t), cellFontSize),
        cellPadX,
        44
      );

      const measureRowLayout = (cells: string[], isHeader: boolean) => {
        const activeFont = isHeader ? boldFont : font;
        const wrappedCells = Array.from({ length: colCount }, (_, c) =>
          wrapTextPdfLib(
            cells[c] ?? "",
            activeFont,
            cellFontSize,
            Math.max(16, colWidths[c] - cellPadX * 2)
          )
        );
        const maxLines = Math.max(1, ...wrappedCells.map((lines) => lines.length));
        const height = maxLines * cellLineHeight + cellPadY * 2;
        return { wrappedCells, height };
      };

      const drawTableRow = (cells: string[], isHeader: boolean, rowIndex: number) => {
        const { wrappedCells, height } = measureRowLayout(cells, isHeader);
        if (y - height < bottomLimit && y < pageTopY - 6) {
          startNewPage();
          if (!isHeader && sec.headers && sec.headers.length > 0) {
            drawTableRow(sec.headers, true, -1);
          }
        }

        const rectBottomY = y - height;
        const activeFont = isHeader ? boldFont : font;
        let x = marginX;

        for (let c = 0; c < colCount; c++) {
          const w = colWidths[c];
          page.drawRectangle({
            x,
            y: rectBottomY,
            width: w,
            height,
            color: isHeader
              ? rgb(0.19, 0.18, 0.51)
              : rowIndex % 2 === 1
                ? rgb(0.97, 0.98, 0.99)
                : rgb(1, 1, 1),
            borderColor: isHeader ? rgb(0.19, 0.18, 0.51) : rgb(0.8, 0.84, 0.88),
            borderWidth: 0.75,
          });

          const cellLines = wrappedCells[c];
          for (let li = 0; li < cellLines.length; li++) {
            const textY = y - cellPadY - cellFontSize + 1 - li * cellLineHeight;
            page.drawText(cellLines[li], {
              x: x + cellPadX,
              y: textY,
              size: cellFontSize,
              font: activeFont,
              color: isHeader ? rgb(1, 1, 1) : rgb(0.12, 0.16, 0.23),
            });
          }
          x += w;
        }
        y = rectBottomY;
      };

      y -= 4;
      if (sec.headers && sec.headers.length > 0) {
        const headerLayout = measureRowLayout(sec.headers, true);
        const firstRowHeight =
          sec.rows.length > 0 ? measureRowLayout(sec.rows[0], false).height : 0;
        if (y - (headerLayout.height + firstRowHeight) < bottomLimit && y < pageTopY - 6) {
          startNewPage();
        }
        drawTableRow(sec.headers, true, -1);
      }

      sec.rows.forEach((row, idx) => {
        drawTableRow(row, false, idx);
      });
      y -= 14;
    }
  }

  // 在全部页面绘制页眉（第 2 页起）与页脚页码
  const allPages = pdfDoc.getPages();
  const totalPages = allPages.length;
  const footerLabel = sanitizeWinAnsi(spec.footerText?.trim() || "Mizurisu Agent");
  const headerLabel = sanitizeWinAnsi(spec.title);

  allPages.forEach((p, idx) => {
    if (idx > 0) {
      p.drawText(headerLabel.slice(0, 72), {
        x: marginX,
        y: 808,
        size: 9,
        font,
        color: rgb(0.58, 0.64, 0.72),
      });
      p.drawLine({
        start: { x: marginX, y: 798 },
        end: { x: pageW - marginX, y: 798 },
        thickness: 0.6,
        color: rgb(0.89, 0.91, 0.94),
      });
    }

    p.drawLine({
      start: { x: marginX, y: 48 },
      end: { x: pageW - marginX, y: 48 },
      thickness: 0.6,
      color: rgb(0.89, 0.91, 0.94),
    });

    p.drawText(footerLabel.slice(0, 72), {
      x: marginX,
      y: 32,
      size: 9,
      font,
      color: rgb(0.39, 0.45, 0.55),
    });

    const pageText = `Page ${idx + 1} / ${totalPages}`;
    const pageTextWidth = font.widthOfTextAtSize(pageText, 9);
    p.drawText(pageText, {
      x: pageW - marginX - pageTextWidth,
      y: 32,
      size: 9,
      font,
      color: rgb(0.39, 0.45, 0.55),
    });
  });

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
