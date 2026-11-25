import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { Kbd } from "./Kbd";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** 提示文案；为空时直接透传子节点 */
  content?: string;
  /** 可选快捷键标注，用于悬停时自然习得快捷键 */
  shortcut?: string | string[];
  side?: TooltipSide;
  delayMs?: number;
  disabled?: boolean;
  className?: string;
  children: ReactElement<Record<string, unknown>>;
}

interface FloatingCoords {
  top: number;
  left: number;
  resolvedSide: TooltipSide;
}

function computeCoords(
  rect: DOMRect,
  tipWidth: number,
  tipHeight: number,
  preferredSide: TooltipSide
): FloatingCoords {
  const gap = 6;
  const pad = 8;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  let side = preferredSide;
  if (side === "top" && rect.top - tipHeight - gap < pad) {
    side = "bottom";
  } else if (side === "bottom" && rect.bottom + tipHeight + gap > vh - pad) {
    side = "top";
  } else if (side === "left" && rect.left - tipWidth - gap < pad) {
    side = "right";
  } else if (side === "right" && rect.right + tipWidth + gap > vw - pad) {
    side = "left";
  }

  let top = 0;
  let left = 0;

  if (side === "top") {
    top = rect.top - tipHeight - gap;
    left = rect.left + rect.width / 2 - tipWidth / 2;
  } else if (side === "bottom") {
    top = rect.bottom + gap;
    left = rect.left + rect.width / 2 - tipWidth / 2;
  } else if (side === "left") {
    top = rect.top + rect.height / 2 - tipHeight / 2;
    left = rect.left - tipWidth - gap;
  } else {
    top = rect.top + rect.height / 2 - tipHeight / 2;
    left = rect.right + gap;
  }

  left = Math.max(pad, Math.min(left, vw - tipWidth - pad));
  top = Math.max(pad, Math.min(top, vh - tipHeight - pad));

  return { top, left, resolvedSide: side };
}

/** Linear 风格悬停提示组件：支持快捷键键帽展示，自动防裁剪定位与可访问性关联 */
export function Tooltip({
  content,
  shortcut,
  side = "top",
  delayMs = 200,
  disabled = false,
  className,
  children,
}: TooltipProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<FloatingCoords | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  const scheduleShow = useCallback(
    (anchor: HTMLElement | null, immediate = false) => {
      if (!content || disabled || !anchor) return;
      anchorRef.current = anchor;
      clearTimer();
      if (immediate || delayMs <= 0) {
        setOpen(true);
        return;
      }
      timerRef.current = setTimeout(() => {
        setOpen(true);
      }, delayMs);
    },
    [clearTimer, content, delayMs, disabled]
  );

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!open || !anchorRef.current) return;

    const updatePosition = () => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      const tipEl = tipRef.current;
      const tipWidth = tipEl?.offsetWidth ?? 160;
      const tipHeight = tipEl?.offsetHeight ?? 28;
      setCoords(computeCoords(rect, tipWidth, tipHeight, side));
    };

    updatePosition();
    const rafId = requestAnimationFrame(updatePosition);
    const onScrollOrResize = () => hide();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [hide, open, side, content, shortcut]);

  if (!content || disabled || !isValidElement(children)) {
    return children;
  }

  const childProps = children.props as Record<string, unknown>;
  const origMouseEnter = childProps.onMouseEnter as
    | ((e: MouseEvent<HTMLElement>) => void)
    | undefined;
  const origMouseLeave = childProps.onMouseLeave as
    | ((e: MouseEvent<HTMLElement>) => void)
    | undefined;
  const origFocus = childProps.onFocus as ((e: FocusEvent<HTMLElement>) => void) | undefined;
  const origBlur = childProps.onBlur as ((e: FocusEvent<HTMLElement>) => void) | undefined;
  const origPointerDown = childProps.onPointerDown as
    | ((e: PointerEvent<HTMLElement>) => void)
    | undefined;

  const enhancedChild = cloneElement(children, {
    "aria-describedby": open ? tooltipId : (childProps["aria-describedby"] as string | undefined),
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      origMouseEnter?.(e);
      scheduleShow(e.currentTarget, false);
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      origMouseLeave?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      origFocus?.(e);
      if (e.currentTarget.matches(":focus-visible")) {
        scheduleShow(e.currentTarget, true);
      }
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      origBlur?.(e);
      hide();
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      origPointerDown?.(e);
      hide();
    },
  });

  return (
    <>
      {enhancedChild}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={tipRef}
            id={tooltipId}
            role="tooltip"
            style={
              coords
                ? { top: coords.top, left: coords.left }
                : { top: -9999, left: -9999 }
            }
            className={cn(
              "fixed z-[90] pointer-events-none select-none px-2 py-1 rounded-[6px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[11px] font-linear-medium text-[var(--text-primary)] shadow-[var(--shadow-popover)] flex items-center gap-1.5 whitespace-nowrap transition-opacity duration-100",
              coords ? "opacity-100" : "opacity-0",
              className
            )}
          >
            <span>{content}</span>
            {shortcut && <Kbd keys={shortcut} />}
          </div>,
          document.body
        )}
    </>
  );
}
