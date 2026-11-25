import { CheckCircle2, ChevronDown, ChevronRight, Circle, Loader2, ListTodo, XCircle } from "lucide-react";
import { useState } from "react";
import type { TodoItem } from "../../types";
import { cn } from "../ui";

export function TodoBoard({ todos }: { todos?: TodoItem[] }) {
  const [expanded, setExpanded] = useState(false);

  if (!todos || todos.length === 0) return null;

  const activeItems = todos.filter((t) => t.status !== "cancelled");
  if (activeItems.length === 0) return null;

  const doneCount = activeItems.filter((t) => t.status === "completed").length;
  const currentTask =
    activeItems.find((t) => t.status === "in_progress") ||
    activeItems.find((t) => t.status === "pending");

  return (
    <div className="mb-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-hidden text-[12px]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full h-8 px-3 flex items-center justify-between gap-2 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer linear-focus-ring"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ListTodo className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
          <span className="font-linear-medium text-[var(--text-primary)] shrink-0">
            任务清单
          </span>
          <span className="font-mono tabular-nums text-[11px] px-1.5 py-px rounded bg-[var(--surface-subtle)] border border-[var(--border-hairline)] text-[var(--text-secondary)] shrink-0">
            {doneCount}/{activeItems.length}
          </span>
          {currentTask && !expanded && (
            <span className="text-[11.5px] text-[var(--text-muted)] truncate">
              正在推进：{currentTask.content}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 pt-1 border-t border-[var(--border-hairline)] space-y-1 max-h-40 overflow-y-auto">
          {todos.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-2 py-0.5 text-[11.5px] leading-snug"
            >
              {item.status === "completed" ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[var(--status-success)] shrink-0 mt-0.5" />
              ) : item.status === "in_progress" ? (
                <Loader2 className="w-3.5 h-3.5 text-[var(--accent)] animate-spin shrink-0 mt-0.5" />
              ) : item.status === "cancelled" ? (
                <XCircle className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0 mt-0.5" />
              ) : (
                <Circle className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0 mt-0.5" />
              )}
              <span
                className={cn(
                  "min-w-0",
                  item.status === "completed" || item.status === "cancelled"
                    ? "line-through text-[var(--text-muted)]"
                    : "text-[var(--text-primary)]"
                )}
              >
                {item.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
