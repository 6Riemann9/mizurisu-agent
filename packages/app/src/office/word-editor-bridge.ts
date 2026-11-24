import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  HighlightColor,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import mammoth from "mammoth";
import type { CreatePdfSpec, PdfSection } from "./pdf";
import { sanitizeSlideHtml } from "./slides-sanitize";

/** Tiptap ProseMirror JSON 节点基础结构 */
export interface TiptapJsonMark {
  type?: string;
  attrs?: Record<string, unknown>;
}

/** Tiptap ProseMirror JSON 节点结构 */
export interface TiptapJsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: TiptapJsonMark[];
  content?: TiptapJsonNode[];
}

/** Tiptap -> Word 转换选项 */
export interface TiptapToWordOptions {
  title?: string;
  headerText?: string;
}

/** 面向 Word 编辑器的 mammoth 样式映射，保留标题、下划线、删除线、引用、代码块与高亮 */
const WORD_EDITOR_STYLE_MAP = [
  "p.Title => h1:fresh",
  "p[style-name='Title'] => h1:fresh",
  "p.Subtitle => p:fresh",
  "p[style-name='Subtitle'] => p:fresh",
  "p.Quote => blockquote > p:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Block Text'] => blockquote > p:fresh",
  "p.CodeBlock => pre > code:fresh",
  "p[style-name='Code Block'] => pre > code:fresh",
  "u => u",
  "strike => s",
  "highlight[color='yellow'] => mark[data-color='#fef08a']",
  "highlight[color='green'] => mark[data-color='#bbf7d0']",
  "highlight[color='cyan'] => mark[data-color='#a5f3fc']",
  "highlight[color='magenta'] => mark[data-color='#fbcfe8']",
  "highlight[color='red'] => mark[data-color='#fecaca']",
  "highlight[color='blue'] => mark[data-color='#bfdbfe']",
  "highlight[color='darkYellow'] => mark[data-color='#fde047']",
  "highlight[color='lightGray'] => mark[data-color='#e2e8f0']",
  "highlight => mark",
];

/** OOXML 标准 HighlightColor 与 RGB 色值映射表（用于将任意 CSS 荧光笔颜色就近映射到 Word 高亮枚举） */
const DOCX_HIGHLIGHT_PALETTE: ReadonlyArray<{
  name: (typeof HighlightColor)[keyof typeof HighlightColor];
  rgb: readonly [number, number, number];
}> = [
  { name: HighlightColor.YELLOW, rgb: [254, 240, 138] },
  { name: HighlightColor.GREEN, rgb: [187, 247, 208] },
  { name: HighlightColor.CYAN, rgb: [165, 243, 252] },
  { name: HighlightColor.MAGENTA, rgb: [251, 207, 232] },
  { name: HighlightColor.RED, rgb: [254, 202, 202] },
  { name: HighlightColor.BLUE, rgb: [191, 219, 254] },
  { name: HighlightColor.DARK_YELLOW, rgb: [234, 179, 8] },
  { name: HighlightColor.DARK_GREEN, rgb: [21, 128, 61] },
  { name: HighlightColor.DARK_CYAN, rgb: [14, 116, 144] },
  { name: HighlightColor.DARK_MAGENTA, rgb: [162, 28, 175] },
  { name: HighlightColor.DARK_RED, rgb: [185, 28, 28] },
  { name: HighlightColor.DARK_BLUE, rgb: [29, 78, 216] },
  { name: HighlightColor.LIGHT_GRAY, rgb: [226, 232, 240] },
  { name: HighlightColor.DARK_GRAY, rgb: [100, 116, 139] },
  { name: HighlightColor.BLACK, rgb: [15, 23, 42] },
  { name: HighlightColor.WHITE, rgb: [255, 255, 255] },
];

/** 常见 CSS 命名颜色与 6 位 Hex 映射 */
const CSS_NAMED_COLORS: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  red: "DC2626",
  blue: "2563EB",
  green: "16A34A",
  yellow: "EAB308",
  orange: "EA580C",
  purple: "7C3AED",
  pink: "DB2777",
  cyan: "0891B2",
  magenta: "C026D3",
  gray: "64748B",
  grey: "64748B",
  darkgray: "334155",
  darkgrey: "334155",
  lightgray: "CBD5E1",
  lightgrey: "CBD5E1",
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** 在浏览器与 Node/Vitest 双环境下安全调用 mammoth */
async function runMammoth<T>(
  fn: (input: { arrayBuffer: ArrayBuffer } | { buffer: Uint8Array }) => Promise<T>,
  bytes: Uint8Array
): Promise<T> {
  const ab = toArrayBuffer(bytes);
  try {
    return await fn({ arrayBuffer: ab });
  } catch (err) {
    // Node / Vitest 环境下的 mammoth 主入口要求 { buffer: Buffer }
    const MaybeBuffer = (
      globalThis as unknown as { Buffer?: { from(u: Uint8Array): Uint8Array } }
    ).Buffer;
    if (MaybeBuffer) {
      return await fn({ buffer: MaybeBuffer.from(bytes) });
    }
    throw err;
  }
}

/** 清洗 Word 转换输出的 HTML，移除脚本、内联样式块、事件属性及危险协议 */
export function sanitizeWordEditorHtml(rawHtml: string): string {
  if (!rawHtml) return "";
  // 编辑器富文本不需要 <style> 块，先剔除避免样式污染或 CSS 逃逸
  const withoutStyleTags = rawHtml.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  return sanitizeSlideHtml(withoutStyleTags).trim();
}

/**
 * 将 `.docx` 二进制解析为可供 Tiptap 编辑器加载的安全 HTML。
 * 若文档为空或无有效正文，则返回 `"<p></p>"`。
 */
export async function wordBytesToEditorHtml(bytes: Uint8Array): Promise<string> {
  if (!bytes || bytes.byteLength === 0) {
    return "<p></p>";
  }
  const result = await runMammoth(
    (input) =>
      mammoth.convertToHtml(
        input as Parameters<typeof mammoth.convertToHtml>[0],
        { styleMap: WORD_EDITOR_STYLE_MAP }
      ),
    bytes
  );
  const cleaned = sanitizeWordEditorHtml(result.value);
  if (!cleaned) {
    return "<p></p>";
  }
  // 仅包含无文本的占位空白标签时兜底为空段落
  const plain = cleaned.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, "").trim();
  if (!plain && !/<(?:img|hr|table)\b/i.test(cleaned)) {
    return "<p></p>";
  }
  return cleaned;
}

/** 将 CSS 颜色字符串解析为 RGB 元组 */
function parseCssColorToRgb(rawColor: unknown): [number, number, number] | null {
  if (typeof rawColor !== "string") return null;
  const trimmed = rawColor.trim().toLowerCase();
  if (!trimmed || trimmed === "inherit" || trimmed === "transparent") return null;

  if (CSS_NAMED_COLORS[trimmed]) {
    const hex = CSS_NAMED_COLORS[trimmed];
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  const hexMatch = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const h = hexMatch[1];
    const full =
      h.length === 3 ? `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : h;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }

  const rgbMatch = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/
  );
  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, Number(rgbMatch[1])));
    const g = Math.max(0, Math.min(255, Number(rgbMatch[2])));
    const b = Math.max(0, Math.min(255, Number(rgbMatch[3])));
    return [r, g, b];
  }

  return null;
}

/** 将 CSS 颜色转为 docx 要求的 6 位大写十六进制字符串（无 # 前缀） */
function normalizeCssColorToHex(rawColor: unknown): string | undefined {
  const rgb = parseCssColorToRgb(rawColor);
  if (!rgb) return undefined;
  return rgb
    .map((n) => n.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

/** 将任意 CSS 高亮色映射为 OOXML 合法的 HighlightColor 枚举值 */
function mapCssColorToDocxHighlight(
  rawColor: unknown
): (typeof HighlightColor)[keyof typeof HighlightColor] {
  if (typeof rawColor === "string") {
    const normalized = rawColor.trim().toLowerCase();
    for (const item of DOCX_HIGHLIGHT_PALETTE) {
      if (item.name.toLowerCase() === normalized) {
        return item.name;
      }
    }
  }
  const rgb = parseCssColorToRgb(rawColor);
  if (!rgb) return HighlightColor.YELLOW;

  let best: (typeof HighlightColor)[keyof typeof HighlightColor] = HighlightColor.YELLOW;
  let bestDist = Infinity;
  for (const item of DOCX_HIGHLIGHT_PALETTE) {
    // 不把用户高亮色匹配成极端的纯黑或纯白
    if (item.name === HighlightColor.BLACK || item.name === HighlightColor.WHITE) {
      continue;
    }
    const dr = rgb[0] - item.rgb[0];
    const dg = rgb[1] - item.rgb[1];
    const db = rgb[2] - item.rgb[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = item.name;
    }
  }
  return best;
}

/** 将 Tiptap fontSize（如 "14px" / "12pt"）转换为 Word 半磅单位 */
function parseFontSizeToHalfPoints(rawSize: unknown): number | undefined {
  if (typeof rawSize === "number" && Number.isFinite(rawSize) && rawSize > 0) {
    return Math.round(rawSize * 2);
  }
  if (typeof rawSize !== "string") return undefined;
  const trimmed = rawSize.trim().toLowerCase();
  const ptMatch = trimmed.match(/^([\d.]+)\s*pt$/);
  if (ptMatch) {
    const pt = Number(ptMatch[1]);
    return pt > 0 ? Math.round(pt * 2) : undefined;
  }
  const pxMatch = trimmed.match(/^([\d.]+)\s*px$/);
  if (pxMatch) {
    const px = Number(pxMatch[1]);
    return px > 0 ? Math.round(px * 0.75 * 2) : undefined;
  }
  return undefined;
}

/** 提取 CSS font-family 中的主字体名 */
function normalizeFontFamily(rawFont: unknown): string | undefined {
  if (typeof rawFont !== "string") return undefined;
  const first = rawFont.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  return first || undefined;
}

/** 校验链接 URL 协议是否安全（仅允许 http / https / mailto） */
function isSafeHyperlinkHref(href: unknown): href is string {
  if (typeof href !== "string") return false;
  const trimmed = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(trimmed);
}

/** 映射 Tiptap textAlign 到 docx AlignmentType */
function mapDocxAlignment(
  align: unknown
): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (align) {
    case "center":
      return AlignmentType.CENTER;
    case "right":
      return AlignmentType.RIGHT;
    case "justify":
      return AlignmentType.BOTH;
    case "left":
      return AlignmentType.LEFT;
    default:
      return undefined;
  }
}

function mapDocxHeadingLevel(
  level: number
): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  if (level <= 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  return HeadingLevel.HEADING_3;
}

/** 递归提取 Tiptap 节点树中的纯文本内容 */
function collectNodePlainText(node: TiptapJsonNode | undefined): string {
  if (!node) return "";
  if (node.type === "hardBreak") return "\n";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(collectNodePlainText).join("");
}

/** 将 Tiptap 行内节点数组转换为 docx ParagraphChild（TextRun / ExternalHyperlink） */
function buildInlineRuns(
  content: TiptapJsonNode[] | undefined,
  defaults?: {
    size?: number;
    bold?: boolean;
    italics?: boolean;
    color?: string;
  }
): ParagraphChild[] {
  if (!Array.isArray(content) || content.length === 0) {
    return [];
  }

  const children: ParagraphChild[] = [];
  for (const inline of content) {
    if (!inline) continue;

    if (inline.type === "hardBreak") {
      children.push(new TextRun({ break: 1 }));
      continue;
    }

    if (inline.type !== "text") {
      // 兜底提取未知行内节点文本
      const nested = collectNodePlainText(inline);
      if (nested) {
        children.push(
          new TextRun({
            text: nested,
            size: defaults?.size ?? 22,
            bold: defaults?.bold,
            italics: defaults?.italics,
            color: defaults?.color,
          })
        );
      }
      continue;
    }

    const text = typeof inline.text === "string" ? inline.text : "";
    if (!text) continue;

    const marks = Array.isArray(inline.marks) ? inline.marks : [];
    let bold = defaults?.bold ?? false;
    let italics = defaults?.italics ?? false;
    let underline = false;
    let strike = false;
    let isCode = false;
    let color = defaults?.color;
    let size = defaults?.size ?? 22;
    let font: string | undefined;
    let highlight: (typeof HighlightColor)[keyof typeof HighlightColor] | undefined;
    let shadingHex: string | undefined;
    let linkHref: string | undefined;

    for (const mark of marks) {
      if (!mark || !mark.type) continue;
      const attrs = mark.attrs ?? {};
      switch (mark.type) {
        case "bold":
          bold = true;
          break;
        case "italic":
          italics = true;
          break;
        case "underline":
          underline = true;
          break;
        case "strike":
          strike = true;
          break;
        case "code":
          isCode = true;
          font = font ?? "Consolas";
          shadingHex = shadingHex ?? "F1F5F9";
          break;
        case "highlight":
          highlight = mapCssColorToDocxHighlight(attrs.color);
          break;
        case "textStyle": {
          const parsedColor = normalizeCssColorToHex(attrs.color);
          if (parsedColor) color = parsedColor;
          const parsedBg = normalizeCssColorToHex(attrs.backgroundColor);
          if (parsedBg) shadingHex = parsedBg;
          const parsedFont = normalizeFontFamily(attrs.fontFamily);
          if (parsedFont) font = parsedFont;
          const parsedSize = parseFontSizeToHalfPoints(attrs.fontSize);
          if (parsedSize) size = parsedSize;
          break;
        }
        case "link":
          if (isSafeHyperlinkHref(attrs.href)) {
            linkHref = attrs.href.trim();
          }
          break;
      }
    }

    const runOptions: IRunOptions = {
      text,
      size,
      ...(bold ? { bold: true } : {}),
      ...(italics ? { italics: true } : {}),
      ...(underline ? { underline: { type: UnderlineType.SINGLE } } : {}),
      ...(strike ? { strike: true } : {}),
      ...(color ? { color } : linkHref ? { color: "2563EB" } : {}),
      ...(font ? { font } : {}),
      ...(highlight ? { highlight } : {}),
      ...(!highlight && shadingHex
        ? { shading: { type: ShadingType.CLEAR, fill: shadingHex } }
        : {}),
      ...(isCode && !color ? { color: "0F172A" } : {}),
      ...(linkHref && !underline ? { underline: { type: UnderlineType.SINGLE } } : {}),
    };

    const run = new TextRun(runOptions);
    if (linkHref) {
      children.push(
        new ExternalHyperlink({
          link: linkHref,
          children: [run],
        })
      );
    } else {
      children.push(run);
    }
  }

  return children;
}

/** 列表转换上下文 */
interface ListBuildContext {
  kind: "bullet" | "ordered";
  depth: number;
  orderedInstance?: number;
  inBlockquote?: boolean;
}

/** 文档转换器状态（用于分配有序列表实例编号） */
class DocxBuildContext {
  private orderedInstanceCounter = 1;

  nextOrderedInstance(): number {
    const id = this.orderedInstanceCounter;
    this.orderedInstanceCounter += 1;
    return id;
  }

  /** 将单个段落样式的 Tiptap 节点转换为 docx Paragraph */
  buildParagraphFromNode(
    node: TiptapJsonNode,
    listCtx?: ListBuildContext,
    isFirstListParagraph?: boolean,
    extraParagraphOpts?: Partial<IParagraphOptions>
  ): Paragraph {
    const align = mapDocxAlignment(node.attrs?.textAlign);
    const inQuote = Boolean(listCtx?.inBlockquote);

    const children = buildInlineRuns(node.content, {
      size: 22,
      ...(inQuote ? { color: "475569" } : {}),
    });

    const paragraphOpts: Record<string, unknown> = {
      alignment: align,
      spacing: listCtx
        ? { after: 80, line: 320 }
        : { after: 140, line: 340 },
      children,
      ...extraParagraphOpts,
    };

    if (listCtx) {
      const clampedLevel = Math.min(8, Math.max(0, listCtx.depth));
      if (isFirstListParagraph) {
        if (listCtx.kind === "bullet") {
          paragraphOpts.bullet = { level: clampedLevel };
        } else {
          paragraphOpts.numbering = {
            reference: "ordered-list",
            level: clampedLevel,
            instance: listCtx.orderedInstance ?? 1,
          };
        }
      } else {
        // 列表项中的续行段落保持左缩进而不重复生成序号/圆点
        paragraphOpts.indent = { left: 720 * (clampedLevel + 1) };
      }
    }

    return new Paragraph(paragraphOpts as IParagraphOptions);
  }

  /** 递归转换列表节点（bulletList / orderedList），完整支持多层嵌套与混排 */
  convertListNode(
    listNode: TiptapJsonNode,
    kind: "bullet" | "ordered",
    depth: number,
    parentOrderedInstance?: number,
    inBlockquote?: boolean
  ): Array<Paragraph | Table> {
    const out: Array<Paragraph | Table> = [];
    const instance =
      kind === "ordered"
        ? parentOrderedInstance ?? this.nextOrderedInstance()
        : parentOrderedInstance;

    const items = Array.isArray(listNode.content) ? listNode.content : [];
    for (const item of items) {
      if (!item || item.type !== "listItem") continue;
      const itemChildren = Array.isArray(item.content) ? item.content : [];
      if (itemChildren.length === 0) {
        out.push(
          this.buildParagraphFromNode(
            { type: "paragraph", content: [] },
            { kind, depth, orderedInstance: instance, inBlockquote },
            true
          )
        );
        continue;
      }

      let markedFirstParagraph = false;
      for (const child of itemChildren) {
        if (!child) continue;
        if (child.type === "paragraph") {
          out.push(
            this.buildParagraphFromNode(
              child,
              { kind, depth, orderedInstance: instance, inBlockquote },
              !markedFirstParagraph
            )
          );
          markedFirstParagraph = true;
        } else if (child.type === "bulletList") {
          out.push(
            ...this.convertListNode(
              child,
              "bullet",
              depth + 1,
              instance,
              inBlockquote
            )
          );
        } else if (child.type === "orderedList") {
          out.push(
            ...this.convertListNode(
              child,
              "ordered",
              depth + 1,
              kind === "ordered" ? instance : this.nextOrderedInstance(),
              inBlockquote
            )
          );
        } else {
          out.push(...this.convertBlockNode(child, inBlockquote));
        }
      }
    }
    return out;
  }

  /** 将 table 节点转换为带边框与表头底色的 docx Table */
  convertTableNode(tableNode: TiptapJsonNode): Table {
    const rawRows = Array.isArray(tableNode.content) ? tableNode.content : [];
    const docxRows: TableRow[] = [];
    let leadingHeaderPhase = true;

    for (const rawRow of rawRows) {
      if (!rawRow || rawRow.type !== "tableRow") continue;
      const rawCells = Array.isArray(rawRow.content) ? rawRow.content : [];
      if (rawCells.length === 0) continue;

      const isHeaderRow = rawCells.some((cell) => cell?.type === "tableHeader");
      if (!isHeaderRow) {
        leadingHeaderPhase = false;
      }

      const docxCells: TableCell[] = rawCells.map((cell) => {
        const isHeaderCell = cell?.type === "tableHeader";
        const colspan =
          typeof cell?.attrs?.colspan === "number" && cell.attrs.colspan > 1
            ? Math.floor(cell.attrs.colspan)
            : undefined;
        const rowspan =
          typeof cell?.attrs?.rowspan === "number" && cell.attrs.rowspan > 1
            ? Math.floor(cell.attrs.rowspan)
            : undefined;

        const cellBlocks = this.convertBlocks(
          Array.isArray(cell?.content) ? cell.content : [],
          false,
          isHeaderCell ? { bold: true, color: "1E1B4B", size: 21 } : { size: 20 }
        );

        const safeChildren =
          cellBlocks.length > 0 ? cellBlocks : [new Paragraph({ children: [] })];

        return new TableCell({
          shading: isHeaderCell
            ? { type: ShadingType.CLEAR, fill: "EEF2FF" }
            : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          ...(colspan ? { columnSpan: colspan } : {}),
          ...(rowspan ? { rowSpan: rowspan } : {}),
          children: safeChildren,
        });
      });

      docxRows.push(
        new TableRow({
          ...(leadingHeaderPhase && isHeaderRow ? { tableHeader: true } : {}),
          children: docxCells,
        })
      );
    }

    if (docxRows.length === 0) {
      docxRows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [] })],
            }),
          ],
        })
      );
    }

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
        left: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
        right: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
        insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
      },
      rows: docxRows,
    });
  }

  /** 将单个 Tiptap 块级节点转为 docx 块级元素数组 */
  convertBlockNode(
    node: TiptapJsonNode,
    inBlockquote = false,
    runDefaults?: { bold?: boolean; color?: string; size?: number }
  ): Array<Paragraph | Table> {
    if (!node || !node.type) return [];

    switch (node.type) {
      case "heading": {
        const rawLevel =
          typeof node.attrs?.level === "number" ? node.attrs.level : 1;
        const level = Math.min(3, Math.max(1, Math.round(rawLevel)));
        const align = mapDocxAlignment(node.attrs?.textAlign);
        const size = level === 1 ? 32 : level === 2 ? 26 : 23;
        const defaultColor =
          level === 1 ? "1E1B4B" : level === 2 ? "1E293B" : "334155";
        const children = buildInlineRuns(node.content, {
          size,
          color: defaultColor,
        });
        return [
          new Paragraph({
            heading: mapDocxHeadingLevel(level),
            alignment: align,
            spacing: {
              before: level === 1 ? 260 : level === 2 ? 220 : 180,
              after: level === 1 ? 120 : level === 2 ? 100 : 80,
            },
            children,
          }),
        ];
      }

      case "paragraph": {
        const align = mapDocxAlignment(node.attrs?.textAlign);
        const children = buildInlineRuns(node.content, {
          size: runDefaults?.size ?? 22,
          bold: runDefaults?.bold,
          color: runDefaults?.color ?? (inBlockquote ? "475569" : undefined),
        });
        if (inBlockquote) {
          return [
            new Paragraph({
              style: "Quote",
              alignment: align,
              indent: { left: 480 },
              border: {
                left: {
                  style: BorderStyle.SINGLE,
                  size: 18,
                  space: 10,
                  color: "5E6AD2",
                },
              },
              shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
              spacing: { before: 80, after: 100, line: 340 },
              children,
            }),
          ];
        }
        return [
          new Paragraph({
            alignment: align,
            spacing: { after: 140, line: 340 },
            children,
          }),
        ];
      }

      case "bulletList":
        return this.convertListNode(node, "bullet", 0, undefined, inBlockquote);

      case "orderedList":
        return this.convertListNode(
          node,
          "ordered",
          0,
          this.nextOrderedInstance(),
          inBlockquote
        );

      case "blockquote": {
        const children = Array.isArray(node.content) ? node.content : [];
        if (children.length === 0) {
          return [
            new Paragraph({
              style: "Quote",
              indent: { left: 480 },
              border: {
                left: {
                  style: BorderStyle.SINGLE,
                  size: 18,
                  space: 10,
                  color: "5E6AD2",
                },
              },
              shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
              children: [],
            }),
          ];
        }
        return this.convertBlocks(children, true, runDefaults);
      }

      case "codeBlock": {
        const rawCode = collectNodePlainText(node);
        const lines = rawCode.split(/\r?\n/);
        const runs: TextRun[] = [];
        lines.forEach((line, idx) => {
          runs.push(
            new TextRun({
              text: line,
              font: "Consolas",
              size: 20,
              color: "0F172A",
              ...(idx > 0 ? { break: 1 } : {}),
            })
          );
        });
        return [
          new Paragraph({
            style: "CodeBlock",
            shading: { type: ShadingType.CLEAR, fill: "F1F5F9" },
            border: {
              top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              left: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              right: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
            },
            indent: { left: 180, right: 180 },
            spacing: { before: 100, after: 140, line: 300 },
            children: runs,
          }),
        ];
      }

      case "horizontalRule":
        return [
          new Paragraph({
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                space: 1,
                color: "CBD5E1",
              },
            },
            spacing: { before: 120, after: 160 },
            children: [],
          }),
        ];

      case "table":
        return [
          this.convertTableNode(node),
          new Paragraph({ text: "", spacing: { after: 100 } }),
        ];

      default: {
        if (Array.isArray(node.content)) {
          return this.convertBlocks(node.content, inBlockquote, runDefaults);
        }
        const text = collectNodePlainText(node);
        return text
          ? [new Paragraph({ children: [new TextRun({ text, size: 22 })] })]
          : [];
      }
    }
  }

  /** 批量转换块级节点列表 */
  convertBlocks(
    nodes: TiptapJsonNode[],
    inBlockquote = false,
    runDefaults?: { bold?: boolean; color?: string; size?: number }
  ): Array<Paragraph | Table> {
    const out: Array<Paragraph | Table> = [];
    for (const node of nodes) {
      out.push(...this.convertBlockNode(node, inBlockquote, runDefaults));
    }
    return out;
  }
}

/** 从 Tiptap JSON 中提取第一个一级标题文本作为文档默认标题 */
function extractFirstHeadingTitle(root: TiptapJsonNode): string | undefined {
  if (!Array.isArray(root.content)) return undefined;
  for (const node of root.content) {
    if (node?.type === "heading" && Number(node.attrs?.level ?? 1) === 1) {
      const text = collectNodePlainText(node).trim();
      if (text) return text;
    }
  }
  return undefined;
}

/**
 * 将 Tiptap ProseMirror JSON 文档树无损生成规范的 `.docx` 二进制（含页眉、页码、样式表、多级列表与样式表格）。
 */
export async function tiptapJsonToWordBytes(
  doc: Record<string, unknown>,
  options?: TiptapToWordOptions
): Promise<Uint8Array> {
  const root = (doc || {}) as TiptapJsonNode;
  const contentNodes = Array.isArray(root.content) ? root.content : [];

  const ctx = new DocxBuildContext();
  const children = ctx.convertBlocks(contentNodes);
  if (children.length === 0) {
    children.push(new Paragraph({ children: [] }));
  }

  const resolvedTitle =
    options?.title?.trim() ||
    extractFirstHeadingTitle(root) ||
    "Mizurisu Agent Document";
  const resolvedHeader =
    options?.headerText !== undefined
      ? options.headerText.trim()
      : resolvedTitle;

  const docxDocument = new Document({
    creator: "Mizurisu Agent",
    title: resolvedTitle,
    styles: {
      default: {
        heading1: {
          run: {
            bold: true,
            size: 32,
            color: "1E1B4B",
          },
          paragraph: {
            spacing: { before: 260, after: 120 },
          },
        },
        heading2: {
          run: {
            bold: true,
            size: 26,
            color: "1E293B",
          },
          paragraph: {
            spacing: { before: 220, after: 100 },
          },
        },
        heading3: {
          run: {
            bold: true,
            size: 23,
            color: "334155",
          },
          paragraph: {
            spacing: { before: 180, after: 80 },
          },
        },
      },
      paragraphStyles: [
        {
          id: "Quote",
          name: "Quote",
          basedOn: "Normal",
          next: "Normal",
          paragraph: {
            indent: { left: 480 },
            spacing: { before: 80, after: 100, line: 340 },
          },
          run: {
            color: "475569",
          },
        },
        {
          id: "CodeBlock",
          name: "Code Block",
          basedOn: "Normal",
          next: "Normal",
          paragraph: {
            spacing: { before: 100, after: 140, line: 300 },
          },
          run: {
            font: "Consolas",
            size: 20,
            color: "0F172A",
          },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "ordered-list",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format:
              level % 3 === 0
                ? LevelFormat.DECIMAL
                : level % 3 === 1
                  ? LevelFormat.LOWER_LETTER
                  : LevelFormat.LOWER_ROMAN,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720 * (level + 1), hanging: 360 },
              },
            },
          })),
        },
      ],
    },
    sections: [
      {
        headers: resolvedHeader
          ? {
              default: new Header({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({
                        text: resolvedHeader,
                        size: 18,
                        color: "64748B",
                      }),
                    ],
                  }),
                ],
              }),
            }
          : undefined,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "第 ", size: 18, color: "64748B" }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 18,
                    color: "64748B",
                  }),
                  new TextRun({ text: " 页 / 共 ", size: 18, color: "64748B" }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 18,
                    color: "64748B",
                  }),
                  new TextRun({ text: " 页", size: 18, color: "64748B" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const packed = await Packer.pack(docxDocument, "uint8array");
  return new Uint8Array(packed);
}

/** 扁平化收集列表项文本用于 PDF 导出 */
function collectListItemsText(
  listNode: TiptapJsonNode,
  prefixBuilder?: (idx: number) => string
): string[] {
  const items = Array.isArray(listNode.content) ? listNode.content : [];
  const lines: string[] = [];
  items.forEach((item, idx) => {
    if (!item || item.type !== "listItem") return;
    const itemChildren = Array.isArray(item.content) ? item.content : [];
    const textParts: string[] = [];
    for (const child of itemChildren) {
      if (!child) continue;
      if (child.type === "bulletList" || child.type === "orderedList") {
        const nested = collectListItemsText(
          child,
          child.type === "orderedList" ? (i) => `${i + 1}. ` : undefined
        );
        if (nested.length > 0) {
          textParts.push(nested.join("；"));
        }
      } else {
        const text = collectNodePlainText(child).trim();
        if (text) textParts.push(text);
      }
    }
    const merged = textParts.join(" ").trim();
    if (merged) {
      lines.push(prefixBuilder ? `${prefixBuilder(idx)}${merged}` : merged);
    }
  });
  return lines;
}

/** 将 Tiptap JSON 文档直接转换为结构化 PDF 导出规格 */
export function tiptapJsonToPdfSpec(
  doc: Record<string, unknown>,
  fallbackTitle = "导出文档"
): CreatePdfSpec {
  const root = (doc || {}) as TiptapJsonNode;
  const contentNodes = Array.isArray(root.content) ? root.content : [];

  let title: string | undefined;
  const sections: PdfSection[] = [];

  for (const node of contentNodes) {
    if (!node || !node.type) continue;
    switch (node.type) {
      case "heading": {
        const rawLevel = Number(node.attrs?.level ?? 1);
        const level: 1 | 2 | 3 = rawLevel <= 1 ? 1 : rawLevel === 2 ? 2 : 3;
        const text = collectNodePlainText(node).trim();
        if (!text) break;
        if (level === 1 && title === undefined) {
          title = text;
        } else {
          sections.push({ type: "heading", level, text });
        }
        break;
      }
      case "paragraph":
      case "blockquote":
      case "codeBlock": {
        const text = collectNodePlainText(node).trim();
        if (text) {
          sections.push({ type: "paragraph", text });
        }
        break;
      }
      case "bulletList": {
        const items = collectListItemsText(node);
        if (items.length > 0) {
          sections.push({ type: "bullets", items });
        }
        break;
      }
      case "orderedList": {
        const items = collectListItemsText(node, (idx) => `${idx + 1}. `);
        if (items.length > 0) {
          sections.push({ type: "paragraph", text: items.join("\n") });
        }
        break;
      }
      case "table": {
        const rawRows = Array.isArray(node.content) ? node.content : [];
        const parsedRows: string[][] = [];
        let hasHeaderRow = false;
        rawRows.forEach((row, rIdx) => {
          if (!row || row.type !== "tableRow") return;
          const cells = Array.isArray(row.content) ? row.content : [];
          if (rIdx === 0 && cells.some((c) => c?.type === "tableHeader")) {
            hasHeaderRow = true;
          }
          parsedRows.push(
            cells.map((cell) => collectNodePlainText(cell).replace(/\s+/g, " ").trim())
          );
        });
        if (parsedRows.length > 0) {
          if (hasHeaderRow) {
            sections.push({
              type: "table",
              headers: parsedRows[0],
              rows: parsedRows.slice(1),
            });
          } else {
            sections.push({
              type: "table",
              rows: parsedRows,
            });
          }
        }
        break;
      }
    }
  }

  return {
    title: title || fallbackTitle,
    sections,
    footerText: "Mizurisu Agent",
  };
}
