import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  Check,
  ChevronDown,
  Cpu,
  FolderOpen,
  Moon,
  PanelLeft,
  PanelRight,
  Search,
  Settings,
  Star,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_BRAND_NAME, PROVIDER_GROUP_LABELS, inferModelMetadata } from "../../newapi/client";
import { getPlatformAdapter } from "../../platform";
import { useAppStore } from "../../store/useAppStore";
import type { ModelInfo, ProviderGroup } from "../../types";
import { BrandLogo } from "../common/FileBadge";

const THINKING_OPTIONS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: "off", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
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

/** 提取模型展示徽标（最多保留 2 个紧凑标签，避免顶栏下拉拥挤） */
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
      className={`group w-full min-h-[28px] px-1.5 rounded-md flex items-center justify-between gap-1.5 transition ${
        active
          ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
          : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(model.id)}
        className="flex-1 min-w-0 h-7 px-1 text-left text-[12px] flex items-center justify-between gap-2 cursor-pointer"
      >
        <span className="font-mono truncate">{model.id}</span>
        <span className="flex items-center gap-1 shrink-0">
          {badges.map((badge) => (
            <span
              key={badge}
              className={`text-[10px] px-1.5 py-px rounded border leading-tight ${
                badge === "推荐"
                  ? "border-[var(--accent)]/35 bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-muted)]"
              }`}
            >
              {badge}
            </span>
          ))}
          {active && <Check className="w-3 h-3 text-[var(--accent)] shrink-0 ml-0.5" />}
        </span>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(model.id);
        }}
        title={favorited ? "取消收藏" : "加入常用收藏"}
        aria-label={favorited ? `取消收藏 ${model.id}` : `收藏 ${model.id}`}
        className={`w-5 h-5 rounded inline-flex items-center justify-center shrink-0 transition cursor-pointer ${
          favorited
            ? "text-[var(--status-warning)] opacity-100"
            : "text-[var(--text-muted)] opacity-45 group-hover:opacity-100 hover:text-[var(--text-primary)]"
        }`}
      >
        <Star className={`w-3 h-3 ${favorited ? "fill-current" : ""}`} />
      </button>
    </div>
  );
}

export function TopBar({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const {
    config,
    settings,
    models,
    authSession,
    previewOpen,
    setPreviewOpen,
    setCommandPaletteOpen,
    updateConfig,
    updateSettings,
    toggleTheme,
    toggleFavoriteModel,
    setSettingsOpen,
    mountNativeDirectory,
  } = useAppStore();

  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [thinkingPickerOpen, setThinkingPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef<HTMLDivElement>(null);
  const platform = getPlatformAdapter();

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (pickerRef.current && !pickerRef.current.contains(target)) {
        setModelPickerOpen(false);
      }
      if (thinkingRef.current && !thinkingRef.current.contains(target)) {
        setThinkingPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

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

  const userDisplay =
    authSession?.user?.displayName ||
    authSession?.user?.username ||
    authSession?.username ||
    (authSession?.mode === "guest" ? "离线访客" : "API Key");

  const isConnected = Boolean(authSession && authSession.mode !== "guest" && config.apiKey);

  return (
    <header className="h-11 shrink-0 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 flex items-center justify-between gap-2 select-none z-40">
      {/* 左侧：侧栏开关、几何标志、模型下拉、Thinking 胶囊 */}
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="hidden md:inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer shrink-0"
          title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
        >
          <PanelLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-1.5 shrink-0 pr-1">
          <BrandLogo className="w-6 h-6 rounded-md shrink-0" />
          <span className="text-[13px] font-medium tracking-tight text-[var(--text-primary)] hidden sm:inline">
            {config.brandName || DEFAULT_BRAND_NAME}
          </span>
        </div>

        <span className="h-3.5 w-px bg-[var(--border-hairline)] hidden sm:block shrink-0" />

        {/* 模型搜索分组下拉 */}
        <div className="relative min-w-0" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setModelPickerOpen((v) => !v)}
            className="h-7 px-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] flex items-center gap-1.5 text-[12px] text-[var(--text-primary)] max-w-[160px] sm:max-w-[185px] lg:max-w-[240px] transition cursor-pointer"
          >
            <Cpu className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
            <span className="font-mono truncate">{currentModel.id}</span>
            <span className="hidden xl:inline text-[10px] text-[var(--text-muted)] shrink-0">
              {currentModel.api === "anthropic-messages"
                ? "Claude"
                : currentModel.api === "google-generative-ai"
                  ? "Gemini"
                  : "OpenAI"}
            </span>
            <ChevronDown className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
          </button>

          {modelPickerOpen && (
            <div className="fixed left-2 right-2 top-12 sm:absolute sm:left-0 sm:right-auto sm:top-auto sm:mt-1.5 sm:w-[380px] sm:max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[0_16px_40px_rgba(0,0,0,0.45)] overflow-hidden z-50">
              <div className="h-9 px-2.5 border-b border-[var(--border-hairline)] flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索模型 ID 或能力标签..."
                  autoFocus
                  className="w-full bg-transparent text-[12px] outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
              </div>
              <div className="max-h-72 overflow-y-auto p-1.5 space-y-2">
                {modelCatalog.totalVisible === 0 ? (
                  <div className="text-[12px] text-[var(--text-muted)] text-center py-6">
                    未匹配到模型，可尝试切换显示全部或前往设置同步
                  </div>
                ) : (
                  <>
                    {modelCatalog.favorites.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                          常用收藏
                        </div>
                        <div className="space-y-0.5">
                          {modelCatalog.favorites.map((m) => (
                            <ModelOptionRow
                              key={`fav-${m.id}`}
                              model={m}
                              active={m.id === config.selectedModelId}
                              favorited={true}
                              onSelect={(id) => {
                                updateConfig({ selectedModelId: id });
                                setModelPickerOpen(false);
                              }}
                              onToggleFavorite={toggleFavoriteModel}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {modelCatalog.recommended.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                          办公推荐
                        </div>
                        <div className="space-y-0.5">
                          {modelCatalog.recommended.map((m) => (
                            <ModelOptionRow
                              key={`rec-${m.id}`}
                              model={m}
                              active={m.id === config.selectedModelId}
                              favorited={favoriteSet.has(m.id)}
                              onSelect={(id) => {
                                updateConfig({ selectedModelId: id });
                                setModelPickerOpen(false);
                              }}
                              onToggleFavorite={toggleFavoriteModel}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {modelCatalog.grouped.map(([group, items]) => (
                      <div key={group}>
                        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                          {PROVIDER_GROUP_LABELS[group]}
                        </div>
                        <div className="space-y-0.5">
                          {items.map((m) => (
                            <ModelOptionRow
                              key={`grp-${m.id}`}
                              model={m}
                              active={m.id === config.selectedModelId}
                              favorited={favoriteSet.has(m.id)}
                              onSelect={(id) => {
                                updateConfig({ selectedModelId: id });
                                setModelPickerOpen(false);
                              }}
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
                  className="w-full flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-3.5 h-3.5 rounded border inline-flex items-center justify-center shrink-0 transition ${
                        showNonChat
                          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                          : "border-[var(--border-strong)] bg-[var(--bg-surface)]"
                      }`}
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

        {/* Thinking 强度胶囊 */}
        <div className="hidden sm:block relative shrink-0" ref={thinkingRef}>
          <button
            type="button"
            onClick={() => setThinkingPickerOpen((v) => !v)}
            className="h-7 px-2.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] shrink-0 whitespace-nowrap transition cursor-pointer"
            title="调整 Thinking 思考强度"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                config.thinkingLevel === "off"
                  ? "bg-[var(--text-muted)]"
                  : "bg-[var(--accent)]"
              }`}
            />
            <span>思考 · {currentThinkingLabel}</span>
            <ChevronDown className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
          </button>

          {thinkingPickerOpen && (
            <div className="absolute left-0 mt-1.5 w-32 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[0_12px_32px_rgba(0,0,0,0.4)] p-1 z-50">
              {THINKING_OPTIONS.map((opt) => {
                const active = config.thinkingLevel === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      updateConfig({ thinkingLevel: opt.value });
                      setThinkingPickerOpen(false);
                    }}
                    className={`w-full h-7 px-2 rounded-md flex items-center justify-between text-[12px] transition cursor-pointer ${
                      active
                        ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <span>{opt.label}</span>
                    {active && <Check className="w-3 h-3 text-[var(--accent)]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：⌘K 命令面板、挂载目录、文档台开关、主题切换、用户状态入口 */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="h-7 px-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] shrink-0 whitespace-nowrap transition cursor-pointer"
          title="打开命令面板 (Cmd/Ctrl + K)"
        >
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <span className="hidden lg:inline">搜索命令</span>
          <kbd className="text-[10px] font-mono px-1 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-muted)] leading-none">
            ⌘K
          </kbd>
        </button>

        {platform.canMountNativeDir && (
          <button
            type="button"
            onClick={() => mountNativeDirectory()}
            className="hidden md:inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-[12px] text-[var(--text-secondary)] shrink-0 whitespace-nowrap transition cursor-pointer"
            title={
              settings.mountedNativeDir
                ? `已挂载: ${settings.mountedNativeDir}`
                : "挂载本地工作目录"
            }
          >
            <FolderOpen className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <span className="max-w-[96px] truncate">
              {settings.mountedNativeDir
                ? settings.mountedNativeDir.split(/[\\/]/).pop()
                : "挂载目录"}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setPreviewOpen(!previewOpen)}
          className={`hidden md:inline-flex items-center gap-1.5 h-7 px-2 rounded-md border text-[12px] transition shrink-0 whitespace-nowrap cursor-pointer ${
            previewOpen
              ? "border-[var(--border-strong)] bg-[var(--bg-active)] text-[var(--text-primary)]"
              : "border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
          }`}
          title="切换右侧 Office 文档台"
        >
          <PanelRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <span>文档台</span>
        </button>

        <button
          type="button"
          onClick={() => toggleTheme()}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer shrink-0"
          title={settings.theme === "dark" ? "切换至浅色主题" : "切换至深色主题"}
        >
          {settings.theme === "dark" ? (
            <Sun className="w-3.5 h-3.5" />
          ) : (
            <Moon className="w-3.5 h-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="h-7 px-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] shrink-0 whitespace-nowrap transition cursor-pointer"
          title="账号与工作台设置"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              isConnected ? "bg-[var(--status-success)]" : "bg-[var(--text-muted)]"
            }`}
          />
          <span className="hidden sm:inline max-w-[90px] truncate text-[var(--text-primary)]">
            {userDisplay}
          </span>
          <Settings className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        </button>
      </div>
    </header>
  );
}
