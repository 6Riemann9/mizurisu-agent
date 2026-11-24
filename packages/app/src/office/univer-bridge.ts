import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import {
  BooleanNumber,
  BorderStyleTypes,
  CellValueType,
  HorizontalAlign,
  LocaleType,
  SheetTypes,
  ThemeColorType,
  VerticalAlign,
  WrapStrategy,
  type IBorderData,
  type IBorderStyleData,
  type ICellData,
  type IColorStyle,
  type IColumnData,
  type IObjectArrayPrimitiveType,
  type IObjectMatrixPrimitiveType,
  type IRange,
  type IRowData,
  type IStyleData,
  type IWorkbookData,
  type IWorksheetData,
  type Nullable,
} from "@univerjs/presets";

const Excel = (ExcelJS as unknown as { default?: typeof ExcelJS }).default ?? ExcelJS;

/** Office 标准主题色板回退映射（用于无 ARGB 仅有 theme 索引的颜色解析） */
const OFFICE_THEME_PALETTE: Record<number, string> = {
  0: "FFFFFF",
  1: "000000",
  2: "E7E6E6",
  3: "44546A",
  4: "4472C4",
  5: "ED7D31",
  6: "A5A5A5",
  7: "FFC000",
  8: "5B9BD5",
  9: "70AD47",
  10: "0563C1",
  11: "954F72",
};

/** Univer ThemeColorType 到 Office 默认 RGB 的映射 */
const UNIVER_THEME_COLOR_MAP: Record<number, string> = {
  [ThemeColorType.DARK1]: "000000",
  [ThemeColorType.LIGHT1]: "FFFFFF",
  [ThemeColorType.DARK2]: "44546A",
  [ThemeColorType.LIGHT2]: "E7E6E6",
  [ThemeColorType.ACCENT1]: "4472C4",
  [ThemeColorType.ACCENT2]: "ED7D31",
  [ThemeColorType.ACCENT3]: "A5A5A5",
  [ThemeColorType.ACCENT4]: "FFC000",
  [ThemeColorType.ACCENT5]: "5B9BD5",
  [ThemeColorType.ACCENT6]: "70AD47",
  [ThemeColorType.HYPERLINK]: "0563C1",
  [ThemeColorType.FOLLOWED_HYPERLINK]: "954F72",
};

let workbookCounter = 0;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** 识别表格文件类型 */
function detectSpreadsheetFormat(filename: string): "csv" | "tsv" | "xls" | "xlsx" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".tsv")) return "tsv";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xls")) return "xls";
  return "xlsx";
}

/** 根据 tint 对 6 位十六进制 RGB 做明暗微调 */
function applyColorTint(hex6: string, tint?: number): string {
  if (typeof tint !== "number" || !Number.isFinite(tint) || tint === 0) {
    return `#${hex6.toUpperCase()}`;
  }
  const r = parseInt(hex6.slice(0, 2), 16);
  const g = parseInt(hex6.slice(2, 4), 16);
  const b = parseInt(hex6.slice(4, 6), 16);
  const adjust = (channel: number) => {
    const next =
      tint > 0
        ? Math.round(channel + (255 - channel) * tint)
        : Math.round(channel * (1 + tint));
    return Math.max(0, Math.min(255, next)).toString(16).padStart(2, "0");
  };
  return `#${adjust(r)}${adjust(g)}${adjust(b)}`.toUpperCase();
}

/** 将 ExcelJS 颜色对象规范化为 Univer 使用的 #RRGGBB */
function normalizeExcelColor(
  color?: Partial<ExcelJS.Color> & { tint?: number }
): string | undefined {
  if (!color) return undefined;
  if (typeof color.argb === "string") {
    const clean = color.argb.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{8}$/.test(clean)) {
      // Alpha 为 00 视为透明无色
      if (clean.slice(0, 2).toUpperCase() === "00") return undefined;
      return `#${clean.slice(2).toUpperCase()}`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(clean)) {
      return `#${clean.toUpperCase()}`;
    }
  }
  if (typeof color.theme === "number") {
    const baseHex = OFFICE_THEME_PALETTE[color.theme];
    if (baseHex) {
      return applyColorTint(baseHex, color.tint);
    }
  }
  return undefined;
}

/** 将 Univer 颜色样式规范化为 ExcelJS 使用的 8 位 ARGB (FFRRGGBB) */
function toExcelArgb(color?: Nullable<IColorStyle>): string | undefined {
  if (!color) return undefined;
  if (typeof color.rgb === "string") {
    const raw = color.rgb.trim();
    if (!raw) return undefined;

    if (raw.startsWith("#")) {
      const hex = raw.slice(1);
      if (/^[0-9a-fA-F]{6}$/.test(hex)) {
        return `FF${hex.toUpperCase()}`;
      }
      if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        const expanded = hex
          .split("")
          .map((ch) => ch + ch)
          .join("");
        return `FF${expanded.toUpperCase()}`;
      }
      if (/^[0-9a-fA-F]{8}$/.test(hex)) {
        // #RRGGBBAA -> AARRGGBB
        const alpha = hex.slice(6, 8).toUpperCase();
        if (alpha === "00") return undefined;
        return `${alpha}${hex.slice(0, 6).toUpperCase()}`;
      }
    }

    if (/^[0-9a-fA-F]{6}$/.test(raw)) {
      return `FF${raw.toUpperCase()}`;
    }
    if (/^[0-9a-fA-F]{8}$/.test(raw)) {
      return raw.toUpperCase();
    }

    const rgbMatch = raw.match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i
    );
    if (rgbMatch) {
      const toHex = (n: string) =>
        Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0").toUpperCase();
      const alphaNum = rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : 1;
      if (alphaNum <= 0) return undefined;
      const alphaHex = Math.max(0, Math.min(255, Math.round(alphaNum * 255)))
        .toString(16)
        .padStart(2, "0")
        .toUpperCase();
      return `${alphaHex}${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
    }
  }

  if (typeof color.th === "number") {
    const fallback = UNIVER_THEME_COLOR_MAP[color.th];
    if (fallback) return `FF${fallback}`;
  }
  return undefined;
}

/** 水平对齐映射：ExcelJS -> Univer */
function mapHorizontalAlignToUniver(
  align?: ExcelJS.Alignment["horizontal"]
): HorizontalAlign | undefined {
  switch (align) {
    case "left":
      return HorizontalAlign.LEFT;
    case "center":
    case "centerContinuous":
      return HorizontalAlign.CENTER;
    case "right":
      return HorizontalAlign.RIGHT;
    case "justify":
      return HorizontalAlign.JUSTIFIED;
    case "distributed":
      return HorizontalAlign.DISTRIBUTED;
    default:
      return undefined;
  }
}

/** 水平对齐映射：Univer -> ExcelJS */
function mapHorizontalAlignToExcel(
  align?: Nullable<HorizontalAlign>
): ExcelJS.Alignment["horizontal"] | undefined {
  switch (align) {
    case HorizontalAlign.LEFT:
      return "left";
    case HorizontalAlign.CENTER:
      return "center";
    case HorizontalAlign.RIGHT:
      return "right";
    case HorizontalAlign.JUSTIFIED:
    case HorizontalAlign.BOTH:
      return "justify";
    case HorizontalAlign.DISTRIBUTED:
      return "distributed";
    default:
      return undefined;
  }
}

/** 垂直对齐映射：ExcelJS -> Univer */
function mapVerticalAlignToUniver(
  align?: ExcelJS.Alignment["vertical"]
): VerticalAlign | undefined {
  switch (align) {
    case "top":
      return VerticalAlign.TOP;
    case "middle":
      return VerticalAlign.MIDDLE;
    case "bottom":
      return VerticalAlign.BOTTOM;
    case "distributed":
    case "justify":
      return VerticalAlign.MIDDLE;
    default:
      return undefined;
  }
}

/** 垂直对齐映射：Univer -> ExcelJS */
function mapVerticalAlignToExcel(
  align?: Nullable<VerticalAlign>
): ExcelJS.Alignment["vertical"] | undefined {
  switch (align) {
    case VerticalAlign.TOP:
      return "top";
    case VerticalAlign.MIDDLE:
      return "middle";
    case VerticalAlign.BOTTOM:
      return "bottom";
    default:
      return undefined;
  }
}

const EXCEL_TO_UNIVER_BORDER: Record<ExcelJS.BorderStyle, BorderStyleTypes> = {
  thin: BorderStyleTypes.THIN,
  hair: BorderStyleTypes.HAIR,
  dotted: BorderStyleTypes.DOTTED,
  dashed: BorderStyleTypes.DASHED,
  dashDot: BorderStyleTypes.DASH_DOT,
  dashDotDot: BorderStyleTypes.DASH_DOT_DOT,
  double: BorderStyleTypes.DOUBLE,
  medium: BorderStyleTypes.MEDIUM,
  mediumDashed: BorderStyleTypes.MEDIUM_DASHED,
  mediumDashDot: BorderStyleTypes.MEDIUM_DASH_DOT,
  mediumDashDotDot: BorderStyleTypes.MEDIUM_DASH_DOT_DOT,
  slantDashDot: BorderStyleTypes.SLANT_DASH_DOT,
  thick: BorderStyleTypes.THICK,
};

const UNIVER_TO_EXCEL_BORDER: Record<number, ExcelJS.BorderStyle> = {
  [BorderStyleTypes.THIN]: "thin",
  [BorderStyleTypes.HAIR]: "hair",
  [BorderStyleTypes.DOTTED]: "dotted",
  [BorderStyleTypes.DASHED]: "dashed",
  [BorderStyleTypes.DASH_DOT]: "dashDot",
  [BorderStyleTypes.DASH_DOT_DOT]: "dashDotDot",
  [BorderStyleTypes.DOUBLE]: "double",
  [BorderStyleTypes.MEDIUM]: "medium",
  [BorderStyleTypes.MEDIUM_DASHED]: "mediumDashed",
  [BorderStyleTypes.MEDIUM_DASH_DOT]: "mediumDashDot",
  [BorderStyleTypes.MEDIUM_DASH_DOT_DOT]: "mediumDashDotDot",
  [BorderStyleTypes.SLANT_DASH_DOT]: "slantDashDot",
  [BorderStyleTypes.THICK]: "thick",
};

/** 转换单个边框侧边样式（ExcelJS -> Univer） */
function convertBorderSideToUniver(
  side?: Partial<ExcelJS.Border>
): IBorderStyleData | undefined {
  if (!side || !side.style) return undefined;
  const mapped = EXCEL_TO_UNIVER_BORDER[side.style];
  if (!mapped) return undefined;
  const rgb = normalizeExcelColor(
    side.color as (Partial<ExcelJS.Color> & { tint?: number }) | undefined
  );
  return {
    s: mapped,
    cl: { rgb: rgb ?? "#000000" },
  };
}

/** 转换单个边框侧边样式（Univer -> ExcelJS） */
function convertBorderSideToExcel(
  side?: Nullable<IBorderStyleData>
): Partial<ExcelJS.Border> | undefined {
  if (!side || side.s === BorderStyleTypes.NONE) return undefined;
  const style = UNIVER_TO_EXCEL_BORDER[side.s];
  if (!style) return undefined;
  const argb = toExcelArgb(side.cl);
  return argb ? { style, color: { argb } } : { style };
}

/** 提取 ExcelJS 单元格的 Univer IStyleData */
function extractUniverStyleFromCell(cell: ExcelJS.Cell): IStyleData | null {
  const style: IStyleData = {};
  const font = cell.font;
  if (font) {
    if (font.name) style.ff = font.name;
    if (typeof font.size === "number" && Number.isFinite(font.size)) style.fs = font.size;
    if (font.bold) style.bl = BooleanNumber.TRUE;
    if (font.italic) style.it = BooleanNumber.TRUE;
    if (font.underline && font.underline !== "none") {
      style.ul = { s: BooleanNumber.TRUE };
    }
    if (font.strike) {
      style.st = { s: BooleanNumber.TRUE };
    }
    const fgRgb = normalizeExcelColor(
      font.color as (Partial<ExcelJS.Color> & { tint?: number }) | undefined
    );
    if (fgRgb) {
      style.cl = { rgb: fgRgb };
    }
  }

  const fill = cell.fill;
  if (fill && fill.type === "pattern" && fill.pattern !== "none") {
    const rawColor =
      fill.fgColor ?? (fill.pattern === "solid" ? fill.bgColor : undefined);
    const bgRgb = normalizeExcelColor(
      rawColor as (Partial<ExcelJS.Color> & { tint?: number }) | undefined
    );
    if (bgRgb) {
      style.bg = { rgb: bgRgb };
    }
  }

  const alignment = cell.alignment;
  if (alignment) {
    const ht = mapHorizontalAlignToUniver(alignment.horizontal);
    if (ht !== undefined) style.ht = ht;
    const vt = mapVerticalAlignToUniver(alignment.vertical);
    if (vt !== undefined) style.vt = vt;
    if (alignment.wrapText) {
      style.tb = WrapStrategy.WRAP;
    }
  }

  const border = cell.border;
  if (border) {
    const bd: IBorderData = {};
    const t = convertBorderSideToUniver(border.top);
    const r = convertBorderSideToUniver(border.right);
    const b = convertBorderSideToUniver(border.bottom);
    const l = convertBorderSideToUniver(border.left);
    if (t) bd.t = t;
    if (r) bd.r = r;
    if (b) bd.b = b;
    if (l) bd.l = l;
    if (Object.keys(bd).length > 0) {
      style.bd = bd;
    }
  }

  if (cell.numFmt && cell.numFmt !== "General") {
    style.n = { pattern: cell.numFmt };
  }

  return Object.keys(style).length > 0 ? style : null;
}

/** 格式化日期为紧凑文本，兼容单元格显示与双向读写 */
function formatExcelDate(date: Date): string {
  const iso = date.toISOString();
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0
  ) {
    return iso.slice(0, 10);
  }
  return iso.slice(0, 19).replace("T", " ");
}

/** 推断标量值的 Univer CellValueType */
function inferCellValueType(val: string | number | boolean): CellValueType {
  if (typeof val === "number") return CellValueType.NUMBER;
  if (typeof val === "boolean") return CellValueType.BOOLEAN;
  return CellValueType.STRING;
}

/** 提取公式缓存标量结果（绝不写入对象或 undefined） */
function extractFormulaScalarResult(
  rawResult: unknown
): string | number | boolean | undefined {
  if (
    typeof rawResult === "string" ||
    typeof rawResult === "boolean"
  ) {
    return rawResult;
  }
  if (typeof rawResult === "number") {
    return Number.isFinite(rawResult) ? rawResult : undefined;
  }
  if (rawResult instanceof Date) {
    return formatExcelDate(rawResult);
  }
  if (rawResult && typeof rawResult === "object" && "error" in rawResult) {
    return String((rawResult as { error: unknown }).error);
  }
  return undefined;
}

/** 解析单元格坐标如 "AB12" 为 0-based { row, col } */
function parseCellCoordinate(coord: string): { row: number; col: number } | null {
  const match = coord.trim().replace(/\$/g, "").match(/^([A-Za-z]+)([0-9]+)$/);
  if (!match) return null;
  const colLetters = match[1].toUpperCase();
  const rowNumber = Number(match[2]);
  if (!Number.isInteger(rowNumber) || rowNumber < 1) return null;
  let colNumber = 0;
  for (let i = 0; i < colLetters.length; i++) {
    colNumber = colNumber * 26 + (colLetters.charCodeAt(i) - 64);
  }
  if (colNumber < 1) return null;
  return { row: rowNumber - 1, col: colNumber - 1 };
}

/** 解析合并单元格范围（支持 "A1:C2" 字符串与 ExcelJS Range 对象） */
function parseMergeRange(entry: unknown): IRange | null {
  if (typeof entry === "string") {
    const parts = entry.split(":");
    const start = parseCellCoordinate(parts[0] || "");
    const end = parseCellCoordinate(parts[1] || parts[0] || "");
    if (!start || !end) return null;
    const startRow = Math.min(start.row, end.row);
    const endRow = Math.max(start.row, end.row);
    const startColumn = Math.min(start.col, end.col);
    const endColumn = Math.max(start.col, end.col);
    if (startRow === endRow && startColumn === endColumn) return null;
    return { startRow, startColumn, endRow, endColumn };
  }

  if (entry && typeof entry === "object") {
    const rangeObj = entry as {
      top?: number;
      left?: number;
      bottom?: number;
      right?: number;
      model?: { top?: number; left?: number; bottom?: number; right?: number };
      range?: string;
    };
    const box = rangeObj.model ?? rangeObj;
    if (
      typeof box.top === "number" &&
      typeof box.left === "number" &&
      typeof box.bottom === "number" &&
      typeof box.right === "number"
    ) {
      const startRow = Math.max(0, Math.min(box.top, box.bottom) - 1);
      const endRow = Math.max(0, Math.max(box.top, box.bottom) - 1);
      const startColumn = Math.max(0, Math.min(box.left, box.right) - 1);
      const endColumn = Math.max(0, Math.max(box.left, box.right) - 1);
      if (startRow === endRow && startColumn === endColumn) return null;
      return { startRow, startColumn, endRow, endColumn };
    }
    if (typeof rangeObj.range === "string") {
      return parseMergeRange(rangeObj.range);
    }
  }
  return null;
}

/** 收集工作表的全部合并单元格范围（兼容 ws.model.merges 与 ws._merges） */
function extractWorksheetMerges(ws: ExcelJS.Worksheet): IRange[] {
  const seen = new Set<string>();
  const merges: IRange[] = [];

  const pushMerge = (raw: unknown) => {
    const parsed = parseMergeRange(raw);
    if (!parsed) return;
    const key = `${parsed.startRow}:${parsed.startColumn}:${parsed.endRow}:${parsed.endColumn}`;
    if (seen.has(key)) return;
    seen.add(key);
    merges.push(parsed);
  };

  const modelMerges = (ws.model as { merges?: unknown[] } | undefined)?.merges;
  if (Array.isArray(modelMerges)) {
    for (const item of modelMerges) {
      pushMerge(item);
    }
  }

  const internalMerges = (ws as unknown as { _merges?: Record<string, unknown> })._merges;
  if (internalMerges && typeof internalMerges === "object") {
    for (const item of Object.values(internalMerges)) {
      pushMerge(item);
    }
  }

  return merges;
}

/** 加载 Excel / CSV / TSV / XLS 二进制为统一的 ExcelJS Workbook */
async function loadExcelJsWorkbook(
  bytes: Uint8Array,
  filename = "book.xlsx"
): Promise<ExcelJS.Workbook> {
  const format = detectSpreadsheetFormat(filename);
  const workbook = new Excel.Workbook();

  if (format === "xlsx") {
    await workbook.xlsx.load(
      toArrayBuffer(bytes) as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]
    );
    if (workbook.worksheets.length === 0) {
      workbook.addWorksheet("Sheet1");
    }
    return workbook;
  }

  // 对 .csv / .tsv / .xls 先通过 SheetJS 读取再转为 ExcelJS 工作表
  const parsed =
    format === "csv" || format === "tsv"
      ? XLSX.read(new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, ""), {
          type: "string",
          FS: format === "tsv" ? "\t" : undefined,
        })
      : XLSX.read(bytes, { type: "array" });

  for (const sheetName of parsed.SheetNames) {
    const ws = workbook.addWorksheet(sheetName.slice(0, 31) || "Sheet1");
    const sheet = parsed.Sheets[sheetName];
    if (!sheet) continue;

    const aoa = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
      header: 1,
      raw: true,
      defval: null,
    });
    for (const row of aoa) {
      ws.addRow(row);
    }

    // 保留 .xls 中的合并单元格结构
    const merges = sheet["!merges"];
    if (Array.isArray(merges)) {
      for (const m of merges) {
        try {
          ws.mergeCells(m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1);
        } catch {
          // 忽略异常重叠合并区间
        }
      }
    }
  }

  if (workbook.worksheets.length === 0) {
    workbook.addWorksheet("Sheet1");
  }
  return workbook;
}

/** 将 Excel 字符宽换算为 Univer 像素列宽 */
function excelCharWidthToPx(charWidth: number): number {
  return Math.max(24, Math.min(800, Math.round(charWidth * 8 + 12)));
}

/** 将 Univer 像素列宽还原为 Excel 字符宽 */
function pxToExcelCharWidth(px: number): number {
  if (px <= 20) return Math.max(1, Number((px / 8).toFixed(2)));
  return Math.max(2, Number(((px - 12) / 8).toFixed(2)));
}

/** 将 Excel 二进制文件 (.xlsx/.xls/.csv/.tsv) 无损转换为 Univer IWorkbookData */
export async function excelBytesToUniverWorkbook(
  bytes: Uint8Array,
  filename = "workbook.xlsx"
): Promise<IWorkbookData> {
  const workbook = await loadExcelJsWorkbook(bytes, filename);
  const styles: Record<string, Nullable<IStyleData>> = {};
  const styleKeyToId = new Map<string, string>();
  let styleCounter = 0;

  /** 对相同样式哈希去重，减少快照体积 */
  const registerStyle = (styleObj: IStyleData | null): string | undefined => {
    if (!styleObj) return undefined;
    const key = JSON.stringify(styleObj);
    const existing = styleKeyToId.get(key);
    if (existing) return existing;
    const id = `s_${styleCounter++}`;
    styleKeyToId.set(key, id);
    styles[id] = styleObj;
    return id;
  };

  const sheetOrder: string[] = [];
  const sheets: Record<string, Partial<IWorksheetData>> = {};

  workbook.worksheets.forEach((ws, sheetIdx) => {
    const sheetId = `sheet_${sheetIdx}`;
    sheetOrder.push(sheetId);

    const mergeData = extractWorksheetMerges(ws);
    const cellData: IObjectMatrixPrimitiveType<ICellData> = {};
    const rowData: IObjectArrayPrimitiveType<Partial<IRowData>> = {};
    const columnData: IObjectArrayPrimitiveType<Partial<IColumnData>> = {};

    let actualRows = 0;
    let actualCols = 0;
    for (const m of mergeData) {
      actualRows = Math.max(actualRows, m.endRow + 1);
      actualCols = Math.max(actualCols, m.endColumn + 1);
    }

    // 映射工作表列宽与列隐藏态
    const columns = ws.columns ?? [];
    columns.forEach((col) => {
      if (!col || typeof col.number !== "number" || col.number < 1) return;
      const colIdx = col.number - 1;
      const entry: Partial<IColumnData> = {};
      if (typeof col.width === "number" && Number.isFinite(col.width) && col.width > 0) {
        entry.w = excelCharWidthToPx(col.width);
      }
      if (col.hidden) {
        entry.hd = BooleanNumber.TRUE;
      }
      if (Object.keys(entry).length > 0) {
        columnData[colIdx] = entry;
        actualCols = Math.max(actualCols, col.number);
      }
    });

    // 逐行遍历（包含空行与空样式单元格）
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const rIdx = rowNumber - 1;
      const rowMeta: Partial<IRowData> = {};
      if (typeof row.height === "number" && Number.isFinite(row.height) && row.height > 0) {
        rowMeta.h = Math.max(12, Math.round(row.height * 1.333));
      }
      if (row.hidden) {
        rowMeta.hd = BooleanNumber.TRUE;
      }
      if (Object.keys(rowMeta).length > 0) {
        rowData[rIdx] = rowMeta;
        actualRows = Math.max(actualRows, rowNumber);
      }

      const rowCells: Record<number, ICellData> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const cIdx = colNumber - 1;
        const isMergedSlave =
          Boolean(cell.isMerged) && Boolean(cell.master) && cell.address !== cell.master.address;

        const univerCell: ICellData = {};
        const styleId = registerStyle(extractUniverStyleFromCell(cell));
        if (styleId) {
          univerCell.s = styleId;
        }

        // 合并单元格从属格子仅保留样式，不重复填充主格值或公式
        if (!isMergedSlave) {
          const raw = cell.value;
          if (raw !== null && raw !== undefined) {
            if (typeof raw === "number") {
              if (Number.isFinite(raw)) {
                univerCell.v = raw;
                univerCell.t = CellValueType.NUMBER;
              }
            } else if (typeof raw === "string") {
              univerCell.v = raw;
              univerCell.t = CellValueType.STRING;
            } else if (typeof raw === "boolean") {
              univerCell.v = raw;
              univerCell.t = CellValueType.BOOLEAN;
            } else if (raw instanceof Date) {
              univerCell.v = formatExcelDate(raw);
              univerCell.t = CellValueType.STRING;
            } else if (typeof raw === "object") {
              // 兼容普通公式与共享公式（优先读取 cell.formula 解析结果）
              const rawFormula =
                "formula" in raw && typeof raw.formula === "string"
                  ? raw.formula
                  : "sharedFormula" in raw && typeof cell.formula === "string"
                    ? cell.formula
                    : undefined;

              if (rawFormula && rawFormula.trim()) {
                univerCell.f = `=${rawFormula.trim().replace(/^=+/, "")}`;
                const cached = extractFormulaScalarResult(
                  (raw as { result?: unknown }).result ?? cell.result
                );
                if (cached !== undefined) {
                  univerCell.v = cached;
                  univerCell.t = inferCellValueType(cached);
                }
              } else if ("richText" in raw && Array.isArray(raw.richText)) {
                univerCell.v = raw.richText.map((part) => part.text).join("");
                univerCell.t = CellValueType.STRING;
              } else if ("text" in raw) {
                const linkText = (raw as { text?: unknown }).text;
                if (
                  linkText &&
                  typeof linkText === "object" &&
                  "richText" in linkText &&
                  Array.isArray((linkText as { richText: Array<{ text: string }> }).richText)
                ) {
                  univerCell.v = (linkText as { richText: Array<{ text: string }> }).richText
                    .map((p) => p.text)
                    .join("");
                } else {
                  univerCell.v = String(linkText ?? "");
                }
                univerCell.t = CellValueType.STRING;
              } else if ("error" in raw) {
                univerCell.v = String((raw as { error: unknown }).error);
                univerCell.t = CellValueType.STRING;
              }
            }
          }
        }

        if (
          univerCell.v !== undefined ||
          univerCell.f !== undefined ||
          univerCell.s !== undefined
        ) {
          rowCells[cIdx] = univerCell;
          actualRows = Math.max(actualRows, rowNumber);
          actualCols = Math.max(actualCols, colNumber);
        }
      });

      if (Object.keys(rowCells).length > 0) {
        cellData[rIdx] = rowCells;
      }
    });

    const firstView = ws.views?.[0];
    const isFrozen = firstView?.state === "frozen";
    const xSplit = isFrozen ? Math.max(0, Math.floor(firstView?.xSplit ?? 0)) : 0;
    const ySplit = isFrozen ? Math.max(0, Math.floor(firstView?.ySplit ?? 0)) : 0;

    const hiddenState =
      ws.state === "veryHidden"
        ? (2 as IWorksheetData["hidden"])
        : ws.state === "hidden"
          ? BooleanNumber.TRUE
          : BooleanNumber.FALSE;

    const tabColorRgb = normalizeExcelColor(
      ws.properties?.tabColor as (Partial<ExcelJS.Color> & { tint?: number }) | undefined
    );

    const showGridlines =
      firstView?.showGridLines === false || ws.properties?.showGridLines === false
        ? BooleanNumber.FALSE
        : BooleanNumber.TRUE;

    sheets[sheetId] = {
      id: sheetId,
      name: ws.name || `Sheet${sheetIdx + 1}`,
      type: SheetTypes.GRID,
      tabColor: tabColorRgb ?? "",
      hidden: hiddenState,
      freeze: {
        xSplit,
        ySplit,
        startRow: ySplit > 0 ? ySplit : -1,
        startColumn: xSplit > 0 ? xSplit : -1,
      },
      rowCount: Math.max(100, actualRows + 30),
      columnCount: Math.max(26, actualCols + 10),
      zoomRatio: 1,
      scrollTop: 0,
      scrollLeft: 0,
      defaultColumnWidth: 88,
      defaultRowHeight: 24,
      mergeData,
      cellData,
      rowData,
      columnData,
      rowHeader: { width: 46, hidden: BooleanNumber.FALSE },
      columnHeader: { height: 20, hidden: BooleanNumber.FALSE },
      showGridlines,
      rightToLeft: firstView?.rightToLeft ? BooleanNumber.TRUE : BooleanNumber.FALSE,
    };
  });

  const baseName = filename.split("/").pop()?.replace(/\.[^.]+$/, "") || "Workbook";
  return {
    id: `wb_${Date.now()}_${++workbookCounter}`,
    name: baseName,
    appVersion: "1.6.1",
    locale: LocaleType.ZH_CN,
    styles,
    sheetOrder,
    sheets,
  };
}

/** 解析单元格样式（同时兼容样式 ID 引用与内联 IStyleData 对象） */
function resolveCellStyle(
  rawStyle: Nullable<IStyleData | string>,
  stylesMap?: Record<string, Nullable<IStyleData>>
): IStyleData | null {
  if (!rawStyle) return null;
  if (typeof rawStyle === "string") {
    return stylesMap?.[rawStyle] ?? null;
  }
  if (typeof rawStyle === "object") {
    return rawStyle;
  }
  return null;
}

/** 将 Univer IStyleData 写回 ExcelJS 单元格 */
function applyUniverStyleToExcelCell(excelCell: ExcelJS.Cell, style: IStyleData): void {
  const font: Partial<ExcelJS.Font> = {};
  if (style.ff) font.name = style.ff;
  if (typeof style.fs === "number" && Number.isFinite(style.fs)) font.size = style.fs;
  if (style.bl === BooleanNumber.TRUE) font.bold = true;
  else if (style.bl === BooleanNumber.FALSE) font.bold = false;
  if (style.it === BooleanNumber.TRUE) font.italic = true;
  else if (style.it === BooleanNumber.FALSE) font.italic = false;
  if (style.ul?.s === BooleanNumber.TRUE) font.underline = true;
  if (style.st?.s === BooleanNumber.TRUE) font.strike = true;
  const fgArgb = toExcelArgb(style.cl);
  if (fgArgb) font.color = { argb: fgArgb };
  if (Object.keys(font).length > 0) {
    excelCell.font = font;
  }

  const bgArgb = toExcelArgb(style.bg);
  if (bgArgb) {
    excelCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: bgArgb },
    };
  }

  const alignment: Partial<ExcelJS.Alignment> = {};
  const horizontal = mapHorizontalAlignToExcel(style.ht);
  if (horizontal) alignment.horizontal = horizontal;
  const vertical = mapVerticalAlignToExcel(style.vt);
  if (vertical) alignment.vertical = vertical;
  if (style.tb === WrapStrategy.WRAP) alignment.wrapText = true;
  if (Object.keys(alignment).length > 0) {
    excelCell.alignment = alignment;
  }

  if (style.bd) {
    const border: Partial<ExcelJS.Borders> = {};
    const top = convertBorderSideToExcel(style.bd.t);
    const right = convertBorderSideToExcel(style.bd.r);
    const bottom = convertBorderSideToExcel(style.bd.b);
    const left = convertBorderSideToExcel(style.bd.l);
    if (top) border.top = top;
    if (right) border.right = right;
    if (bottom) border.bottom = bottom;
    if (left) border.left = left;
    if (Object.keys(border).length > 0) {
      excelCell.border = border;
    }
  }

  if (style.n?.pattern && style.n.pattern !== "General") {
    excelCell.numFmt = style.n.pattern;
  }
}

/** 从 Univer 富文本对象提取纯文本 */
function extractRichTextPlain(cell: ICellData): string | undefined {
  const stream = cell.p?.body?.dataStream;
  if (typeof stream !== "string" || stream.length === 0) return undefined;
  return stream.replace(/\r\n$/, "").replace(/\r/g, "\n");
}

/** 将 Univer IWorkbookData 快照无损写回为 .xlsx 二进制字节 */
export async function univerWorkbookToExcelBytes(
  snapshot: IWorkbookData
): Promise<Uint8Array> {
  const wb = new Excel.Workbook();
  wb.creator = "Mizurisu Agent";
  wb.modified = new Date();

  const orderedIds =
    Array.isArray(snapshot.sheetOrder) && snapshot.sheetOrder.length > 0
      ? snapshot.sheetOrder
      : Object.keys(snapshot.sheets || {});

  const usedNames = new Set<string>();
  const allocateSheetName = (rawName: string | undefined, fallbackIdx: number): string => {
    const base = (rawName || `Sheet${fallbackIdx + 1}`).trim().slice(0, 31) || `Sheet${fallbackIdx + 1}`;
    if (!usedNames.has(base)) {
      usedNames.add(base);
      return base;
    }
    let suffix = 2;
    while (suffix < 1000) {
      const tag = ` (${suffix})`;
      const candidate = `${base.slice(0, 31 - tag.length)}${tag}`;
      if (!usedNames.has(candidate)) {
        usedNames.add(candidate);
        return candidate;
      }
      suffix += 1;
    }
    return `Sheet_${Date.now()}`.slice(0, 31);
  };

  orderedIds.forEach((sheetId, idx) => {
    const sheet = snapshot.sheets?.[sheetId];
    if (!sheet) return;

    const sheetName = allocateSheetName(sheet.name, idx);
    const xSplit = sheet.freeze?.xSplit && sheet.freeze.xSplit > 0 ? sheet.freeze.xSplit : 0;
    const ySplit = sheet.freeze?.ySplit && sheet.freeze.ySplit > 0 ? sheet.freeze.ySplit : 0;
    const showGridLines = sheet.showGridlines !== BooleanNumber.FALSE;

    const views: Array<Partial<ExcelJS.WorksheetView>> =
      xSplit > 0 || ySplit > 0
        ? [{ state: "frozen", xSplit, ySplit, showGridLines }]
        : showGridLines
          ? []
          : [{ state: "normal", showGridLines: false }];

    const state: ExcelJS.WorksheetState =
      sheet.hidden === 2
        ? "veryHidden"
        : sheet.hidden === BooleanNumber.TRUE
          ? "hidden"
          : "visible";

    const tabColorArgb = sheet.tabColor ? toExcelArgb({ rgb: sheet.tabColor }) : undefined;

    const ws = wb.addWorksheet(sheetName, {
      state,
      ...(views.length > 0 ? { views } : {}),
      ...(tabColorArgb
        ? { properties: { tabColor: { argb: tabColorArgb }, showGridLines } }
        : { properties: { showGridLines } }),
    });

    const cellData = sheet.cellData ?? {};
    const rowData = sheet.rowData ?? {};
    const columnData = sheet.columnData ?? {};
    const mergeData = sheet.mergeData ?? [];

    let maxContentRow = -1;
    let maxContentCol = -1;
    for (const m of mergeData) {
      maxContentRow = Math.max(maxContentRow, m.endRow);
      maxContentCol = Math.max(maxContentCol, m.endColumn);
    }

    // 写入单元格数据与样式
    const rowIndices = Object.keys(cellData)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b);

    for (const rIdx of rowIndices) {
      const rowCells = cellData[rIdx];
      if (!rowCells) continue;
      const colIndices = Object.keys(rowCells)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0)
        .sort((a, b) => a - b);

      for (const cIdx of colIndices) {
        const cell = rowCells[cIdx];
        if (!cell) continue;

        const rowStyle = resolveCellStyle(rowData[rIdx]?.s, snapshot.styles);
        const colStyle = resolveCellStyle(columnData[cIdx]?.s, snapshot.styles);
        const cellStyle = resolveCellStyle(cell.s, snapshot.styles);
        const resolvedStyle = cellStyle ?? rowStyle ?? colStyle;

        const hasFormula = typeof cell.f === "string" && cell.f.trim().length > 0;
        const richText = cell.v === undefined || cell.v === null ? extractRichTextPlain(cell) : undefined;
        const hasValue =
          (cell.v !== undefined && cell.v !== null) || richText !== undefined;

        if (!hasFormula && !hasValue && !resolvedStyle) {
          continue;
        }

        maxContentRow = Math.max(maxContentRow, rIdx);
        maxContentCol = Math.max(maxContentCol, cIdx);

        const excelCell = ws.getCell(rIdx + 1, cIdx + 1);

        if (hasFormula && cell.f) {
          // 剥离前导 '='，防止 ExcelJS 写回后出现 '==' 双等号
          const cleanFormula = cell.f.trim().replace(/^=+/, "");
          if (cleanFormula.length > 0) {
            const cachedResult =
              typeof cell.v === "string" ||
              typeof cell.v === "number" ||
              typeof cell.v === "boolean"
                ? cell.v
                : undefined;
            excelCell.value =
              cachedResult !== undefined
                ? { formula: cleanFormula, result: cachedResult }
                : { formula: cleanFormula };
          } else if (hasValue) {
            excelCell.value = cell.v ?? richText ?? null;
          }
        } else if (hasValue) {
          if (cell.v !== undefined && cell.v !== null) {
            if (cell.t === CellValueType.BOOLEAN) {
              excelCell.value =
                typeof cell.v === "boolean"
                  ? cell.v
                  : cell.v === 1 || cell.v === "TRUE" || cell.v === "true";
            } else if (cell.t === CellValueType.FORCE_STRING) {
              excelCell.value = String(cell.v);
            } else {
              excelCell.value = cell.v;
            }
          } else if (richText !== undefined) {
            excelCell.value = richText;
          }
        }

        if (resolvedStyle) {
          applyUniverStyleToExcelCell(excelCell, resolvedStyle);
        }
      }
    }

    // 写回列宽与列隐藏（避免尾部纯默认空白列虚增列数）
    const defaultColW = sheet.defaultColumnWidth ?? 88;
    const colKeys = Object.keys(columnData)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b);

    for (const cIdx of colKeys) {
      const colInfo = columnData[cIdx];
      if (!colInfo) continue;
      const isCustomWidth =
        typeof colInfo.w === "number" &&
        Number.isFinite(colInfo.w) &&
        colInfo.w > 0 &&
        Math.abs(colInfo.w - defaultColW) > 1;
      const isHidden = colInfo.hd === BooleanNumber.TRUE;
      if (cIdx > maxContentCol && !isCustomWidth && !isHidden) {
        continue;
      }
      const excelCol = ws.getColumn(cIdx + 1);
      if (typeof colInfo.w === "number" && Number.isFinite(colInfo.w) && colInfo.w > 0) {
        excelCol.width = pxToExcelCharWidth(colInfo.w);
      }
      if (isHidden) {
        excelCol.hidden = true;
      }
    }

    // 写回行高与行隐藏（避免仅含默认自动行高的空行虚增 rowCount）
    const defaultRowH = sheet.defaultRowHeight ?? 24;
    const rowKeys = Object.keys(rowData)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b);

    for (const rIdx of rowKeys) {
      const rowInfo = rowData[rIdx];
      if (!rowInfo) continue;
      const explicitHeight =
        typeof rowInfo.h === "number" && Number.isFinite(rowInfo.h) && rowInfo.h > 0
          ? rowInfo.h
          : undefined;
      const autoHeight =
        rowInfo.ia === BooleanNumber.TRUE &&
        typeof rowInfo.ah === "number" &&
        Number.isFinite(rowInfo.ah) &&
        rowInfo.ah > 0
          ? rowInfo.ah
          : undefined;
      const pxHeight = explicitHeight ?? autoHeight;
      const isCustomHeight =
        pxHeight !== undefined && Math.abs(pxHeight - defaultRowH) > 1;
      const isHidden = rowInfo.hd === BooleanNumber.TRUE;
      if (rIdx > maxContentRow && !isCustomHeight && !isHidden) {
        continue;
      }
      const excelRow = ws.getRow(rIdx + 1);
      if (
        pxHeight !== undefined &&
        (explicitHeight !== undefined || isCustomHeight)
      ) {
        excelRow.height = Math.max(8, Number((pxHeight / 1.333).toFixed(2)));
      }
      if (isHidden) {
        excelRow.hidden = true;
      }
    }

    // 写回合并单元格
    for (const m of mergeData) {
      if (
        m.startRow < 0 ||
        m.startColumn < 0 ||
        m.endRow < m.startRow ||
        m.endColumn < m.startColumn ||
        (m.startRow === m.endRow && m.startColumn === m.endColumn)
      ) {
        continue;
      }
      try {
        ws.mergeCells(m.startRow + 1, m.startColumn + 1, m.endRow + 1, m.endColumn + 1);
      } catch {
        // 忽略重叠或非法合并范围
      }
    }
  });

  if (wb.worksheets.length === 0) {
    wb.addWorksheet("Sheet1");
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
