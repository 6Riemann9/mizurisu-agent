import {
  Check,
  CheckCheck,
  Eye,
  FileDiff,
  FileMinus2,
  FilePlus2,
  FileText,
  Loader2,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { workspaceVfs } from "../../storage/workspace-vfs";
import { useAppStore } from "../../store/useAppStore";
import type { SessionFileChange } from "../../types";
import { computeLineDiff, isTextDiffablePath, type TextDiffResult } from "../../utils/text-diff";
import { Button, Dialog, Kbd, Tooltip, cn } from "../ui";

interface LoadedDiffPayload {
  kind: "text" | "binary";
  diff?: TextDiffResult;
  beforeSize?: number;
  afterSize?: number;
  missingSnapshotNote?: string;
}

const ACTION_BADGE_MAP: Record<
  SessionFileChange["action"],
  { label: string; cls: string; Icon: typeof FileText }
> = {
  created: {
    label: "新增",
    cls: "border-[var(--status-success)]/40 bg-[var(--status-success)]/10 text-[var(--status-success)]",
    Icon: FilePlus2,
  },
  modified: {
    label: "修改",
    cls: "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]",
    Icon: FileText,
  },
  deleted: {
    label: "删除",
    cls: "border-[var(--status-danger)]/40 bg-[var(--status-danger)]/10 text-[var(--status-danger)]",
    Icon: FileMinus2,
  },
};

export function DiffReviewModal() {
  const {
    diffReviewOpen,
    setDiffReviewOpen,
    sessions,
    activeSessionId,
    acceptSessionFileChange,
    acceptAllSessionFileChanges,
    revertSessionFileChange,
    revertAllSessionFileChanges,
    openPreview,
    pushToast,
  } = useAppStore();

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const fileChanges = useMemo(() => activeSession?.fileChanges || [], [activeSession?.fileChanges]);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [payload, setPayload] = useState<LoadedDiffPayload | null>(null);

  useEffect(() => {
    if (!diffReviewOpen) return;
    if (fileChanges.length === 0) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath || !fileChanges.some((fc) => fc.path === selectedPath)) {
      const firstUnreviewed = fileChanges.find((fc) => !fc.reviewed) ?? fileChanges[0];
      setSelectedPath(firstUnreviewed.path);
    }
  }, [diffReviewOpen, fileChanges, selectedPath]);

  const selectedChange = useMemo(
    () => fileChanges.find((fc) => fc.path === selectedPath) ?? null,
    [fileChanges, selectedPath]
  );

  useEffect(() => {
    if (!diffReviewOpen || !selectedChange) {
      setPayload(null);
      return;
    }
    let cancelled = false;
    setLoadingDiff(true);

    (async () => {
      try {
        let beforeBytes: Uint8Array | null = null;
        if (selectedChange.existedBefore && selectedChange.beforeSnapshotId) {
          const snaps = await workspaceVfs.getSnapshots(selectedChange.path);
          const matched = snaps.find((s) => s.id === selectedChange.beforeSnapshotId);
          if (matched) {
            beforeBytes = matched.data;
          }
        }

        let afterBytes: Uint8Array | null = null;
        if (selectedChange.action !== "deleted") {
          afterBytes = await workspaceVfs.readBytes(selectedChange.path).catch(() => null);
        }

        if (cancelled) return;

        if (isTextDiffablePath(selectedChange.path)) {
          const decoder = new TextDecoder("utf-8");
          const beforeText = beforeBytes
            ? decoder.decode(beforeBytes)
            : selectedChange.existedBefore
              ? ""
              : "";
          const afterText = afterBytes ? decoder.decode(afterBytes) : "";
          const missingSnapshotNote =
            selectedChange.existedBefore && !beforeBytes
              ? "（改前快照未命中，当前按空白基线对比新内容）"
              : undefined;
          setPayload({
            kind: "text",
            diff: computeLineDiff(beforeText, afterText),
            beforeSize: beforeBytes?.byteLength,
            afterSize: afterBytes?.byteLength,
            missingSnapshotNote,
          });
        } else {
          setPayload({
            kind: "binary",
            beforeSize: beforeBytes?.byteLength,
            afterSize: afterBytes?.byteLength,
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingDiff(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [diffReviewOpen, selectedChange]);

  const pendingCount = fileChanges.filter((fc) => !fc.reviewed).length;
  const activeCount = fileChanges.filter((fc) => fc.reviewed !== "reverted").length;

  const handleRevertOne = async (path: string) => {
    setBusyPath(path);
    try {
      await revertSessionFileChange(path);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusyPath(null);
    }
  };

  const handleRevertAll = async () => {
    setBusyPath("__ALL__");
    try {
      await revertAllSessionFileChanges();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusyPath(null);
    }
  };

  return (
    <Dialog
      open={diffReviewOpen}
      onClose={() => setDiffReviewOpen(false)}
      ariaLabel="本会话文件变更审查"
      className="w-full max-w-[920px] h-[min(78dvh,680px)] flex flex-col overflow-hidden"
    >
      {/* 顶栏 */}
      <header className="h-12 px-4 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileDiff className="w-4 h-4 text-[var(--accent)] shrink-0" />
          <h2 className="text-[13px] font-linear-semibold text-[var(--text-primary)] truncate">
            变更审查中心（Diff Review）
          </h2>
          <span className="text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-[var(--surface-subtle)] border border-[var(--border-hairline)] text-[var(--text-secondary)] shrink-0">
            {fileChanges.length} 个文件 · {pendingCount} 待审
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {activeCount > 0 && (
            <>
              <Button
                variant="secondary"
                size="xs"
                disabled={busyPath !== null}
                onClick={() => void handleRevertAll()}
                className="text-[11px] text-[var(--status-danger)] hover:border-[var(--status-danger)]/50"
              >
                <Undo2 className="w-3 h-3" />
                <span>全部回滚</span>
              </Button>
              <Button
                variant="primary"
                size="xs"
                disabled={busyPath !== null || pendingCount === 0}
                onClick={() => void acceptAllSessionFileChanges()}
                className="text-[11px]"
              >
                <CheckCheck className="w-3 h-3" />
                <span>全部保留</span>
              </Button>
            </>
          )}
          <Kbd keys="Escape" className="hidden sm:inline-flex" />
          <Tooltip content="关闭变更审查" shortcut="Escape" side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setDiffReviewOpen(false)}
              aria-label="关闭变更审查"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
        </div>
      </header>

      {/* 主分栏：左侧变更文件清单 + 右侧 Diff / 摘要对比 */}
      {fileChanges.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[var(--bg-canvas)]">
          <FileDiff className="w-8 h-8 text-[var(--text-muted)] mb-3 stroke-[1.5]" />
          <p className="text-[13px] font-linear-medium text-[var(--text-primary)]">
            当前会话暂无 Agent 文件变更记录
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-muted)] max-w-sm">
            当 Agent 在本会话中创建、编辑或删除工作区文件时，所有改动都会自动汇总到这里供您逐项 Diff 对比与一键回滚。
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row bg-[var(--bg-canvas)]">
          {/* 左侧文件列表 */}
          <aside className="w-full md:w-64 max-h-44 md:max-h-none overflow-y-auto border-b md:border-b-0 md:border-r border-[var(--border-hairline)] bg-[var(--bg-sidebar)] p-1.5 space-y-0.5 shrink-0">
            {fileChanges.map((fc) => {
              const selected = fc.path === selectedChange?.path;
              const badge = ACTION_BADGE_MAP[fc.action];
              return (
                <button
                  key={fc.path}
                  type="button"
                  onClick={() => setSelectedPath(fc.path)}
                  className={cn(
                    "w-full px-2 py-1.5 rounded-md text-left transition flex items-center justify-between gap-2 cursor-pointer",
                    selected
                      ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "text-[9.5px] px-1 py-px rounded border shrink-0 font-linear-medium",
                          badge.cls
                        )}
                      >
                        {badge.label}
                      </span>
                      <span className="font-mono text-[11.5px] truncate">
                        {fc.path.split("/").pop() || fc.path}
                      </span>
                    </div>
                    {fc.path.includes("/") && (
                      <div className="text-[10px] font-mono text-[var(--text-muted)] truncate mt-0.5">
                        {fc.path}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px]">
                    {fc.reviewed === "accepted" ? (
                      <span className="text-[var(--status-success)] font-linear-medium">
                        已留
                      </span>
                    ) : fc.reviewed === "reverted" ? (
                      <span className="text-[var(--text-muted)] line-through">已撤销</span>
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] inline-block" />
                    )}
                  </span>
                </button>
              );
            })}
          </aside>

          {/* 右侧详情区 */}
          {selectedChange && (
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
              {/* 文件头部信息 + 单文件保留/回滚 */}
              <div className="px-4 py-2.5 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[12px] font-linear-medium text-[var(--text-primary)] truncate">
                      {selectedChange.path}
                    </span>
                    {payload?.diff && (
                      <span className="font-mono tabular-nums text-[11px] shrink-0">
                        <span className="text-[var(--status-success)]">
                          +{payload.diff.additions}
                        </span>{" "}
                        <span className="text-[var(--status-danger)]">
                          -{payload.diff.deletions}
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] truncate">
                    工具：{selectedChange.toolName}
                    {selectedChange.summary ? ` · ${selectedChange.summary}` : ""}
                    {payload?.missingSnapshotNote ? ` ${payload.missingSnapshotNote}` : ""}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {selectedChange.action !== "deleted" &&
                    selectedChange.reviewed !== "reverted" && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          openPreview(selectedChange.path);
                          setDiffReviewOpen(false);
                        }}
                        className="text-[11px]"
                      >
                        <Eye className="w-3 h-3" />
                        <span>文档台打开</span>
                      </Button>
                    )}

                  {selectedChange.reviewed !== "reverted" && (
                    <Button
                      variant="secondary"
                      size="xs"
                      disabled={busyPath !== null}
                      onClick={() => void handleRevertOne(selectedChange.path)}
                      className="text-[11px] text-[var(--status-danger)]"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>
                        {selectedChange.existedBefore ? "回滚原版" : "删除新建文件"}
                      </span>
                    </Button>
                  )}

                  {!selectedChange.reviewed && (
                    <Button
                      variant="primary"
                      size="xs"
                      disabled={busyPath !== null}
                      onClick={() => void acceptSessionFileChange(selectedChange.path)}
                      className="text-[11px]"
                    >
                      <Check className="w-3 h-3" />
                      <span>保留</span>
                    </Button>
                  )}
                </div>
              </div>

              {/* Diff 内容视图 */}
              <div className="flex-1 min-h-0 overflow-auto p-3">
                {loadingDiff ? (
                  <div className="h-full flex items-center justify-center gap-2 text-[12px] text-[var(--text-muted)]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>正在对比改前快照与当前文件...</span>
                  </div>
                ) : payload?.kind === "text" && payload.diff ? (
                  <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] font-mono text-[11.5px] leading-[1.55] overflow-x-auto">
                    {payload.diff.truncated && (
                      <div className="px-3 py-1.5 border-b border-[var(--border-hairline)] bg-[var(--status-warning)]/10 text-[11px] text-[var(--status-warning)]">
                        文件变更行数较大，已自动切换为块级差异对照展示。
                      </div>
                    )}
                    {payload.diff.lines.length === 0 ? (
                      <div className="p-6 text-center text-[12px] text-[var(--text-muted)]">
                        文件内容无文本差异。
                      </div>
                    ) : (
                      payload.diff.lines.map((line, i) => (
                        <div
                          key={i}
                          className={cn(
                            "flex items-stretch px-2 min-w-max",
                            line.type === "add" &&
                              "bg-[var(--status-success)]/12 text-[var(--text-primary)]",
                            line.type === "del" &&
                              "bg-[var(--status-danger)]/12 text-[var(--text-primary)]"
                          )}
                        >
                          <span className="w-9 shrink-0 select-none text-right pr-2 text-[10.5px] text-[var(--text-dim)] tabular-nums">
                            {line.oldLineNo ?? ""}
                          </span>
                          <span className="w-9 shrink-0 select-none text-right pr-2 text-[10.5px] text-[var(--text-dim)] tabular-nums border-r border-[var(--border-hairline)]/60">
                            {line.newLineNo ?? ""}
                          </span>
                          <span
                            className={cn(
                              "w-5 shrink-0 select-none text-center font-bold",
                              line.type === "add"
                                ? "text-[var(--status-success)]"
                                : line.type === "del"
                                  ? "text-[var(--status-danger)]"
                                  : "text-transparent"
                            )}
                          >
                            {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                          </span>
                          <span className="whitespace-pre pr-4">{line.text}</span>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 space-y-3 text-[12px]">
                    <div className="font-linear-medium text-[var(--text-primary)]">
                      富文档 / 二进制 Office 变更摘要
                    </div>
                    <p className="text-[var(--text-secondary)] leading-relaxed">
                      该文件为 Office 二进制或复合排版格式（{selectedChange.path}），请在右侧文档台查看可视化排版效果，或点击右上角随时一键回滚。
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-[11px] font-mono">
                      <div className="p-2.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-canvas)]">
                        <div className="text-[var(--text-muted)]">变更类型</div>
                        <div className="mt-0.5 text-[var(--text-primary)]">
                          {ACTION_BADGE_MAP[selectedChange.action].label}
                        </div>
                      </div>
                      <div className="p-2.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-canvas)]">
                        <div className="text-[var(--text-muted)]">修改前体积</div>
                        <div className="mt-0.5 text-[var(--text-primary)] tabular-nums">
                          {payload?.beforeSize !== undefined
                            ? `${(payload.beforeSize / 1024).toFixed(1)} KB`
                            : selectedChange.existedBefore
                              ? "未知"
                              : "无（新建）"}
                        </div>
                      </div>
                      <div className="p-2.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-canvas)]">
                        <div className="text-[var(--text-muted)]">修改后体积</div>
                        <div className="mt-0.5 text-[var(--text-primary)] tabular-nums">
                          {payload?.afterSize !== undefined
                            ? `${(payload.afterSize / 1024).toFixed(1)} KB`
                            : "已删除"}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
