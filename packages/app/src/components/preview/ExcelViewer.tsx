import { Download, Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";
import { useAppStore } from "../../store/useAppStore";
import { ErrorBoundary } from "../common/ErrorBoundary";

const UniverExcelEditor = lazy(() => import("./UniverExcelEditor"));

/** 电子表格预览与编辑入口：按需懒加载 Univer 引擎并提供外层错误边界保护 */
export function ExcelViewer({
  path,
  bytes,
}: {
  path: string;
  bytes: Uint8Array;
}) {
  const exportWorkspaceFile = useAppStore((s) => s.exportWorkspaceFile);

  return (
    <ErrorBoundary
      scope="panel"
      title="电子表格渲染异常"
      resetKey={path}
      fallbackActions={
        <button
          type="button"
          onClick={() => void exportWorkspaceFile(path)}
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-active)] text-xs font-medium text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
          <span>导出原表格</span>
        </button>
      }
    >
      <Suspense
        fallback={
          <div className="h-full w-full flex flex-col items-center justify-center gap-2.5 bg-[var(--bg-canvas)] text-xs text-[var(--text-muted)] select-none">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
            <span>正在加载电子表格引擎…</span>
          </div>
        }
      >
        <UniverExcelEditor path={path} bytes={bytes} />
      </Suspense>
    </ErrorBoundary>
  );
}
