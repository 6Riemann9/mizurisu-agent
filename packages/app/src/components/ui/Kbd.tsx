import { cn } from "./cn";

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

/** 将内部快捷键别名（如 Mod）转换为贴合用户当前操作系统的展示符号 */
export function formatShortcutKey(key: string): string {
  const mac = isMacPlatform();
  switch (key) {
    case "Mod":
      return mac ? "⌘" : "Ctrl";
    case "Shift":
      return mac ? "⇧" : "Shift";
    case "Alt":
      return mac ? "⌥" : "Alt";
    case "Enter":
      return "↵";
    case "Escape":
      return "Esc";
    default:
      return key;
  }
}

export interface KbdProps {
  /** 单个键名或组合键数组，支持 Mod 自动区分 macOS(⌘) 与 Windows/Linux(Ctrl) */
  keys: string | string[];
  className?: string;
  keyClassName?: string;
}

/** Linear 风格等宽快捷键帽组件 */
export function Kbd({ keys, className, keyClassName }: KbdProps) {
  const list = Array.isArray(keys) ? keys : [keys];

  return (
    <span className={cn("inline-flex items-center gap-0.5 shrink-0", className)}>
      {list.map((raw, idx) => (
        <kbd
          key={`${raw}-${idx}`}
          className={cn(
            "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-[4px] border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[10px] font-mono tabular-nums leading-none text-[var(--text-muted)] shadow-[inset_0_-1px_0_rgba(0,0,0,0.2)] select-none",
            keyClassName
          )}
        >
          {formatShortcutKey(raw)}
        </kbd>
      ))}
    </span>
  );
}
