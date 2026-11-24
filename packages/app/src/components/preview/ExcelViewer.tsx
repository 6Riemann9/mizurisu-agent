import { Download, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  exportSheetToCsv,
  inspectExcel,
  readExcelSheet,
  updateExcelCells,
  type ExcelInspectResult,
  type ParsedCell,
} from "../../office";
import { getPlatformAdapter } from "../../platform";
import { workspaceVfs } from "../../storage/workspace-vfs";
import { useAppStore } from "../../store/useAppStore";

function colIndexToLetter(colIdx: number): string {
  let n = colIdx + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function getCellRawInput(cell?: ParsedCell): string {
  if (!cell) return "";
  if (cell.formula) return `=${cell.formula}`;
  return cell.value !== null && cell.value !== undefined ? String(cell.value) : "";
}

export function ExcelViewer({
  path,
  bytes,
}: {
  path: string;
  bytes: Uint8Array;
}) {
  const [inspect, setInspect] = useState<ExcelInspectResult | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [rows, setRows] = useState<ParsedCell[][]>([]);
  const [totalCols, setTotalCols] = useState(0);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);
  const [formulaInput, setFormulaInput] = useState("");
  const [editing, setEditing] = useState<{ r: number; c: number; val: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skipBlurRef = useRef(false);
  const formulaBarRef = useRef<HTMLInputElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // 切换文件时重置筛选、编辑状态与默认焦点
  useEffect(() => {
    setFilter("");
    setEditing(null);
    setSelected({ r: 0, c: 0 });
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const info = await inspectExcel(bytes, path, 5);
        if (cancelled) return;
        setInspect(info);
        const first = info.sheets[0]?.name || "";
        setActiveSheet((prev) =>
          prev && info.sheets.some((s) => s.name === prev) ? prev : first
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes, path]);

  useEffect(() => {
    if (!activeSheet) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await readExcelSheet(bytes, {
          filename: path,
          sheetName: activeSheet,
          startRow: 1,
          maxRows: 400,
        });
        if (cancelled) return;
        const nextCols = Math.max(res.totalColumns, res.rows[0]?.length || 0);
        setRows(res.rows);
        setTotalCols(nextCols);

        if (res.rows.length === 0 || nextCols === 0) {
          setSelected(null);
          setFormulaInput("");
        } else {
          setSelected((prev) => {
            const nextR = prev ? Math.min(prev.r, res.rows.length - 1) : 0;
            const nextC = prev ? Math.min(prev.c, nextCols - 1) : 0;
            setFormulaInput(getCellRawInput(res.rows[nextR]?.[nextC]));
            return { r: nextR, c: nextC };
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes, path, activeSheet]);

  const filteredRowIndices = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows.map((_, i) => i);
    return rows
      .map((row, idx) => ({ row, idx }))
      .filter(({ row, idx }) => {
        if (idx === 0) return true;
        return row.some(
          (c) =>
            String(c.value ?? "").toLowerCase().includes(q) ||
            (c.formula ? `=${c.formula}`.toLowerCase().includes(q) : false)
        );
      })
      .map((x) => x.idx);
  }, [rows, filter]);

  const selectCell = (r: number, c: number) => {
    setSelected({ r, c });
    setFormulaInput(getCellRawInput(rows[r]?.[c]));
  };

  const commitCellEdit = async (r: number, c: number, rawInput: string) => {
    setEditing(null);
    const prevDisplay = getCellRawInput(rows[r]?.[c]);
    if (rawInput === prevDisplay) return;

    setSaving(true);
    setError(null);
    try {
      const coord = `${colIndexToLetter(c)}${r + 1}`;
      const isFormula = rawInput.startsWith("=") && rawInput.length > 1;
      const numVal = Number(rawInput);
      const parsedValue =
        rawInput === ""
          ? null
          : !isFormula && !Number.isNaN(numVal) && rawInput.trim() !== ""
            ? numVal
            : rawInput;

      const nextBytes = await updateExcelCells(
        bytes,
        {
          operations: [
            {
              sheetName: activeSheet,
              cell: coord,
              value: isFormula ? undefined : parsedValue,
              formula: isFormula ? rawInput.slice(1) : undefined,
            },
          ],
        },
        path
      );
      const targetPath = path.toLowerCase().endsWith(".xlsx")
        ? path
        : `${path.replace(/\.[^.]+$/, "")}.xlsx`;
      await workspaceVfs.writeBytes(targetPath, nextBytes, {
        snapshotNote: `表格单元格编辑 (${coord})`,
      });
      if (targetPath !== path) {
        useAppStore.getState().openPreview(targetPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAppendRow = async () => {
    if (!activeSheet || saving) return;
    setSaving(true);
    setError(null);
    try {
      const emptyRow = new Array(Math.max(1, totalCols)).fill("");
      const nextBytes = await updateExcelCells(
        bytes,
        {
          appendRows: [{ sheetName: activeSheet, rows: [emptyRow] }],
        },
        path
      );
      const targetPath = path.toLowerCase().endsWith(".xlsx")
        ? path
        : `${path.replace(/\.[^.]+$/, "")}.xlsx`;
      await workspaceVfs.writeBytes(targetPath, nextBytes, {
        snapshotNote: "表格新增空白行",
      });
      if (targetPath !== path) {
        useAppStore.getState().openPreview(targetPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      const csv = await exportSheetToCsv(bytes, activeSheet, path);
      const data = new TextEncoder().encode("\uFEFF" + csv);
      await getPlatformAdapter().exportFile(
        `${path.replace(/\.[^.]+$/, "")}_${activeSheet || "sheet"}.csv`,
        data,
        "text/csv;charset=utf-8"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return;
    }
    if (!selected || filteredRowIndices.length === 0 || totalCols === 0) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const currentVisiblePos = filteredRowIndices.indexOf(selected.r);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextPos =
        currentVisiblePos >= 0
          ? Math.min(filteredRowIndices.length - 1, currentVisiblePos + 1)
          : 0;
      selectCell(filteredRowIndices[nextPos], selected.c);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const nextPos =
        currentVisiblePos >= 0 ? Math.max(0, currentVisiblePos - 1) : 0;
      selectCell(filteredRowIndices[nextPos], selected.c);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      selectCell(selected.r, Math.min(totalCols - 1, selected.c + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      selectCell(selected.r, Math.max(0, selected.c - 1));
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      const raw = getCellRawInput(rows[selected.r]?.[selected.c]);
      setEditing({ r: selected.r, c: selected.c, val: raw });
    }
  };

  const selectedCoord = selected
    ? `${colIndexToLetter(selected.c)}${selected.r + 1}`
    : "—";
  const selectedCell = selected ? rows[selected.r]?.[selected.c] : undefined;
  const selectedRaw = getCellRawInput(selectedCell);
  const formulaModified = Boolean(selected) && formulaInput !== selectedRaw;
  const isFormulaActive =
    Boolean(selectedCell?.formula) || formulaInput.trim().startsWith("=");

  if (error) {
    return (
      <div className="p-4 m-4 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-xs text-[var(--status-danger)]">
        表格解析或写入失败：{error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg-canvas)]">
      {/* 顶部 h-9 工具行 */}
      <div className="h-9 shrink-0 px-2.5 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between gap-2 text-xs select-none">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-1 max-w-[240px]">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="筛选行内容..."
              className="w-full h-6 pl-7 pr-6 rounded border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-strong)] transition-colors"
            />
            {filter && (
              <button
                type="button"
                onClick={() => setFilter("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                title="清空筛选"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {saving ? (
            <span className="text-[11px] text-[var(--accent)] font-medium whitespace-nowrap">
              正在保存…
            </span>
          ) : filter.trim() ? (
            <span className="text-[10px] font-mono tabular-nums text-[var(--text-muted)] whitespace-nowrap hidden sm:inline">
              {filteredRowIndices.length} 行
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={saving || !activeSheet}
            onClick={handleAppendRow}
            className="h-6 inline-flex items-center gap-1 px-2 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-45"
          >
            <Plus className="w-3 h-3" />
            <span>新增行</span>
          </button>
          <button
            type="button"
            disabled={!activeSheet}
            onClick={handleExportCsv}
            className="h-6 inline-flex items-center gap-1 px-2 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-45"
          >
            <Download className="w-3 h-3" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Linear 风格公式栏 (h-8) */}
      <div className="h-8 shrink-0 border-b border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex items-center text-xs">
        <div
          className="w-14 h-full shrink-0 border-r border-[var(--border-hairline)] flex items-center justify-center font-mono text-[11px] font-medium tabular-nums text-[var(--text-primary)] select-none bg-[var(--bg-sidebar)]"
          title="当前选中单元格坐标"
        >
          {selectedCoord}
        </div>
        <div
          className={`w-8 h-full shrink-0 border-r border-[var(--border-hairline)] flex items-center justify-center font-mono italic text-[11px] select-none bg-[var(--bg-sidebar)] ${
            isFormulaActive ? "text-[var(--accent)] font-medium" : "text-[var(--text-muted)]"
          }`}
          title="公式 / 原始值"
        >
          fx
        </div>
        <div className="flex-1 min-w-0 h-full flex items-center bg-[var(--bg-canvas)]">
          <input
            ref={formulaBarRef}
            value={formulaInput}
            disabled={!selected || saving}
            onFocus={() => {
              if (editing) {
                setFormulaInput(editing.val);
                skipBlurRef.current = true;
                setEditing(null);
              }
            }}
            onChange={(e) => setFormulaInput(e.target.value)}
            onKeyDown={(e) => {
              if (!selected) return;
              if (e.key === "Enter") {
                e.preventDefault();
                void commitCellEdit(selected.r, selected.c, formulaInput);
                gridContainerRef.current?.focus();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setFormulaInput(selectedRaw);
                formulaBarRef.current?.blur();
              }
            }}
            placeholder={selected ? "输入数值、文本或 =SUM(...) 公式，按 Enter 写回" : "选择单元格以查看或编辑"}
            className="w-full h-full px-2.5 bg-transparent font-mono text-[11.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none disabled:opacity-50"
          />
          {formulaModified && (
            <span className="px-2 text-[10px] font-mono text-[var(--text-muted)] shrink-0 hidden sm:inline select-none">
              ↵ Enter 应用
            </span>
          )}
        </div>
      </div>

      {/* 电子表格网格 */}
      <div
        ref={gridContainerRef}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        className="flex-1 overflow-auto min-h-0 bg-[var(--bg-canvas)] outline-none"
      >
        {rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-[var(--text-muted)]">
            工作表为空
          </div>
        ) : (
          <table className="border-separate border-spacing-0 text-xs w-max min-w-full">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 w-10 min-w-[40px] h-7 px-2 border-r border-b border-[var(--border-hairline)] bg-[var(--bg-sidebar)] text-[var(--text-muted)] font-mono text-[11px] font-medium text-center select-none">
                  #
                </th>
                {Array.from({ length: totalCols }).map((_, cIdx) => {
                  const isColSelected = selected?.c === cIdx;
                  return (
                    <th
                      key={cIdx}
                      className={`sticky top-0 z-20 min-w-[110px] h-7 px-2.5 border-r border-b border-[var(--border-hairline)] font-mono text-[11px] font-medium text-center select-none transition-colors ${
                        isColSelected
                          ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                          : "bg-[var(--bg-sidebar)] text-[var(--text-muted)]"
                      }`}
                    >
                      {colIndexToLetter(cIdx)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredRowIndices.map((rIdx) => {
                const row = rows[rIdx] || [];
                const isHeaderRow = rIdx === 0;
                const isRowSelected = selected?.r === rIdx;
                return (
                  <tr
                    key={rIdx}
                    className={
                      isHeaderRow
                        ? "bg-[var(--bg-surface)] font-medium"
                        : "bg-[var(--bg-canvas)] hover:bg-[var(--bg-hover)]"
                    }
                  >
                    <td
                      className={`sticky left-0 z-10 w-10 min-w-[40px] h-7 px-2 border-r border-b border-[var(--border-hairline)] font-mono tabular-nums text-[11px] text-center select-none transition-colors ${
                        isRowSelected
                          ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                          : "bg-[var(--bg-sidebar)] text-[var(--text-muted)]"
                      }`}
                    >
                      {rIdx + 1}
                    </td>
                    {Array.from({ length: totalCols }).map((_, cIdx) => {
                      const cell = row[cIdx] || { value: null };
                      const isSel = selected?.r === rIdx && selected?.c === cIdx;
                      const isEd = editing?.r === rIdx && editing?.c === cIdx;
                      const hasFormula = Boolean(cell.formula);
                      const isNumeric = typeof cell.value === "number";
                      const displayVal =
                        cell.value !== null && cell.value !== undefined
                          ? String(cell.value)
                          : cell.formula
                            ? `=${cell.formula}`
                            : "";

                      return (
                        <td
                          key={cIdx}
                          onClick={() => {
                            if (!isEd) selectCell(rIdx, cIdx);
                          }}
                          onDoubleClick={() => {
                            const raw = getCellRawInput(cell);
                            setSelected({ r: rIdx, c: cIdx });
                            setFormulaInput(raw);
                            setEditing({
                              r: rIdx,
                              c: cIdx,
                              val: raw,
                            });
                          }}
                          title={
                            hasFormula
                              ? `公式: =${cell.formula}（双击编辑）`
                              : "单击选中，双击编辑"
                          }
                          className={`relative h-7 px-2.5 border-r border-b border-[var(--border-hairline)] max-w-[260px] truncate cursor-cell text-[12px] text-[var(--text-primary)] ${
                            isNumeric
                              ? "text-right font-mono tabular-nums"
                              : hasFormula && cell.value === null
                                ? "text-left font-mono"
                                : "text-left"
                          } ${
                            isSel && !isEd
                              ? "shadow-[inset_0_0_0_1px_var(--accent)] bg-[var(--accent-soft)]/30"
                              : ""
                          }`}
                        >
                          {hasFormula && !isEd && (
                            <span
                              className="pointer-events-none absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--accent)]"
                              aria-hidden="true"
                            />
                          )}
                          {isEd ? (
                            <input
                              autoFocus
                              value={editing.val}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditing({ ...editing, val });
                                setFormulaInput(val);
                              }}
                              onBlur={() => {
                                if (skipBlurRef.current) {
                                  skipBlurRef.current = false;
                                  return;
                                }
                                void commitCellEdit(rIdx, cIdx, editing.val);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  skipBlurRef.current = true;
                                  void commitCellEdit(rIdx, cIdx, editing.val);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  skipBlurRef.current = true;
                                  setEditing(null);
                                  setFormulaInput(getCellRawInput(cell));
                                }
                              }}
                              className="w-full h-5 bg-[var(--bg-canvas)] text-[var(--text-primary)] font-mono text-[12px] outline-none shadow-[inset_0_0_0_1px_var(--accent)] px-1"
                            />
                          ) : (
                            displayVal
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 底部 h-8 Sheet 切换栏 */}
      <div className="h-8 shrink-0 px-2 border-t border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex items-center justify-between gap-2 text-[11px] select-none">
        <div className="flex items-center gap-1 overflow-x-auto min-w-0">
          {inspect?.sheets.map((s) => {
            const active = activeSheet === s.name;
            return (
              <button
                key={s.name}
                type="button"
                onClick={() => {
                  setEditing(null);
                  setSelected({ r: 0, c: 0 });
                  setActiveSheet(s.name);
                }}
                className={`h-6 px-2.5 rounded inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  active
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-hairline)] font-medium"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent"
                }`}
              >
                <span>{s.name}</span>
                <span className="text-[10px] font-mono tabular-nums text-[var(--text-muted)]">
                  {s.rowCount}×{s.columnCount}
                </span>
              </button>
            );
          })}
        </div>
        <span className="text-[10px] font-mono text-[var(--text-muted)] whitespace-nowrap hidden sm:inline">
          双击或公式栏按 Enter 编辑
        </span>
      </div>
    </div>
  );
}
