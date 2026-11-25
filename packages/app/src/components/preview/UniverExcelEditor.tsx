import {
  CommandType,
  createUniver,
  defaultTheme,
  LocaleType,
  mergeLocales,
  type IDisposable,
  type IExecutionOptions,
} from "@univerjs/presets";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import UniverPresetSheetsConditionalFormattingZhCN from "@univerjs/preset-sheets-conditional-formatting/locales/zh-CN";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import UniverPresetSheetsFilterZhCN from "@univerjs/preset-sheets-filter/locales/zh-CN";
import "@univerjs/preset-sheets-filter/lib/index.css";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import UniverPresetSheetsFindReplaceZhCN from "@univerjs/preset-sheets-find-replace/locales/zh-CN";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import UniverPresetSheetsSortZhCN from "@univerjs/preset-sheets-sort/locales/zh-CN";
import "@univerjs/preset-sheets-sort/lib/index.css";
import { AlertCircle, CheckCircle2, Download, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { exportSheetToCsv } from "../../office";
import {
  excelBytesToUniverWorkbook,
  univerWorkbookToExcelBytes,
} from "../../office/univer-bridge";
import { getPlatformAdapter } from "../../platform";
import { workspaceVfs } from "../../storage/workspace-vfs";
import { useAppStore } from "../../store/useAppStore";

type SaveState = "saved" | "dirty" | "saving";

/** 无需触发脏状态或自动保存的内部视图/自动排版变更 ID */
const IGNORED_SHEET_MUTATIONS = new Set([
  "sheet.mutation.set-worksheet-row-auto-height",
  "sheet.mutation.set-worksheet-row-is-auto-height",
  "sheet.mutation.mark-dirty-filter-change",
  "sheet.mutation.data-validation-formula-mark-dirty",
  "sheet.mutation.register-worksheet-range-theme-style",
  "sheet.mutation.unregister-worksheet-range-theme-style",
]);

/** 判断 CommandExecuted 事件是否代表用户对工作簿数据的实质修改 */
function isUserDataMutationEvent(ev: {
  id: string;
  type: CommandType;
  options?: IExecutionOptions;
}): boolean {
  if (ev.type === CommandType.OPERATION) return false;
  if (ev.type !== CommandType.MUTATION) return false;
  if (!ev.id.startsWith("sheet.mutation.")) return false;
  if (IGNORED_SHEET_MUTATIONS.has(ev.id)) return false;
  // 忽略公式引擎回填计算结果产生的内部变更，避免打开文件即误报未保存
  if (ev.options?.fromFormula || ev.options?.applyFormulaCalculationResult) {
    return false;
  }
  return true;
}

/** 计算字节序列轻量指纹，用于精准区分自身保存回流与外部文件修改 */
function computeBytesSignature(bytes: Uint8Array): string {
  let hash1 = 0x811c9dc5;
  let hash2 = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    hash1 = Math.imul(hash1 ^ b, 0x01000193) >>> 0;
    hash2 = Math.imul(hash2 ^ (b + i), 0x85ebca6b) >>> 0;
  }
  return `${bytes.byteLength}:${hash1.toString(16)}:${hash2.toString(16)}`;
}

export function UniverExcelEditor({
  path,
  bytes,
}: {
  path: string;
  bytes: Uint8Array;
}) {
  const theme = useAppStore((s) => s.settings.theme);

  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const univerApiRef = useRef<ReturnType<typeof createUniver>["univerAPI"] | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const pathRef = useRef(path);
  const bytesRef = useRef(bytes);
  bytesRef.current = bytes;

  /** 记录最近一次自身写回的路径与字节指纹，避免 VFS 回流引发实例重建 */
  const lastSelfSavedHashRef = useRef<string | null>(null);
  const pendingOrLoadedSigRef = useRef<string | null>(null);
  const isHydratingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editSeqRef = useRef(0);
  const loadSeqRef = useRef(0);
  const saveInFlightRef = useRef<Promise<void> | null>(null);

  /** 将当前 Univer 工作簿快照串行化并写回工作区 VFS */
  const saveWorkbook = useCallback(
    async (targetRawPath: string, commitActiveEdit: boolean) => {
      const univerAPI = univerApiRef.current;
      if (!univerAPI) return;
      const activeWb = univerAPI.getActiveWorkbook();
      if (!activeWb) return;

      // 显式保存时先提交仍在浮层输入中的单元格编辑
      if (
        commitActiveEdit &&
        typeof activeWb.isCellEditing === "function" &&
        activeWb.isCellEditing()
      ) {
        await activeWb.endEditingAsync(true);
      }

      const executeSave = async () => {
        const currentWb = univerApiRef.current?.getActiveWorkbook();
        if (!currentWb) return;

        const seqAtStart = editSeqRef.current;
        setSaveState("saving");
        setError(null);

        try {
          const snapshot = currentWb.save();
          const nextBytes = await univerWorkbookToExcelBytes(snapshot);
          const targetPath = targetRawPath.toLowerCase().endsWith(".xlsx")
            ? targetRawPath
            : `${targetRawPath.replace(/\.[^.]+$/, "")}.xlsx`;

          const sig = `${targetPath}::${computeBytesSignature(nextBytes)}`;
          lastSelfSavedHashRef.current = sig;
          pendingOrLoadedSigRef.current = sig;

          await workspaceVfs.writeBytes(targetPath, nextBytes, {
            snapshotNote: "表格编辑保存",
          });

          if (targetPath !== targetRawPath) {
            pathRef.current = targetPath;
            useAppStore.getState().openPreview(targetPath);
          }

          if (editSeqRef.current === seqAtStart) {
            setSaveState("saved");
          } else {
            setSaveState("dirty");
          }
        } catch (err) {
          setSaveState("dirty");
          setError(err instanceof Error ? err.message : String(err));
        }
      };

      const prev = saveInFlightRef.current ?? Promise.resolve();
      const next = prev.then(executeSave, executeSave);
      saveInFlightRef.current = next;
      await next;
    },
    []
  );

  // 初始化唯一的 Univer 实例并绑定命令变更监听（兼容 React 19 StrictMode）
  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;

    let cancelled = false;
    let disposable: IDisposable | null = null;

    const hostEl = document.createElement("div");
    hostEl.className = "w-full h-full";
    containerEl.appendChild(hostEl);

    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ZH_CN,
      locales: {
        [LocaleType.ZH_CN]: mergeLocales(
          UniverPresetSheetsCoreZhCN,
          UniverPresetSheetsFilterZhCN,
          UniverPresetSheetsSortZhCN,
          UniverPresetSheetsFindReplaceZhCN,
          UniverPresetSheetsConditionalFormattingZhCN
        ),
      },
      theme: defaultTheme,
      darkMode: themeRef.current === "dark",
      presets: [
        UniverSheetsCorePreset({
          container: hostEl,
          header: true,
          toolbar: true,
          footer: {
            sheetBar: true,
            statisticBar: true,
            menus: true,
            zoomSlider: true,
          },
          formulaBar: true,
          ribbonType: "simple",
        }),
        UniverSheetsFilterPreset(),
        UniverSheetsSortPreset(),
        UniverSheetsFindReplacePreset(),
        UniverSheetsConditionalFormattingPreset(),
      ],
    });

    univerApiRef.current = univerAPI;

    disposable = univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
      if (cancelled || isHydratingRef.current) return;
      if (!isUserDataMutationEvent(event)) return;

      editSeqRef.current += 1;
      setSaveState("dirty");

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      const currentPath = pathRef.current;
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void saveWorkbook(currentPath, false);
      }, 800);
    });

    const initialPath = pathRef.current;
    const initialBytes = bytesRef.current;
    const initialSig = `${initialPath}::${computeBytesSignature(initialBytes)}`;
    pendingOrLoadedSigRef.current = initialSig;
    const loadSeq = ++loadSeqRef.current;

    (async () => {
      try {
        const workbookData = await excelBytesToUniverWorkbook(initialBytes, initialPath);
        if (cancelled || loadSeq !== loadSeqRef.current) return;

        isHydratingRef.current = true;
        try {
          univerAPI.createWorkbook(workbookData);
        } finally {
          isHydratingRef.current = false;
        }
        setSaveState("saved");
        setError(null);
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          pendingOrLoadedSigRef.current = null;
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      pendingOrLoadedSigRef.current = null;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (univerApiRef.current === univerAPI) {
        univerApiRef.current = null;
      }
      // 隐藏待销毁容器并延迟至微任务清理，满足 React 19 StrictMode 卸载约束
      hostEl.style.display = "none";
      queueMicrotask(() => {
        disposable?.dispose();
        univer.dispose();
        hostEl.remove();
        if (typeof document !== "undefined") {
          document.documentElement.classList.remove("univer-dark");
        }
      });
    };
  }, [saveWorkbook]);

  // 切换主题时实时联动 Univer 暗黑/浅色模式
  useEffect(() => {
    const univerAPI = univerApiRef.current;
    if (!univerAPI) return;
    univerAPI.toggleDarkMode(theme === "dark");
  }, [theme]);

  // 监听宿主容器尺寸变化（分栏拖拽 / 展开全屏），触发 Univer 画布重排铺满
  useEffect(() => {
    const container = containerRef.current;
    if (!ready || !container) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    let lastWidth = container.clientWidth;
    let lastHeight = container.clientHeight;

    const scheduleResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          window.dispatchEvent(new Event("resize"));
        });
      }, 50);
    };

    // 初始化就绪或刚切换到全屏容器后，主动触发一次延时重排
    scheduleResize();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (!rect) return;
            if (Math.abs(rect.width - lastWidth) > 1 || Math.abs(rect.height - lastHeight) > 1) {
              lastWidth = rect.width;
              lastHeight = rect.height;
              scheduleResize();
            }
          })
        : null;

    observer?.observe(container);

    return () => {
      observer?.disconnect();
      if (timer) clearTimeout(timer);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [ready]);

  // 响应外部文件切换、Agent 修改或快照回滚，跳过自身保存触发的回流
  useEffect(() => {
    const univerAPI = univerApiRef.current;
    if (!univerAPI) return;

    const incomingSig = `${path}::${computeBytesSignature(bytes)}`;

    if (lastSelfSavedHashRef.current === incomingSig) {
      pathRef.current = path;
      pendingOrLoadedSigRef.current = incomingSig;
      return;
    }

    if (pendingOrLoadedSigRef.current === incomingSig) {
      return;
    }

    pathRef.current = path;
    pendingOrLoadedSigRef.current = incomingSig;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const loadSeq = ++loadSeqRef.current;
    let cancelled = false;

    (async () => {
      try {
        const workbookData = await excelBytesToUniverWorkbook(bytes, path);
        if (cancelled || loadSeq !== loadSeqRef.current) return;

        isHydratingRef.current = true;
        try {
          const prevWb = univerAPI.getActiveWorkbook();
          if (prevWb) {
            univerAPI.disposeUnit(prevWb.getId());
          }
          univerAPI.createWorkbook(workbookData);
        } finally {
          isHydratingRef.current = false;
        }

        lastSelfSavedHashRef.current = null;
        setSaveState("saved");
        setError(null);
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          pendingOrLoadedSigRef.current = null;
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path, bytes]);

  const handleManualSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void saveWorkbook(pathRef.current, true);
  }, [saveWorkbook]);

  const handleKeyDownCapture = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      handleManualSave();
    }
  };

  const handleExportCsv = async () => {
    if (exportingCsv) return;
    setExportingCsv(true);
    setError(null);
    try {
      const univerAPI = univerApiRef.current;
      const wb = univerAPI?.getActiveWorkbook();
      let sourceBytes = bytesRef.current;
      let activeSheetName: string | undefined;

      if (wb) {
        if (typeof wb.isCellEditing === "function" && wb.isCellEditing()) {
          await wb.endEditingAsync(true);
        }
        activeSheetName = wb.getActiveSheet()?.getSheetName() || undefined;
        sourceBytes = await univerWorkbookToExcelBytes(wb.save());
      }

      const targetFilename = pathRef.current.toLowerCase().endsWith(".xlsx")
        ? pathRef.current
        : `${pathRef.current.replace(/\.[^.]+$/, "")}.xlsx`;
      const csv = await exportSheetToCsv(sourceBytes, activeSheetName, targetFilename);
      const data = new TextEncoder().encode("\uFEFF" + csv);
      await getPlatformAdapter().exportFile(
        `${pathRef.current.replace(/\.[^.]+$/, "")}_${activeSheetName || "sheet"}.csv`,
        data,
        "text/csv;charset=utf-8"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingCsv(false);
    }
  };

  return (
    <div
      onKeyDownCapture={handleKeyDownCapture}
      className="flex flex-col h-full min-h-0 w-full bg-[var(--bg-canvas)]"
    >
      {/* 顶部辅助状态栏 */}
      <div className="h-7 shrink-0 px-2.5 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between gap-2 text-[11px] select-none">
        <div className="flex items-center gap-2 min-w-0">
          {saveState === "saving" ? (
            <span className="inline-flex items-center gap-1 text-[var(--accent)] font-medium whitespace-nowrap">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>正在保存…</span>
            </span>
          ) : saveState === "dirty" ? (
            <span className="inline-flex items-center gap-1 text-[var(--status-warning)] font-medium whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-warning)]" />
              <span>有未保存修改</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[var(--text-secondary)] whitespace-nowrap">
              <CheckCircle2 className="w-3 h-3 text-[var(--status-success)]" />
              <span>已保存</span>
            </span>
          )}

          <span className="text-[10px] text-[var(--text-muted)] truncate hidden sm:inline">
            支持公式计算 · 筛选排序 · 查找替换 · 条件格式
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={!ready || saveState === "saving"}
            onClick={handleManualSave}
            className="h-5 inline-flex items-center gap-1 px-2 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[10.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-45 cursor-pointer"
            title="立即保存工作簿到工作区 (Ctrl+S)"
          >
            <Save className="w-2.5 h-2.5" />
            <span>保存 (Ctrl+S)</span>
          </button>

          <button
            type="button"
            disabled={!ready || exportingCsv}
            onClick={() => void handleExportCsv()}
            className="h-5 inline-flex items-center gap-1 px-2 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[10.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-45 cursor-pointer"
            title="将当前工作表导出为 CSV"
          >
            {exportingCsv ? (
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <Download className="w-2.5 h-2.5" />
            )}
            <span>导出 CSV</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-1.5 shrink-0 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[11px] text-[var(--status-danger)] flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate" title={error}>
            表格处理异常：{error}
          </span>
        </div>
      )}

      {/* Univer 电子表格渲染容器（tabIndex={-1} 确保点击 Canvas 单元格时焦点留在宿主容器内） */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden">
        <div
          ref={containerRef}
          tabIndex={-1}
          className="univer-host-container h-full w-full outline-none"
        />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-canvas)]/85 text-xs text-[var(--text-muted)] gap-2 pointer-events-none">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
            <span>正在初始化专业电子表格引擎…</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default UniverExcelEditor;
