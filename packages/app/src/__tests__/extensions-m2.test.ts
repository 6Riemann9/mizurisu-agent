import { beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultExtensionHost,
  recognizeImageWithFallback,
} from "../agent/extensions";
import type { ExtensionRuntimeContext } from "../agent/extensions";
import {
  createExcelWorkbook,
  createPdfDocument,
  createPptPresentation,
  createWordDocument,
  parsePdfPageRanges,
  readExcelSheet,
  readPptDocument,
  readWordDocument,
  splitPdfDocument,
  updateExcelCells,
  updatePptDocumentInPlace,
  updateWordDocumentInPlace,
  watermarkPdfDocument,
} from "../office";
import { clearAllLocalData } from "../storage/db";
import { WorkspaceVFS } from "../storage/workspace-vfs";

function createCtx(
  vfs: WorkspaceVFS,
  overrides?: Partial<ExtensionRuntimeContext>
): ExtensionRuntimeContext {
  return {
    sessionId: "sess_m2",
    vfs,
    config: {
      brandName: "Mizurisu Agent",
      baseUrl: "https://www.mizurisu.com",
      apiKey: "sk-test",
      protocolMode: "compatible",
      selectedModelId: "gpt-4o",
      thinkingLevel: "medium",
      customModels: [],
      modelProtocolOverrides: {},
    },
    settings: {
      theme: "dark",
      autoApproveDelete: false,
      previewWidth: 520,
    },
    model: {
      id: "gpt-4o",
      name: "GPT-4o",
      api: "openai-completions",
      provider: "openai",
      baseUrl: "https://www.mizurisu.com/v1",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    },
    models: [],
    streamFn: (() => {
      throw new Error("not used");
    }) as unknown as ExtensionRuntimeContext["streamFn"],
    platform: {
      kind: "desktop",
      label: "Desktop",
      canRunShell: true,
      canMountNativeDir: true,
      getFetch: () => globalThis.fetch,
      sessionRequest: async () => ({ status: 200, ok: true, text: "" }),
      exportFile: async () => undefined,
      pickNativeDirectory: async () => null,
    },
    subagentDepth: 0,
    todos: [],
    updateTodos: () => undefined,
    ...overrides,
  };
}

describe("M2: Office 原地精修、公式重算、PDF 进阶与辅助视觉", () => {
  let vfs: WorkspaceVFS;

  beforeEach(async () => {
    await clearAllLocalData();
    vfs = new WorkspaceVFS();
  });

  it("Excel 写盘前自动重算公式（含 result=0、SUMIFS、XLOOKUP、INDEX+MATCH）并支持删行列", async () => {
    const bytes = await createExcelWorkbook({
      sheets: [
        {
          name: "数据",
          headers: ["部门", "项目", "金额"],
          rows: [
            ["研发", "A", 100],
            ["研发", "B", 200],
            ["市场", "C", 0],
            ["研发合计", "=SUMIFS(C2:C4,A2:A4,\"研发\")", "=XLOOKUP(\"C\",B2:B4,C2:C4)"],
            ["索引校验", "=INDEX(B2:B4,MATCH(\"市场\",A2:A4,0))", "=SUM(C2:C3)-300"],
          ],
        },
      ],
    });

    const read1 = await readExcelSheet(bytes, { sheetName: "数据" });
    // 第5行第2列 SUMIFS = 300
    expect(read1.rows[4][1].value).toBe(300);
    // 第5行第3列 XLOOKUP("C") = 0 (验证 result=0 不丢失)
    expect(read1.rows[4][2].value).toBe(0);
    // 第6行第2列 INDEX+MATCH = "C"
    expect(read1.rows[5][1].value).toBe("C");
    // 第6行第3列 = 0
    expect(read1.rows[5][2].value).toBe(0);

    const updated = await updateExcelCells(bytes, {
      operations: [{ sheetName: "数据", cell: "C2", value: 150 }],
      deleteRows: [{ sheetName: "数据", startRow: 4, count: 1 }],
    });
    const read2 = await readExcelSheet(updated, { sheetName: "数据" });
    expect(read2.totalRows).toBe(5);
  });

  it("Word 原地精修 (word_update) 保留表格与页眉并支持变量套打与一键快照回滚", async () => {
    const origBytes = await createWordDocument({
      title: "商务合作协议 {{年度}}",
      headerText: "密级：{{密级}}",
      blocks: [
        { type: "paragraph", text: "甲方：{{甲方名称}}，合同金额人民币 100 万元。", bold: true },
        { type: "table", headers: ["阶段", "金额"], rows: [["首付款", "30万"], ["尾款", "70万"]] },
      ],
    });
    await vfs.writeBytes("协议模板.docx", origBytes);

    // 直接引擎校验
    const inPlace = await updateWordDocumentInPlace(origBytes, {
      variables: { 年度: "2026", 密级: "内部公开", 甲方名称: "星辰科技" },
      tableUpdates: [{ tableIndex: 0, rowIndex: 1, colIndex: 1, text: "40万" }],
      appendParagraphs: [{ text: "补充条款：验收合格后 10 日内付款。" }],
    });
    expect(inPlace.replacedCount).toBe(3);
    expect(inPlace.tableCellsUpdated).toBe(1);
    expect(inPlace.appendedCount).toBe(1);

    const parsed = await readWordDocument(inPlace.bytes);
    expect(parsed.text).toContain("星辰科技");
    expect(parsed.text).toContain("40万");
    expect(parsed.text).toContain("补充条款");

    // 工具闭环校验 + 一键回滚校验
    const host = createDefaultExtensionHost();
    const ctx = createCtx(vfs);
    const wordUpdate = host.compile(ctx).tools.find((t) => t.name === "word_update")!;
    const toolRes = await wordUpdate.execute("tc_w1", {
      path: "协议模板.docx",
      variables: { 甲方名称: "未来智能有限公司" },
    });
    const details = toolRes.details as { changeSummary?: string; rollbackSnapshotId?: string; rollbackPath?: string };
    expect(details.changeSummary).toContain("替换");
    expect(details.rollbackSnapshotId).toBeTruthy();

    const afterUpdate = await readWordDocument(await vfs.readBytes("协议模板.docx"));
    expect(afterUpdate.text).toContain("未来智能有限公司");

    await vfs.restoreSnapshot(details.rollbackSnapshotId!, details.rollbackPath!);
    const afterRollback = await readWordDocument(await vfs.readBytes("协议模板.docx"));
    expect(afterRollback.text).toContain("{{甲方名称}}");
  });

  it("PPT 原地更新 (ppt_update) 保留母版并修改指定页面文本、表格与备注", async () => {
    const origPpt = await createPptPresentation({
      title: "季度汇报",
      slides: [
        { layout: "cover", title: "{{年度}} 季度总结", subtitle: "汇报人：{{姓名}}", notes: "开场页" },
        { layout: "table", title: "区域对比", headers: ["区域", "营收"], rows: [["华东", "300"]], notes: "旧备注" },
      ],
    });
    await vfs.writeBytes("母版汇报.pptx", origPpt);

    const direct = await updatePptDocumentInPlace(origPpt, {
      variables: { 年度: "2026", 姓名: "张工" },
      slideUpdates: [
        {
          slideIndex: 2,
          tableUpdates: [{ tableIndex: 0, rowIndex: 1, colIndex: 1, text: "520" }],
          notes: "已更新华东区最新实绩 520 万",
        },
      ],
    });
    expect(direct.modifiedSlides).toEqual([1, 2]);
    const readBack = await readPptDocument(direct.bytes);
    expect(readBack.slides[0].title).toContain("2026");
    expect(readBack.slides[1].texts.join(" ")).toContain("520");
    expect(readBack.slides[1].notes).toContain("已更新华东区最新实绩");

    const host = createDefaultExtensionHost();
    const pptUpdate = host.compile(createCtx(vfs)).tools.find((t) => t.name === "ppt_update")!;
    const toolRes = await pptUpdate.execute("tc_p1", {
      path: "母版汇报.pptx",
      variables: { 年度: "2027" },
    });
    expect((toolRes.details as { changeSummary?: string }).changeSummary).toContain("第 1 页");
  });

  it("PDF 支持拆分提取、水印叠加与辅助视觉三层降级链", async () => {
    const pdfBytes = await createPdfDocument({
      title: "Multi Page PDF",
      paragraphs: Array.from({ length: 45 }, (_, i) => `Paragraph ${i + 1} content line.`),
    });
    expect(parsePdfPageRanges("1,3", 3)).toEqual([1, 3]);

    const splitRes = await splitPdfDocument(pdfBytes, "1");
    expect(splitRes.extractedPages).toEqual([1]);

    const watermarked = await watermarkPdfDocument(splitRes.bytes, {
      text: "CONFIDENTIAL",
      opacity: 0.25,
    });
    expect(watermarked.pageCount).toBe(1);
    expect(watermarked.bytes.byteLength).toBeGreaterThan(0);

    const ctx = createCtx(vfs, {
      platform: {
        kind: "desktop",
        label: "Desktop",
        canRunShell: true,
        canMountNativeDir: true,
        getFetch: () => globalThis.fetch,
        sessionRequest: async () => ({ status: 200, ok: true, text: "" }),
        nativeOcrImage: async () => "发票代码：031002300111 金额：¥1,280.00",
        exportFile: async () => undefined,
        pickNativeDirectory: async () => null,
      },
    });
    const ocrOut = await recognizeImageWithFallback(ctx, "data:image/png;base64,iVBORw0KGgo=", {
      mode: "auto",
    });
    expect(ocrOut.engine).toBe("native-ocr");
    expect(ocrOut.text).toContain("031002300111");
  });
});
