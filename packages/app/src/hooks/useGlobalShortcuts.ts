import { useEffect, useRef } from "react";

/**
 * 判断键盘事件目标是否处于可编辑上下文（常规输入控件、富文本编辑器或 Univer 电子表格容器内），
 * 用于防止在输入或编辑文档时误触单键全局快捷键。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as Element & { isContentEditable?: boolean };
  if (typeof el.tagName !== "string") return false;

  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (el.isContentEditable) {
    return true;
  }
  if (
    typeof el.closest === "function" &&
    el.closest(
      '[contenteditable="true"], [contenteditable=""], .ProseMirror, .univer-host-container, .univer-editor-container, [data-u-comp="editor"], [data-shortcut-ignore="true"]'
    )
  ) {
    return true;
  }
  return false;
}

export interface GlobalShortcutHandlers {
  /** 是否存在任意弹窗 / 命令面板 / 审批框阻断单键快捷键 */
  modalOpen: boolean;
  onToggleSidebar: () => void;
  onTogglePreview: () => void;
  onToggleExpandPreview: () => void;
  onNewSession: () => void;
  onFocusComposer: () => void;
  onToggleShortcutHelp: () => void;
  onOpenSettings: () => void;
}

/**
 * 全局键盘优先引擎：提供单键工作流导航（[, ], \, c, /, ?）与 Mod+, 打开设置，
 * 并自动避让编辑器、表单与组合输入法。
 */
export function useGlobalShortcuts(handlers: GlobalShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const current = handlersRef.current;

      // Mod + , 打开设置（避免干扰 Univer 内置快捷键）
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === ",") {
        const insideUniver =
          e.target instanceof Element && Boolean(e.target.closest(".univer-host-container"));
        if (!insideUniver) {
          e.preventDefault();
          current.onOpenSettings();
        }
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (current.modalOpen) return;
      if (isEditableTarget(e.target)) return;

      switch (e.key) {
        case "[":
          e.preventDefault();
          current.onToggleSidebar();
          break;
        case "]":
          e.preventDefault();
          current.onTogglePreview();
          break;
        case "\\":
          e.preventDefault();
          current.onToggleExpandPreview();
          break;
        case "c":
        case "C":
          if (!e.shiftKey) {
            e.preventDefault();
            current.onNewSession();
          }
          break;
        case "/":
          if (!e.shiftKey) {
            e.preventDefault();
            current.onFocusComposer();
          }
          break;
        case "?":
          e.preventDefault();
          current.onToggleShortcutHelp();
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
