import { ShieldAlert } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { Button, Dialog } from "../ui";

export function ApprovalDialog() {
  const { pendingApproval, resolveApproval } = useAppStore();

  return (
    <Dialog
      open={Boolean(pendingApproval)}
      onClose={() => resolveApproval(false)}
      closeOnBackdrop={false}
      ariaLabel={pendingApproval?.title || "高风险操作审批"}
      className="w-full max-w-md overflow-hidden"
    >
      {pendingApproval && (
        <>
          <div className="px-4 py-3 border-b border-[var(--border-hairline)] flex items-center gap-2.5 bg-[var(--bg-surface)]">
            <div className="w-8 h-8 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--status-warning)] flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[13px] font-linear-semibold text-[var(--text-primary)] truncate">
                {pendingApproval.title}
              </h3>
              <p className="text-[11px] font-mono text-[var(--text-muted)] truncate">
                {pendingApproval.toolName}
              </p>
            </div>
          </div>

          <div className="p-4 space-y-3 bg-[var(--bg-surface)]">
            <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
              {pendingApproval.description}
            </p>
            <pre className="p-3 rounded-md bg-[var(--bg-canvas)] border border-[var(--border-hairline)] text-[11px] font-mono text-[var(--text-primary)] overflow-x-auto max-h-48">
              {pendingApproval.argsPreview}
            </pre>
          </div>

          <div className="px-4 py-2.5 bg-[var(--bg-sidebar)] border-t border-[var(--border-hairline)] flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => resolveApproval(false)}
              className="text-[12px]"
            >
              拒绝
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => resolveApproval(true)}
              className="text-[12px]"
            >
              允许执行
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
