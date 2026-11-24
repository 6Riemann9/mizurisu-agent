import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import mammoth from "mammoth";

export interface WordReadResult {
  text: string;
  html: string;
  paragraphCount: number;
  warnings: string[];
}

export type WordBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string; bold?: boolean; italic?: boolean; align?: "left" | "center" | "right" }
  | { type: "bullet"; items: string[] }
  | { type: "numbered"; items: string[] }
  | { type: "table"; headers?: string[]; rows: string[][] }
  | { type: "pageBreak" };

export interface CreateWordSpec {
  title?: string;
  subtitle?: string;
  headerText?: string;
  showPageNumbers?: boolean;
  blocks: WordBlock[];
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function runMammoth<T>(
  fn: (input: { arrayBuffer: ArrayBuffer } | { buffer: Uint8Array }) => Promise<T>,
  bytes: Uint8Array
): Promise<T> {
  const ab = toArrayBuffer(bytes);
  try {
    return await fn({ arrayBuffer: ab });
  } catch (err) {
    // Node / Vitest 环境下的 mammoth 主入口要求 { buffer: Buffer }
    const MaybeBuffer = (globalThis as unknown as { Buffer?: { from(u: Uint8Array): Uint8Array } }).Buffer;
    if (MaybeBuffer) {
      return await fn({ buffer: MaybeBuffer.from(bytes) });
    }
    throw err;
  }
}

export async function readWordDocument(bytes: Uint8Array): Promise<WordReadResult> {
  const [rawRes, htmlRes] = await Promise.all([
    runMammoth((input) => mammoth.extractRawText(input as Parameters<typeof mammoth.extractRawText>[0]), bytes),
    runMammoth((input) => mammoth.convertToHtml(input as Parameters<typeof mammoth.convertToHtml>[0]), bytes),
  ]);
  const text = rawRes.value.trim();
  const paragraphs = text ? text.split(/\n+/).filter((l) => l.trim().length > 0) : [];
  return {
    text,
    html: htmlRes.value,
    paragraphCount: paragraphs.length,
    warnings: [...rawRes.messages, ...htmlRes.messages].map((m) => m.message),
  };
}

function mapHeading(level: 1 | 2 | 3) {
  if (level === 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  return HeadingLevel.HEADING_3;
}

function mapAlignment(align?: "left" | "center" | "right") {
  if (align === "center") return AlignmentType.CENTER;
  if (align === "right") return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

function buildStyledTable(headers: string[] | undefined, rows: string[][]): Table {
  const tableRows: TableRow[] = [];

  if (headers && headers.length > 0) {
    tableRows.push(
      new TableRow({
        tableHeader: true,
        children: headers.map(
          (text) =>
            new TableCell({
              shading: { type: ShadingType.CLEAR, fill: "312E81" },
              margins: { top: 100, bottom: 100, left: 140, right: 140 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 21 })],
                }),
              ],
            })
        ),
      })
    );
  }

  rows.forEach((rowCells, idx) => {
    tableRows.push(
      new TableRow({
        children: rowCells.map(
          (text) =>
            new TableCell({
              shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: "F8FAFC" } : undefined,
              margins: { top: 80, bottom: 80, left: 140, right: 140 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: text ?? "", size: 20 })],
                }),
              ],
            })
        ),
      })
    );
  });

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
    rows: tableRows,
  });
}

export async function createWordDocument(spec: CreateWordSpec): Promise<Uint8Array> {
  const children: Array<Paragraph | Table> = [];

  if (spec.title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        spacing: { after: 120 },
        children: [new TextRun({ text: spec.title, bold: true, size: 44, color: "1E1B4B" })],
      })
    );
  }

  if (spec.subtitle) {
    children.push(
      new Paragraph({
        spacing: { after: 280 },
        children: [new TextRun({ text: spec.subtitle, color: "64748B", size: 24 })],
      })
    );
  }

  for (const block of spec.blocks) {
    switch (block.type) {
      case "heading":
        children.push(
          new Paragraph({
            heading: mapHeading(block.level),
            spacing: { before: 240, after: 120 },
            children: [
              new TextRun({
                text: block.text,
                bold: true,
                size: block.level === 1 ? 32 : block.level === 2 ? 26 : 23,
                color: "1E293B",
              }),
            ],
          })
        );
        break;
      case "paragraph":
        children.push(
          new Paragraph({
            alignment: mapAlignment(block.align),
            spacing: { after: 140, line: 340 },
            children: [
              new TextRun({
                text: block.text,
                bold: block.bold,
                italics: block.italic,
                size: 22,
              }),
            ],
          })
        );
        break;
      case "bullet":
        for (const item of block.items) {
          children.push(
            new Paragraph({
              bullet: { level: 0 },
              spacing: { after: 80 },
              children: [new TextRun({ text: item, size: 22 })],
            })
          );
        }
        break;
      case "numbered":
        block.items.forEach((item, index) => {
          children.push(
            new Paragraph({
              spacing: { after: 80 },
              indent: { left: 360 },
              children: [new TextRun({ text: `${index + 1}. ${item}`, size: 22 })],
            })
          );
        });
        break;
      case "table":
        children.push(buildStyledTable(block.headers, block.rows));
        children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
        break;
      case "pageBreak":
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
    }
  }

  const doc = new Document({
    creator: "Mizurisu Agent",
    title: spec.title || "Mizurisu Agent Document",
    sections: [
      {
        headers: spec.headerText
          ? {
              default: new Header({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [new TextRun({ text: spec.headerText, size: 18, color: "64748B" })],
                  }),
                ],
              }),
            }
          : undefined,
        footers:
          spec.showPageNumbers !== false
            ? {
                default: new Footer({
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({ text: "第 ", size: 18, color: "64748B" }),
                        new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "64748B" }),
                        new TextRun({ text: " 页 / 共 ", size: 18, color: "64748B" }),
                        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: "64748B" }),
                        new TextRun({ text: " 页", size: 18, color: "64748B" }),
                      ],
                    }),
                  ],
                }),
              }
            : undefined,
        children,
      },
    ],
  });

  const result = await Packer.pack(doc, "uint8array");
  return new Uint8Array(result);
}
