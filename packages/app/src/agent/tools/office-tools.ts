import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, bool, int, obj, oneOf, opt, str, unknown } from "@earendil-works/pi-schema";
import {
  buildSlidesHtmlDocument,
  createExcelWorkbook,
  createPdfDocument,
  createPptPresentation,
  createWordDocument,
  exportHtmlSlidesToPptxBytes,
  inspectExcel,
  markdownToPdfSpec,
  markdownToWordSpec,
  mergePdfDocuments,
  parseSlidesHtmlDocument,
  readExcelSheet,
  readPdfDocument,
  readPptDocument,
  readWordDocument,
  updateExcelCells,
  updateSlideInHtmlDocument,
  validateSlidesHtml,
  type CellScalar,
  type PdfSection,
  type PptSlideInput,
  type SlideThemeId,
  type SlideValidationReport,
  type WordBlock,
} from "../../office";
import type { WorkspaceVFS } from "../../storage/workspace-vfs";

const excelInspectParams = obj({
  path: str({ description: "工作区内的 Excel/CSV 文件路径，如 data.xlsx" }),
  previewRows: opt(int({ description: "每个 Sheet 预览行数，默认 8", minimum: 1, maximum: 50 })),
});

const excelReadParams = obj({
  path: str({ description: "Excel/CSV 文件路径" }),
  sheetName: opt(str({ description: "工作表名称，省略时读取第一个工作表" })),
  startRow: opt(int({ description: "起始行（从 1 开始）", minimum: 1 })),
  maxRows: opt(int({ description: "最多返回行数，默认 80", minimum: 1, maximum: 500 })),
});

const excelCreateParams = obj({
  path: str({ description: "新建或覆盖的 .xlsx 文件路径，如 report.xlsx" }),
  sheets: arr(
    obj({
      name: str({ description: "Sheet 名称（最多 31 字符）" }),
      headers: opt(arr(str(), { description: "首行表头数组" })),
      rows: arr(
        arr(unknown(), {
          description: "数据行数组；单元格支持文本、数字、布尔、null 或 '=SUM(B2:B5)' 公式字符串",
        })
      ),
      freezeHeader: opt(bool({ description: "是否冻结首行，默认 true" })),
    }),
    { minItems: 1 }
  ),
});

const excelUpdateParams = obj({
  path: str({ description: "要修改的既有 .xlsx 文件路径" }),
  operations: opt(
    arr(
      obj({
        sheetName: opt(str({ description: "目标 Sheet 名称，默认首个 Sheet" })),
        cell: str({ description: "单元格坐标，如 B3" }),
        value: opt(unknown({ description: "新值（文本/数字/布尔/null）" })),
        formula: opt(str({ description: "Excel 公式，如 SUM(B2:B5)" })),
        numFmt: opt(str({ description: "数字格式，如 0.0% 或 #,##0.00" })),
      })
    )
  ),
  appendRows: opt(
    arr(
      obj({
        sheetName: opt(str({ description: "目标 Sheet 名称" })),
        rows: arr(arr(unknown())),
      })
    )
  ),
  deleteRows: opt(
    arr(
      obj({
        sheetName: opt(str({ description: "目标 Sheet 名称" })),
        startRow: int({ description: "起始行号（从 1 开始）", minimum: 1 }),
        count: opt(int({ description: "删除行数，默认 1", minimum: 1 })),
      })
    )
  ),
  deleteColumns: opt(
    arr(
      obj({
        sheetName: opt(str({ description: "目标 Sheet 名称" })),
        startCol: int({ description: "起始列号（从 1 开始）", minimum: 1 }),
        count: opt(int({ description: "删除列数，默认 1", minimum: 1 })),
      })
    )
  ),
  mergeCells: opt(
    arr(
      obj({
        sheetName: opt(str({ description: "目标 Sheet 名称" })),
        range: str({ description: "合并区域，如 A1:D1" }),
      })
    )
  ),
});

const wordReadParams = obj({
  path: str({ description: ".docx 文件路径" }),
});

const wordCreateParams = obj({
  path: str({ description: "新建或覆盖的 .docx 文件路径" }),
  title: opt(str({ description: "文档主标题" })),
  subtitle: opt(str({ description: "文档副标题或日期摘要" })),
  headerText: opt(str({ description: "页眉文字" })),
  blocks: arr(
    obj({
      type: oneOf(["heading", "paragraph", "bullet", "numbered", "table", "pageBreak"], {
        description: "块类型",
      }),
      level: opt(int({ description: "仅 heading 有效：1、2 或 3", minimum: 1, maximum: 3 })),
      text: opt(str({ description: "heading 或 paragraph 的文本内容" })),
      bold: opt(bool({ description: "paragraph 是否加粗" })),
      items: opt(arr(str(), { description: "bullet 或 numbered 列表条目" })),
      headers: opt(arr(str(), { description: "table 表头" })),
      rows: opt(arr(arr(str()), { description: "table 数据行" })),
    }),
    { minItems: 1 }
  ),
});

const pptReadParams = obj({
  path: str({ description: ".pptx 文件路径" }),
});

const slidesReadParams = obj({
  path: str({ description: ".slides.html（或 .deck.html）幻灯片文件路径" }),
});

const slidesCreateParams = obj({
  path: str({ description: "新建或覆盖的 .slides.html 路径，如 q2_report.slides.html" }),
  title: str({ description: "演示文稿主标题" }),
  theme: opt(
    oneOf(["linear-dark", "apple-keynote", "consulting-exec", "swiss-editorial", "warm-founder"], {
      description: "视觉主题，默认 linear-dark",
    })
  ),
  customCss: opt(
    str({
      description:
        "可选作用域化附加 CSS（仅允许白名单属性，严禁 backdrop-filter / radial-gradient / conic-gradient / translate / scale / skew / vh / vw / @keyframes）",
    })
  ),
  slides: arr(
    obj({
      title: str({ description: "本页标题" }),
      notes: opt(str({ description: "本页演讲者备注" })),
      html: str({
        description:
          "本页 <section class=\"slide\"> 内部的 HTML 片段（画布 1280×720px，正文 <= 60 字，可用内置原子类 .slide-header / .slide-kicker / .slide-h1 / .slide-h2 / .kpi-grid / .kpi-card / .kpi-num / .bento-grid / .bento-card / .cols-2 / .timeline-row / .slide-table / .badge / .slide-footer / .cover-stage 及内联 SVG）",
      }),
    }),
    { minItems: 1 }
  ),
  alsoExportPptx: opt(
    bool({ description: "是否在浏览器环境下自动同步导出同名 .pptx 到工作区，默认 false" })
  ),
});

const slidesUpdateSlideParams = obj({
  path: str({ description: "既有的 .slides.html 文件路径" }),
  slideIndex: int({ description: "要局部更新的页码（从 1 开始）", minimum: 1 }),
  title: opt(str({ description: "更新后的本页标题（省略则保留原标题）" })),
  notes: opt(str({ description: "更新后的演讲者备注（省略则保留原备注）" })),
  html: opt(str({ description: "更新后的本页内部 HTML 片段（省略则保留原 HTML）" })),
});

const pptCreateParams = obj({
  path: str({ description: "新建或覆盖的 .pptx 文件路径" }),
  title: opt(str({ description: "演示文稿标题" })),
  theme: opt(
    oneOf(["business-navy", "minimal-tech", "warm-report", "dark-keynote"], {
      description: "配色主题，默认 business-navy",
    })
  ),
  slides: arr(
    obj({
      layout: oneOf(["cover", "bullets", "two-column", "table", "chart", "closing"], {
        description: "幻灯片版式",
      }),
      title: str({ description: "本页标题" }),
      subtitle: opt(str({ description: "cover/closing 页副标题" })),
      meta: opt(str({ description: "cover 页底部信息（汇报人/日期）" })),
      bullets: opt(arr(str(), { description: "bullets 版式要点列表" })),
      leftTitle: opt(str({ description: "two-column 左栏标题" })),
      leftBullets: opt(arr(str(), { description: "two-column 左栏要点" })),
      rightTitle: opt(str({ description: "two-column 右栏标题" })),
      rightBullets: opt(arr(str(), { description: "two-column 右栏要点" })),
      headers: opt(arr(str(), { description: "table 表头" })),
      rows: opt(arr(arr(str()), { description: "table 数据行" })),
      chartType: opt(oneOf(["bar", "line", "pie"], { description: "chart 图表类型" })),
      series: opt(
        arr(
          obj({
            name: str(),
            labels: arr(str()),
            values: arr(unknown()),
          }),
          { description: "chart 数据系列" }
        )
      ),
      caption: opt(str({ description: "chart 底部说明" })),
      notes: opt(str({ description: "演讲者备注" })),
    }),
    { minItems: 1 }
  ),
});

const pdfReadParams = obj({
  path: str({ description: ".pdf 文件路径" }),
  startPage: opt(int({ description: "起始页码（从 1 开始）", minimum: 1 })),
  endPage: opt(int({ description: "结束页码", minimum: 1 })),
});

const pdfCreateParams = obj({
  path: str({ description: "新建或覆盖的 .pdf 文件路径" }),
  title: str({ description: "PDF 文档标题" }),
  subtitle: opt(str({ description: "副标题" })),
  paragraphs: opt(arr(str(), { description: "正文段落列表（兼容简单纯段落模式）" })),
  sections: opt(
    arr(
      obj({
        type: oneOf(["heading", "paragraph", "bullets", "table"], {
          description: "结构化区块类型",
        }),
        level: opt(int({ description: "仅 heading 有效：1、2 或 3", minimum: 1, maximum: 3 })),
        text: opt(str({ description: "heading 或 paragraph 的文本内容" })),
        items: opt(arr(str(), { description: "bullets 列表条目" })),
        headers: opt(arr(str(), { description: "table 表头" })),
        rows: opt(arr(arr(str()), { description: "table 数据行" })),
      }),
      { description: "结构化区块列表（支持多级标题、段落、要点列表与表格）" }
    )
  ),
  footerText: opt(str({ description: "可选页脚文字，默认显示 Mizurisu Agent" })),
});

const pdfMergeParams = obj({
  paths: arr(str(), { description: "按顺序合并的工作区 .pdf 文件路径列表（至少 2 份）", minItems: 2 }),
  outputPath: str({ description: "合并后的输出 .pdf 文件路径" }),
});

const markdownExportParams = obj({
  sourcePath: str({ description: "工作区内的 Markdown 源文件路径，如 report.md" }),
  format: oneOf(["docx", "pdf"], { description: "导出目标格式：docx 或 pdf" }),
  outputPath: opt(str({ description: "可选输出文件路径，省略时自动替换源文件扩展名" })),
  title: opt(str({ description: "可选文档标题（当 Markdown 未含一级标题时作为兜底标题）" })),
});

function toCellInput(v: unknown): CellScalar | { formula: string } {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object" && "formula" in v && typeof (v as { formula?: unknown }).formula === "string") {
    return { formula: (v as { formula: string }).formula };
  }
  return String(v);
}

function ensureSlidesHtmlPath(rawPath: string): string {
  const lower = rawPath.toLowerCase();
  if (lower.endsWith(".slides.html") || lower.endsWith(".deck.html")) {
    return rawPath;
  }
  if (lower.endsWith(".html")) {
    return `${rawPath.slice(0, -5)}.slides.html`;
  }
  return `${rawPath}.slides.html`;
}

function derivePptxPath(slidesPath: string): string {
  return slidesPath.replace(/\.(slides|deck)\.html$/i, ".pptx").replace(/\.html$/i, ".pptx");
}

function deriveFallbackTitle(sourcePath: string): string {
  const filename = sourcePath.split("/").pop() || sourcePath;
  return filename.replace(/\.(md|mdx|markdown)$/i, "") || "导出文档";
}

function deriveExportOutputPath(sourcePath: string, format: "docx" | "pdf"): string {
  if (/\.(md|mdx|markdown)$/i.test(sourcePath)) {
    return sourcePath.replace(/\.(md|mdx|markdown)$/i, `.${format}`);
  }
  return `${sourcePath}.${format}`;
}

function formatSlideValidationSummary(report: SlideValidationReport): string {
  if (report.issues.length === 0) {
    return `体检结果：全部 ${report.slideCount} 页通过（0 项违规或溢出）。`;
  }
  const lines = report.issues.map((issue) => {
    const pageLabel = issue.slideIndex > 0 ? `第 ${issue.slideIndex} 页` : "全局样式";
    return `- [${issue.severity.toUpperCase()}][${pageLabel}][${issue.code}] ${issue.message}`;
  });
  return [
    `体检结果：发现 ${report.issues.length} 项问题（ok=${report.ok}，共 ${report.slideCount} 页），请根据下方逐页提示调用 slides_update_slide 修复：`,
    ...lines,
  ].join("\n");
}

export function createOfficeTools(vfs: WorkspaceVFS): AgentTool[] {
  const excelInspectTool: AgentTool<typeof excelInspectParams> = {
    name: "excel_inspect",
    label: "检查 Excel 结构",
    description: "查看 Excel/CSV 文件包含的工作表、行列数、表头、前几行样本与数值列汇总统计。",
    parameters: excelInspectParams,
    execute: async (_id, params) => {
      const bytes = await vfs.readBytes(params.path);
      const info = await inspectExcel(bytes, params.path, params.previewRows ?? 8);
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
        details: { path: params.path, sheetCount: info.sheetCount },
      };
    },
  };

  const excelReadTool: AgentTool<typeof excelReadParams> = {
    name: "excel_read_sheet",
    label: "读取 Excel 工作表",
    description: "分页读取指定工作表的单元格内容与公式。",
    parameters: excelReadParams,
    execute: async (_id, params) => {
      const bytes = await vfs.readBytes(params.path);
      const res = await readExcelSheet(bytes, {
        filename: params.path,
        sheetName: params.sheetName,
        startRow: params.startRow,
        maxRows: params.maxRows ?? 80,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        details: { path: params.path, sheetName: res.sheetName },
      };
    },
  };

  const excelCreateTool: AgentTool<typeof excelCreateParams> = {
    name: "excel_create",
    label: "生成 Excel 工作簿",
    description: "创建带样式、冻结表头、多 Sheet 与 Excel 公式的新 .xlsx 文件并保存到工作区。",
    parameters: excelCreateParams,
    execute: async (_id, params) => {
      const bytes = await createExcelWorkbook({
        sheets: params.sheets.map((s) => ({
          name: s.name,
          headers: s.headers,
          rows: s.rows.map((row) => row.map(toCellInput)),
          freezeHeader: s.freezeHeader,
        })),
      });
      const meta = await vfs.writeBytes(params.path, bytes, {
        snapshotNote: "Agent 生成 Excel 前快照",
      });
      return {
        content: [{ type: "text", text: `已生成 Excel 文件 ${meta.path} (${meta.size} 字节)。` }],
        details: { modifiedPath: meta.path, size: meta.size },
      };
    },
  };

  const excelUpdateTool: AgentTool<typeof excelUpdateParams> = {
    name: "excel_update",
    label: "更新 Excel 单元格/追加行",
    description: "在既有 .xlsx 工作簿上修改单元格值或公式、设置格式或追加行（自动保存版本快照）。",
    parameters: excelUpdateParams,
    execute: async (_id, params) => {
      const prev = await vfs.readBytes(params.path);
      const updated = await updateExcelCells(
        prev,
        {
          operations: params.operations?.map((op) => ({
            sheetName: op.sheetName,
            cell: op.cell,
            value:
              op.value === undefined
                ? undefined
                : (toCellInput(op.value) as CellScalar),
            formula: op.formula,
            numFmt: op.numFmt,
          })),
          appendRows: params.appendRows?.map((batch) => ({
            sheetName: batch.sheetName,
            rows: batch.rows.map((r) => r.map(toCellInput)),
          })),
          deleteRows: params.deleteRows,
          deleteColumns: params.deleteColumns,
          mergeCells: params.mergeCells,
        },
        params.path
      );
      const meta = await vfs.writeBytes(params.path, updated, {
        snapshotNote: "Agent 修改 Excel 前快照",
      });
      return {
        content: [{ type: "text", text: `已更新 Excel 文件 ${meta.path} (${meta.size} 字节)。` }],
        details: { modifiedPath: meta.path, size: meta.size },
      };
    },
  };

  const wordReadTool: AgentTool<typeof wordReadParams> = {
    name: "word_read",
    label: "读取 Word 文档",
    description: "解析工作区 .docx 文件的纯文本与结构化内容。",
    parameters: wordReadParams,
    execute: async (_id, params) => {
      const bytes = await vfs.readBytes(params.path);
      const res = await readWordDocument(bytes);
      return {
        content: [
          {
            type: "text",
            text: `Word 文档 ${params.path} (约 ${res.paragraphCount} 段):\n\n${res.text}`,
          },
        ],
        details: { path: params.path, paragraphCount: res.paragraphCount },
      };
    },
  };

  const wordCreateTool: AgentTool<typeof wordCreateParams> = {
    name: "word_create",
    label: "生成 Word 文档",
    description: "创建排版规范的 .docx 文档，支持标题、段落、列表、样式表格、页眉页码与分页符。",
    parameters: wordCreateParams,
    execute: async (_id, params) => {
      const blocks: WordBlock[] = params.blocks.map((b) => {
        switch (b.type) {
          case "heading":
            return {
              type: "heading",
              level: b.level === 2 ? 2 : b.level === 3 ? 3 : 1,
              text: b.text || "",
            };
          case "bullet":
            return { type: "bullet", items: b.items || (b.text ? [b.text] : []) };
          case "numbered":
            return { type: "numbered", items: b.items || (b.text ? [b.text] : []) };
          case "table":
            return { type: "table", headers: b.headers, rows: b.rows || [] };
          case "pageBreak":
            return { type: "pageBreak" };
          case "paragraph":
          default:
            return { type: "paragraph", text: b.text || "", bold: b.bold };
        }
      });

      const bytes = await createWordDocument({
        title: params.title,
        subtitle: params.subtitle,
        headerText: params.headerText,
        blocks,
      });
      const meta = await vfs.writeBytes(params.path, bytes, {
        snapshotNote: "Agent 生成 Word 前快照",
      });
      return {
        content: [{ type: "text", text: `已生成 Word 文档 ${meta.path} (${meta.size} 字节)。` }],
        details: { modifiedPath: meta.path, size: meta.size },
      };
    },
  };

  const pptReadTool: AgentTool<typeof pptReadParams> = {
    name: "ppt_read",
    label: "读取 PPT 演示文稿",
    description: "读取 .pptx 每页幻灯片的标题、文本和演讲者备注。",
    parameters: pptReadParams,
    execute: async (_id, params) => {
      const bytes = await vfs.readBytes(params.path);
      const res = await readPptDocument(bytes);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        details: { path: params.path, slideCount: res.slideCount },
      };
    },
  };

  const slidesReadTool: AgentTool<typeof slidesReadParams> = {
    name: "slides_read",
    label: "读取 HTML 幻灯片",
    description:
      "读取 .slides.html 演示文稿的标题、主题、每页 HTML 片段与演讲者备注，并执行 CSS/溢出体检。",
    parameters: slidesReadParams,
    execute: async (_id, params) => {
      const html = await vfs.readText(params.path);
      const deck = parseSlidesHtmlDocument(html);
      const validation = validateSlidesHtml(html);
      const payload = {
        path: params.path,
        title: deck.title,
        theme: deck.theme,
        slideCount: deck.slides.length,
        customCss: deck.customCss,
        slides: deck.slides.map((s, idx) => ({
          slideIndex: idx + 1,
          title: s.title,
          notes: s.notes || "",
          html: s.html,
        })),
        validation,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details: {
          path: params.path,
          slideCount: deck.slides.length,
          ok: validation.ok,
        },
      };
    },
  };

  const slidesCreateTool: AgentTool<typeof slidesCreateParams> = {
    name: "slides_create",
    label: "生成 HTML 高颜值幻灯片",
    description:
      "【首选演示工具】基于 1280×720 HTML-First 引擎生成 .slides.html 高颜值演示文稿，自动执行 CSS 白名单与防溢出体检；可选在浏览器环境同步导出同名 .pptx。",
    parameters: slidesCreateParams,
    execute: async (_id, params) => {
      const targetPath = ensureSlidesHtmlPath(params.path);
      const theme = (params.theme ?? "linear-dark") as SlideThemeId;
      const html = buildSlidesHtmlDocument({
        title: params.title,
        theme,
        customCss: params.customCss,
        slides: params.slides,
      });

      const meta = await vfs.writeText(targetPath, html, {
        snapshotNote: "Agent 生成 HTML 幻灯片前快照",
      });

      const validation = validateSlidesHtml(html);
      let pptxPath: string | undefined;
      let pptxNote = "";

      if (params.alsoExportPptx) {
        if (typeof document !== "undefined" && document.body) {
          try {
            const candidatePptxPath = derivePptxPath(meta.path);
            const fileName = candidatePptxPath.split("/").pop() || "presentation.pptx";
            const pptxBytes = await exportHtmlSlidesToPptxBytes(html, fileName);
            const pptxMeta = await vfs.writeBytes(candidatePptxPath, pptxBytes, {
              snapshotNote: "HTML 幻灯片同步导出 PPTX 前快照",
            });
            pptxPath = pptxMeta.path;
            pptxNote = `\n已同步导出原生 PPTX：${pptxMeta.path} (${pptxMeta.size} 字节)。`;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            pptxNote = `\n自动导出 .pptx 失败（.slides.html 已成功落盘，可在预览台点击「导出 PPTX」重试）：${msg}`;
          }
        } else {
          pptxNote =
            "\n当前非浏览器 DOM 环境，已跳过自动导出 .pptx（可在预览台点击「导出 PPTX」一键转换）。";
        }
      }

      const summary = [
        `已生成 HTML 幻灯片 ${meta.path} (${meta.size} 字节，主题 ${theme}，共 ${params.slides.length} 页)。`,
        formatSlideValidationSummary(validation),
      ].join("\n") + pptxNote;

      return {
        content: [{ type: "text", text: summary }],
        details: {
          modifiedPath: meta.path,
          size: meta.size,
          slideCount: params.slides.length,
          validation,
          ...(pptxPath ? { pptxPath } : {}),
        },
      };
    },
  };

  const slidesUpdateSlideTool: AgentTool<typeof slidesUpdateSlideParams> = {
    name: "slides_update_slide",
    label: "局部更新单页幻灯片",
    description:
      "按页码（从 1 开始）局部更新既有 .slides.html 的某页标题、HTML 或演讲者备注，执行防溢出与 CSS 黑名单体检，并自动保留版本快照。",
    parameters: slidesUpdateSlideParams,
    execute: async (_id, params) => {
      if (
        params.title === undefined &&
        params.notes === undefined &&
        params.html === undefined
      ) {
        throw new Error("请至少提供 title、notes 或 html 中的一项进行更新");
      }

      const prevHtml = await vfs.readText(params.path);
      const nextHtml = updateSlideInHtmlDocument(prevHtml, params.slideIndex, {
        ...(params.title !== undefined ? { title: params.title } : {}),
        ...(params.notes !== undefined ? { notes: params.notes } : {}),
        ...(params.html !== undefined ? { html: params.html } : {}),
      });

      const meta = await vfs.writeText(params.path, nextHtml, {
        snapshotNote: `更新第 ${params.slideIndex} 页前快照`,
      });
      const validation = validateSlidesHtml(nextHtml);

      return {
        content: [
          {
            type: "text",
            text: [
              `已更新 ${meta.path} 第 ${params.slideIndex} 页 (${meta.size} 字节)。`,
              formatSlideValidationSummary(validation),
            ].join("\n"),
          },
        ],
        details: {
          modifiedPath: meta.path,
          size: meta.size,
          slideIndex: params.slideIndex,
          slideCount: validation.slideCount,
          validation,
        },
      };
    },
  };

  const pptCreateTool: AgentTool<typeof pptCreateParams> = {
    name: "ppt_create",
    label: "生成旧版 PPTX（兜底）",
    description:
      "【旧版兜底】直接用 PptxGenJS 生成简单固定版式 .pptx。常规制作演示文稿请优先使用 slides_create（支持 Bento/KPI 巨字/SVG 图表并可导出高保真 PPTX）。",
    parameters: pptCreateParams,
    execute: async (_id, params) => {
      const slides: PptSlideInput[] = params.slides.map((s) => {
        if (s.layout === "cover") {
          return {
            layout: "cover",
            title: s.title,
            subtitle: s.subtitle,
            meta: s.meta,
            notes: s.notes,
          };
        }
        if (s.layout === "closing") {
          return {
            layout: "closing",
            title: s.title,
            subtitle: s.subtitle,
            notes: s.notes,
          };
        }
        if (s.layout === "two-column") {
          return {
            layout: "two-column",
            title: s.title,
            leftTitle: s.leftTitle || "左侧要点",
            leftBullets: s.leftBullets || [],
            rightTitle: s.rightTitle || "右侧要点",
            rightBullets: s.rightBullets || [],
            notes: s.notes,
          };
        }
        if (s.layout === "table") {
          return {
            layout: "table",
            title: s.title,
            headers: s.headers || [],
            rows: s.rows || [],
            notes: s.notes,
          };
        }
        if (s.layout === "chart") {
          return {
            layout: "chart",
            title: s.title,
            chartType: s.chartType || "bar",
            series: (s.series || []).map((sr) => ({
              name: sr.name,
              labels: sr.labels,
              values: sr.values.map((v) => Number(v) || 0),
            })),
            caption: s.caption,
            notes: s.notes,
          };
        }
        return {
          layout: "bullets",
          title: s.title,
          bullets: s.bullets || [],
          notes: s.notes,
        };
      });

      const bytes = await createPptPresentation({
        title: params.title,
        theme: params.theme,
        slides,
      });
      const meta = await vfs.writeBytes(params.path, bytes, {
        snapshotNote: "Agent 生成 PPT 前快照",
      });
      return {
        content: [{ type: "text", text: `已生成 PPT 文件 ${meta.path} (${meta.size} 字节，共 ${slides.length} 页)。` }],
        details: { modifiedPath: meta.path, size: meta.size, slideCount: slides.length },
      };
    },
  };

  const pdfReadTool: AgentTool<typeof pdfReadParams> = {
    name: "pdf_read",
    label: "读取 PDF 文档",
    description: "提取工作区 .pdf 文件的页数与指定页范围的文本内容。",
    parameters: pdfReadParams,
    execute: async (_id, params) => {
      const bytes = await vfs.readBytes(params.path);
      const res = await readPdfDocument(bytes, {
        startPage: params.startPage,
        endPage: params.endPage,
      });
      const suspectedScannedPages = res.pages
        .filter((p) => p.text.trim().length < 15)
        .map((p) => p.pageNumber);
      const payload = {
        ...res,
        ...(suspectedScannedPages.length > 0
          ? {
              suspectedScannedPages,
              hint: `检测到第 ${suspectedScannedPages.join("、")} 页疑似扫描件或纯图页（文本极少），可调用 vision_ocr 对指定页码做辅助视觉/OCR识别。`,
            }
          : {}),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details: { path: params.path, pageCount: res.pageCount, suspectedScannedPages },
      };
    },
  };

  const pdfCreateTool: AgentTool<typeof pdfCreateParams> = {
    name: "pdf_create",
    label: "生成 PDF 文档",
    description:
      "根据标题、正文段落或结构化区块（多级标题、列表、表格）生成带页眉页码的 .pdf 文档（支持中英文混排）。",
    parameters: pdfCreateParams,
    execute: async (_id, params) => {
      const sections: PdfSection[] | undefined = params.sections?.map((sec) => {
        switch (sec.type) {
          case "heading":
            return {
              type: "heading",
              level: sec.level === 2 ? 2 : sec.level === 3 ? 3 : 1,
              text: sec.text || "",
            };
          case "bullets":
            return {
              type: "bullets",
              items: sec.items || (sec.text ? [sec.text] : []),
            };
          case "table":
            return {
              type: "table",
              headers: sec.headers,
              rows: sec.rows || [],
            };
          case "paragraph":
          default:
            return { type: "paragraph", text: sec.text || "" };
        }
      });

      const hasParagraphs = Boolean(params.paragraphs && params.paragraphs.length > 0);
      const hasSections = Boolean(sections && sections.length > 0);
      // 当 paragraphs 与 sections 均为空时使用空段兜底，避免调用报错
      const resolvedParagraphs = hasParagraphs || hasSections ? params.paragraphs : [""];

      const bytes = await createPdfDocument({
        title: params.title,
        subtitle: params.subtitle,
        paragraphs: resolvedParagraphs,
        sections,
        footerText: params.footerText,
      });
      const meta = await vfs.writeBytes(params.path, bytes, {
        snapshotNote: "Agent 生成 PDF 前快照",
      });
      const fallbackHint =
        !hasParagraphs && !hasSections ? "（未提供正文或区块，已按空段落兜底生成标题页）" : "";
      return {
        content: [
          {
            type: "text",
            text: `已生成 PDF 文件 ${meta.path} (${meta.size} 字节)。${fallbackHint}`,
          },
        ],
        details: { modifiedPath: meta.path, size: meta.size },
      };
    },
  };

  const pdfMergeTool: AgentTool<typeof pdfMergeParams> = {
    name: "pdf_merge",
    label: "合并多个 PDF 文档",
    description: "按顺序读取工作区中的多份 .pdf 文件（至少 2 份）并合并输出为一个新 PDF。",
    parameters: pdfMergeParams,
    execute: async (_id, params) => {
      if (params.paths.length < 2) {
        throw new Error("合并 PDF 至少需要提供 2 份有效文件路径");
      }
      const filesBytes: Uint8Array[] = [];
      for (const path of params.paths) {
        filesBytes.push(await vfs.readBytes(path));
      }
      const merged = await mergePdfDocuments(filesBytes);
      const meta = await vfs.writeBytes(params.outputPath, merged, {
        snapshotNote: "Agent 合并 PDF 前快照",
      });
      return {
        content: [
          {
            type: "text",
            text: `已将 ${params.paths.length} 份 PDF 合并为 ${meta.path} (${meta.size} 字节)。`,
          },
        ],
        details: {
          modifiedPath: meta.path,
          size: meta.size,
          sourceCount: params.paths.length,
        },
      };
    },
  };

  const markdownExportTool: AgentTool<typeof markdownExportParams> = {
    name: "markdown_export",
    label: "Markdown 导出 Word / PDF",
    description: "将工作区 Markdown 文件解析为结构化标题、列表与表格，导出为规范 .docx 或 .pdf 文件。",
    parameters: markdownExportParams,
    execute: async (_id, params) => {
      const markdown = await vfs.readText(params.sourcePath);
      const fallbackTitle = params.title?.trim() || deriveFallbackTitle(params.sourcePath);
      const targetPath =
        params.outputPath?.trim() || deriveExportOutputPath(params.sourcePath, params.format);

      const bytes =
        params.format === "docx"
          ? await createWordDocument(markdownToWordSpec(markdown, fallbackTitle))
          : await createPdfDocument(markdownToPdfSpec(markdown, fallbackTitle));

      const meta = await vfs.writeBytes(targetPath, bytes, {
        snapshotNote: `Markdown 导出 ${params.format.toUpperCase()} 前快照`,
      });
      return {
        content: [
          {
            type: "text",
            text: `已将 ${params.sourcePath} 导出为 ${meta.path} (${meta.size} 字节)。`,
          },
        ],
        details: {
          modifiedPath: meta.path,
          size: meta.size,
          format: params.format,
          sourcePath: params.sourcePath,
        },
      };
    },
  };

  return [
    excelInspectTool,
    excelReadTool,
    excelCreateTool,
    excelUpdateTool,
    wordReadTool,
    wordCreateTool,
    slidesCreateTool,
    slidesUpdateSlideTool,
    slidesReadTool,
    pptReadTool,
    pptCreateTool,
    pdfReadTool,
    pdfCreateTool,
    pdfMergeTool,
    markdownExportTool,
  ];
}
