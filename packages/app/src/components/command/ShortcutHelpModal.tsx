import { Keyboard, X } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { Button, Dialog, Kbd, Tooltip } from "../ui";

interface ShortcutEntry {
  keys: string | string[];
  label: string;
  description?: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "全局与导航",
    items: [
      { keys: ["Mod", "K"], label: "打开命令面板", description: "支持文件二级操作菜单" },
      { keys: "[", label: "折叠 / 展开侧栏" },
      { keys: "]", label: "打开 / 收起文档台" },
      { keys: "\\", label: "文档台全屏展开 / 还原" },
      { keys: ["Mod", ","], label: "打开工作台设置" },
      { keys: "?", label: "显示 / 隐藏快捷键指南" },
    ],
  },
  {
    title: "会话与输入",
    items: [
      { keys: "C", label: "新建会话并聚焦输入" },
      { keys: "/", label: "聚焦对话输入框" },
      { keys: "@", label: "引用工作区文件", description: "在对话输入框内触发" },
      { keys: "/", label: "呼出办公技能", description: "在输入首字符处触发" },
      { keys: ["Shift", "Tab"], label: "切换执行模式", description: "循环切换 Plan / Ask / Auto Edits / Full Auto" },
      { keys: "Enter", label: "发送消息", description: "浮层展开时确认选中项" },
      { keys: ["Alt", "Enter"], label: "加入发送队列", description: "Agent 运行中排队，结束后自动执行" },
      { keys: ["Shift", "Enter"], label: "输入框内换行" },
      { keys: "Escape", label: "关闭浮层或弹窗" },
    ],
  },
];

/** 全局键盘快捷键速查弹窗 */
export function ShortcutHelpModal() {
  const shortcutHelpOpen = useAppStore((s) => s.shortcutHelpOpen);
  const setShortcutHelpOpen = useAppStore((s) => s.setShortcutHelpOpen);

  return (
    <Dialog
      open={shortcutHelpOpen}
      onClose={() => setShortcutHelpOpen(false)}
      ariaLabel="键盘快捷键指南"
      className="w-full max-w-[640px] overflow-hidden"
    >
      {/* 顶栏 */}
      <div className="h-11 px-4 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Keyboard className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
          <h2 className="text-[13px] font-linear-semibold tracking-tight text-[var(--text-primary)] truncate">
            键盘快捷键指南
          </h2>
          <span className="hidden sm:inline text-[11px] text-[var(--text-muted)]">
            键盘优先工作流
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Kbd keys="Escape" />
          <Tooltip content="关闭指南" shortcut="Escape" side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShortcutHelpOpen(false)}
              aria-label="关闭键盘快捷键指南"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* 双栏分组速查列表 */}
      <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[var(--bg-surface)] max-h-[70dvh] overflow-y-auto">
        {SHORTCUT_GROUPS.map((group) => (
          <section
            key={group.title}
            className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] overflow-hidden"
          >
            <header className="px-3 py-2 border-b border-[var(--border-hairline)] bg-[var(--surface-subtle)]">
              <h3 className="text-[11px] font-linear-semibold uppercase tracking-wider text-[var(--text-heading-sub)]">
                {group.title}
              </h3>
            </header>

            <div className="divide-y divide-[var(--border-hairline)]">
              {group.items.map((item, idx) => (
                <div
                  key={`${group.title}-${item.label}-${idx}`}
                  className="px-3 py-2 flex items-center justify-between gap-3 min-h-[34px]"
                >
                  <div className="min-w-0">
                    <div className="text-[12px] font-linear-medium text-[var(--text-primary)] truncate">
                      {item.label}
                    </div>
                    {item.description && (
                      <div className="text-[10.5px] text-[var(--text-muted)] truncate mt-0.5">
                        {item.description}
                      </div>
                    )}
                  </div>
                  <Kbd keys={item.keys} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* 底部焦点避让提示 */}
      <footer className="px-4 py-2.5 border-t border-[var(--border-hairline)] bg-[var(--bg-sidebar)] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
        <span>
          在 Word 富文本或 Excel 电子表格等编辑态焦点内，单键快捷键会自动暂停以避免打字冲突。
        </span>
      </footer>
    </Dialog>
  );
}
