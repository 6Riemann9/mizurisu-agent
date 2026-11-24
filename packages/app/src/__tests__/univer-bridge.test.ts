import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  BooleanNumber,
  BorderStyleTypes,
  CellValueType,
  HorizontalAlign,
  SheetTypes,
  VerticalAlign,
  WrapStrategy,
} from "@univerjs/presets";
import { createExcelWorkbook, inspectExcel, readExcelSheet } from "../office";
import {
  excelBytesToUniverWorkbook,
  univerWorkbookToExcelBytes,
} from "../office/univer-bridge";

const Excel = (ExcelJS as unknown as { default?: typeof ExcelJS }).default ?? ExcelJS;

describe("Univer <-> ExcelJS 双向无损桥接", () => {
  it("完整闭环：createExcelWorkbook -> Univer 编辑（数值/公式/样式/合并/新增Sheet）-> 写回并读回校验", async () => {
    const initialBytes = await createExcelWorkbook({
      sheets: [
        {
          name: "销售汇总",
          headers: ["地区", "金额", "占比"],
          rows: [
            ["华东", 120, 0.6],
            ["华南", 80, 0.4],
            ["合计", { formula: "SUM(B2:B3)", result: 200 }, 1],
          ],
          freezeHeader: true,
          numberFormats: { 1: "#,##0", 2: "0.0%" },
        },
      ],
    });

    const univerWb = await excelBytesToUniverWorkbook(initialBytes, "sales.xlsx");

    expect(univerWb.sheetOrder).toHaveLength(1);
    const mainSheetId = univerWb.sheetOrder[0];
    const mainSheet = univerWb.sheets[mainSheetId];
    expect(mainSheet).toBeDefined();
    expect(mainSheet.name).toBe("销售汇总");
    expect(mainSheet.type).toBe(SheetTypes.GRID);
    expect(mainSheet.showGridlines).toBe(BooleanNumber.TRUE);
    expect(mainSheet.rowCount).toBeGreaterThanOrEqual(100);
    expect(mainSheet.columnCount).toBeGreaterThanOrEqual(26);
    expect(mainSheet.freeze).toEqual({
      xSplit: 0,
      ySplit: 1,
      startRow: 1,
      startColumn: -1,
    });

    // 校验导入的公式与缓存结果
    const importedFormulaCell = mainSheet.cellData?.[3]?.[1];
    expect(importedFormulaCell?.f).toBe("=SUM(B2:B3)");
    expect(importedFormulaCell?.v).toBe(200);

    // 校验表头样式哈希去重与颜色规范化
    const headerStyleId = mainSheet.cellData?.[0]?.[0]?.s;
    expect(typeof headerStyleId).toBe("string");
    const headerStyle =
      typeof headerStyleId === "string" ? univerWb.styles[headerStyleId] : undefined;
    expect(headerStyle?.bl).toBe(BooleanNumber.TRUE);
    expect(headerStyle?.cl?.rgb).toBe("#FFFFFF");
    expect(headerStyle?.bg?.rgb).toBe("#312E81");
    expect(headerStyle?.ht).toBe(HorizontalAlign.CENTER);
    expect(headerStyle?.vt).toBe(VerticalAlign.MIDDLE);

    // 在 Univer 快照中模拟修改：数值、公式（带 '=' 与双 '=' 边界）、样式、合并单元格与新增 Sheet
    univerWb.styles["custom_highlight"] = {
      ff: "Microsoft YaHei",
      fs: 12,
      bl: BooleanNumber.TRUE,
      it: BooleanNumber.TRUE,
      ul: { s: BooleanNumber.TRUE },
      st: { s: BooleanNumber.TRUE },
      cl: { rgb: "#B91C1C" },
      bg: { rgb: "#FEF2F2" },
      ht: HorizontalAlign.RIGHT,
      vt: VerticalAlign.MIDDLE,
      tb: WrapStrategy.WRAP,
      bd: {
        t: { s: BorderStyleTypes.THIN, cl: { rgb: "#CBD5E1" } },
        b: { s: BorderStyleTypes.MEDIUM, cl: { rgb: "#0F172A" } },
      },
      n: { pattern: "¥#,##0.00" },
    };

    mainSheet.cellData![1][1] = {
      v: 250,
      t: CellValueType.NUMBER,
      s: "custom_highlight",
    };
    mainSheet.cellData![3][1] = {
      f: "=SUM(B2:B3)",
      v: 330,
      t: CellValueType.NUMBER,
      s: importedFormulaCell?.s,
    };
    // 测试内联样式对象及异常前缀 '==' 公式清洗
    mainSheet.cellData![1][3] = {
      f: "==B2*2",
      v: 500,
      t: CellValueType.NUMBER,
      s: {
        bl: BooleanNumber.TRUE,
        bg: { rgb: "#ECFDF5" },
        n: { pattern: "#,##0" },
      },
    };

    // 添加合并单元格 A6:C6
    mainSheet.cellData![5] = {
      0: {
        v: "合并备注栏",
        t: CellValueType.STRING,
        s: { ht: HorizontalAlign.CENTER, bl: BooleanNumber.TRUE },
      },
    };
    mainSheet.mergeData = [
      ...(mainSheet.mergeData ?? []),
      { startRow: 5, startColumn: 0, endRow: 5, endColumn: 2 },
    ];

    // 新增第二个工作表（含冻结行列、自定义列宽与行高）
    const extraSheetId = "sheet_extra";
    univerWb.sheetOrder.push(extraSheetId);
    univerWb.sheets[extraSheetId] = {
      id: extraSheetId,
      name: "明细附表",
      type: SheetTypes.GRID,
      hidden: BooleanNumber.FALSE,
      freeze: { xSplit: 1, ySplit: 1, startRow: 1, startColumn: 1 },
      rowCount: 100,
      columnCount: 26,
      showGridlines: BooleanNumber.TRUE,
      mergeData: [],
      columnData: {
        0: { w: 172 },
      },
      rowData: {
        0: { h: 40 },
      },
      cellData: {
        0: {
          0: { v: "科目", t: CellValueType.STRING },
          1: { v: "预算", t: CellValueType.NUMBER },
        },
        1: {
          0: { v: "算力采购", t: CellValueType.STRING },
          1: { v: 1024, t: CellValueType.NUMBER },
        },
      },
    };

    const exportedBytes = await univerWorkbookToExcelBytes(univerWb);
    expect(exportedBytes.byteLength).toBeGreaterThan(0);

    // 通过 office 现有能力读回校验
    const info = await inspectExcel(exportedBytes, "sales.xlsx");
    expect(info.sheetCount).toBe(2);
    expect(info.sheets.map((s) => s.name)).toEqual(["销售汇总", "明细附表"]);
    expect(info.sheets[1].headers).toEqual(["科目", "预算"]);

    const readMain = await readExcelSheet(exportedBytes, {
      filename: "sales.xlsx",
      sheetName: "销售汇总",
    });
    expect(readMain.rows[1][1].value).toBe(250);
    expect(readMain.rows[1][1].numFmt).toBe("¥#,##0.00");

    // 严格断言公式不带 '=' 或 '==' 且保留计算缓存结果
    const formulaCellRead = readMain.rows[3][1];
    expect(formulaCellRead.formula).toBe("SUM(B2:B3)");
    expect(formulaCellRead.formula?.startsWith("=")).toBe(false);
    expect(formulaCellRead.value).toBe(330);
    expect(formulaCellRead.numFmt).toBe("#,##0");

    const sanitizedFormulaRead = readMain.rows[1][3];
    expect(sanitizedFormulaRead.formula).toBe("B2*2");
    expect(sanitizedFormulaRead.formula?.includes("==")).toBe(false);
    expect(sanitizedFormulaRead.value).toBe(500);
    expect(sanitizedFormulaRead.numFmt).toBe("#,##0");
    expect(readMain.rows[1][2].numFmt).toBe("0.0%");

    // 使用 ExcelJS 与 Univer 再次回环解析，验证合并单元格、样式、冻结与列宽行高保留
    const checkWb = new Excel.Workbook();
    await checkWb.xlsx.load(exportedBytes.buffer as ArrayBuffer);
    const checkMainWs = checkWb.getWorksheet("销售汇总")!;
    expect(checkMainWs.model.merges).toContain("A6:C6");
    expect(checkMainWs.getCell("B2").font?.bold).toBe(true);
    expect(checkMainWs.getCell("B2").font?.italic).toBe(true);
    expect(checkMainWs.getCell("B2").font?.color?.argb).toBe("FFB91C1C");
    expect((checkMainWs.getCell("B2").fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe(
      "FFFEF2F2"
    );
    expect(checkMainWs.getCell("B2").alignment?.wrapText).toBe(true);
    expect(checkMainWs.getCell("B2").border?.bottom?.style).toBe("medium");

    const reimportedUniver = await excelBytesToUniverWorkbook(exportedBytes, "sales.xlsx");
    expect(reimportedUniver.sheetOrder).toHaveLength(2);
    const reMain = reimportedUniver.sheets[reimportedUniver.sheetOrder[0]];
    const reExtra = reimportedUniver.sheets[reimportedUniver.sheetOrder[1]];

    expect(reMain.mergeData).toContainEqual({
      startRow: 5,
      startColumn: 0,
      endRow: 5,
      endColumn: 2,
    });
    // 合并单元格从属格子不应重复写入主格值
    expect(reMain.cellData?.[5]?.[0]?.v).toBe("合并备注栏");
    expect(reMain.cellData?.[5]?.[1]?.v).toBeUndefined();

    expect(reExtra.freeze).toEqual({
      xSplit: 1,
      ySplit: 1,
      startRow: 1,
      startColumn: 1,
    });
    expect(reExtra.columnData?.[0]?.w).toBe(172);
    expect(reExtra.rowData?.[0]?.h).toBe(40);
  });

  it("支持 CSV / TSV 导入转为 Univer IWorkbookData 并过滤合并从属格重复内容", async () => {
    const csvContent = "\uFEFF城市,营收,增长率\r\n上海,520,0.18\r\n\"北京,海淀\",410,0.12";
    const csvBytes = new TextEncoder().encode(csvContent);

    const univerCsv = await excelBytesToUniverWorkbook(csvBytes, "metrics.csv");
    expect(univerCsv.sheetOrder).toHaveLength(1);
    const sheet = univerCsv.sheets[univerCsv.sheetOrder[0]];
    expect(sheet.rowCount).toBeGreaterThanOrEqual(100);
    expect(sheet.columnCount).toBeGreaterThanOrEqual(26);
    expect(sheet.cellData?.[0]?.[0]?.v).toBe("城市");
    expect(sheet.cellData?.[1]?.[1]?.v).toBe(520);
    expect(sheet.cellData?.[1]?.[1]?.t).toBe(CellValueType.NUMBER);
    expect(sheet.cellData?.[2]?.[0]?.v).toBe("北京,海淀");

    // 构造含合并单元格、日期与隐藏工作表的 ExcelJS 文件进行转换校验
    const wb = new Excel.Workbook();
    const ws = wb.addWorksheet("主表");
    ws.getCell("A1").value = "总览报表";
    ws.mergeCells("A1:C1");
    ws.getCell("A2").value = new Date("2026-11-24T00:00:00.000Z");
    ws.getCell("B2").value = {
      richText: [{ text: "富文本" }, { text: "内容" }],
    };
    const hiddenWs = wb.addWorksheet("隐藏页", { state: "hidden" });
    hiddenWs.getCell("A1").value = "内部参数";

    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const parsed = await excelBytesToUniverWorkbook(buf, "complex.xlsx");
    expect(parsed.sheetOrder).toHaveLength(2);

    const s0 = parsed.sheets[parsed.sheetOrder[0]];
    const s1 = parsed.sheets[parsed.sheetOrder[1]];
    expect(s0.mergeData).toContainEqual({
      startRow: 0,
      startColumn: 0,
      endRow: 0,
      endColumn: 2,
    });
    expect(s0.cellData?.[0]?.[0]?.v).toBe("总览报表");
    expect(s0.cellData?.[0]?.[1]?.v).toBeUndefined();
    expect(s0.cellData?.[0]?.[2]?.v).toBeUndefined();
    expect(s0.cellData?.[1]?.[0]?.v).toBe("2026-11-24");
    expect(s0.cellData?.[1]?.[1]?.v).toBe("富文本内容");
    expect(s1.hidden).toBe(BooleanNumber.TRUE);
  });
});
