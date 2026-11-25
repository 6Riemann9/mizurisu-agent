import { ArrowRightLeft, ExternalLink, Gauge } from "lucide-react";
import { useMemo } from "react";
import { estimateTokenBurden } from "../../agent/extensions";
import { getMizurisuConsoleLinks, inferModelMetadata } from "../../newapi/client";
import { useAppStore } from "../../store/useAppStore";
import { Button, Tooltip, cn } from "../ui";

export function TokenBurdenBar() {
  const {
    config,
    models,
    sessions,
    activeSessionId,
    tokenBurden,
    billing,
    settings,
    isStreaming,
    handoffActiveSession,
  } = useAppStore();

  const pluginEnabled = settings.enabledPlugins?.["pi-token-burden"] !== false;
  const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];

  const report = useMemo(() => {
    if (tokenBurden && session?.messages.length) return tokenBurden;
    if (!session || session.messages.length === 0) return null;

    const modelInfo =
      models.find((m) => m.id === config.selectedModelId) ??
      inferModelMetadata(config.selectedModelId || "gpt-4o", config);

    const historyText = session.messages
      .map((m) => `${m.content || ""}\n${m.thinking || ""}`)
      .join("\n");

    return estimateTokenBurden({
      systemPrompt: historyText.slice(0, 600),
      tools: [],
      historyMessages: [
        { role: "user", content: historyText, timestamp: session.updatedAt },
      ],
      uiMessages: session.messages,
      contextWindow: modelInfo.contextWindow,
      modelId: modelInfo.id,
    });
  }, [tokenBurden, session, models, config]);

  if (!pluginEnabled || !report || !session || session.messages.length === 0) {
    return null;
  }

  const isWarning = report.usagePercent >= 75;
  const isDanger = report.usagePercent >= 90;
  const lowBalance =
    billing?.supported &&
    typeof billing.remainingUsd === "number" &&
    billing.remainingUsd < 1;

  const consoleLinks = getMizurisuConsoleLinks(config.baseUrl);
  const detailText = `系统提示词 ~${report.systemPromptTokens.toLocaleString()} · 工具 ~${report.toolSchemaTokens.toLocaleString()} · 历史 ~${report.historyTokens.toLocaleString()} / 裁剪预算 ${report.budgetLimit.toLocaleString()} tokens（费用为按公开参考价估算，实际以中转站扣费为准）`;

  return (
    <div className="mb-1.5 px-2.5 py-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)]/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
      <div className="flex items-center gap-2 min-w-0">
        <Tooltip content={detailText} side="top">
          <div className="flex items-center gap-1.5 cursor-default">
            <Gauge
              className={cn(
                "w-3.5 h-3.5 shrink-0",
                isDanger
                  ? "text-[var(--status-danger)]"
                  : isWarning
                    ? "text-[var(--status-warning)]"
                    : "text-[var(--text-muted)]"
              )}
            />
            <span className="tabular-nums font-mono">
              上下文 {report.usagePercent}%
            </span>
            <span className="w-16 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden hidden sm:inline-block">
              <span
                className={cn(
                  "block h-full transition-all duration-200",
                  isDanger
                    ? "bg-[var(--status-danger)]"
                    : isWarning
                      ? "bg-[var(--status-warning)]"
                      : "bg-[var(--accent)]"
                )}
                style={{ width: `${Math.min(100, Math.max(4, report.usagePercent))}%` }}
              />
            </span>
          </div>
        </Tooltip>

        {report.estimatedSessionCostUsd > 0 && (
          <span className="font-mono tabular-nums text-[10.5px] text-[var(--text-secondary)]">
            · 估算消耗 ${report.estimatedSessionCostUsd.toFixed(4)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isWarning && !isStreaming && settings.enabledPlugins?.["pi-handoff"] !== false && (
          <Tooltip content="提炼当前进展并开启干净新会话，避免上下文超限变慢或遗忘" side="top">
            <Button
              variant="secondary"
              size="xs"
              onClick={() => void handoffActiveSession()}
              className="h-5 px-1.5 text-[10.5px]"
            >
              <ArrowRightLeft className="w-3 h-3 text-[var(--accent)]" />
              <span>接力新会话</span>
            </Button>
          </Tooltip>
        )}

        {lowBalance && (
          <a
            href={consoleLinks.topupUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 h-5 px-1.5 rounded border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 text-[10.5px] text-[var(--status-warning)] hover:bg-[var(--status-warning)]/20 transition"
          >
            <span>余额偏低，去充值</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}
