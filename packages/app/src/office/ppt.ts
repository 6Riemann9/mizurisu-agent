import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";

export type PptThemeName = "business-navy" | "minimal-tech" | "warm-report" | "dark-keynote";

export interface ParsedPptSlide {
  index: number;
  title: string;
  texts: string[];
  notes: string;
}

export interface PptReadResult {
  slideCount: number;
  slides: ParsedPptSlide[];
}

export interface PptChartSeries {
  name: string;
  labels: string[];
  values: number[];
}

export type PptSlideInput =
  | {
      layout: "cover";
      title: string;
      subtitle?: string;
      meta?: string;
      notes?: string;
    }
  | {
      layout: "bullets";
      title: string;
      bullets: string[];
      notes?: string;
    }
  | {
      layout: "two-column";
      title: string;
      leftTitle: string;
      leftBullets: string[];
      rightTitle: string;
      rightBullets: string[];
      notes?: string;
    }
  | {
      layout: "table";
      title: string;
      headers: string[];
      rows: string[][];
      notes?: string;
    }
  | {
      layout: "chart";
      title: string;
      chartType: "bar" | "line" | "pie";
      series: PptChartSeries[];
      caption?: string;
      notes?: string;
    }
  | {
      layout: "closing";
      title: string;
      subtitle?: string;
      notes?: string;
    };

export interface CreatePptSpec {
  title?: string;
  author?: string;
  theme?: PptThemeName;
  slides: PptSlideInput[];
}

interface ThemePalette {
  bg: string;
  coverBg: string;
  primary: string;
  accent: string;
  text: string;
  muted: string;
  cardBg: string;
  isDark: boolean;
}

const THEMES: Record<PptThemeName, ThemePalette> = {
  "business-navy": {
    bg: "F8FAFC",
    coverBg: "1E1B4B",
    primary: "1E293B",
    accent: "4F46E5",
    text: "334155",
    muted: "64748B",
    cardBg: "EEF2FF",
    isDark: false,
  },
  "minimal-tech": {
    bg: "FFFFFF",
    coverBg: "0F172A",
    primary: "0F172A",
    accent: "0284C7",
    text: "334155",
    muted: "64748B",
    cardBg: "F0F9FF",
    isDark: false,
  },
  "warm-report": {
    bg: "FFFBF5",
    coverBg: "7C2D12",
    primary: "431407",
    accent: "EA580C",
    text: "44403C",
    muted: "78716C",
    cardBg: "FFEDD5",
    isDark: false,
  },
  "dark-keynote": {
    bg: "09090B",
    coverBg: "18181B",
    primary: "FAFAFA",
    accent: "818CF8",
    text: "E4E4E7",
    muted: "A1A1AA",
    cardBg: "18181B",
    isDark: true,
  },
};

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractXmlParagraphTexts(xml: string): string[] {
  const paragraphs: string[] = [];
  const pMatches = xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g);
  for (const pm of pMatches) {
    const runs = [...pm[1].matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) =>
      decodeXmlEntities(m[1])
    );
    const joined = runs.join("").trim();
    if (joined) paragraphs.push(joined);
  }
  return paragraphs;
}

function slideNumberFromPath(path: string): number {
  const m = path.match(/(\d+)\.xml$/);
  return m ? Number(m[1]) : 0;
}

export async function readPptDocument(bytes: Uint8Array): Promise<PptReadResult> {
  const zip = await JSZip.loadAsync(bytes);
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => slideNumberFromPath(a) - slideNumberFromPath(b));

  const slides: ParsedPptSlide[] = [];

  for (const slidePath of slidePaths) {
    const idx = slideNumberFromPath(slidePath);
    const xml = await zip.file(slidePath)!.async("string");
    const texts = extractXmlParagraphTexts(xml);

    // 解析关联备注（从 _rels 或同序号 notesSlide）
    let notes = "";
    const relPath = `ppt/slides/_rels/slide${idx}.xml.rels`;
    const relFile = zip.file(relPath);
    if (relFile) {
      const relXml = await relFile.async("string");
      const m = relXml.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/i);
      if (m) {
        const noteFile = zip.file(`ppt/notesSlides/${m[1]}`);
        if (noteFile) {
          const noteXml = await noteFile.async("string");
          const noteLines = extractXmlParagraphTexts(noteXml).filter(
            (t) => !/^\d+$/.test(t)
          );
          notes = noteLines.join("\n");
        }
      }
    }

    slides.push({
      index: idx,
      title: texts[0] || `第 ${idx} 页`,
      texts,
      notes,
    });
  }

  return {
    slideCount: slides.length,
    slides,
  };
}

function addSlideHeader(
  slide: PptxGenJS.Slide,
  title: string,
  pageIndex: number,
  palette: ThemePalette
) {
  slide.background = { color: palette.bg };
  slide.addShape("rect", {
    x: 0.6,
    y: 0.45,
    w: 0.12,
    h: 0.52,
    fill: { color: palette.accent },
    line: { width: 0 },
  });
  slide.addText(title, {
    x: 0.85,
    y: 0.42,
    w: 11.2,
    h: 0.6,
    fontSize: 24,
    bold: true,
    color: palette.primary,
    fontFace: "Microsoft YaHei",
  });
  slide.addText(`${pageIndex}`, {
    x: 12.1,
    y: 6.95,
    w: 0.7,
    h: 0.3,
    fontSize: 11,
    color: palette.muted,
    align: "right",
  });
}

export async function createPptPresentation(spec: CreatePptSpec): Promise<Uint8Array> {
  const PptxCtor =
    (PptxGenJS as unknown as { default?: typeof PptxGenJS }).default ?? PptxGenJS;
  const pptx = new PptxCtor();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = spec.author || "Mizurisu Agent";
  pptx.title = spec.title || "Mizurisu Agent Presentation";

  const palette = THEMES[spec.theme || "business-navy"];

  spec.slides.forEach((item, idx) => {
    const slide = pptx.addSlide();
    const pageNum = idx + 1;

    if (item.layout === "cover" || item.layout === "closing") {
      slide.background = { color: palette.coverBg };
      slide.addShape("rect", {
        x: 0.9,
        y: 2.1,
        w: 1.2,
        h: 0.08,
        fill: { color: palette.accent },
        line: { width: 0 },
      });
      slide.addText(item.title, {
        x: 0.9,
        y: 2.4,
        w: 11.4,
        h: 1.3,
        fontSize: 38,
        bold: true,
        color: "FFFFFF",
        fontFace: "Microsoft YaHei",
      });
      if (item.subtitle) {
        slide.addText(item.subtitle, {
          x: 0.9,
          y: 3.8,
          w: 11.0,
          h: 0.9,
          fontSize: 18,
          color: "CBD5E1",
          fontFace: "Microsoft YaHei",
        });
      }
      if (item.layout === "cover" && item.meta) {
        slide.addText(item.meta, {
          x: 0.9,
          y: 6.3,
          w: 11.0,
          h: 0.45,
          fontSize: 13,
          color: "94A3B8",
          fontFace: "Microsoft YaHei",
        });
      }
    } else if (item.layout === "bullets") {
      addSlideHeader(slide, item.title, pageNum, palette);
      slide.addText(
        item.bullets.map((b) => ({
          text: b,
          options: { bullet: true, breakLine: true, paraSpaceAfter: 12 },
        })),
        {
          x: 0.85,
          y: 1.35,
          w: 11.6,
          h: 5.2,
          fontSize: 18,
          color: palette.text,
          valign: "top",
          fontFace: "Microsoft YaHei",
        }
      );
    } else if (item.layout === "two-column") {
      addSlideHeader(slide, item.title, pageNum, palette);
      const drawCol = (x: number, colTitle: string, bullets: string[]) => {
        slide.addShape("roundRect", {
          x,
          y: 1.3,
          w: 5.6,
          h: 5.2,
          fill: { color: palette.cardBg },
          line: { color: palette.isDark ? "27272A" : "E2E8F0", width: 1 },
        });
        slide.addText(colTitle, {
          x: x + 0.3,
          y: 1.5,
          w: 5.0,
          h: 0.45,
          fontSize: 18,
          bold: true,
          color: palette.accent,
          fontFace: "Microsoft YaHei",
        });
        slide.addText(
          bullets.map((b) => ({
            text: b,
            options: { bullet: true, breakLine: true, paraSpaceAfter: 10 },
          })),
          {
            x: x + 0.3,
            y: 2.1,
            w: 5.0,
            h: 4.1,
            fontSize: 15,
            color: palette.text,
            valign: "top",
            fontFace: "Microsoft YaHei",
          }
        );
      };
      drawCol(0.8, item.leftTitle, item.leftBullets);
      drawCol(6.8, item.rightTitle, item.rightBullets);
    } else if (item.layout === "table") {
      addSlideHeader(slide, item.title, pageNum, palette);
      const headerRow = item.headers.map((h) => ({
        text: h,
        options: {
          bold: true,
          color: "FFFFFF",
          fill: { color: palette.accent },
          align: "center" as const,
        },
      }));
      const bodyRows = item.rows.map((r, rIdx) =>
        r.map((cell) => ({
          text: cell,
          options: {
            color: palette.text,
            fill: { color: rIdx % 2 === 1 ? palette.cardBg : palette.bg },
          },
        }))
      );
      slide.addTable([headerRow, ...bodyRows], {
        x: 0.85,
        y: 1.35,
        w: 11.6,
        fontSize: 13,
        fontFace: "Microsoft YaHei",
        border: { pt: 1, color: palette.isDark ? "3F3F46" : "CBD5E1" },
        margin: [6, 8, 6, 8],
      });
    } else if (item.layout === "chart") {
      addSlideHeader(slide, item.title, pageNum, palette);
      const chartType =
        item.chartType === "line"
          ? pptx.ChartType.line
          : item.chartType === "pie"
            ? pptx.ChartType.pie
            : pptx.ChartType.bar;
      slide.addChart(chartType, item.series, {
        x: 0.85,
        y: 1.35,
        w: 11.6,
        h: item.caption ? 4.6 : 5.2,
        showLegend: true,
        legendPos: "b",
        showValue: item.chartType !== "line",
        chartColors: ["4F46E5", "0EA5E9", "10B981", "F59E0B", "EC4899"],
      });
      if (item.caption) {
        slide.addText(item.caption, {
          x: 0.85,
          y: 6.1,
          w: 11.6,
          h: 0.45,
          fontSize: 13,
          color: palette.muted,
          align: "center",
          fontFace: "Microsoft YaHei",
        });
      }
    }

    if (item.notes) {
      slide.addNotes(item.notes);
    }
  });

  const out = await pptx.write({ outputType: "uint8array" });
  if (out instanceof Uint8Array) return out;
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  throw new Error("PPTX 生成返回了未知数据类型");
}
