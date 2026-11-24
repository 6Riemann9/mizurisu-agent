import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_SKILLS } from "../agent/skills";
import { createOfficeTools } from "../agent/tools/office-tools";
import {
  createPdfDocument,
  createWordDocument,
  createWorkspaceZip,
  formatSessionToMarkdown,
  markdownToPdfSpec,
  markdownToWordSpec,
  readPdfDocument,
  readWordDocument,
} from "../office";
import { clearAllLocalData } from "../storage/db";
import { WorkspaceVFS } from "../storage/workspace-vfs";
import type { ChatSession } from "../types";

describe("Office 升级、打包导出与工作区增强", () => {
  let vfs: WorkspaceVFS;

  beforeEach(async () => {
    await clearAllLocalData();
    vfs = new WorkspaceVFS();
  });

  it("结构化 PDF 生成支持多级标题、列表、表格、自动分页与页脚页码", async () => {
    const manyRows = Array.from({ length: 38 }, (_, idx) => [
      `Item-${idx + 1}`,
      `Category-${(idx % 3) + 1}`,
      `${(idx + 1) * 120} USD`,
      idx % 2 === 0 ? "Completed" : "In Progress",
    ]);

    const pdfBytes = await createPdfDocument({
      title: "Enterprise Quarterly Audit Report",
      subtitle: "FY2026 Q2 Executive Review",
      footerText: "Confidential - Mizurisu Client Deliverable",
      sections: [
        { type: "heading", level: 1, text: "1. Executive Summary" },
        {
          type: "paragraph",
          text: "Overall operational efficiency improved significantly across all regions.",
        },
        { type: "heading", level: 2, text: "1.1 Key Highlights" },
        {
          type: "bullets",
          items: [
            "Recurring SaaS revenue increased by 28.4% year-over-year.",
            "Gateway availability remained at 99.98% across peak traffic.",
          ],
        },
        { type: "heading", level: 3, text: "1.2 Detailed Breakdown Table" },
        {
          type: "table",
          headers: ["Record", "Department", "Amount", "Status"],
          rows: manyRows,
        },
      ],
    });

    // 校验 PDF 文件魔数
    const header = String.fromCharCode(...pdfBytes.slice(0, 5));
    expect(header).toBe("%PDF-");

    const parsed = await readPdfDocument(pdfBytes);
    expect(parsed.pageCount).toBeGreaterThanOrEqual(2);
    expect(parsed.pages[0].text).toContain("Enterprise Quarterly Audit Report");
    expect(parsed.pages[0].text).toContain("1. Executive Summary");
    expect(parsed.pages[0].text).toContain("99.98%");
    expect(parsed.pages[0].text).toContain("Confidential - Mizurisu Client Deliverable");
    expect(parsed.pages[0].text).toContain(`Page 1 / ${parsed.pageCount}`);
    expect(parsed.pages[parsed.pageCount - 1].text).toContain(
      `Page ${parsed.pageCount} / ${parsed.pageCount}`
    );
    expect(parsed.pages[1].text).toContain("Enterprise Quarterly Audit Report");
  });

  it("createWorkspaceZip 规范化路径并用 deflate 压缩，JSZip 可完整解压校验", async () => {
    const textBytes = new TextEncoder().encode("# Delivery Report\nAll tasks completed.");
    const binaryBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xaa, 0xbb]);

    const zipBytes = await createWorkspaceZip([
      { path: "/docs/summary.md", data: textBytes },
      { path: "assets\\bin\\sample.dat", data: binaryBytes },
    ]);

    const loaded = await JSZip.loadAsync(zipBytes);
    const entryNames = Object.keys(loaded.files);
    expect(entryNames).toContain("docs/summary.md");
    expect(entryNames).toContain("assets/bin/sample.dat");

    const extractedText = await loaded.file("docs/summary.md")!.async("string");
    expect(extractedText).toBe("# Delivery Report\nAll tasks completed.");

    const extractedBin = await loaded.file("assets/bin/sample.dat")!.async("uint8array");
    expect(Array.from(extractedBin)).toEqual(Array.from(binaryBytes));
  });

  it("Markdown 转 Word / PDF 与会话归档 Markdown 导出正常工作", async () => {
    const md = [
      "# Q2 Business Delivery Summary",
      "",
      "## Overview",
      "Total revenue reached **$1.25M** across core accounts.",
      "",
      "- East China: +24%",
      "* South China: +31%",
      "",
      "1. Finalize Q3 budget",
      "2. Launch enterprise onboarding",
      "",
      "| Region | Target | Actual |",
      "| --- | --- | --- |",
      "| East | 300 | 385 |",
      "| South | 220 | 268 |",
      "",
      "> Note: Figures are verified locally.",
      "",
      "```",
      "SUM = 653",
      "```",
    ].join("\n");

    const wordSpec = markdownToWordSpec(md, "Fallback");
    expect(wordSpec.title).toBe("Q2 Business Delivery Summary");
    expect(wordSpec.blocks.some((b) => b.type === "table")).toBe(true);
    expect(wordSpec.blocks.some((b) => b.type === "bullet")).toBe(true);
    expect(wordSpec.blocks.some((b) => b.type === "numbered")).toBe(true);

    const docxBytes = await createWordDocument(wordSpec);
    const docxRead = await readWordDocument(docxBytes);
    expect(docxRead.text).toContain("Q2 Business Delivery Summary");
    expect(docxRead.text).toContain("$1.25M");
    expect(docxRead.text).toContain("385");

    const pdfSpec = markdownToPdfSpec(md, "Fallback");
    expect(pdfSpec.title).toBe("Q2 Business Delivery Summary");
    expect(pdfSpec.sections?.some((s) => s.type === "table")).toBe(true);

    const pdfBytes = await createPdfDocument(pdfSpec);
    const pdfRead = await readPdfDocument(pdfBytes);
    expect(pdfRead.pages[0].text).toContain("Q2 Business Delivery Summary");
    expect(pdfRead.pages[0].text).toContain("East");
    expect(pdfRead.pages[0].text).toContain("385");

    // 无一级标题时使用 fallbackTitle
    const fallbackWord = markdownToWordSpec("## Section Only\nPlain body", "Custom Fallback");
    expect(fallbackWord.title).toBe("Custom Fallback");

    const session: ChatSession = {
      id: "sess_export_1",
      title: "季度财务复盘会话",
      createdAt: 1700000000000,
      updatedAt: 1700000020000,
      totalTokens: 1280,
      messages: [
        {
          id: "m2",
          role: "assistant",
          content: "已完成销售汇总表和正式报告。",
          modelId: "claude-sonnet-4-5",
          createdAt: 1700000015000,
          usage: { inputTokens: 800, outputTokens: 480, totalTokens: 1280 },
          toolCalls: [
            {
              id: "tc1",
              name: "word_create",
              args: { path: "Q2报告.docx" },
              status: "success",
              modifiedPath: "Q2报告.docx",
            },
          ],
        },
        {
          id: "m1",
          role: "user",
          content: "请分析附件销售数据并生成报告。",
          createdAt: 1700000005000,
          attachments: [{ path: "sales.xlsx", name: "sales.xlsx", category: "excel" }],
        },
      ],
    };

    const exportedMd = formatSessionToMarkdown(session);
    expect(exportedMd).toContain("# 季度财务复盘会话");
    expect(exportedMd).toContain("claude-sonnet-4-5");
    expect(exportedMd).toContain("1280");
    expect(exportedMd).toContain("sales.xlsx");
    expect(exportedMd).toContain("Q2报告.docx");
    // 验证按时间顺序先用户后助手
    expect(exportedMd.indexOf("用户提问")).toBeLessThan(exportedMd.indexOf("助手回复"));
  });

  it("pdf_merge、升级版 pdf_create 与 markdown_export 工具正常工作", async () => {
    const tools = createOfficeTools(vfs);
    const pdfCreate = tools.find((t) => t.name === "pdf_create")!;
    const pdfMerge = tools.find((t) => t.name === "pdf_merge")!;
    const mdExport = tools.find((t) => t.name === "markdown_export")!;

    // 1. 升级版 pdf_create：支持结构化 sections 与空内容兜底
    const structuredRes = await pdfCreate.execute("tc_pdf_1", {
      path: "part1.pdf",
      title: "Part One Document",
      footerText: "Part One Footer",
      sections: [
        { type: "heading", level: 1, text: "Section Alpha" },
        { type: "bullets", items: ["Bullet Alpha", "Bullet Beta"] },
        { type: "table", headers: ["Key", "Value"], rows: [["Revenue", "500"]] },
      ],
    });
    expect((structuredRes.details as { modifiedPath?: string }).modifiedPath).toBe("part1.pdf");

    const fallbackRes = await pdfCreate.execute("tc_pdf_2", {
      path: "part2.pdf",
      title: "Part Two Title Only",
    });
    expect((fallbackRes.details as { modifiedPath?: string }).modifiedPath).toBe("part2.pdf");

    // 2. pdf_merge：校验至少 2 份并成功合并
    await expect(
      pdfMerge.execute("tc_merge_bad", { paths: ["part1.pdf"], outputPath: "bad.pdf" })
    ).rejects.toThrow();

    const mergeRes = await pdfMerge.execute("tc_merge_ok", {
      paths: ["part1.pdf", "part2.pdf"],
      outputPath: "merged.pdf",
    });
    expect((mergeRes.details as { modifiedPath?: string }).modifiedPath).toBe("merged.pdf");

    const mergedRead = await readPdfDocument(await vfs.readBytes("merged.pdf"));
    expect(mergedRead.pageCount).toBe(2);
    expect(mergedRead.pages[0].text).toContain("Section Alpha");
    expect(mergedRead.pages[1].text).toContain("Part Two Title Only");

    // 3. markdown_export：支持导出 docx 与 pdf
    await vfs.writeText(
      "notes/brief.md",
      "# Weekly Brief\n\n## Progress\n- Shipped PDF upgrade\n\n| Task | Owner |\n| --- | --- |\n| Export | Team |\n"
    );

    const docxExportRes = await mdExport.execute("tc_md_docx", {
      sourcePath: "notes/brief.md",
      format: "docx",
    });
    expect((docxExportRes.details as { modifiedPath?: string }).modifiedPath).toBe(
      "notes/brief.docx"
    );
    const docxContent = await readWordDocument(await vfs.readBytes("notes/brief.docx"));
    expect(docxContent.text).toContain("Weekly Brief");
    expect(docxContent.text).toContain("Shipped PDF upgrade");

    const pdfExportRes = await mdExport.execute("tc_md_pdf", {
      sourcePath: "notes/brief.md",
      format: "pdf",
      outputPath: "exports/brief_out.pdf",
    });
    expect((pdfExportRes.details as { modifiedPath?: string }).modifiedPath).toBe(
      "exports/brief_out.pdf"
    );
    const pdfExportRead = await readPdfDocument(await vfs.readBytes("exports/brief_out.pdf"));
    expect(pdfExportRead.pages[0].text).toContain("Weekly Brief");
  });

  it("WorkspaceVFS.renameFile 支持安全改名、快照留存、原子 rename 事件与重名覆盖保护", async () => {
    const events: Array<{ type: string; path?: string; previousPath?: string }> = [];
    const unsubscribe = vfs.subscribe((ev) => events.push(ev));

    await vfs.writeText("draft/v1.md", "合同初稿内容");
    await vfs.writeText("final/existing.md", "已有正式文档");

    // 冲突保护：禁止覆盖已有文件
    await expect(vfs.renameFile("draft/v1.md", "final/existing.md")).rejects.toThrow("已存在");
    expect(await vfs.exists("draft/v1.md")).toBe(true);
    expect(await vfs.readText("final/existing.md")).toBe("已有正式文档");

    // 相同路径与不存在文件保护
    await expect(vfs.renameFile("/draft/v1.md", "draft/v1.md")).rejects.toThrow("相同");
    await expect(vfs.renameFile("missing.md", "other.md")).rejects.toThrow("不存在");

    // 清空前置写入事件，单独验证 renameFile 仅发射 1 次原子 rename 事件
    events.length = 0;

    // 正常重命名
    const meta = await vfs.renameFile("/draft/v1.md", "final/contract_v1.md");
    expect(meta.path).toBe("final/contract_v1.md");
    expect(meta.name).toBe("contract_v1.md");
    expect(await vfs.exists("draft/v1.md")).toBe(false);
    expect(await vfs.readText("final/contract_v1.md")).toBe("合同初稿内容");

    const oldSnapshots = await vfs.getSnapshots("draft/v1.md");
    expect(oldSnapshots.length).toBeGreaterThanOrEqual(1);
    expect(events).toEqual([
      { type: "rename", path: "final/contract_v1.md", previousPath: "draft/v1.md" },
    ]);

    unsubscribe();
  });

  it("内置 Skills 扩充为 9 项客户办公技能且默认模板品牌名已统一", async () => {
    expect(BUILTIN_SKILLS.length).toBe(9);
    const ids = BUILTIN_SKILLS.map((s) => s.id);
    expect(ids).toContain("skill-contract-review");
    expect(ids).toContain("skill-finance-reconcile");
    expect(ids).toContain("skill-meeting-action");

    await vfs.seedStarterWorkspaceIfEmpty();
    const tpl = await vfs.readText("示例_项目周报模板.md");
    expect(tpl).toContain("Mizurisu Agent");
    expect(tpl).toContain("Mizurisu / 多模型 AI 中转网关");
    expect(tpl).not.toContain("Pi Agent");
    expect(tpl).not.toContain("New-API");
  });

  it("中文 PDF 在 Canvas 环境下支持结构化 sections、分页表格与中文页码", async () => {
    const drawnTexts: string[] = [];
    const oneByOnePng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

    const mockCtx = {
      fillStyle: "#FFFFFF",
      strokeStyle: "#000000",
      lineWidth: 1,
      font: "24px sans-serif",
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn((text: string) => {
        drawnTexts.push(text);
      }),
      measureText: vi.fn((text: string) => ({ width: text.length * 22 })),
    } as unknown as CanvasRenderingContext2D;

    const getCtxSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => mockCtx as never);
    const toDataUrlSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockImplementation(() => oneByOnePng);

    try {
      const rows = Array.from({ length: 30 }, (_, idx) => [
        `项目${idx + 1}`,
        `负责人${idx + 1}`,
        "已完成",
      ]);

      const pdfBytes = await createPdfDocument({
        title: "中文客户交付审计报告",
        subtitle: "2026 第二季度",
        footerText: "Mizurisu 客户专属交付件",
        sections: [
          { type: "heading", level: 1, text: "一、核心发现" },
          { type: "paragraph", text: "本季度各项指标均符合预期要求。" },
          { type: "bullets", items: ["完成本地工作区打包", "支持中文表格自动分页"] },
          { type: "table", headers: ["事项", "负责人", "状态"], rows },
        ],
      });

      expect(String.fromCharCode(...pdfBytes.slice(0, 5))).toBe("%PDF-");
      const parsed = await readPdfDocument(pdfBytes);
      expect(parsed.pageCount).toBeGreaterThanOrEqual(2);
      expect(parsed.pages[0].text).toContain("中文客户交付审计报告");
      expect(parsed.pages[0].text).toContain("一、核心发现");
      expect(parsed.pages[0].text).toContain("本季度各项指标均符合预期要求。");
      expect(parsed.pages[0].text).toContain("Mizurisu 客户专属交付件");
      expect(parsed.pages[0].text).toContain(`第 1 / ${parsed.pageCount} 页`);
      const lastPageText = parsed.pages[parsed.pageCount - 1].text;
      expect(lastPageText).toContain("项目30");
      expect(lastPageText).toContain(`第 ${parsed.pageCount} / ${parsed.pageCount} 页`);
      expect(drawnTexts).toContain("中文客户交付审计报告");
      expect(drawnTexts).toContain("一、核心发现");
      expect(drawnTexts).toContain("Mizurisu 客户专属交付件");
      expect(drawnTexts.some((t) => t === `第 1 / ${parsed.pageCount} 页`)).toBe(true);
      expect(
        drawnTexts.some((t) => t === `第 ${parsed.pageCount} / ${parsed.pageCount} 页`)
      ).toBe(true);
    } finally {
      getCtxSpy.mockRestore();
      toDataUrlSpy.mockRestore();
    }
  });
});
