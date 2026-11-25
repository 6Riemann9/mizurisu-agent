import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { recalculateWorkbookFormulas } from "./excel-formula";

const Excel = (ExcelJS as unknown as { default?: typeof ExcelJS }).default ?? ExcelJS;

export type CellScalar = string | number | boolean | null;

export interface ParsedCell {
  value: CellScalar;
  formula?: string;
  numFmt?: string;
}

export interface SheetSummary {
  name: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
  previewRows: CellScalar[][];
  numericStats: Array<{
    column: string;
    count: number;
    sum: number;
    min: number;
    max: number;
    avg: number;
  }>;
}

export interface ExcelInspectResult {
  format: "xlsx" | "xls" | "csv";
  sheetCount: number;
  sheets: SheetSummary[];
}

export interface SheetReadResult {
  sheetName: string;
  totalRows: number;
  totalColumns: number;
  startRow: number;
  rows: ParsedCell[][];
}

export interface ExcelSheetSpec {
  name: string;
  headers?: string[];
  rows: Array<Array<CellScalar | { formula: string; result?: number | string }>>;
  freezeHeader?: boolean;
  columnWidths?: number[];
  numberFormats?: Record<number, string>;
}

export interface CreateExcelSpec {
  sheets: ExcelSheetSpec[];
  author?: string;
}

export interface ExcelCellUpdateOp {
  sheetName?: string;
  /** 如 "B3" 单元格坐标 */
  cell?: string;
  value?: CellScalar;
  formula?: string;
  numFmt?: string;
}

export interface UpdateExcelSpec {
  operations?: ExcelCellUpdateOp[];
  appendRows?: Array<{
    sheetName?: string;
    rows: Array<Array<CellScalar | { formula: string }>>;
  }>;
  addSheets?: ExcelSheetSpec[];
  renameSheet?: { from: string; to: string };
  deleteRows?: Array<{ sheetName?: string; startRow: number; count?: number }>;
  deleteColumns?: Array<{ sheetName?: string; startCol: number; count?: number }>;
  mergeCells?: Array<{ sheetName?: string; range: string }>;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isCsvOrXls(filename: string): "csv" | "xls" | "xlsx" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "csv";
  if (lower.endsWith(".xls")) return "xls";
  return "xlsx";
}

function normalizeExcelJsCellValue(raw: ExcelJS.CellValue): ParsedCell {
  if (raw === null || raw === undefined) return { value: null };
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return { value: raw };
  }
  if (raw instanceof Date) {
    return { value: raw.toISOString().slice(0, 10) };
  }
  if (typeof raw === "object") {
    if ("formula" in raw && typeof raw.formula === "string") {
      const res = (raw as { result?: unknown }).result;
      const scalar: CellScalar =
        typeof res === "string" || typeof res === "number" || typeof res === "boolean"
          ? res
          : res instanceof Date
            ? res.toISOString().slice(0, 10)
            : null;
      return { value: scalar, formula: raw.formula };
    }
    if ("richText" in raw && Array.isArray(raw.richText)) {
      return { value: raw.richText.map((r) => r.text).join("") };
    }
    if ("text" in raw && typeof raw.text === "string") {
      return { value: raw.text };
    }
    if ("error" in raw) {
      return { value: String(raw.error) };
    }
  }
  return { value: String(raw) };
}

async function loadWorkbookFromBytes(
  bytes: Uint8Array,
  filename = "book.xlsx"
): Promise<{ workbook: ExcelJS.Workbook; format: "xlsx" | "xls" | "csv" }> {
  const format = isCsvOrXls(filename);
  const workbook = new Excel.Workbook();

  if (format === "xlsx") {
    await workbook.xlsx.load(toArrayBuffer(bytes) as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
    return { workbook, format };
  }

  // 使用 SheetJS (xlsx) 解析 .xls / .csv / .tsv 后转入 ExcelJS 模型以统一后续读写逻辑
  const parsed =
    format === "csv"
      ? XLSX.read(new TextDecoder("utf-8").decode(bytes), {
          type: "string",
          FS: filename.toLowerCase().endsWith(".tsv") ? "\t" : undefined,
        })
      : XLSX.read(bytes, { type: "array" });

  for (const name of parsed.SheetNames) {
    const ws = workbook.addWorksheet(name);
    const sheet = parsed.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<CellScalar[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
    });
    for (const row of aoa) {
      ws.addRow(row);
    }
  }
  if (workbook.worksheets.length === 0) {
    workbook.addWorksheet("Sheet1");
  }
  return { workbook, format };
}

function getWorksheetGrid(ws: ExcelJS.Worksheet): ParsedCell[][] {
  const rowCount = ws.rowCount;
  let colCount = ws.columnCount;
  const rows: ParsedCell[][] = [];

  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    colCount = Math.max(colCount, row.cellCount);
    const rowCells: ParsedCell[] = [];
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      const parsed = normalizeExcelJsCellValue(cell.value);
      if (parsed.formula && parsed.value === null && cell.result !== undefined) {
        const r = cell.result;
        if (typeof r === "string" || typeof r === "number" || typeof r === "boolean") {
          parsed.value = r;
        }
      }
      if (cell.numFmt) parsed.numFmt = cell.numFmt;
      rowCells.push(parsed);
    }
    rows.push(rowCells);
  }
  // 对齐每行列数
  for (const r of rows) {
    while (r.length < colCount) r.push({ value: null });
  }
  return rows;
}

export async function inspectExcel(
  bytes: Uint8Array,
  filename = "book.xlsx",
  previewLimit = 8
): Promise<ExcelInspectResult> {
  const { workbook, format } = await loadWorkbookFromBytes(bytes, filename);
  const sheets: SheetSummary[] = workbook.worksheets.map((ws) => {
    const grid = getWorksheetGrid(ws);
    const headers = (grid[0] || []).map((cell, i) =>
      cell.value !== null && String(cell.value).trim() !== ""
        ? String(cell.value)
        : `列${i + 1}`
    );
    const previewRows = grid
      .slice(0, previewLimit)
      .map((row) => row.map((c) => (c.formula && c.value === null ? `=${c.formula}` : c.value)));

    const numericStats: SheetSummary["numericStats"] = [];
    const colCount = headers.length;
    for (let c = 0; c < colCount; c++) {
      const nums: number[] = [];
      for (let r = 1; r < grid.length; r++) {
        const val = grid[r]?.[c]?.value;
        if (typeof val === "number" && Number.isFinite(val)) {
          nums.push(val);
        }
      }
      if (nums.length > 0) {
        const sum = nums.reduce((a, b) => a + b, 0);
        numericStats.push({
          column: headers[c],
          count: nums.length,
          sum: Number(sum.toFixed(4)),
          min: Math.min(...nums),
          max: Math.max(...nums),
          avg: Number((sum / nums.length).toFixed(4)),
        });
      }
    }

    return {
      name: ws.name,
      rowCount: grid.length,
      columnCount: colCount,
      headers,
      previewRows,
      numericStats,
    };
  });

  return {
    format,
    sheetCount: sheets.length,
    sheets,
  };
}

export async function readExcelSheet(
  bytes: Uint8Array,
  options?: {
    filename?: string;
    sheetName?: string;
    startRow?: number;
    maxRows?: number;
  }
): Promise<SheetReadResult> {
  const { workbook } = await loadWorkbookFromBytes(bytes, options?.filename || "book.xlsx");
  const ws = options?.sheetName
    ? workbook.getWorksheet(options.sheetName)
    : workbook.worksheets[0];
  if (!ws) {
    throw new Error(`未找到工作表: ${options?.sheetName}`);
  }

  const grid = getWorksheetGrid(ws);
  const startRow = Math.max(1, options?.startRow ?? 1);
  const maxRows = Math.max(1, options?.maxRows ?? 200);
  const sliced = grid.slice(startRow - 1, startRow - 1 + maxRows);

  return {
    sheetName: ws.name,
    totalRows: grid.length,
    totalColumns: grid[0]?.length ?? 0,
    startRow,
    rows: sliced,
  };
}

function applySheetSpec(wb: ExcelJS.Workbook, spec: ExcelSheetSpec): ExcelJS.Worksheet {
  const safeName = spec.name.slice(0, 31) || "Sheet1";
  const ws = wb.addWorksheet(safeName, {
    views: spec.freezeHeader !== false && spec.headers?.length ? [{ state: "frozen", ySplit: 1 }] : undefined,
  });

  const maxCols = Math.max(
    spec.headers?.length || 0,
    ...spec.rows.map((r) => r.length),
    1
  );
  const colLengths = new Array<number>(maxCols).fill(10);

  const trackWidth = (colIdx: number, val: unknown) => {
    const str = val === null || val === undefined ? "" : String(val);
    // 中文字符按 2 字符宽估算
    let width = 0;
    for (const ch of str) {
      width += ch.charCodeAt(0) > 127 ? 2 : 1;
    }
    colLengths[colIdx] = Math.min(48, Math.max(colLengths[colIdx], width + 4));
  };

  if (spec.headers && spec.headers.length > 0) {
    const headerRow = ws.addRow(spec.headers);
    headerRow.height = 24;
    headerRow.eachCell((cell, colNumber) => {
      trackWidth(colNumber - 1, cell.value);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF312E81" },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
    });
  }

  spec.rows.forEach((rowData, rowIdx) => {
    const normalized = rowData.map((item) => {
      if (item !== null && typeof item === "object" && "formula" in item) {
        const cleanFormula = item.formula.startsWith("=") ? item.formula.slice(1) : item.formula;
        return { formula: cleanFormula, result: item.result };
      }
      if (typeof item === "string" && item.startsWith("=") && item.length > 1) {
        return { formula: item.slice(1) };
      }
      return item;
    });
    const row = ws.addRow(normalized);
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      trackWidth(colNumber - 1, typeof cell.value === "object" ? "=FORMULA" : cell.value);
      if (rowIdx % 2 === 1) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
      }
      const fmt = spec.numberFormats?.[colNumber - 1];
      if (fmt) cell.numFmt = fmt;
      cell.border = {
        bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
      };
    });
  });

  for (let i = 0; i < maxCols; i++) {
    const col = ws.getColumn(i + 1);
    col.width = spec.columnWidths?.[i] ?? colLengths[i];
  }

  return ws;
}

export async function createExcelWorkbook(spec: CreateExcelSpec): Promise<Uint8Array> {
  const wb = new Excel.Workbook();
  wb.creator = spec.author || "Mizurisu Agent";
  wb.created = new Date();
  for (const sheet of spec.sheets) {
    applySheetSpec(wb, sheet);
  }
  recalculateWorkbookFormulas(wb);
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

export async function updateExcelCells(
  bytes: Uint8Array,
  spec: UpdateExcelSpec,
  filename = "book.xlsx"
): Promise<Uint8Array> {
  const { workbook } = await loadWorkbookFromBytes(bytes, filename);

  if (spec.renameSheet) {
    const target = workbook.getWorksheet(spec.renameSheet.from);
    if (!target) throw new Error(`未找到待重命名的工作表: ${spec.renameSheet.from}`);
    target.name = spec.renameSheet.to.slice(0, 31);
  }

  if (spec.addSheets?.length) {
    for (const s of spec.addSheets) {
      applySheetSpec(workbook, s);
    }
  }

  if (spec.operations?.length) {
    for (const op of spec.operations) {
      const ws = op.sheetName
        ? workbook.getWorksheet(op.sheetName)
        : workbook.worksheets[0];
      if (!ws) throw new Error(`未找到工作表: ${op.sheetName}`);
      if (!op.cell) continue;
      const cell = ws.getCell(op.cell.toUpperCase());
      if (op.formula) {
        const clean = op.formula.startsWith("=") ? op.formula.slice(1) : op.formula;
        cell.value = { formula: clean };
      } else if (typeof op.value === "string" && op.value.startsWith("=") && op.value.length > 1) {
        cell.value = { formula: op.value.slice(1) };
      } else {
        cell.value = op.value ?? null;
      }
      if (op.numFmt) {
        cell.numFmt = op.numFmt;
      }
    }
  }

  if (spec.appendRows?.length) {
    for (const batch of spec.appendRows) {
      const ws = batch.sheetName
        ? workbook.getWorksheet(batch.sheetName)
        : workbook.worksheets[0];
      if (!ws) throw new Error(`未找到工作表: ${batch.sheetName}`);
      for (const row of batch.rows) {
        const normalized = row.map((item) => {
          if (item !== null && typeof item === "object" && "formula" in item) {
            const clean = item.formula.startsWith("=") ? item.formula.slice(1) : item.formula;
            return { formula: clean };
          }
          if (typeof item === "string" && item.startsWith("=") && item.length > 1) {
            return { formula: item.slice(1) };
          }
          return item;
        });
        ws.addRow(normalized);
      }
    }
  }

  if (spec.deleteRows?.length) {
    for (const del of spec.deleteRows) {
      const ws = del.sheetName
        ? workbook.getWorksheet(del.sheetName)
        : workbook.worksheets[0];
      if (!ws) throw new Error(`未找到工作表: ${del.sheetName}`);
      ws.spliceRows(Math.max(1, del.startRow), Math.max(1, del.count ?? 1));
    }
  }

  if (spec.deleteColumns?.length) {
    for (const del of spec.deleteColumns) {
      const ws = del.sheetName
        ? workbook.getWorksheet(del.sheetName)
        : workbook.worksheets[0];
      if (!ws) throw new Error(`未找到工作表: ${del.sheetName}`);
      ws.spliceColumns(Math.max(1, del.startCol), Math.max(1, del.count ?? 1));
    }
  }

  if (spec.mergeCells?.length) {
    for (const m of spec.mergeCells) {
      const ws = m.sheetName
        ? workbook.getWorksheet(m.sheetName)
        : workbook.worksheets[0];
      if (!ws) throw new Error(`未找到工作表: ${m.sheetName}`);
      ws.mergeCells(m.range);
    }
  }

  recalculateWorkbookFormulas(workbook);
  const out = await workbook.xlsx.writeBuffer();
  return new Uint8Array(out);
}

export async function exportSheetToCsv(
  bytes: Uint8Array,
  sheetName?: string,
  filename = "book.xlsx"
): Promise<string> {
  const res = await readExcelSheet(bytes, { filename, sheetName, startRow: 1, maxRows: 50000 });
  const escapeCell = (val: CellScalar): string => {
    if (val === null || val === undefined) return "";
    const s = String(val);
    if (/[",\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return res.rows
    .map((row) => row.map((cell) => escapeCell(cell.value)).join(","))
    .join("\r\n");
}
