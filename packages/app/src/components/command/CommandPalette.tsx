import {
  Check,
  Cpu,
  FileText,
  KeyRound,
  LogOut,
  MessageSquarePlus,
  Moon,
  PanelRight,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BUILTIN_SKILLS } from "../../agent/skills";
import { maskApiKey } from "../../newapi/auth";
import { inferModelMetadata } from "../../newapi/client";
import { useAppStore } from "../../store/useAppStore";

interface CommandItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords: string;
  active?: boolean;
  icon: ReactNode;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    config,
    settings,
    models,
    files,
    customSkills,
    activeSkillId,
    authSession,
    previewOpen,
    createSession,
    toggleTheme,
    setSettingsOpen,
    setPreviewOpen,
    updateConfig,
    openPreview,
    setActiveSkill,
    switchActiveToken,
    refreshAccountSession,
    logout,
  } = useAppStore();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 全局监听 Cmd/Ctrl+K 与 Esc
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!useAppStore.getState().commandPaletteOpen);
        return;
      }
      if (e.key === "Escape" && useAppStore.getState().commandPaletteOpen) {
        e.preventDefault();
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setCommandPaletteOpen]);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [commandPaletteOpen]);

  const items = useMemo<CommandItem[]>(() => {
    const allSkills = [...BUILTIN_SKILLS, ...customSkills];
    const modelList =
      models.length > 0
        ? models
        : config.selectedModelId
          ? [inferModelMetadata(config.selectedModelId, config)]
          : [];

    const commands: CommandItem[] = [
      {
        id: "action:new-session",
        group: "快捷操作",
        label: "新建办公会话",
        hint: "重置当前对话上下文",
        keywords: "new chat session 新建 会话 对话",
        icon: <MessageSquarePlus className="w-3.5 h-3.5" />,
        run: () => createSession(),
      },
      {
        id: "action:toggle-theme",
        group: "快捷操作",
        label: settings.theme === "dark" ? "切换到浅色主题" : "切换到深色主题",
        hint: settings.theme === "dark" ? "Light" : "Dark",
        keywords: "theme dark light 主题 暗色 浅色",
        icon:
          settings.theme === "dark" ? (
            <Sun className="w-3.5 h-3.5" />
          ) : (
            <Moon className="w-3.5 h-3.5" />
          ),
        run: () => toggleTheme(),
      },
      {
        id: "action:toggle-preview",
        group: "快捷操作",
        label: previewOpen ? "收起右侧文档台" : "展开右侧文档台",
        keywords: "preview office document 文档台 预览",
        icon: <PanelRight className="w-3.5 h-3.5" />,
        run: () => setPreviewOpen(!previewOpen),
      },
      {
        id: "action:open-settings",
        group: "快捷操作",
        label: "打开设置与账号管理",
        keywords: "settings config token 设置 中转站 令牌",
        icon: <Settings className="w-3.5 h-3.5" />,
        run: () => setSettingsOpen(true),
      },
    ];

    if (authSession && authSession.mode !== "guest") {
      commands.push({
        id: "action:refresh-account",
        group: "快捷操作",
        label: "同步账户额度与可用模型",
        keywords: "refresh sync billing quota 刷新 额度 同步",
        icon: <RefreshCw className="w-3.5 h-3.5" />,
        run: () => refreshAccountSession(),
      });
    }

    commands.push({
      id: "action:logout",
      group: "快捷操作",
      label: "退出登录",
      hint: authSession?.username || authSession?.user?.username || "返回登录门户",
      keywords: "logout signout 退出 登出 注销",
      icon: <LogOut className="w-3.5 h-3.5" />,
      run: () => logout(),
    });

    for (const m of modelList) {
      const active = m.id === config.selectedModelId;
      commands.push({
        id: `model:${m.id}`,
        group: "切换模型",
        label: m.id,
        hint: m.providerGroup,
        keywords: `model 模型 ${m.id} ${m.providerGroup}`,
        active,
        icon: <Cpu className="w-3.5 h-3.5" />,
        run: () => updateConfig({ selectedModelId: m.id }),
      });
    }

    for (const f of files) {
      commands.push({
        id: `file:${f.path}`,
        group: "打开工作区文件",
        label: f.name,
        hint: f.path !== f.name ? f.path : f.category.toUpperCase(),
        keywords: `file doc open 打开 文件 ${f.name} ${f.path}`,
        icon: <FileText className="w-3.5 h-3.5" />,
        run: () => openPreview(f.path),
      });
    }

    for (const sk of allSkills) {
      const active = activeSkillId === sk.id;
      commands.push({
        id: `skill:${sk.id}`,
        group: "启用办公技能",
        label: sk.name,
        hint: active ? "点击取消挂载" : sk.description,
        keywords: `skill 技能 ${sk.name} ${sk.description}`,
        active,
        icon: <Wand2 className="w-3.5 h-3.5" />,
        run: () => setActiveSkill(active ? undefined : sk.id),
      });
    }

    if (authSession?.tokens && authSession.tokens.length > 0) {
      for (const tk of authSession.tokens) {
        const active = authSession.activeTokenId === tk.id;
        commands.push({
          id: `token:${tk.id}`,
          group: "切换 API 令牌",
          label: tk.name || `Token #${tk.id}`,
          hint: maskApiKey(tk.key || tk.maskedKey),
          keywords: `token key api 令牌 ${tk.name}`,
          active,
          icon: <KeyRound className="w-3.5 h-3.5" />,
          run: () => switchActiveToken(tk.id),
        });
      }
    }

    return commands;
  }, [
    models,
    config,
    files,
    customSkills,
    activeSkillId,
    authSession,
    settings.theme,
    previewOpen,
    createSession,
    toggleTheme,
    setPreviewOpen,
    setSettingsOpen,
    refreshAccountSession,
    logout,
    updateConfig,
    openPreview,
    setActiveSkill,
    switchActiveToken,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const terms = q.split(/\s+/).filter(Boolean);
    return items.filter((item) => {
      const hay = `${item.label} ${item.hint || ""} ${item.group} ${item.keywords}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [items, query]);

  const clampedIndex =
    filtered.length === 0 ? 0 : Math.min(selectedIndex, filtered.length - 1);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>(
      `[data-cmd-idx="${clampedIndex}"]`
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex]);

  if (!commandPaletteOpen) return null;

  const executeItem = (item?: CommandItem) => {
    if (!item) return;
    setCommandPaletteOpen(false);
    Promise.resolve(item.run()).catch((err) => {
      console.error("CommandPalette action failed:", err);
    });
  };

  // 分组渲染同时保持全局扁平下标以支持键盘上下移动
  const grouped: Array<{ group: string; entries: Array<{ item: CommandItem; index: number }> }> = [];
  const groupIndexMap = new Map<string, number>();
  filtered.forEach((item, index) => {
    let gIdx = groupIndexMap.get(item.group);
    if (gIdx === undefined) {
      gIdx = grouped.length;
      groupIndexMap.set(item.group, gIdx);
      grouped.push({ group: item.group, entries: [] });
    }
    grouped[gIdx].entries.push({ item, index });
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-start justify-center pt-[13vh] px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          setCommandPaletteOpen(false);
        }
      }}
    >
      <div
        role="dialog"
        aria-label="命令面板"
        className="w-full max-w-[540px] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[0_24px_64px_rgba(0,0,0,0.6)] overflow-hidden"
      >
        {/* 搜索输入栏 */}
        <div className="h-11 px-3.5 border-b border-[var(--border-hairline)] flex items-center gap-2.5">
          <Search className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (filtered.length > 0) {
                  setSelectedIndex((prev) => (prev + 1) % filtered.length);
                }
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (filtered.length > 0) {
                  setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
                }
              } else if (e.key === "Enter") {
                e.preventDefault();
                executeItem(filtered[clampedIndex]);
              }
            }}
            placeholder="输入命令、模型、文件、技能或令牌..."
            className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
            ESC
          </kbd>
        </div>

        {/* 命令列表 */}
        <div ref={listRef} className="max-h-[340px] overflow-y-auto p-1.5 space-y-2">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-[var(--text-muted)]">
              未找到匹配的命令或资源
            </div>
          ) : (
            grouped.map(({ group, entries }) => (
              <div key={group}>
                <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {group}
                </div>
                <div className="space-y-0.5">
                  {entries.map(({ item, index }) => {
                    const selected = index === clampedIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-cmd-idx={index}
                        onMouseEnter={() => setSelectedIndex(index)}
                        onClick={() => executeItem(item)}
                        className={`w-full h-8 px-2.5 rounded-md flex items-center justify-between gap-2 text-left text-[12px] transition cursor-pointer ${
                          selected
                            ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`shrink-0 ${
                              selected ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                            }`}
                          >
                            {item.icon}
                          </span>
                          <span className="truncate font-medium text-[var(--text-primary)]">
                            {item.label}
                          </span>
                          {item.hint && (
                            <span className="truncate text-[11px] text-[var(--text-muted)] font-mono">
                              {item.hint}
                            </span>
                          )}
                        </div>
                        {item.active && (
                          <Check className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* 底部快捷键提示 */}
        <div className="h-7 px-3.5 border-t border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>↑↓ 选择 · ↵ 执行 · Esc 关闭</span>
          <span className="tabular-nums">{filtered.length} 项</span>
        </div>
      </div>
    </div>
  );
}
