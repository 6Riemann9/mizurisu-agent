import { CheckSquare, CircleHelp } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { Button, Dialog, cn } from "../ui";

export function QuestionnaireDialog() {
  const { pendingQuestionnaire, resolveQuestionnaire } = useAppStore();
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!pendingQuestionnaire) {
      setSelections({});
      setCustomInputs({});
      return;
    }
    const initial: Record<string, string[]> = {};
    for (const q of pendingQuestionnaire.questions) {
      initial[q.id] = [];
    }
    setSelections(initial);
    setCustomInputs({});
  }, [pendingQuestionnaire]);

  const toggleOption = (qId: string, option: string, multiSelect?: boolean) => {
    setSelections((prev) => {
      const current = prev[qId] || [];
      if (!multiSelect) {
        return { ...prev, [qId]: [option] };
      }
      const exists = current.includes(option);
      return {
        ...prev,
        [qId]: exists ? current.filter((x) => x !== option) : [...current, option],
      };
    });
  };

  const handleSubmit = () => {
    if (!pendingQuestionnaire) return;
    const result: Record<string, string[]> = {};
    for (const q of pendingQuestionnaire.questions) {
      const picked = [...(selections[q.id] || [])];
      const extra = (customInputs[q.id] || "").trim();
      if (extra) {
        picked.push(extra);
      }
      result[q.id] = picked;
    }
    resolveQuestionnaire(result);
  };

  return (
    <Dialog
      open={Boolean(pendingQuestionnaire)}
      onClose={() => resolveQuestionnaire(null)}
      closeOnBackdrop={false}
      ariaLabel={pendingQuestionnaire?.title || "请补充确认细节"}
      className="w-full max-w-lg max-h-[82dvh] flex flex-col overflow-hidden"
    >
      {pendingQuestionnaire && (
        <>
          <div className="px-4 py-3 border-b border-[var(--border-hairline)] flex items-center gap-2.5 bg-[var(--bg-surface)] shrink-0">
            <div className="w-8 h-8 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--accent)] flex items-center justify-center shrink-0">
              <CircleHelp className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[13px] font-linear-semibold text-[var(--text-primary)] truncate">
                {pendingQuestionnaire.title || "请补充确认细节"}
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] truncate">
                点选偏好后，Agent 将按你的确认直接输出成品
              </p>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-[var(--bg-surface)]">
            {pendingQuestionnaire.questions.map((q, idx) => {
              const picked = selections[q.id] || [];
              return (
                <div
                  key={q.id}
                  className="p-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-2.5"
                >
                  <div className="text-[12.5px] font-linear-medium text-[var(--text-primary)] flex items-start gap-1.5">
                    <span className="font-mono text-[11px] text-[var(--text-muted)] mt-0.5 shrink-0">
                      {idx + 1}.
                    </span>
                    <span>
                      {q.question}
                      {q.multiSelect && (
                        <span className="ml-1.5 text-[10.5px] text-[var(--text-muted)] font-normal">
                          (可多选)
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {q.options.map((opt) => {
                      const active = picked.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => toggleOption(q.id, opt, q.multiSelect)}
                          aria-pressed={active}
                          className={cn(
                            "px-2.5 py-2 rounded-md border text-left text-[12px] flex items-center gap-2 transition cursor-pointer linear-focus-ring",
                            active
                              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)] font-linear-medium"
                              : "border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]"
                          )}
                        >
                          <CheckSquare
                            className={cn(
                              "w-3.5 h-3.5 shrink-0",
                              active ? "text-[var(--accent)]" : "text-[var(--text-muted)]/60"
                            )}
                          />
                          <span className="leading-snug">{opt}</span>
                        </button>
                      );
                    })}
                  </div>

                  <input
                    type="text"
                    value={customInputs[q.id] || ""}
                    onChange={(e) =>
                      setCustomInputs((prev) => ({ ...prev, [q.id]: e.target.value }))
                    }
                    placeholder="其他补充说明（可选）..."
                    className="w-full h-7 px-2.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[11.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-strong)] linear-focus-ring"
                  />
                </div>
              );
            })}
          </div>

          <div className="px-4 py-2.5 bg-[var(--bg-sidebar)] border-t border-[var(--border-hairline)] flex items-center justify-end gap-2 shrink-0">
            <Button
              variant="secondary"
              size="md"
              onClick={() => resolveQuestionnaire(null)}
              className="text-[12px]"
            >
              跳过
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleSubmit}
              className="text-[12px]"
            >
              确认并继续
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
