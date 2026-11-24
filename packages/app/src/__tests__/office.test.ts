import { describe, expect, it } from "vitest";
import {
  createExcelWorkbook,
  createPdfDocument,
  createPptPresentation,
  createWordDocument,
  exportSheetToCsv,
  inspectExcel,
  mergePdfDocuments,
  readExcelSheet,
  readPdfDocument,
  readPptDocument,
  readWordDocument,
  updateExcelCells,
} from "../office";

describe("纯 JS 内置 Office 读写闭环", () => {
  it("Excel: 生成、检查统计、增量修改单元格、追加行与导出 CSV", async () => {
    const bytes = await createExcelWorkbook({
      sheets: [
        {
          name: "销售汇总",
          headers: ["地区", "金额", "占比"],
          rows: [
            ["华东", 120, 0.6],
            ["华南", 80, 0.4],
            ["合计", { formula: "SUM(B2:B3)", result: 200 }, 1],
          ],
          numberFormats: { 1: "#,##0", 2: "0.0%" },
        },
      ],
    });

    const info = await inspectExcel(bytes, "sales.xlsx");
    expect(info.sheetCount).toBe(1);
    expect(info.sheets[0].headers).toEqual(["地区", "金额", "占比"]);
    expect(info.sheets[0].numericStats.find((s) => s.column === "金额")?.sum).toBe(400);

    const updated = await updateExcelCells(
      bytes,
      {
        operations: [{ sheetName: "销售汇总", cell: "B2", value: 150 }],
        appendRows: [{ sheetName: "销售汇总", rows: [["华北", 90, 0.2]] }],
      },
      "sales.xlsx"
    );

    const readBack = await readExcelSheet(updated, {
      filename: "sales.xlsx",
      sheetName: "销售汇总",
    });
    expect(readBack.rows[1][1].value).toBe(150);
    expect(readBack.rows[4][0].value).toBe("华北");
    expect(readBack.rows[3][1].formula).toBe("SUM(B2:B3)");

    const csv = await exportSheetToCsv(updated, "销售汇总", "sales.xlsx");
    expect(csv).toContain("地区,金额,占比");
    expect(csv).toContain("华北,90,0.2");
  });

  it("Word: 生成含标题、列表、表格的 .docx 并完整读回", async () => {
    const bytes = await createWordDocument({
      title: "季度经营分析报告",
      subtitle: "2026 Q2 内部审阅版",
      headerText: "Mizurisu Agent 自动生成",
      blocks: [
        { type: "heading", level: 1, text: "一、核心经营结论" },
        { type: "paragraph", text: "本季度中转站调用量与 SaaS 收入同步增长 28%。" },
        { type: "bullet", items: ["华东区保持第一", "API 网关稳定性达 99.98%"] },
        {
          type: "table",
          headers: ["部门", "完成率"],
          rows: [
            ["研发部", "105%"],
            ["市场部", "98%"],
          ],
        },
      ],
    });

    const parsed = await readWordDocument(bytes);
    expect(parsed.text).toContain("季度经营分析报告");
    expect(parsed.text).toContain("核心经营结论");
    expect(parsed.text).toContain("99.98%");
    expect(parsed.text).toContain("105%");
    expect(parsed.paragraphCount).toBeGreaterThanOrEqual(4);
  });

  it("PPT: 生成含封面、双栏、表格、原生图表与备注的 .pptx 并读回校验", async () => {
    const bytes = await createPptPresentation({
      title: "年度规划汇报",
      theme: "business-navy",
      slides: [
        { layout: "cover", title: "2026 年度规划", subtitle: "产品与营收路线", notes: "开场致谢" },
        { layout: "bullets", title: "核心目标", bullets: ["月活突破 10 万", "推出三端客户端"] },
        {
          layout: "two-column",
          title: "现状与对策",
          leftTitle: "挑战",
          leftBullets: ["跨端同步体验"],
          rightTitle: "方案",
          rightBullets: ["纯本机 VFS + JSON 迁移"],
        },
        {
          layout: "table",
          title: "季度目标拆解",
          headers: ["季度", "目标(万)"],
          rows: [
            ["Q1", "500"],
            ["Q2", "700"],
          ],
        },
        {
          layout: "chart",
          title: "营收趋势预测",
          chartType: "bar",
          series: [{ name: "营收", labels: ["Q1", "Q2", "Q3"], values: [500, 700, 950] }],
        },
        { layout: "closing", title: "谢谢聆听", subtitle: "Q&A 交流环节", notes: "结束页备注" },
      ],
    });

    const parsed = await readPptDocument(bytes);
    expect(parsed.slideCount).toBe(6);
    expect(parsed.slides[0].title).toContain("2026 年度规划");
    expect(parsed.slides[0].notes).toContain("开场致谢");
    expect(parsed.slides[1].texts.join(" ")).toContain("推出三端客户端");
    expect(parsed.slides[5].notes).toContain("结束页备注");
  });

  it("PDF: 生成、读取文本与多文档合并", async () => {
    const pdf1 = await createPdfDocument({
      title: "Mizurisu Agent Quarterly Summary",
      subtitle: "Generated locally",
      paragraphs: ["Revenue grew by 25 percent in Q2 with zero backend overhead."],
    });
    const pdf2 = await createPdfDocument({
      title: "Appendix Page",
      paragraphs: ["Detailed breakdown of regional performance."],
    });

    const read1 = await readPdfDocument(pdf1);
    expect(read1.pageCount).toBe(1);
    expect(read1.pages[0].text).toContain("Mizurisu Agent Quarterly Summary");
    expect(read1.pages[0].text).toContain("Revenue grew by 25 percent");

    const merged = await mergePdfDocuments([pdf1, pdf2]);
    const readMerged = await readPdfDocument(merged);
    expect(readMerged.pageCount).toBe(2);
    expect(readMerged.pages[1].text).toContain("Appendix Page");
  });
});
