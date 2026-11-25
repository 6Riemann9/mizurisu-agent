import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../components/ui";
import { isEditableTarget } from "../hooks/useGlobalShortcuts";
import { clearAllLocalData, kvSet, loadAllSessions, saveSession } from "../storage/db";
import { workspaceVfs } from "../storage/workspace-vfs";
import { useAppStore } from "../store/useAppStore";
import type { ChatSession } from "../types";

/** 使用访客会话与已种子标记初始化 Store，避免测试中触发外部网络请求或重型初始化 */
async function initStoreForTest(): Promise<void> {
  await kvSet("auth_session", {
    mode: "guest",
    baseUrl: "https://relay.example.com",
    tokens: [],
    activeApiKey: "",
    loggedInAt: Date.now(),
  });
  await kvSet("starter_workspace_seeded", true);
  await kvSet("starter_slides_seeded", true);

  useAppStore.setState({
    initialized: false,
    authSession: null,
    sessions: [],
    activeSessionId: "",
    files: [],
    activePreviewPath: null,
    previewOpen: false,
    toasts: [],
  });
  await useAppStore.getState().init();
}

function clearPendingToasts(): void {
  const currentToasts = [...useAppStore.getState().toasts];
  for (const toast of currentToasts) {
    useAppStore.getState().dismissToast(toast.id);
  }
}

describe("Linear 工作台 UI 原语、快捷键避让与可逆交互 (linear-ui)", () => {
  beforeEach(async () => {
    clearPendingToasts();
    await clearAllLocalData();
    document.documentElement.classList.remove("dark", "light", "high-contrast");
    document.documentElement.classList.add("dark");
  });

  afterEach(() => {
    clearPendingToasts();
    cleanup();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    document.documentElement.classList.remove("dark", "light", "high-contrast");
    document.documentElement.classList.add("dark");
  });

  it("isEditableTarget 精确区分普通容器与输入控件、contentEditable、ProseMirror、Univer 子节点", () => {
    const plainDiv = document.createElement("div");
    document.body.appendChild(plainDiv);

    const input = document.createElement("input");
    const textarea = document.createElement("textarea");

    const editableHost = document.createElement("div");
    editableHost.setAttribute("contenteditable", "true");
    const editableChild = document.createElement("span");
    editableHost.appendChild(editableChild);

    const proseMirror = document.createElement("div");
    proseMirror.className = "ProseMirror";
    const proseParagraph = document.createElement("p");
    proseMirror.appendChild(proseParagraph);

    const univerHost = document.createElement("div");
    univerHost.className = "univer-host-container";
    const univerCellInput = document.createElement("div");
    univerHost.appendChild(univerCellInput);

    document.body.append(
      input,
      textarea,
      editableHost,
      proseMirror,
      univerHost
    );

    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(plainDiv)).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);

    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(editableHost)).toBe(true);
    expect(isEditableTarget(editableChild)).toBe(true);
    expect(isEditableTarget(proseParagraph)).toBe(true);
    expect(isEditableTarget(univerCellInput)).toBe(true);

    // 防回归：Univer 暗色主题在根元素/body 注入 univer-dark 类时，不应误判普通节点
    const univerEditor = document.createElement("div");
    univerEditor.className = "univer-editor-container";
    const univerEditorChild = document.createElement("span");
    univerEditor.appendChild(univerEditorChild);
    const univerCompEditor = document.createElement("div");
    univerCompEditor.setAttribute("data-u-comp", "editor");
    document.body.append(univerEditor, univerCompEditor);

    document.documentElement.classList.add("univer-dark");
    document.body.classList.add("univer-dark");
    try {
      expect(isEditableTarget(plainDiv)).toBe(false);
      expect(isEditableTarget(document.body)).toBe(false);
      expect(isEditableTarget(univerEditorChild)).toBe(true);
      expect(isEditableTarget(univerCompEditor)).toBe(true);
    } finally {
      document.documentElement.classList.remove("univer-dark");
      document.body.classList.remove("univer-dark");
    }
  });

  it("toggleHighContrast 同步切换 settings.highContrast 与根元素 high-contrast 类且保留主题类", async () => {
    await initStoreForTest();
    await useAppStore.getState().updateSettings({ theme: "dark", highContrast: false });

    expect(useAppStore.getState().settings.highContrast).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("high-contrast")).toBe(false);

    // 1. 深色主题下开启高对比度
    await useAppStore.getState().toggleHighContrast();
    expect(useAppStore.getState().settings.highContrast).toBe(true);
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);

    // 2. 再次调用关闭高对比度
    await useAppStore.getState().toggleHighContrast();
    expect(useAppStore.getState().settings.highContrast).toBe(false);
    expect(document.documentElement.classList.contains("high-contrast")).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // 3. 切换浅色主题后开启高对比度，应同时保留 .light 与 .high-contrast
    await useAppStore.getState().toggleTheme();
    await useAppStore.getState().toggleHighContrast();
    expect(useAppStore.getState().settings.theme).toBe("light");
    expect(useAppStore.getState().settings.highContrast).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);
  });

  it("deleteSession 弹出 6 秒撤销 Toast，点击撤销后可完整恢复原会话并选中", async () => {
    await initStoreForTest();

    const targetSession: ChatSession = {
      id: "sess_target_restore",
      title: "季度预算关键对话",
      createdAt: Date.now() - 1000,
      updatedAt: Date.now(),
      totalTokens: 42,
      messages: [
        {
          id: "msg_u_1",
          role: "user",
          content: "请核对 Q3 部门预算明细",
          createdAt: Date.now() - 500,
        },
      ],
    };
    await saveSession(targetSession);
    useAppStore.setState((state) => ({
      sessions: [targetSession, ...state.sessions],
      activeSessionId: targetSession.id,
    }));

    await useAppStore.getState().deleteSession(targetSession.id);

    expect(
      useAppStore.getState().sessions.some((s) => s.id === targetSession.id)
    ).toBe(false);
    expect(useAppStore.getState().activeSessionId).not.toBe(targetSession.id);

    const undoToast = useAppStore
      .getState()
      .toasts.find((t) => t.action?.label === "撤销");
    expect(undoToast).toBeTruthy();
    expect(undoToast?.durationMs).toBe(6000);
    expect(undoToast?.message).toContain("季度预算关键对话");

    await undoToast!.action!.onClick();

    const restored = useAppStore
      .getState()
      .sessions.find((s) => s.id === targetSession.id);
    expect(restored).toBeTruthy();
    expect(restored?.title).toBe("季度预算关键对话");
    expect(restored?.messages).toHaveLength(1);
    expect(restored?.messages[0].content).toBe("请核对 Q3 部门预算明细");
    expect(useAppStore.getState().activeSessionId).toBe(targetSession.id);

    const persistedSessions = await loadAllSessions();
    expect(persistedSessions.some((s) => s.id === targetSession.id)).toBe(true);
  });

  it("deleteWorkspaceFile 触发 6 秒撤销 Toast，点击撤销后完整恢复文件及字节内容", async () => {
    await initStoreForTest();

    const testPath = "reports/q3-audit.bin";
    const originalBytes = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x10, 0x20, 0x7f, 0x80, 0xfe, 0xff,
    ]);
    await workspaceVfs.writeBytes(testPath, originalBytes);
    await useAppStore.getState().refreshFiles();

    expect(await workspaceVfs.exists(testPath)).toBe(true);

    await useAppStore.getState().deleteWorkspaceFile(testPath);

    expect(await workspaceVfs.exists(testPath)).toBe(false);
    expect(useAppStore.getState().files.some((f) => f.path === testPath)).toBe(
      false
    );

    const undoToast = useAppStore
      .getState()
      .toasts.find((t) => t.action?.label === "撤销");
    expect(undoToast).toBeTruthy();
    expect(undoToast?.durationMs).toBe(6000);
    expect(undoToast?.message).toContain(testPath);

    await undoToast!.action!.onClick();

    expect(await workspaceVfs.exists(testPath)).toBe(true);
    const restoredBytes = await workspaceVfs.readBytes(testPath);
    expect(Array.from(restoredBytes)).toEqual(Array.from(originalBytes));
    expect(useAppStore.getState().files.some((f) => f.path === testPath)).toBe(
      true
    );
    expect(useAppStore.getState().activePreviewPath).toBe(testPath);
  });

  it("Dialog 原语打开时渲染 role='dialog'、按 Escape 调用 onClose 并在关闭后还原焦点至原触发按钮", async () => {
    const onCloseSpy = vi.fn();

    function DialogTestHarness() {
      const [open, setOpen] = useState(false);

      return createElement(
        "div",
        null,
        createElement(
          "button",
          {
            type: "button",
            onClick: () => setOpen(true),
          },
          "打开测试弹窗"
        ),
        createElement(Dialog, {
          open,
          ariaLabel: "规范验证弹窗",
          onClose: () => {
            onCloseSpy();
            setOpen(false);
          },
          children: createElement(
            "div",
            null,
            createElement("button", { type: "button" }, "弹窗首按钮"),
            createElement("button", { type: "button" }, "弹窗次按钮")
          ),
        })
      );
    }

    render(createElement(DialogTestHarness));

    const triggerBtn = screen.getByRole("button", { name: "打开测试弹窗" });
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    fireEvent.click(triggerBtn);

    const dialog = screen.getByRole("dialog", { name: "规范验证弹窗" });
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "弹窗首按钮" })
      );
    });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(document.activeElement).toBe(triggerBtn);
  });
});
