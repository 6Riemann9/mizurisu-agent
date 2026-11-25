import type ExcelJS from "exceljs";
import FormulaParser from "fast-formula-parser";

type FormulaArg = { value?: unknown; isArray?: boolean } | unknown;

function unwrapArg(arg: FormulaArg): unknown {
  if (arg && typeof arg === "object" && "value" in arg) {
    return (arg as { value?: unknown }).value;
  }
  return arg;
}

function flattenValues(args: FormulaArg[]): unknown[] {
  const out: unknown[] = [];
  const pushVal = (v: unknown) => {
    const raw = unwrapArg(v);
    if (Array.isArray(raw)) {
      for (const item of raw) pushVal(item);
    } else {
      out.push(raw);
    }
  };
  for (const a of args) pushVal(a);
  return out;
}

function flattenNumbers(args: FormulaArg[]): number[] {
  return flattenValues(args)
    .map((v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN))
    .filter((n) => Number.isFinite(n));
}

function resolveContextArg(context: unknown, arg: FormulaArg): unknown {
  if (
    context &&
    typeof context === "object" &&
    "utils" in context &&
    typeof (context as { utils?: { extractRefValue?: (a: unknown) => { val: unknown } } }).utils
      ?.extractRefValue === "function"
  ) {
    return (
      context as { utils: { extractRefValue: (a: unknown) => { val: unknown } } }
    ).utils.extractRefValue(arg).val;
  }
  return unwrapArg(arg);
}

function matchesCriteria(cellVal: unknown, criteriaRaw: unknown): boolean {
  const crit = unwrapArg(criteriaRaw);
  if (typeof crit === "string") {
    const trimmed = crit.trim();
    const cmp = trimmed.match(/^(<=|>=|<>|<|>|=)(.*)$/);
    if (cmp) {
      const op = cmp[1];
      const rhsStr = cmp[2].trim();
      const rhsNum = rhsStr === "" ? NaN : Number(rhsStr);
      const lhsNum =
        typeof cellVal === "number"
          ? cellVal
          : typeof cellVal === "string" && cellVal.trim() !== ""
            ? Number(cellVal)
            : NaN;
      if (Number.isFinite(lhsNum) && Number.isFinite(rhsNum)) {
        if (op === ">") return lhsNum > rhsNum;
        if (op === "<") return lhsNum < rhsNum;
        if (op === ">=") return lhsNum >= rhsNum;
        if (op === "<=") return lhsNum <= rhsNum;
        if (op === "<>") return lhsNum !== rhsNum;
        return lhsNum === rhsNum;
      }
      const l = String(cellVal ?? "").toLowerCase();
      const r = rhsStr.toLowerCase();
      if (op === "<>") return l !== r;
      if (op === "=") return l === r;
      if (op === ">") return l > r;
      if (op === "<") return l < r;
      if (op === ">=") return l >= r;
      if (op === "<=") return l <= r;
    }
    if (trimmed.includes("*") || trimmed.includes("?")) {
      const escaped = trimmed
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
      return new RegExp(`^${escaped}$`, "i").test(String(cellVal ?? ""));
    }
    return String(cellVal ?? "").toLowerCase() === trimmed.toLowerCase();
  }
  if (crit === null || crit === undefined) {
    return cellVal === null || cellVal === undefined || cellVal === "";
  }
  return cellVal === crit;
}

function readRawCellScalar(cell: ExcelJS.Cell): unknown {
  // ExcelJS cell.value getter 在 result === 0 时可能丢弃结果，故同时检查 cell.result
  const rawVal = cell.value;
  if (rawVal === null || rawVal === undefined) return null;
  if (rawVal instanceof Date) return rawVal;
  if (typeof rawVal === "object") {
    if ("formula" in rawVal || "sharedFormula" in rawVal) {
      const res = (rawVal as { result?: unknown }).result ?? cell.result;
      return res === undefined ? null : res;
    }
    if ("richText" in rawVal && Array.isArray(rawVal.richText)) {
      return rawVal.richText.map((r) => r.text).join("");
    }
    if ("text" in rawVal && typeof rawVal.text === "string") {
      return rawVal.text;
    }
  }
  return rawVal;
}

/**
 * 在写盘前使用纯 JS 公式引擎重算工作簿内所有公式单元格的缓存值（`result`），
 * 确保后续 `excel_inspect` / `excel_read_sheet` 或未自动重算的阅读器立即可读到最新结果。
 */
export function recalculateWorkbookFormulas(workbook: ExcelJS.Workbook): number {
  const sheetByName = new Map<string, ExcelJS.Worksheet>();
  for (const ws of workbook.worksheets) {
    sheetByName.set(ws.name, ws);
    sheetByName.set(ws.name.toLowerCase(), ws);
  }

  const getSheet = (name?: string): ExcelJS.Worksheet | undefined => {
    if (!name) return workbook.worksheets[0];
    return sheetByName.get(name) ?? sheetByName.get(name.toLowerCase());
  };

  const evaluating = new Set<string>();
  let computedCount = 0;

  const evalCell = (ws: ExcelJS.Worksheet, row: number, col: number): unknown => {
    const key = `${ws.name}!${row}:${col}`;
    if (evaluating.has(key)) return 0;

    const cell = ws.getRow(row).getCell(col);
    const val = cell.value;
    if (val && typeof val === "object" && "formula" in val && typeof val.formula === "string") {
      evaluating.add(key);
      try {
        const cleanFormula = val.formula.startsWith("=") ? val.formula.slice(1) : val.formula;
        const result = parser.parse(cleanFormula, { row, col, sheet: ws.name });
        const normalizedResult =
          typeof result === "number" || typeof result === "string" || typeof result === "boolean"
            ? result
            : result === null || result === undefined
              ? null
              : String(result);
        cell.value = {
          formula: cleanFormula,
          result: normalizedResult as ExcelJS.CellFormulaValue["result"],
        };
        computedCount++;
        return normalizedResult;
      } catch {
        return (val as { result?: unknown }).result ?? cell.result ?? null;
      } finally {
        evaluating.delete(key);
      }
    }
    return readRawCellScalar(cell);
  };

  const parser = new FormulaParser({
    onCell: ({ sheet, row, col }) => {
      const ws = getSheet(sheet);
      if (!ws) return null;
      return evalCell(ws, row, col);
    },
    onRange: ({ sheet, from, to }) => {
      const ws = getSheet(sheet);
      if (!ws) return [[]];
      const matrix: unknown[][] = [];
      for (let r = from.row; r <= to.row; r++) {
        const rowArr: unknown[] = [];
        for (let c = from.col; c <= to.col; c++) {
          rowArr.push(evalCell(ws, r, c));
        }
        matrix.push(rowArr);
      }
      return matrix;
    },
    functions: {
      MIN: (...args: FormulaArg[]) => {
        const nums = flattenNumbers(args);
        return nums.length > 0 ? Math.min(...nums) : 0;
      },
      MAX: (...args: FormulaArg[]) => {
        const nums = flattenNumbers(args);
        return nums.length > 0 ? Math.max(...nums) : 0;
      },
      COUNTA: (...args: FormulaArg[]) =>
        flattenValues(args).filter((v) => v !== null && v !== undefined && v !== "").length,
      UPPER: (arg: FormulaArg) => String(unwrapArg(arg) ?? "").toUpperCase(),
      LOWER: (arg: FormulaArg) => String(unwrapArg(arg) ?? "").toLowerCase(),
      SUBSTITUTE: (textArg: FormulaArg, oldArg: FormulaArg, newArg: FormulaArg, instArg?: FormulaArg) => {
        const text = String(unwrapArg(textArg) ?? "");
        const oldStr = String(unwrapArg(oldArg) ?? "");
        const newStr = String(unwrapArg(newArg) ?? "");
        if (!oldStr) return text;
        const inst = instArg !== undefined ? Number(unwrapArg(instArg)) : undefined;
        if (!inst || !Number.isFinite(inst)) {
          return text.split(oldStr).join(newStr);
        }
        let idx = 0;
        let count = 0;
        while ((idx = text.indexOf(oldStr, idx)) !== -1) {
          count++;
          if (count === inst) {
            return text.slice(0, idx) + newStr + text.slice(idx + oldStr.length);
          }
          idx += oldStr.length;
        }
        return text;
      },
      TEXTJOIN: (delimArg: FormulaArg, ignoreEmptyArg: FormulaArg, ...rest: FormulaArg[]) => {
        const delim = String(unwrapArg(delimArg) ?? "");
        const ignoreEmpty = Boolean(unwrapArg(ignoreEmptyArg));
        const vals = flattenValues(rest).map((v) => (v === null || v === undefined ? "" : String(v)));
        return (ignoreEmpty ? vals.filter((s) => s !== "") : vals).join(delim);
      },
      CHOOSE: (context: unknown, idxArg: FormulaArg, ...choices: FormulaArg[]) => {
        const idx = Math.trunc(Number(resolveContextArg(context, idxArg)));
        if (!Number.isFinite(idx) || idx < 1 || idx > choices.length) return "#VALUE!";
        return resolveContextArg(context, choices[idx - 1]);
      },
      MATCH: (lookupArg: FormulaArg, arrayArg: FormulaArg, matchTypeArg?: FormulaArg) => {
        const target = unwrapArg(lookupArg);
        const flat = flattenValues([arrayArg]);
        const matchType = matchTypeArg !== undefined ? Number(unwrapArg(matchTypeArg)) : 1;
        if (matchType === 0) {
          const i = flat.findIndex((item) => matchesCriteria(item, target));
          return i >= 0 ? i + 1 : "#N/A";
        }
        const i = flat.findIndex((item) => item === target);
        return i >= 0 ? i + 1 : "#N/A";
      },
      INDEX: (context: unknown, rangesArg: FormulaArg, rowArg: FormulaArg, colArg?: FormulaArg) => {
        const rowVal = resolveContextArg(context, rowArg);
        const colVal = colArg !== undefined ? resolveContextArg(context, colArg) : 1;
        const r = Math.trunc(Number(rowVal));
        const c = Math.trunc(Number(colVal ?? 1));

        const rawRef = rangesArg as {
          ref?: {
            sheet?: string;
            row?: number;
            col?: number;
            from?: { row: number; col: number };
            to?: { row: number; col: number };
          };
        };
        if (rawRef?.ref?.from && rawRef.ref.to) {
          const from = rawRef.ref.from;
          const to = rawRef.ref.to;
          if (r < 1 || c < 1 || from.row + r - 1 > to.row || from.col + c - 1 > to.col) {
            return "#REF!";
          }
          const ws = getSheet(rawRef.ref.sheet);
          return ws ? evalCell(ws, from.row + r - 1, from.col + c - 1) : "#REF!";
        }
        if (rawRef?.ref?.row !== undefined && rawRef.ref.col !== undefined) {
          if (r !== 1 || c !== 1) return "#REF!";
          const ws = getSheet(rawRef.ref.sheet);
          return ws ? evalCell(ws, rawRef.ref.row, rawRef.ref.col) : "#REF!";
        }

        const resolved = resolveContextArg(context, rangesArg);
        const grid = Array.isArray(resolved)
          ? Array.isArray(resolved[0])
            ? (resolved as unknown[][])
            : [resolved]
          : [[resolved]];
        if (r < 1 || r > grid.length || c < 1 || c > (grid[0]?.length ?? 0)) return "#REF!";
        return grid[r - 1][c - 1] ?? null;
      },
      XLOOKUP: (
        lookupArg: FormulaArg,
        lookupArrArg: FormulaArg,
        returnArrArg: FormulaArg,
        ifNotFoundArg?: FormulaArg
      ) => {
        const target = unwrapArg(lookupArg);
        const keys = flattenValues([lookupArrArg]);
        const vals = flattenValues([returnArrArg]);
        const idx = keys.findIndex((k) => matchesCriteria(k, target));
        if (idx >= 0 && idx < vals.length) return vals[idx];
        return ifNotFoundArg !== undefined ? unwrapArg(ifNotFoundArg) : "#N/A";
      },
      COUNTIFS: (...args: FormulaArg[]) => {
        if (args.length < 2) return 0;
        const firstRange = flattenValues([args[0]]);
        let count = 0;
        for (let i = 0; i < firstRange.length; i++) {
          let ok = true;
          for (let p = 0; p + 1 < args.length; p += 2) {
            const range = flattenValues([args[p]]);
            if (!matchesCriteria(range[i], args[p + 1])) {
              ok = false;
              break;
            }
          }
          if (ok) count++;
        }
        return count;
      },
      SUMIFS: (sumRangeArg: FormulaArg, ...criteriaPairs: FormulaArg[]) => {
        const sumVals = flattenValues([sumRangeArg]);
        let total = 0;
        for (let i = 0; i < sumVals.length; i++) {
          let ok = true;
          for (let p = 0; p + 1 < criteriaPairs.length; p += 2) {
            const range = flattenValues([criteriaPairs[p]]);
            if (!matchesCriteria(range[i], criteriaPairs[p + 1])) {
              ok = false;
              break;
            }
          }
          if (ok) {
            const n = Number(sumVals[i]);
            if (Number.isFinite(n)) total += n;
          }
        }
        return total;
      },
      AVERAGEIFS: (avgRangeArg: FormulaArg, ...criteriaPairs: FormulaArg[]) => {
        const vals = flattenValues([avgRangeArg]);
        let sum = 0;
        let count = 0;
        for (let i = 0; i < vals.length; i++) {
          let ok = true;
          for (let p = 0; p + 1 < criteriaPairs.length; p += 2) {
            const range = flattenValues([criteriaPairs[p]]);
            if (!matchesCriteria(range[i], criteriaPairs[p + 1])) {
              ok = false;
              break;
            }
          }
          if (ok) {
            const n = Number(vals[i]);
            if (Number.isFinite(n)) {
              sum += n;
              count++;
            }
          }
        }
        return count > 0 ? sum / count : "#DIV/0!";
      },
      MEDIAN: (...args: FormulaArg[]) => {
        const nums = flattenNumbers(args).sort((a, b) => a - b);
        if (nums.length === 0) return 0;
        const mid = Math.floor(nums.length / 2);
        return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
      },
      STDEV: (...args: FormulaArg[]) => {
        const nums = flattenNumbers(args);
        if (nums.length < 2) return 0;
        const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
        const variance =
          nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / (nums.length - 1);
        return Math.sqrt(variance);
      },
      RANK: (numArg: FormulaArg, refArg: FormulaArg, orderArg?: FormulaArg) => {
        const target = Number(unwrapArg(numArg));
        const nums = flattenNumbers([refArg]);
        const asc = Number(unwrapArg(orderArg) || 0) !== 0;
        const sorted = [...nums].sort((a, b) => (asc ? a - b : b - a));
        const idx = sorted.indexOf(target);
        return idx >= 0 ? idx + 1 : "#N/A";
      },
      PMT: (rateArg: FormulaArg, nperArg: FormulaArg, pvArg: FormulaArg) => {
        const rate = Number(unwrapArg(rateArg));
        const nper = Number(unwrapArg(nperArg));
        const pv = Number(unwrapArg(pvArg));
        if (nper <= 0) return "#NUM!";
        if (rate === 0) return -pv / nper;
        return (-pv * rate * Math.pow(1 + rate, nper)) / (Math.pow(1 + rate, nper) - 1);
      },
      NPV: (rateArg: FormulaArg, ...cashflows: FormulaArg[]) => {
        const rate = Number(unwrapArg(rateArg));
        const vals = flattenNumbers(cashflows);
        return vals.reduce((acc, cf, idx) => acc + cf / Math.pow(1 + rate, idx + 1), 0);
      },
    },
  });

  for (const ws of workbook.worksheets) {
    ws.eachRow((row, rowNumber) => {
      row.eachCell((cell, colNumber) => {
        const v = cell.value;
        if (v && typeof v === "object" && "formula" in v && typeof v.formula === "string") {
          evalCell(ws, rowNumber, colNumber);
        }
      });
    });
  }

  return computedCount;
}
