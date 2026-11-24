import type { ComponentPropsWithoutRef, Ref } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "icon" | "icon-sm";

export interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] shadow-[var(--btn-primary-shadow)] hover:bg-[var(--btn-primary-hover)]",
  accent: "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
  secondary:
    "border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]",
  ghost:
    "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
  danger:
    "border border-[var(--border-hairline)] bg-[var(--bg-elevated)] text-[var(--status-danger)] hover:bg-[var(--bg-active)] hover:border-[var(--status-danger)]/40",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-[11px] rounded-[5px] gap-1",
  sm: "h-7 px-2.5 text-[12px] rounded-[6px] gap-1.5",
  md: "h-8 px-3 text-[13px] rounded-[6px] gap-1.5",
  icon: "size-7 rounded-[6px]",
  "icon-sm": "size-6 rounded-[5px]",
};

/** 统一按钮原语：内建 Linear 字重阶梯、4px 栅格尺寸、微过渡与 :focus-visible 聚焦环 */
export function Button({
  variant = "secondary",
  size = "sm",
  type = "button",
  className,
  children,
  ref,
  ...props
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap font-linear-medium select-none cursor-pointer transition-[background-color,border-color,color,box-shadow,opacity] duration-150 disabled:opacity-40 disabled:pointer-events-none linear-focus-ring shrink-0",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
