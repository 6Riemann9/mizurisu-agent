import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { Check, ChevronDown, Compass, Cpu, Flame, PenLine, Search, Shield, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PERMISSION_MODE_META, PERMISSION_MODE_ORDER } from "../../agent/permission";
import { PROVIDER_GROUP_LABELS, inferModelMetadata } from "../../newapi/client";
import { useAppStore } from "../../store/useAppStore";
import type { ModelInfo, PermissionMode, ProviderGroup } from "../../types";
import { Button, Kbd, Tooltip, cn } from "../ui";

const THINKING_OPTIONS: Array<{ value: ThinkingLevel; label: string; desc: string }> = [
  { value: "off", label: "关闭", desc: "直接响应" },
  { value: "low", label: "低", desc: "轻量推理" },
  { value: "medium", label: "中", desc: "均衡深度" },
  { value: "high", label: "高", desc: "深度思考" },
];

const PROVIDER_GROUP_ORDER: ProviderGroup[] = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "qwen",
  "xai",
  "mistral",
  "meta",
  "other",
];

/** 提取模型展示徽标（最多保留 2 个紧凑标签，避免底部浮层拥挤） */
function getModelCompactBadges(model: ModelInfo): string[] {
  if (model.tags && model.tags.length > 0) {
    return model.tags.slice(0, 2);
  }
  const tags: string[] = [];
  if (model.isChatCapable === false) {
    tags.push("非对话");
  } else {
    if (model.recommended) tags.push("推荐");
    if (model.supportsReasoning) tags.push("推理");
    if (model.supportsVision) tags.push("视觉");
    if (model.contextWindow >= 200000) tags.push("长文本");
  }
  return tags.slice(0, 2);
}

/** 单个模型条目：支持能力徽标与星标收藏切换 */
function ModelOptionRow({
  model,
  active,
  favorited,
  onSelect,
  onToggleFavorite,
}: {
  model: ModelInfo;
  active: boolean;
  favorited: boolean;
  onSelect: (modelId: string) => void;
  onToggleFavorite: (modelId: string) => void;
}) {
  const badges = getModelCompactBadges(model);

  return (
    <div
      className={cn(
        "group w-full min-h-[28px] px-1.5 rounded-md flex items-center justify-between gap-1.5 transition-colors duration-150",
        active
          ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-linear-medium"
          : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(model.id)}
        className="flex-1 min-w-0 h-7 px-1 text-left text-[12px] flex items-center justify-between gap-2 cursor-pointer linear-focus-ring rounded"
      >
        <span className="font-mono truncate">{model.id}</span>
        <span className="flex items-center gap-1 shrink-0">
          {badges.map((badge) => (
            <span
              key={badge}
              className={cn(
                "text-[10px] px-1.5 py-px rounded border leading-tight",
                badge === "推荐"
                  ? "border-[var(--accent)]/35 bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-muted)]"
              )}
            >
              {badge}
            </span>
          ))}
          {active && <Check className="w-3 h-3 text-[var(--accent)] shrink-0 ml-0.5" />}
        </span>
      </button>

      <Tooltip content={favorited ? "取消收藏" : "加入常用收藏"} side="top">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(model.id);
          }}
          aria-label={favorited ? `取消收藏 ${model.id}` : `收藏 ${model.id}`}
          className={cn(
            "w-5 h-5 rounded inline-flex items-center justify-center shrink-0 transition cursor-pointer linear-focus-ring",
            favorited
              ? "text-[var(--status-warning)] opacity-100"
              : "text-[var(--text-muted)] opacity-55 sm:opacity-45 group-hover:opacity-100 hover:text-[var(--text-primary)]"
          )}
        >
          <Star className={cn("w-3 h-3", favorited && "fill-current")} />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Composer 底部模型与思考强度控制组（从顶栏下沉，支持向上弹出浮层、收藏筛选与关键词检索）
 */
export function ComposerControls({ className }: { className?: string }) {
  const {
    config,
    settings,
    models,
    updateConfig,
    updateSettings,
    setPermissionMode,
    toggleFavoriteModel,
  } = useAppStore();

  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [thinkingPickerOpen, setThinkingPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  const modeRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef<HTMLDivElement>(null);
  const modeTriggerRef = useRef<HTMLButtonElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const thinkingTriggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 点击外部自动收起浮层
  useEffect(() => {
    if (!modePickerOpen && !modelPickerOpen && !thinkingPickerOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (modePickerOpen && modeRef.current && !modeRef.current.contains(target)) {
        setModePickerOpen(false);
      }
      if (modelPickerOpen && pickerRef.current && !pickerRef.current.contains(target)) {
        setModelPickerOpen(false);
        setSearch("");
      }
      if (
        thinkingPickerOpen &&
        thinkingRef.current &&
        !thinkingRef.current.contains(target)
      ) {
        setThinkingPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [modePickerOpen, modelPickerOpen, thinkingPickerOpen]);

  // Esc 快捷键关闭浮层并将焦点还原至对应触发微胶囊
  useEffect(() => {
    if (!modePickerOpen && !modelPickerOpen && !thinkingPickerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (modePickerOpen) {
        setModePickerOpen(false);
        modeTriggerRef.current?.focus();
      }
      if (modelPickerOpen) {
        setModelPickerOpen(false);
        setSearch("");
        modelTriggerRef.current?.focus();
      }
      if (thinkingPickerOpen) {
        setThinkingPickerOpen(false);
        thinkingTriggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [modePickerOpen, modelPickerOpen, thinkingPickerOpen]);

  // 打开模型选择器时聚焦搜索框
  useEffect(() => {
    if (!modelPickerOpen) return;
    const rafId = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(rafId);
  }, [modelPickerOpen]);

  const currentModel = useMemo(() => {
    return (
      models.find((m) => m.id === config.selectedModelId) ??
      inferModelMetadata(config.selectedModelId || "gpt-4o", config)
    );
  }, [models, config]);

  const showNonChat = Boolean(settings.showNonChatModels);
  const favoriteSet = useMemo(
    () => new Set(settings.favoriteModels || []),
    [settings.favoriteModels]
  );

  const modelCatalog = useMemo(() => {
    const baseList =
      models.length > 0
        ? models
        : [inferModelMetadata(config.selectedModelId || "gpt-4o", config)];

    const hiddenNonChatCount = baseList.filter((m) => m.isChatCapable === false).length;
    const chatFiltered = showNonChat
      ? baseList
      : baseList.filter((m) => m.isChatCapable !== false);

    const q = search.trim().toLowerCase();
    const filtered = q
      ? chatFiltered.filter(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q) ||
            (m.tags || []).some((t) => t.toLowerCase().includes(q))
        )
      : chatFiltered;

    const favorites = q ? [] : filtered.filter((m) => favoriteSet.has(m.id));
    const recommended = q ? [] : filtered.filter((m) => m.recommended);

    const map = new Map<ProviderGroup, ModelInfo[]>();
    for (const m of filtered) {
      const bucket = map.get(m.providerGroup) || [];
      bucket.push(m);
      map.set(m.providerGroup, bucket);
    }
    const grouped = PROVIDER_GROUP_ORDER.filter((g) => map.has(g)).map(
      (g) => [g, map.get(g)!] as [ProviderGroup, ModelInfo[]]
    );

    return {
      favorites,
      recommended,
      grouped,
      hiddenNonChatCount,
      totalVisible: filtered.length,
    };
  }, [models, search, config, showNonChat, favoriteSet]);

  const currentThinkingLabel =
    THINKING_OPTIONS.find((opt) => opt.value === config.thinkingLevel)?.label ?? "中";

  const currentMode: PermissionMode = settings.permissionMode ?? "auto-edits";
  const modeMeta = PERMISSION_MODE_META[currentMode];

  const renderModeIcon = (mode: PermissionMode, cls = "w-3 h-3 shrink-0") => {
    switch (mode) {
      case "plan":
        return <Compass className={cls} />;
      case "ask":
        return <Shield className={cls} />;
      case "full-auto":
        return <Flame className={cls} />;
      default:
        return <PenLine className={cls} />;
    }
  };

  const handleSelectModel = (modelId: string) => {
    updateConfig({ selectedModelId: modelId });
    setModelPickerOpen(false);
    setSearch("");
  };

  return (
    <div className={cn("flex items-center gap-1 min-w-0", className)}>
      {/* 执行权限模式微胶囊（Claude Code Desktop 风格：Plan / Ask / Auto Edits / Full Auto） */}
      <div className="relative shrink-0" ref={modeRef}>
        <Tooltip
          content={`${modeMeta.label} · ${modeMeta.description}`}
          shortcut={["Shift", "Tab"]}
          side="top"
          disabled={modePickerOpen}
        >
          <Button
            ref={modeTriggerRef}
            variant="ghost"
            size="xs"
            aria-label={`切换执行模式（当前：${modeMeta.label}）`}
            aria-expanded={modePickerOpen}
            aria-haspopup="menu"
            onClick={() => {
              setModelPickerOpen(false);
              setThinkingPickerOpen(false);
              setModePickerOpen((prev) => !prev);
            }}
            className={cn(
              "h-6 px-2 rounded-full border text-[11.5px]",
              currentMode === "plan"
                ? "border-[var(--accent)]/45 bg-[var(--accent-soft)] text-[var(--accent)] font-linear-medium"
                : currentMode === "full-auto"
                  ? "border-[var(--status-warning)]/45 bg-[var(--status-warning)]/10 text-[var(--status-warning)] font-linear-medium"
                  : "border-[var(--border-hairline)] bg-[var(--surface-subtle)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            {renderModeIcon(currentMode)}
            <span className="truncate max-w-[82px]">{modeMeta.shortLabel}</span>
            <ChevronDown
              className={cn(
                "w-3 h-3 opacity-70 shrink-0 transition-transform duration-150",
                modePickerOpen && "rotate-180"
              )}
            />
          </Button>
        </Tooltip>

        {modePickerOpen && (
          <div
            role="menu"
            aria-label="选择执行权限模式"
            className="absolute left-0 bottom-full mb-1.5 w-[min(300px,calc(100vw-2rem))] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-popover)] p-1 z-50"
          >
            <div className="px-2 py-1 text-[10px] font-linear-medium uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-hairline)] mb-1 flex items-center justify-between gap-2">
              <span>执行权限模式</span>
              <Kbd keys={["Shift", "Tab"]} />
            </div>
            <div className="space-y-0.5">
              {PERMISSION_MODE_ORDER.map((m) => {
                const meta = PERMISSION_MODE_META[m];
                const active = currentMode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      void setPermissionMode(m);
                      setModePickerOpen(false);
                    }}
                    className={cn(
                      "w-full px-2 py-1.5 rounded-md flex items-start justify-between gap-2 text-left transition cursor-pointer linear-focus-ring",
                      active
                        ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <span className="flex items-start gap-2 min-w-0">
                      <span
                        className={cn(
                          "mt-0.5 shrink-0",
                          m === "plan"
                            ? "text-[var(--accent)]"
                            : m === "full-auto"
                              ? "text-[var(--status-warning)]"
                              : "text-[var(--text-muted)]"
                        )}
                      >
                        {renderModeIcon(m, "w-3.5 h-3.5")}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-linear-medium leading-snug">
                          {meta.label}
                        </span>
                        <span className="block text-[10.5px] text-[var(--text-muted)] leading-snug mt-0.5">
                          {meta.description}
                        </span>
                      </span>
                    </span>
                    {active && <Check className="w-3.5 h-3.5 text-[var(--accent)] shrink-0 mt-0.5" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 模型选择微胶囊 + 向上弹出浮层 */}
      <div className="relative min-w-0" ref={pickerRef}>
        <Tooltip
          content={`切换对话模型（当前：${currentModel.id}）`}
          side="top"
          disabled={modelPickerOpen}
        >
          <Button
            ref={modelTriggerRef}
            variant="ghost"
            size="xs"
            aria-label={`切换对话模型（当前：${currentModel.id}）`}
            aria-expanded={modelPickerOpen}
            aria-haspopup="listbox"
            onClick={() => {
              setThinkingPickerOpen(false);
              setModelPickerOpen((prev) => {
                if (prev) setSearch("");
                return !prev;
              });
            }}
            className="h-6 px-2 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-subtle)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] max-w-[138px] sm:max-w-[196px]"
          >
            <Cpu className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
            <span className="font-mono truncate">{currentModel.id}</span>
            <ChevronDown
              className={cn(
                "w-3 h-3 text-[var(--text-muted)] shrink-0 transition-transform duration-150",
                modelPickerOpen && "rotate-180"
              )}
            />
          </Button>
        </Tooltip>

        {modelPickerOpen && (
          <div
            role="dialog"
            aria-label="选择对话模型"
            className="absolute left-0 bottom-full mb-1.5 w-[min(380px,calc(100vw-2.5rem))] sm:w-[380px] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-popover)] overflow-hidden z-50"
          >
            <div className="h-9 px-2.5 border-b border-[var(--border-hairline)] flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索模型 ID 或能力标签..."
                className="w-full bg-transparent text-[12px] outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </div>

            <div className="max-h-[min(18rem,52vh)] overflow-y-auto p-1.5 space-y-2">
              {modelCatalog.totalVisible === 0 ? (
                <div className="text-[12px] text-[var(--text-muted)] text-center py-6">
                  未匹配到模型，可尝试切换显示全部或前往设置同步
                </div>
              ) : (
                <>
                  {modelCatalog.favorites.length > 0 && (
                    <div>
                      <div className="px-2 py-1 text-[10px] font-linear-medium uppercase tracking-wider text-[var(--text-muted)]">
                        常用收藏
                      </div>
                      <div className="space-y-0.5">
                        {modelCatalog.favorites.map((m) => (
                          <ModelOptionRow
                            key={`fav-${m.id}`}
                            model={m}
                            active={m.id === config.selectedModelId}
                            favorited={true}
                            onSelect={handleSelectModel}
                            onToggleFavorite={toggleFavoriteModel}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {modelCatalog.recommended.length > 0 && (
                    <div>
                      <div className="px-2 py-1 text-[10px] font-linear-medium uppercase tracking-wider text-[var(--text-muted)]">
                        办公推荐
                      </div>
                      <div className="space-y-0.5">
                        {modelCatalog.recommended.map((m) => (
                          <ModelOptionRow
                            key={`rec-${m.id}`}
                            model={m}
                            active={m.id === config.selectedModelId}
                            favorited={favoriteSet.has(m.id)}
                            onSelect={handleSelectModel}
                            onToggleFavorite={toggleFavoriteModel}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {modelCatalog.grouped.map(([group, items]) => (
                    <div key={group}>
                      <div className="px-2 py-1 text-[10px] font-linear-medium uppercase tracking-wider text-[var(--text-muted)]">
                        {PROVIDER_GROUP_LABELS[group]}
                      </div>
                      <div className="space-y-0.5">
                        {items.map((m) => (
                          <ModelOptionRow
                            key={`grp-${m.id}`}
                            model={m}
                            active={m.id === config.selectedModelId}
                            favorited={favoriteSet.has(m.id)}
                            onSelect={handleSelectModel}
                            onToggleFavorite={toggleFavoriteModel}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className="border-t border-[var(--border-hairline)] bg-[var(--bg-sidebar)] px-2.5 py-2">
              <button
                type="button"
                onClick={() => updateSettings({ showNonChatModels: !showNonChat })}
                className="w-full flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer linear-focus-ring rounded"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "w-3.5 h-3.5 rounded border inline-flex items-center justify-center shrink-0 transition",
                      showNonChat
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                        : "border-[var(--border-strong)] bg-[var(--bg-surface)]"
                    )}
                  >
                    {showNonChat && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span className="truncate">显示非对话模型（向量/语音/生图）</span>
                </span>
                {!showNonChat && modelCatalog.hiddenNonChatCount > 0 && (
                  <span className="text-[10px] text-[var(--text-muted)] tabular-nums shrink-0">
                    已隐藏 {modelCatalog.hiddenNonChatCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Thinking 思考强度微胶囊 + 向上弹出浮层 */}
      <div className="relative shrink-0" ref={thinkingRef}>
        <Tooltip
          content="调整 Thinking 思考强度"
          side="top"
          disabled={thinkingPickerOpen}
        >
          <Button
            ref={thinkingTriggerRef}
            variant="ghost"
            size="xs"
            aria-label={`调整思考强度（当前：${currentThinkingLabel}）`}
            aria-expanded={thinkingPickerOpen}
            aria-haspopup="menu"
            onClick={() => {
              setModelPickerOpen(false);
              setSearch("");
              setThinkingPickerOpen((prev) => !prev);
            }}
            className="h-6 px-2 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-subtle)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                config.thinkingLevel === "off"
                  ? "bg-[var(--text-muted)]"
                  : "bg-[var(--accent)]"
              )}
            />
            <span>思考 · {currentThinkingLabel}</span>
            <ChevronDown
              className={cn(
                "w-3 h-3 text-[var(--text-muted)] shrink-0 transition-transform duration-150",
                thinkingPickerOpen && "rotate-180"
              )}
            />
          </Button>
        </Tooltip>

        {thinkingPickerOpen && (
          <div
            role="menu"
            aria-label="选择思考强度"
            className="absolute right-0 sm:right-auto sm:left-0 bottom-full mb-1.5 w-40 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-popover)] p-1 z-50"
          >
            <div className="px-2 py-1 text-[10px] font-linear-medium uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-hairline)] mb-1">
              Thinking 强度
            </div>
            {THINKING_OPTIONS.map((opt) => {
              const active = config.thinkingLevel === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    updateConfig({ thinkingLevel: opt.value });
                    setThinkingPickerOpen(false);
                  }}
                  className={cn(
                    "w-full h-7 px-2 rounded-md flex items-center justify-between gap-2 text-[12px] transition cursor-pointer linear-focus-ring",
                    active
                      ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-linear-medium"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span>{opt.label}</span>
                    <span className="text-[10.5px] text-[var(--text-muted)]">{opt.desc}</span>
                  </span>
                  {active && <Check className="w-3 h-3 text-[var(--accent)] shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
