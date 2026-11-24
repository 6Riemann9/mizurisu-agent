import { ShieldAlert } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";

export function ApprovalDialog() {
  const { pendingApproval, resolveApproval } = useAppStore();
  if (!pendingApproval) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[0_24px_64px_rgba(0,0,0,0.6)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border-hairline)] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--status-warning)] flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
              {pendingApproval.title}
            </h3>
            <p className="text-[11px] font-mono text-[var(--text-muted)] truncate">
              {pendingApproval.toolName}
            </p>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
            {pendingApproval.description}
          </p>
          <pre className="p-3 rounded-md bg-[var(--bg-canvas)] border border-[var(--border-hairline)] text-[11px] font-mono text-[var(--text-primary)] overflow-x-auto max-h-48">
            {pendingApproval.argsPreview}
          </pre>
        </div>

        <div className="px-4 py-2.5 bg-[var(--bg-sidebar)] border-t border-[var(--border-hairline)] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => resolveApproval(false)}
            className="h-8 px-3 rounded-md text-[12px] font-medium border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition cursor-pointer"
          >
            拒绝
          </button>
          <button
            type="button"
            onClick={() => resolveApproval(true)}
            className="h-8 px-3 rounded-md text-[12px] font-medium bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition cursor-pointer"
          >
            允许执行
          </button>
        </div>
      </div>
    </div>
  );
}
