import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import type { ToastItem } from "../../types";

const LEVEL_STYLES: Record<
  ToastItem["level"],
  { borderClass: string; iconClass: string; Icon: typeof Info }
> = {
  info: {
    borderClass: "border-l-[var(--accent)]",
    iconClass: "text-[var(--accent)]",
    Icon: Info,
  },
  success: {
    borderClass: "border-l-[var(--status-success)]",
    iconClass: "text-[var(--status-success)]",
    Icon: CheckCircle2,
  },
  warning: {
    borderClass: "border-l-[var(--status-warning)]",
    iconClass: "text-[var(--status-warning)]",
    Icon: AlertTriangle,
  },
  error: {
    borderClass: "border-l-[var(--status-danger)]",
    iconClass: "text-[var(--status-danger)]",
    Icon: AlertCircle,
  },
};

/**
 * 全局轻提示宿主：在顶栏下方右上角展示操作反馈，避开移动端底栏与对话输入区
 */
export function ToastHost() {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed top-14 right-3 left-3 sm:left-auto sm:right-4 sm:w-80 z-[70] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const { borderClass, iconClass, Icon } = LEVEL_STYLES[toast.level];
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto rounded-lg border border-[var(--border-strong)] border-l-2 ${borderClass} bg-[var(--bg-surface)] shadow-[0_10px_28px_rgba(0,0,0,0.32)] px-3 py-2.5 flex items-start gap-2.5 text-[12px]`}
          >
            <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconClass}`} />
            <span className="flex-1 min-w-0 text-[var(--text-primary)] leading-snug break-words">
              {toast.message}
            </span>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="关闭提示"
              className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer mt-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
