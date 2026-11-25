import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, TextContent } from "@earendil-works/pi-ai";
import { create } from "zustand";
import { buildHandoffFromSession } from "../agent/extensions";
import { cyclePermissionMode as cycleModeHelper } from "../agent/permission";
import {
  DEFAULT_MIZURISU_MD_TEMPLATE,
  findProjectInstructionFile,
} from "../agent/project-instructions";
import { PiAgentRunner } from "../agent/runtime";
import { parseSkillMarkdown } from "../agent/skill-md";
import { BUILTIN_SKILLS } from "../agent/skills";
import {
  authenticateAndBootstrapKey,
  buildNewApiAuthHeaders,
  createNewApiToken,
  extractAuthFromUrl,
  fetchSiteStatus,
  fetchUserSelf,
  fetchUserTokens,
  isMaskedKey,
  logoutNewApiAccount,
  maskApiKey,
  normalizeApiKey,
  resolvePlaintextKeyForToken,
  tryResumeExistingSession,
} from "../newapi/auth";
import {
  DEFAULT_BRAND_NAME,
  DEFAULT_NEWAPI_URL,
  fetchNewApiBilling,
  fetchNewApiModels,
  inferModelMetadata,
  normalizeNewApiBaseUrl,
  pickDefaultStationModel,
  toPiModel,
} from "../newapi/client";
import { createNewApiStreamFn } from "../newapi/stream";
import { detectFileCategory, inferMimeType } from "../office";
import { createWorkspaceZip, formatSessionToMarkdown } from "../office/export-bundle";
import { getPlatformAdapter } from "../platform";
import {
  clearAllLocalData,
  dbDeleteCustomSkill,
  dbListCustomSkills,
  dbSaveCustomSkill,
  deleteSessionById,
  kvGet,
  kvSet,
  loadAllSessions,
  saveSession,
} from "../storage/db";
import { workspaceVfs } from "../storage/workspace-vfs";
import type {
  AppSettings,
  ApprovalRequest,
  AuthSession,
  BillingInfo,
  ChatSession,
  HandoffPayload,
  ModelInfo,
  NewApiConfig,
  NewApiSiteStatus,
  NewApiTokenItem,
  PermissionMode,
  QueuedMessageItem,
  QuestionnaireRequest,
  SessionFileChange,
  SkillTemplate,
  ToastAction,
  ToastItem,
  TokenBurdenReport,
  UiMessage,
  WorkspaceFileMeta,
  WorkspaceProfile,
} from "../types";

export type MobileTab = "chat" | "files" | "preview" | "settings";

function getDefaultConfig(): NewApiConfig {
  const defaultModel =
    (import.meta.env?.VITE_DEFAULT_MODEL as string | undefined)?.trim() || "";

  return {
    brandName: DEFAULT_BRAND_NAME,
    baseUrl: DEFAULT_NEWAPI_URL,
    apiKey: "",
    protocolMode: "compatible",
    selectedModelId: defaultModel,
    thinkingLevel: "medium",
    customModels: [],
    modelProtocolOverrides: {},
  };
}

function getDefaultSettings(): AppSettings {
  return {
    theme: "dark",
    highContrast: false,
    autoApproveDelete: false,
    permissionMode: "auto-edits",
    previewWidth: 520,
    favoriteModels: [],
    showNonChatModels: false,
    onboardingDismissed: false,
    customSystemPrompt: "",
  };
}

function createEmptySession(title = "新对话", workspaceId?: string): ChatSession {
  const now = Date.now();
  return {
    id: `sess_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
    totalTokens: 0,
    ...(workspaceId && workspaceId !== "default" ? { workspaceId } : {}),
  };
}

const DEFAULT_WORKSPACE: WorkspaceProfile = {
  id: "default",
  name: "默认工作区",
  createdAt: 0,
};

function applyThemeToDocument(theme: "light" | "dark", highContrast = false): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root?.classList?.toggle("dark", theme === "dark");
  root?.classList?.toggle("light", theme === "light");
  root?.classList?.toggle("high-contrast", Boolean(highContrast));
  const themeMeta =
    typeof document.querySelector === "function"
      ? document.querySelector('meta[name="theme-color"]')
      : null;
  if (themeMeta) {
    themeMeta.setAttribute("content", theme === "dark" ? "#08090a" : "#ffffff");
  }
}

function formatYmd(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sanitizeFilename(raw: string, fallback = "chat-session"): string {
  const cleaned = raw.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || fallback;
}

async function fileToDataUrl(file: File): Promise<string> {
  const mimeType = file.type || "image/png";
  if (typeof FileReader !== "undefined") {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return `data:${mimeType};base64,${btoa(bin)}`;
}

function dataUrlToImageContent(img: { mimeType: string; dataUrl: string }): ImageContent | null {
  const commaIdx = img.dataUrl.indexOf(",");
  const data = commaIdx >= 0 ? img.dataUrl.slice(commaIdx + 1) : img.dataUrl;
  if (!data) return null;
  return {
    type: "image",
    data,
    mimeType: img.mimeType || "image/png",
  };
}

export interface AppState {
  initialized: boolean;
  config: NewApiConfig;
  settings: AppSettings;
  authSession: AuthSession | null;
  siteStatus?: NewApiSiteStatus;
  checkingExistingSession: boolean;
  authBusy: boolean;
  authProgress?: string;
  authError?: string;
  commandPaletteOpen: boolean;
  models: ModelInfo[];
  modelsLoading: boolean;
  modelsError?: string;
  billing?: BillingInfo;
  billingLoading: boolean;
  sessions: ChatSession[];
  activeSessionId: string;
  isStreaming: boolean;
  runningSessionIds: Record<string, boolean>;
  unreadCompletedSessionIds: Record<string, boolean>;
  pendingApprovalsBySession: Record<string, ApprovalRequest>;
  pendingQuestionnairesBySession: Record<string, QuestionnaireRequest>;
  sessionAllowedTools: Record<string, string[]>;
  queuedMessagesBySession: Record<string, QueuedMessageItem[]>;
  diffReviewOpen: boolean;
  projectInstructionPath: string | null;
  files: WorkspaceFileMeta[];
  activePreviewPath: string | null;
  previewRevision: number;
  previewOpen: boolean;
  previewExpanded: boolean;
  customSkills: SkillTemplate[];
  activeSkillId?: string;
  workspaces: WorkspaceProfile[];
  activeWorkspaceId: string;
  pendingApproval: ApprovalRequest | null;
  pendingQuestionnaire: QuestionnaireRequest | null;
  tokenBurden?: TokenBurdenReport;
  composerDraft?: string;
  settingsOpen: boolean;
  shortcutHelpOpen: boolean;
  mobileTab: MobileTab;
  statusBanner?: string;
  /** 全局轻提示队列 */
  toasts: ToastItem[];

  init: () => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
  setShortcutHelpOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setMobileTab: (tab: MobileTab) => void;
  setPreviewOpen: (open: boolean) => void;
  setPreviewExpanded: (expanded: boolean) => void;
  openPreview: (path: string) => void;
  closePreview: () => void;
  pushToast: (
    message: string,
    level?: ToastItem["level"],
    options?: { action?: ToastAction; durationMs?: number }
  ) => void;
  dismissToast: (id: string) => void;

  loginWithAccount: (
    baseUrl: string,
    username: string,
    password: string,
    turnstileToken?: string
  ) => Promise<void>;
  loginWithApiKey: (baseUrl: string, apiKey: string) => Promise<void>;
  enterGuestMode: () => Promise<void>;
  switchActiveToken: (tokenId: number) => Promise<void>;
  createAccountToken: (name: string) => Promise<NewApiTokenItem>;
  refreshAccountSession: () => Promise<void>;
  logout: () => Promise<void>;

  updateConfig: (patch: Partial<NewApiConfig>) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  toggleTheme: () => Promise<void>;
  toggleHighContrast: () => Promise<void>;
  toggleFavoriteModel: (modelId: string) => Promise<void>;
  dismissOnboarding: () => Promise<void>;
  testConnectionAndSync: () => Promise<ModelInfo[]>;
  refreshBilling: () => Promise<void>;

  createSession: () => Promise<void>;
  selectSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  exportSessionMarkdown: (id: string) => Promise<void>;

  sendMessage: (
    text: string,
    attachmentPaths?: string[],
    imageFiles?: File[],
    preloadedImages?: UiMessage["images"]
  ) => Promise<void>;
  regenerateMessage: (assistantMsgId: string) => Promise<void>;
  editAndResendMessage: (userMsgId: string, nextContent: string) => Promise<void>;
  branchFromMessage: (messageId: string) => Promise<void>;
  abortRun: (options?: { discardResult?: boolean; sessionId?: string }) => void;

  setPermissionMode: (mode: PermissionMode) => Promise<void>;
  cyclePermissionMode: () => Promise<PermissionMode>;
  approvePlanAndExecute: (sessionId?: string) => Promise<void>;
  setDiffReviewOpen: (open: boolean) => void;
  acceptSessionFileChange: (path: string) => Promise<void>;
  acceptAllSessionFileChanges: () => Promise<void>;
  revertSessionFileChange: (path: string) => Promise<void>;
  revertAllSessionFileChanges: () => Promise<void>;
  enqueueMessage: (text: string, attachmentPaths?: string[]) => void;
  removeQueuedMessage: (id: string, sessionId?: string) => void;
  sendQueuedMessageNow: (id: string, sessionId?: string) => Promise<void>;
  compactActiveSession: () => Promise<void>;
  openOrCreateProjectInstructions: () => Promise<void>;

  refreshFiles: () => Promise<void>;
  uploadFilesToWorkspace: (fileList: File[] | FileList) => Promise<WorkspaceFileMeta[]>;
  deleteWorkspaceFile: (path: string) => Promise<void>;
  renameWorkspaceFile: (oldPath: string, newPath: string) => Promise<void>;
  exportWorkspaceFile: (path: string) => Promise<void>;
  exportWorkspaceZip: () => Promise<void>;
  mountNativeDirectory: () => Promise<void>;
  createWorkspace: (name: string, nativeDir?: string) => Promise<WorkspaceProfile>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  openNativeFolderWorkspace: () => Promise<void>;

  setActiveSkill: (skillId?: string) => void;
  saveCustomSkill: (skill: SkillTemplate) => Promise<void>;
  deleteCustomSkill: (id: string) => Promise<void>;
  importSkillMarkdown: (rawMarkdown: string, fallbackName?: string) => Promise<SkillTemplate>;

  resolveApproval: (
    approved: boolean,
    options?: { rememberForSession?: boolean }
  ) => void;
  resolveQuestionnaire: (answers: Record<string, string[]> | null) => void;
  togglePlugin: (pluginId: string, enabled: boolean) => Promise<void>;
  toggleProtectedPath: (path: string) => Promise<boolean>;
  handoffActiveSession: (customPayload?: HandoffPayload) => Promise<void>;
  clearComposerDraft: () => void;
  resetAllData: () => Promise<void>;
}

const sessionRunners = new Map<string, PiAgentRunner>();
const manuallyAbortedSessions = new Set<string>();
let vfsUnsubscribe: (() => void) | null = null;
let nativeWatchStop: (() => void) | null = null;
let initPromise: Promise<void> | null = null;
let fileListSeq = 0;
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

function mergeSessionFileChanges(
  existing: SessionFileChange[] | undefined,
  incoming: SessionFileChange
): SessionFileChange[] {
  const list = existing ? [...existing] : [];
  const idx = list.findIndex((item) => item.path === incoming.path);
  if (idx < 0) {
    list.push(incoming);
    return list;
  }
  const prev = list[idx];
  // 同会话先创建后删除且未撤销，等于净零变动，直接移除记录
  if (prev.reviewed !== "reverted" && prev.action === "created" && incoming.action === "deleted") {
    list.splice(idx, 1);
    return list;
  }
  const keepBaseline = prev.reviewed !== "reverted";
  list[idx] = {
    path: incoming.path,
    action:
      keepBaseline && prev.action === "created" && incoming.action !== "deleted"
        ? "created"
        : incoming.action,
    toolName: incoming.toolName,
    summary: incoming.summary || prev.summary,
    beforeSnapshotId: keepBaseline
      ? prev.beforeSnapshotId ?? incoming.beforeSnapshotId
      : incoming.beforeSnapshotId,
    existedBefore: keepBaseline ? prev.existedBefore : incoming.existedBefore,
    updatedAt: incoming.updatedAt,
    reviewed: undefined,
  };
  return list;
}

async function syncNativeDirWatcher(nativeDir?: string): Promise<void> {
  if (nativeWatchStop) {
    try {
      nativeWatchStop();
    } catch {
      // 忽略清理异常
    }
    nativeWatchStop = null;
  }
  const cleanDir = nativeDir?.trim();
  if (!cleanDir) return;
  const platform = getPlatformAdapter();
  if (!platform.watchNativeDirectory) return;
  nativeWatchStop = await platform
    .watchNativeDirectory(cleanDir, () => {
      workspaceVfs.emitSync();
    })
    .catch(() => null);
}

export const useAppStore = create<AppState>((set, get) => {
  const getOrCreateRunner = (targetSessionId: string): PiAgentRunner => {
    const existing = sessionRunners.get(targetSessionId);
    if (existing) return existing;

    const runner = new PiAgentRunner(workspaceVfs, {
      onAssistantUpdate: (sessionId, assistantMsg) => {
        set((state) => {
          const sessions = state.sessions.map((s) => {
            if (s.id !== sessionId) return s;
            const idx = s.messages.findIndex((m) => m.id === assistantMsg.id);
            const nextMsgs =
              idx >= 0
                ? s.messages.map((m, i) => (i === idx ? assistantMsg : m))
                : [...s.messages, assistantMsg];
            const totalTokens = nextMsgs.reduce(
              (acc, m) => acc + (m.usage?.totalTokens || 0),
              0
            );
            return {
              ...s,
              messages: nextMsgs,
              totalTokens,
              updatedAt: Date.now(),
            };
          });
          return { sessions };
        });
      },
      onToolModifiedFile: (modifiedPath, sessionId) => {
        set((state) => {
          const isCurrent = !sessionId || sessionId === state.activeSessionId;
          if (isCurrent) {
            return {
              activePreviewPath: modifiedPath,
              previewOpen: true,
              previewRevision: state.previewRevision + 1,
            };
          }
          if (state.activePreviewPath === modifiedPath) {
            return { previewRevision: state.previewRevision + 1 };
          }
          return {};
        });
      },
      onSessionFileChanged: (sessionId, change) => {
        set((state) => {
          const sessions = state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  fileChanges: mergeSessionFileChanges(s.fileChanges, change),
                  updatedAt: Date.now(),
                }
              : s
          );
          const target = sessions.find((s) => s.id === sessionId);
          if (target) {
            saveSession(target).catch(() => undefined);
          }
          return { sessions };
        });
      },
      onAllowToolForSession: (sessionId, toolName) => {
        set((state) => {
          const prev = state.sessionAllowedTools[sessionId] || [];
          if (prev.includes(toolName)) return {};
          return {
            sessionAllowedTools: {
              ...state.sessionAllowedTools,
              [sessionId]: [...prev, toolName],
            },
          };
        });
      },
      onRequestApproval: (req) => {
        const sid = req.sessionId || targetSessionId;
        const enrichedReq: ApprovalRequest = { ...req, sessionId: sid };
        set((state) => {
          const nextMap = { ...state.pendingApprovalsBySession, [sid]: enrichedReq };
          return {
            pendingApprovalsBySession: nextMap,
            pendingApproval:
              sid === state.activeSessionId
                ? enrichedReq
                : nextMap[state.activeSessionId] ?? state.pendingApproval,
          };
        });
        if (sid !== get().activeSessionId) {
          const bgSession = get().sessions.find((s) => s.id === sid);
          get().pushToast(`后台会话「${bgSession?.title || "任务"}」等待您审批`, "warning", {
            durationMs: 6000,
            action: {
              label: "前往审批",
              onClick: () => get().selectSession(sid),
            },
          });
        }
      },
      onCancelApproval: (approvalId) => {
        set((state) => {
          const nextMap: Record<string, ApprovalRequest> = {};
          for (const [k, v] of Object.entries(state.pendingApprovalsBySession)) {
            if (v.id !== approvalId) nextMap[k] = v;
          }
          return {
            pendingApprovalsBySession: nextMap,
            pendingApproval: nextMap[state.activeSessionId] ?? null,
          };
        });
      },
      onUpdateTodos: (sessionId, todos) => {
        set((state) => {
          const sessions = state.sessions.map((s) =>
            s.id === sessionId ? { ...s, todos, updatedAt: Date.now() } : s
          );
          const target = sessions.find((s) => s.id === sessionId);
          if (target) {
            saveSession(target).catch(() => undefined);
          }
          return { sessions };
        });
      },
      onRequestQuestionnaire: (req) => {
        const sid = req.sessionId || targetSessionId;
        const enrichedReq: QuestionnaireRequest = { ...req, sessionId: sid };
        set((state) => {
          const nextMap = { ...state.pendingQuestionnairesBySession, [sid]: enrichedReq };
          return {
            pendingQuestionnairesBySession: nextMap,
            pendingQuestionnaire:
              sid === state.activeSessionId
                ? enrichedReq
                : nextMap[state.activeSessionId] ?? state.pendingQuestionnaire,
          };
        });
        if (sid !== get().activeSessionId) {
          const bgSession = get().sessions.find((s) => s.id === sid);
          get().pushToast(`后台会话「${bgSession?.title || "任务"}」需要确认偏好`, "info", {
            durationMs: 6000,
            action: {
              label: "前往查看",
              onClick: () => get().selectSession(sid),
            },
          });
        }
      },
      onCancelQuestionnaire: (id) => {
        set((state) => {
          const nextMap: Record<string, QuestionnaireRequest> = {};
          for (const [k, v] of Object.entries(state.pendingQuestionnairesBySession)) {
            if (v.id !== id) nextMap[k] = v;
          }
          return {
            pendingQuestionnairesBySession: nextMap,
            pendingQuestionnaire: nextMap[state.activeSessionId] ?? null,
          };
        });
      },
      onHandoffSession: async (payload) => {
        await get().handoffActiveSession(payload);
      },
      onTokenBurdenUpdate: (report) => {
        if (targetSessionId === get().activeSessionId) {
          set({ tokenBurden: report });
        }
      },
      onSubagentUsage: (sessionId, usage) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? { ...s, totalTokens: s.totalTokens + (usage.totalTokens || 0) }
              : s
          ),
        }));
      },
      onRunFinished: (sessionId) => {
        const wasManualAbort = manuallyAbortedSessions.has(sessionId);
        manuallyAbortedSessions.delete(sessionId);

        set((state) => {
          const nextRunning = { ...state.runningSessionIds };
          if (!sessionRunners.get(sessionId)?.isRunning()) {
            delete nextRunning[sessionId];
          }
          const isBg = sessionId !== state.activeSessionId;
          const nextUnread =
            isBg && !wasManualAbort
              ? { ...state.unreadCompletedSessionIds, [sessionId]: true }
              : state.unreadCompletedSessionIds;
          return {
            runningSessionIds: nextRunning,
            isStreaming: Boolean(nextRunning[state.activeSessionId]),
            unreadCompletedSessionIds: nextUnread,
          };
        });

        const finished = get().sessions.find((s) => s.id === sessionId);
        if (finished) {
          saveSession(finished).catch(() => undefined);
        }

        // 后台并行会话完成时推送站内 Toast +（失焦时）系统桌面通知
        if (sessionId !== get().activeSessionId && !wasManualAbort) {
          get().pushToast(`后台会话「${finished?.title || "任务"}」已完成`, "success", {
            durationMs: 6000,
            action: {
              label: "立即查看",
              onClick: () => get().selectSession(sessionId),
            },
          });
          if (
            typeof document !== "undefined" &&
            document.hidden &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            try {
              new Notification("Mizurisu Agent 任务已完成", {
                body: finished?.title || "点击返回工作台查看执行结果",
              });
            } catch {
              // 忽略不支持系统通知的环境
            }
          }
        }

        // 若该会话存在排队待发消息且非用户手动停止，自动出队续跑下一轮
        const queuedList = get().queuedMessagesBySession[sessionId];
        if (!wasManualAbort && queuedList && queuedList.length > 0) {
          const [nextItem, ...restQueue] = queuedList;
          set((state) => ({
            queuedMessagesBySession: {
              ...state.queuedMessagesBySession,
              [sessionId]: restQueue,
            },
          }));
          setTimeout(() => {
            const latestSession = get().sessions.find((s) => s.id === sessionId);
            if (!latestSession) return;
            const attachments = nextItem.attachmentPaths.map((p) => ({
              path: p,
              name: p.split("/").pop() || p,
              category: detectFileCategory(p),
            }));
            void dispatchPromptTurn({
              session: latestSession,
              historyBefore: [...latestSession.messages],
              text: nextItem.text,
              attachments,
            }).catch((err) => {
              get().pushToast(
                `排队消息执行失败：${err instanceof Error ? err.message : String(err)}`,
                "error"
              );
            });
          }, 0);
        }

        // 每次对话结束后轻量刷新余额
        const { config } = get();
        if (config.baseUrl && config.apiKey) {
          get().refreshBilling().catch(() => undefined);
        }
      },
    });
    sessionRunners.set(targetSessionId, runner);
    return runner;
  };

  /** 发送或重发单轮对话的统一调度器，保证历史裁剪、图片、权限模式与多会话并行一致 */
  const dispatchPromptTurn = async (params: {
    session: ChatSession;
    historyBefore: UiMessage[];
    text: string;
    attachments?: UiMessage["attachments"];
    imagesMeta?: UiMessage["images"];
    imageContents?: ImageContent[];
    permissionModeOverride?: PermissionMode;
  }) => {
    const runner = getOrCreateRunner(params.session.id);
    const { config, models, settings, customSkills, activeSkillId, sessionAllowedTools } = get();
    const effectiveMode: PermissionMode =
      params.permissionModeOverride ?? settings.permissionMode ?? "auto-edits";
    manuallyAbortedSessions.delete(params.session.id);

    const userMsg: UiMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_u`,
      role: "user",
      content: params.text,
      attachments: params.attachments ?? [],
      ...(params.imagesMeta && params.imagesMeta.length > 0
        ? { images: params.imagesMeta }
        : {}),
      createdAt: Date.now(),
    };

    const titleSource =
      params.text.trim() ||
      (params.imagesMeta && params.imagesMeta.length > 0
        ? `图片分析 (${params.imagesMeta[0].name || "图片"})`
        : params.attachments && params.attachments.length > 0
          ? `文件处理 (${params.attachments[0].name})`
          : "新对话");

    const nextTitle =
      params.historyBefore.length === 0
        ? titleSource.slice(0, 22) + (titleSource.length > 22 ? "..." : "")
        : params.session.title;

    const historyTokens = params.historyBefore.reduce(
      (acc, m) => acc + (m.usage?.totalTokens || 0),
      0
    );

    const updatedSession: ChatSession = {
      ...params.session,
      title: nextTitle,
      messages: [...params.historyBefore, userMsg],
      totalTokens: historyTokens,
      updatedAt: Date.now(),
    };

    set((state) => {
      const nextRunning = { ...state.runningSessionIds, [params.session.id]: true };
      return {
        runningSessionIds: nextRunning,
        isStreaming: Boolean(nextRunning[state.activeSessionId]),
        sessions: state.sessions.map((s) =>
          s.id === params.session.id ? updatedSession : s
        ),
      };
    });
    await saveSession(updatedSession);

    const allSkills = [...BUILTIN_SKILLS, ...customSkills];
    const activeSkill = allSkills.find((s) => s.id === activeSkillId);

    await runner.runTurn({
      sessionId: params.session.id,
      userMessage: userMsg,
      historyBeforeUser: params.historyBefore,
      config,
      models,
      settings,
      activeSkill,
      images:
        params.imageContents && params.imageContents.length > 0
          ? params.imageContents
          : undefined,
      initialTodos: params.session.todos,
      permissionMode: effectiveMode,
      sessionAllowedTools: sessionAllowedTools[params.session.id] || [],
    });
  };

  return {
    initialized: false,
    config: getDefaultConfig(),
    settings: getDefaultSettings(),
    authSession: null,
    checkingExistingSession: false,
    authBusy: false,
    commandPaletteOpen: false,
    models: [],
    modelsLoading: false,
    billingLoading: false,
    sessions: [],
    activeSessionId: "",
    isStreaming: false,
    runningSessionIds: {},
    unreadCompletedSessionIds: {},
    pendingApprovalsBySession: {},
    pendingQuestionnairesBySession: {},
    sessionAllowedTools: {},
    queuedMessagesBySession: {},
    diffReviewOpen: false,
    projectInstructionPath: null,
    files: [],
    activePreviewPath: null,
    previewRevision: 0,
    previewOpen: false,
    previewExpanded: false,
    customSkills: [],
    workspaces: [DEFAULT_WORKSPACE],
    activeWorkspaceId: "default",
    pendingApproval: null,
    pendingQuestionnaire: null,
    settingsOpen: false,
    shortcutHelpOpen: false,
    mobileTab: "chat",
    toasts: [],

    init: async () => {
      if (get().initialized) return;
      if (initPromise) return initPromise;

      initPromise = (async () => {
        try {
          const [
            savedConfig,
            savedSettings,
            savedAuthSession,
            savedSessions,
            savedSkills,
            savedWorkspaces,
            savedActiveWorkspaceId,
          ] = await Promise.all([
            kvGet<NewApiConfig>("newapi_config"),
            kvGet<AppSettings>("app_settings"),
            kvGet<AuthSession | null>("auth_session"),
            loadAllSessions(),
            dbListCustomSkills(),
            kvGet<WorkspaceProfile[]>("workspaces_meta"),
            kvGet<string>("active_workspace_id"),
          ]);

          const defaultsConfig = getDefaultConfig();
          let config: NewApiConfig = {
            ...defaultsConfig,
            ...savedConfig,
            baseUrl: savedConfig?.baseUrl?.trim() || defaultsConfig.baseUrl,
            brandName:
              savedConfig?.brandName?.trim() &&
              savedConfig.brandName !== "PiDesk" &&
              savedConfig.brandName !== "Mizurisu Agent"
                ? savedConfig.brandName
                : defaultsConfig.brandName,
          };
          const defaults = getDefaultSettings();
          const settings: AppSettings = {
            ...defaults,
            ...savedSettings,
            previewWidth:
              typeof savedSettings?.previewWidth === "number" && savedSettings.previewWidth > 0
                ? savedSettings.previewWidth
                : defaults.previewWidth,
          };
          applyThemeToDocument(settings.theme, settings.highContrast);

          let authSession: AuthSession | null = savedAuthSession ?? null;
          // 兼容旧版本已保存 baseUrl + apiKey 但尚无 auth_session 记录的场景
          if (savedAuthSession === undefined && config.baseUrl.trim() && config.apiKey.trim()) {
            authSession = {
              mode: "apikey",
              baseUrl: normalizeNewApiBaseUrl(config.baseUrl),
              tokens: [],
              activeApiKey: normalizeApiKey(config.apiKey),
              loggedInAt: Date.now(),
            };
          }

          if (authSession && authSession.mode !== "guest") {
            config = {
              ...config,
              baseUrl: authSession.baseUrl || config.baseUrl,
              apiKey: authSession.activeApiKey || config.apiKey,
            };
          }

          let workspaces: WorkspaceProfile[] =
            savedWorkspaces && savedWorkspaces.length > 0
              ? savedWorkspaces
              : [
                  {
                    ...DEFAULT_WORKSPACE,
                    ...(settings.mountedNativeDir ? { nativeDir: settings.mountedNativeDir } : {}),
                  },
                ];
          if (!workspaces.some((w) => w.id === "default")) {
            workspaces = [DEFAULT_WORKSPACE, ...workspaces];
          }
          const activeWorkspaceId =
            savedActiveWorkspaceId && workspaces.some((w) => w.id === savedActiveWorkspaceId)
              ? savedActiveWorkspaceId
              : "default";
          const activeWs = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];

          workspaceVfs.setActiveWorkspace(activeWorkspaceId, activeWs.nativeDir);
          await syncNativeDirWatcher(activeWs.nativeDir);

          await workspaceVfs.seedStarterWorkspaceIfEmpty();
          const files = await workspaceVfs.listFiles();

          let sessions = savedSessions;
          const wsSessions = sessions.filter(
            (s) => (s.workspaceId || "default") === activeWorkspaceId
          );
          if (wsSessions.length === 0) {
            const first = createEmptySession("新对话", activeWorkspaceId);
            sessions = [first, ...sessions];
            await saveSession(first);
          }

          if (!vfsUnsubscribe) {
            vfsUnsubscribe = workspaceVfs.subscribe((ev) => {
              // 同步处理预览路径状态转换，消除 rename 期间异步刷新带来的闪烁与空态误清
              if (ev.type === "rename" && ev.path && ev.previousPath) {
                set((state) => {
                  if (state.activePreviewPath !== ev.previousPath) return {};
                  return {
                    activePreviewPath: ev.path,
                    previewRevision: state.previewRevision + 1,
                  };
                });
              } else if (ev.type === "delete" && ev.path) {
                set((state) => {
                  if (state.activePreviewPath !== ev.path) return {};
                  return { activePreviewPath: null };
                });
              } else if (ev.type === "write" && ev.path) {
                set((state) => {
                  if (state.activePreviewPath !== ev.path) return {};
                  return { previewRevision: state.previewRevision + 1 };
                });
              } else if (ev.type === "sync") {
                set((state) =>
                  state.activePreviewPath
                    ? { previewRevision: state.previewRevision + 1 }
                    : {}
                );
              }

              const seq = ++fileListSeq;
              workspaceVfs
                .listFiles()
                .then((nextFiles) => {
                  if (seq !== fileListSeq) return;
                  set({
                    files: nextFiles,
                    projectInstructionPath: findProjectInstructionFile(nextFiles)?.path ?? null,
                  });
                })
                .catch(() => undefined);
            });
          }

          const starterPreview =
            files.find((f) => f.path.endsWith(".xlsx"))?.path ?? files[0]?.path ?? null;

          const firstWsSession =
            sessions.find((s) => (s.workspaceId || "default") === activeWorkspaceId) ?? sessions[0];

          set({
            initialized: true,
            config,
            settings,
            authSession,
            siteStatus: authSession?.siteStatus,
            sessions,
            activeSessionId: firstWsSession.id,
            files,
            projectInstructionPath: findProjectInstructionFile(files)?.path ?? null,
            customSkills: savedSkills,
            workspaces,
            activeWorkspaceId,
            activePreviewPath: starterPreview,
            previewOpen: Boolean(starterPreview),
          });

          const platform = getPlatformAdapter();

          // 1. 优先处理从 Mizurisu / New-API 后台一键跳转携带的一次性 Key
          if (typeof window !== "undefined") {
            const urlAuth = extractAuthFromUrl(window.location.href);
            if (urlAuth) {
              try {
                const cleanUrl = `${window.location.origin}${window.location.pathname}`;
                window.history.replaceState({}, document.title, cleanUrl);
              } catch {
                // 忽略 history 替换限制
              }
              await get()
                .loginWithApiKey(urlAuth.baseUrl || config.baseUrl, urlAuth.apiKey)
                .catch(() => undefined);
              return;
            }
          }

          if (authSession && authSession.mode !== "guest") {
            get().testConnectionAndSync().catch(() => undefined);
            if (authSession.mode === "account") {
              get()
                .refreshAccountSession()
                .catch(() => {
                  set({ authError: undefined });
                });
            }
            return;
          }

          // 2. 未本地登录时：静默拉取站点元信息并探测浏览器同源会话（若已在站点登录则免二次登录直接进工作台）
          if (!authSession && config.baseUrl.trim()) {
            set({ checkingExistingSession: true });
            try {
              const [status, resumed] = await Promise.all([
                fetchSiteStatus(config.baseUrl, platform).catch(() => undefined),
                tryResumeExistingSession(config.baseUrl, platform).catch(() => null),
              ]);

              if (status) {
                set({ siteStatus: status });
              }

              if (resumed) {
                const nextConfig: NewApiConfig = {
                  ...get().config,
                  baseUrl: resumed.baseUrl,
                  apiKey: resumed.activeApiKey,
                  brandName: resumed.siteStatus?.systemName || get().config.brandName,
                };
                await Promise.all([
                  kvSet("auth_session", resumed),
                  kvSet("newapi_config", nextConfig),
                ]);
                set({
                  authSession: resumed,
                  siteStatus: resumed.siteStatus ?? status,
                  config: nextConfig,
                  checkingExistingSession: false,
                });
                await get().testConnectionAndSync().catch(() => undefined);
                return;
              }
            } finally {
              set({ checkingExistingSession: false });
            }
          }
        } finally {
          initPromise = null;
        }
      })();

      return initPromise;
    },

    setSettingsOpen: (open) => set({ settingsOpen: open }),
    setShortcutHelpOpen: (open) => set({ shortcutHelpOpen: open }),
    setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    setMobileTab: (tab) => set({ mobileTab: tab }),
    setPreviewOpen: (open) => set({ previewOpen: open }),
    setPreviewExpanded: (expanded) => set({ previewExpanded: expanded }),

    openPreview: (path) => {
      set((state) => ({
        activePreviewPath: path,
        previewOpen: true,
        mobileTab: "preview",
        previewRevision: state.previewRevision + 1,
      }));
    },

    closePreview: () => set({ previewOpen: false, previewExpanded: false }),

    pushToast: (message, level = "info", options) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const durationMs = options?.durationMs ?? (options?.action ? 6000 : 4000);
      const timer = setTimeout(() => {
        get().dismissToast(id);
      }, durationMs);
      toastTimers.set(id, timer);
      const item: ToastItem = {
        id,
        level,
        message,
        ...(options?.action ? { action: options.action } : {}),
        ...(options?.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
      };
      set((state) => {
        const combined = [...state.toasts, item];
        if (combined.length > 4) {
          const overflowCount = combined.length - 4;
          const evicted = combined.slice(0, overflowCount);
          for (const entry of evicted) {
            const staleTimer = toastTimers.get(entry.id);
            if (staleTimer) {
              clearTimeout(staleTimer);
              toastTimers.delete(entry.id);
            }
          }
          return { toasts: combined.slice(overflowCount) };
        }
        return { toasts: combined };
      });
    },

    dismissToast: (id) => {
      const timer = toastTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        toastTimers.delete(id);
      }
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    },

    loginWithAccount: async (baseUrl, username, password, turnstileToken) => {
      set({
        authBusy: true,
        authError: undefined,
        authProgress: "正在连接中转站...",
      });
      try {
        const platform = getPlatformAdapter();
        const session = await authenticateAndBootstrapKey(
          {
            baseUrl,
            username,
            password,
            turnstileToken,
            onProgress: (message) => set({ authProgress: message }),
          },
          platform
        );

        const nextConfig: NewApiConfig = {
          ...get().config,
          baseUrl: session.baseUrl,
          apiKey: session.activeApiKey,
          brandName: session.siteStatus?.systemName || get().config.brandName,
        };

        await Promise.all([
          kvSet("auth_session", session),
          kvSet("newapi_config", nextConfig),
        ]);

        set({
          authSession: session,
          siteStatus: session.siteStatus ?? get().siteStatus,
          config: nextConfig,
          authProgress: "正在同步站点模型列表...",
        });

        await get().testConnectionAndSync().catch(() => undefined);
        set({ authBusy: false, authProgress: undefined, authError: undefined });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ authBusy: false, authProgress: undefined, authError: msg });
        throw err;
      }
    },

    loginWithApiKey: async (baseUrl, apiKey) => {
      const root = normalizeNewApiBaseUrl(baseUrl);
      const cleanKey = normalizeApiKey(apiKey);
      if (!root) {
        const msg = "请先填写 New-API 中转站地址";
        set({ authError: msg });
        throw new Error(msg);
      }
      if (!cleanKey) {
        const msg = "请先填写有效的 API Key";
        set({ authError: msg });
        throw new Error(msg);
      }

      set({
        authBusy: true,
        authError: undefined,
        authProgress: "正在验证 API Key 并拉取模型...",
      });

      try {
        const platform = getPlatformAdapter();
        const tempConfig: NewApiConfig = {
          ...get().config,
          baseUrl: root,
          apiKey: cleanKey,
        };

        const models = await fetchNewApiModels(tempConfig, platform.getFetch());
        const nextSelected = pickDefaultStationModel(
          models,
          tempConfig.selectedModelId || undefined
        );
        const nextConfig: NewApiConfig = {
          ...tempConfig,
          selectedModelId: nextSelected,
        };

        const siteStatus = await fetchSiteStatus(root, platform).catch(() => undefined);
        const session: AuthSession = {
          mode: "apikey",
          baseUrl: root,
          siteStatus,
          tokens: [],
          activeApiKey: cleanKey,
          loggedInAt: Date.now(),
        };

        await Promise.all([
          kvSet("auth_session", session),
          kvSet("newapi_config", nextConfig),
        ]);

        set({
          authSession: session,
          config: nextConfig,
          models,
          modelsLoading: false,
          modelsError: undefined,
          authBusy: false,
          authProgress: undefined,
          authError: undefined,
        });

        get().refreshBilling().catch(() => undefined);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ authBusy: false, authProgress: undefined, authError: msg });
        throw err;
      }
    },

    enterGuestMode: async () => {
      const session: AuthSession = {
        mode: "guest",
        baseUrl: get().config.baseUrl,
        tokens: [],
        activeApiKey: "",
        loggedInAt: Date.now(),
      };
      await kvSet("auth_session", session);
      set({
        authSession: session,
        authBusy: false,
        authProgress: undefined,
        authError: undefined,
      });
    },

    switchActiveToken: async (tokenId) => {
      const current = get().authSession;
      if (!current || current.mode !== "account" || !current.baseUrl) {
        throw new Error("当前非账号登录会话，无法切换令牌");
      }
      const target = current.tokens.find((t) => t.id === tokenId);
      if (!target) {
        throw new Error("未找到指定的令牌");
      }

      set({ authBusy: true, authError: undefined, authProgress: "正在切换令牌..." });
      try {
        const platform = getPlatformAdapter();
        const authHeaders = buildNewApiAuthHeaders(current.user?.id, current.accessToken);
        const plaintext = await resolvePlaintextKeyForToken(
          current.baseUrl,
          target,
          authHeaders,
          platform
        );
        if (!plaintext) {
          throw new Error("未能获取该令牌的明文 Key，请新建一个令牌使用");
        }

        const nextTokens = current.tokens.map((t) =>
          t.id === tokenId
            ? { ...t, key: plaintext, maskedKey: maskApiKey(plaintext) }
            : t
        );
        const nextSession: AuthSession = {
          ...current,
          tokens: nextTokens,
          activeTokenId: tokenId,
          activeApiKey: plaintext,
        };
        const nextConfig: NewApiConfig = {
          ...get().config,
          baseUrl: current.baseUrl,
          apiKey: plaintext,
        };

        await Promise.all([
          kvSet("auth_session", nextSession),
          kvSet("newapi_config", nextConfig),
        ]);

        set({
          authSession: nextSession,
          config: nextConfig,
          authBusy: false,
          authProgress: undefined,
        });

        get().testConnectionAndSync().catch(() => undefined);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ authBusy: false, authProgress: undefined, authError: msg });
        throw err;
      }
    },

    createAccountToken: async (name) => {
      const current = get().authSession;
      if (!current || current.mode !== "account" || !current.baseUrl) {
        throw new Error("请先使用 New-API 账号密码登录后再创建令牌");
      }

      set({ authBusy: true, authError: undefined, authProgress: "正在创建新令牌..." });
      try {
        const platform = getPlatformAdapter();
        const authHeaders = buildNewApiAuthHeaders(current.user?.id, current.accessToken);
        const created = await createNewApiToken(current.baseUrl, authHeaders, platform, {
          name: name.trim() || "Mizurisu Agent",
          group: current.user?.group,
        });

        const refreshed = await fetchUserTokens(
          current.baseUrl,
          authHeaders,
          platform
        ).catch(() => [] as NewApiTokenItem[]);

        const cachedPlain = new Map<number, NewApiTokenItem>();
        for (const old of current.tokens) {
          if (old.key && !isMaskedKey(old.key)) {
            cachedPlain.set(old.id, old);
          }
        }
        cachedPlain.set(created.id, created);

        let nextTokens: NewApiTokenItem[];
        if (refreshed.length > 0) {
          const merged = refreshed.map((t) => {
            const cached = cachedPlain.get(t.id);
            if (cached && (!t.key || isMaskedKey(t.key))) {
              return { ...t, key: cached.key, maskedKey: cached.maskedKey };
            }
            return t;
          });
          nextTokens = merged.some((t) => t.id === created.id)
            ? merged
            : [created, ...merged];
        } else {
          nextTokens = [created, ...current.tokens.filter((t) => t.id !== created.id)];
        }

        const nextSession: AuthSession = {
          ...current,
          tokens: nextTokens,
          activeTokenId: created.id,
          activeApiKey: created.key,
        };
        const nextConfig: NewApiConfig = {
          ...get().config,
          baseUrl: current.baseUrl,
          apiKey: created.key,
        };

        await Promise.all([
          kvSet("auth_session", nextSession),
          kvSet("newapi_config", nextConfig),
        ]);

        set({
          authSession: nextSession,
          config: nextConfig,
          authBusy: false,
          authProgress: undefined,
        });

        get().testConnectionAndSync().catch(() => undefined);

        return created;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ authBusy: false, authProgress: undefined, authError: msg });
        throw err;
      }
    },

    refreshAccountSession: async () => {
      const current = get().authSession;
      if (!current || current.mode === "guest" || !current.baseUrl) return;

      if (current.mode === "apikey") {
        await get().testConnectionAndSync();
        return;
      }

      set({ authError: undefined });
      try {
        const platform = getPlatformAdapter();
        const authHeaders = buildNewApiAuthHeaders(current.user?.id, current.accessToken);

        const [siteStatus, user, freshTokens] = await Promise.all([
          fetchSiteStatus(current.baseUrl, platform).catch(() => current.siteStatus),
          fetchUserSelf(current.baseUrl, authHeaders, platform),
          fetchUserTokens(current.baseUrl, authHeaders, platform),
        ]);

        const cachedPlain = new Map<number, NewApiTokenItem>();
        for (const old of current.tokens) {
          if (old.key && !isMaskedKey(old.key)) {
            cachedPlain.set(old.id, old);
          }
        }

        const nextTokens = freshTokens.map((t) => {
          const cached = cachedPlain.get(t.id);
          if (cached && (!t.key || isMaskedKey(t.key))) {
            return { ...t, key: cached.key, maskedKey: cached.maskedKey };
          }
          return t;
        });

        const nextSession: AuthSession = {
          ...current,
          username: user.username,
          user,
          siteStatus,
          tokens: nextTokens,
        };

        await kvSet("auth_session", nextSession);
        set({ authSession: nextSession });
        get().refreshBilling().catch(() => undefined);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ authError: msg });
        throw err;
      }
    },

    logout: async () => {
      const current = get().authSession;
      const platform = getPlatformAdapter();
      if (current?.mode === "account" && current.baseUrl) {
        const authHeaders = buildNewApiAuthHeaders(
          current.user?.id,
          current.accessToken
        );
        await logoutNewApiAccount(current.baseUrl, authHeaders, platform).catch(
          () => undefined
        );
      } else {
        await platform.clearSessionCookies?.().catch(() => undefined);
      }

      const nextConfig: NewApiConfig = {
        ...get().config,
        apiKey: "",
      };

      await Promise.all([
        kvSet("auth_session", null),
        kvSet("newapi_config", nextConfig),
      ]);

      set({
        authSession: null,
        authBusy: false,
        authProgress: undefined,
        authError: undefined,
        config: nextConfig,
        models: [],
        modelsError: undefined,
        billing: undefined,
        settingsOpen: false,
        commandPaletteOpen: false,
      });
    },

    updateConfig: async (patch) => {
      const next = { ...get().config, ...patch };
      const currentAuth = get().authSession;
      let nextAuth = currentAuth;
      if (
        currentAuth?.mode === "apikey" &&
        (patch.baseUrl !== undefined || patch.apiKey !== undefined)
      ) {
        nextAuth = {
          ...currentAuth,
          baseUrl: normalizeNewApiBaseUrl(next.baseUrl),
          activeApiKey: next.apiKey,
        };
      }
      set({ config: next, authSession: nextAuth });
      await kvSet("newapi_config", next);
      if (nextAuth !== currentAuth) {
        await kvSet("auth_session", nextAuth);
      }
    },

    updateSettings: async (patch) => {
      const next = { ...get().settings, ...patch };
      applyThemeToDocument(next.theme, next.highContrast);
      set({ settings: next });
      await kvSet("app_settings", next);
    },

    toggleTheme: async () => {
      const nextTheme = get().settings.theme === "dark" ? "light" : "dark";
      await get().updateSettings({ theme: nextTheme });
    },

    toggleHighContrast: async () => {
      const nextHighContrast = !Boolean(get().settings.highContrast);
      await get().updateSettings({ highContrast: nextHighContrast });
    },

    toggleFavoriteModel: async (modelId) => {
      const clean = modelId.trim();
      if (!clean) return;
      const current = get().settings.favoriteModels || [];
      const next = current.includes(clean)
        ? current.filter((id) => id !== clean)
        : [...current, clean];
      await get().updateSettings({ favoriteModels: next });
    },

    dismissOnboarding: async () => {
      await get().updateSettings({ onboardingDismissed: true });
    },

    testConnectionAndSync: async () => {
      const { config, authSession } = get();
      set({ modelsLoading: true, modelsError: undefined });
      try {
        const platform = getPlatformAdapter();
        const fetchImpl = platform.getFetch();
        const sessionFallback =
          authSession?.mode === "account"
            ? {
                sessionRequest: platform.sessionRequest.bind(platform),
                authHeaders: buildNewApiAuthHeaders(
                  authSession.user?.id,
                  authSession.accessToken
                ),
              }
            : undefined;
        const models = await fetchNewApiModels(config, fetchImpl, sessionFallback);
        const nextSelected = pickDefaultStationModel(
          models,
          config.selectedModelId || undefined
        );
        if (nextSelected !== config.selectedModelId) {
          await get().updateConfig({ selectedModelId: nextSelected });
        }
        set({ models, modelsLoading: false });
        get().refreshBilling().catch(() => undefined);
        return models;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ modelsLoading: false, modelsError: msg });
        throw err;
      }
    },

    refreshBilling: async () => {
      const { config } = get();
      if (!config.baseUrl || !config.apiKey) return;
      set({ billingLoading: true });
      const billing = await fetchNewApiBilling(config, getPlatformAdapter().getFetch());
      set({ billing, billingLoading: false });
    },

    createSession: async () => {
      // 多会话真并行：新建会话不再强行中止后台正在运行的其他会话
      const next = createEmptySession("新对话", get().activeWorkspaceId);
      set((state) => ({
        sessions: [next, ...state.sessions],
        activeSessionId: next.id,
        isStreaming: Boolean(state.runningSessionIds[next.id]),
        pendingApproval: state.pendingApprovalsBySession[next.id] ?? null,
        pendingQuestionnaire: state.pendingQuestionnairesBySession[next.id] ?? null,
        mobileTab: "chat",
      }));
      await saveSession(next);
    },

    selectSession: (id) => {
      const stateBefore = get();
      if (id === stateBefore.activeSessionId) {
        if (stateBefore.unreadCompletedSessionIds[id]) {
          const nextUnread = { ...stateBefore.unreadCompletedSessionIds };
          delete nextUnread[id];
          set({ unreadCompletedSessionIds: nextUnread, mobileTab: "chat" });
        } else {
          set({ mobileTab: "chat" });
        }
        return;
      }
      // 多会话真并行：切走会话时后台会话继续运行，同步更新当前视图的流式/审批/问卷派生状态
      set((state) => {
        const nextUnread = { ...state.unreadCompletedSessionIds };
        delete nextUnread[id];
        return {
          activeSessionId: id,
          mobileTab: "chat",
          isStreaming: Boolean(state.runningSessionIds[id]),
          pendingApproval: state.pendingApprovalsBySession[id] ?? null,
          pendingQuestionnaire: state.pendingQuestionnairesBySession[id] ?? null,
          unreadCompletedSessionIds: nextUnread,
        };
      });
    },

    deleteSession: async (id) => {
      const target = get().sessions.find((s) => s.id === id);
      const snapshot: ChatSession | null = target
        ? {
            ...target,
            messages: target.messages.map((m) => ({ ...m })),
          }
        : null;
      if (
        get().runningSessionIds[id] ||
        get().pendingApprovalsBySession[id] ||
        get().pendingQuestionnairesBySession[id]
      ) {
        get().abortRun({ discardResult: true, sessionId: id });
      }
      sessionRunners.delete(id);
      await deleteSessionById(id);
      const activeWsId = get().activeWorkspaceId;
      const remaining = get().sessions.filter((s) => s.id !== id);
      const wsRemaining = remaining.filter((s) => (s.workspaceId || "default") === activeWsId);
      if (wsRemaining.length === 0) {
        const fresh = createEmptySession("新对话", activeWsId);
        await saveSession(fresh);
        set({
          sessions: [fresh, ...remaining],
          activeSessionId: fresh.id,
          isStreaming: false,
          pendingApproval: null,
          pendingQuestionnaire: null,
        });
      } else {
        set((state) => {
          const nextActiveId =
            state.activeSessionId === id ? wsRemaining[0].id : state.activeSessionId;
          return {
            sessions: remaining,
            activeSessionId: nextActiveId,
            isStreaming: Boolean(state.runningSessionIds[nextActiveId]),
            pendingApproval: state.pendingApprovalsBySession[nextActiveId] ?? null,
            pendingQuestionnaire: state.pendingQuestionnairesBySession[nextActiveId] ?? null,
          };
        });
      }
      if (snapshot) {
        get().pushToast(`已删除会话「${snapshot.title}」`, "info", {
          durationMs: 6000,
          action: {
            label: "撤销",
            onClick: async () => {
              await saveSession(snapshot);
              set((state) => {
                if (state.sessions.some((s) => s.id === snapshot.id)) {
                  return { activeSessionId: snapshot.id };
                }
                const merged = [snapshot, ...state.sessions].sort(
                  (a, b) => b.updatedAt - a.updatedAt
                );
                return { sessions: merged, activeSessionId: snapshot.id };
              });
            },
          },
        });
      }
    },

    renameSession: async (id, title) => {
      const nextTitle = title.trim();
      if (!nextTitle) return;
      const target = get().sessions.find((s) => s.id === id);
      if (!target) return;
      const updated: ChatSession = {
        ...target,
        title: nextTitle,
        updatedAt: Date.now(),
      };
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === id ? updated : s)),
      }));
      await saveSession(updated);
    },

    exportSessionMarkdown: async (id) => {
      const target = get().sessions.find((s) => s.id === id);
      if (!target) {
        throw new Error("未找到需要导出的会话记录");
      }
      const markdown = formatSessionToMarkdown(target);
      const filename = `${sanitizeFilename(target.title, "mizurisu-chat")}-${formatYmd()}.md`;
      const bytes = new TextEncoder().encode(markdown);
      await getPlatformAdapter().exportFile(
        filename,
        bytes,
        "text/markdown;charset=utf-8"
      );
      get().pushToast(`已导出对话记录：${filename}`, "success");
    },

    sendMessage: async (text, attachmentPaths = [], imageFiles = [], preloadedImages = []) => {
      const trimmed = text.trim();
      const hasText = trimmed.length > 0;
      const hasAttachments = attachmentPaths.length > 0;
      const hasImages = imageFiles.length > 0 || preloadedImages.length > 0;
      if (!hasText && !hasAttachments && !hasImages) return;

      const { activeSessionId, sessions, config, runningSessionIds } = get();
      const runner = getOrCreateRunner(activeSessionId);

      // 若当前会话正在生成且用户发送消息，触发中途插话引导并持久化该条消息
      if ((runningSessionIds[activeSessionId] || runner.isRunning()) && runner.isRunning()) {
        const steerText =
          trimmed ||
          (hasImages
            ? "请查看并分析我补充发送的图片内容。"
            : "请读取并分析我补充附带的工作区文件。");
        const steerMsg: UiMessage = {
          id: `msg_${Date.now()}_steer`,
          role: "user",
          content: `[中途补充引导] ${steerText}`,
          createdAt: Date.now(),
        };
        let updatedForSave: ChatSession | undefined;
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== activeSessionId) return s;
            updatedForSave = {
              ...s,
              messages: [...s.messages, steerMsg],
              updatedAt: Date.now(),
            };
            return updatedForSave;
          }),
        }));
        if (updatedForSave) {
          saveSession(updatedForSave).catch(() => undefined);
        }
        runner.steer(steerText);
        return;
      }

      if (!config.baseUrl.trim() || !config.apiKey.trim()) {
        set({ settingsOpen: true });
        throw new Error("请先在设置中配置 New-API 中转站地址与 API Key");
      }

      const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
      if (!session) return;

      const imagesMeta: NonNullable<UiMessage["images"]> = [];
      const imageContents: ImageContent[] = [];

      for (const pre of preloadedImages) {
        imagesMeta.push(pre);
        const content = dataUrlToImageContent(pre);
        if (content) {
          imageContents.push(content);
        }
      }

      for (const img of imageFiles) {
        const dataUrl = await fileToDataUrl(img);
        const mimeType = img.type || "image/png";
        imagesMeta.push({
          name: img.name || "image.png",
          mimeType,
          dataUrl,
        });
        const content = dataUrlToImageContent({ mimeType, dataUrl });
        if (content) {
          imageContents.push(content);
        }
      }

      const attachments = attachmentPaths.map((p) => ({
        path: p,
        name: p.split("/").pop() || p,
        category: detectFileCategory(p),
      }));

      await dispatchPromptTurn({
        session,
        historyBefore: [...session.messages],
        text: trimmed,
        attachments,
        imagesMeta,
        imageContents,
      });
    },

    regenerateMessage: async (assistantMsgId) => {
      const { activeSessionId, sessions, config, isStreaming, pendingApproval } = get();
      if (!config.baseUrl.trim() || !config.apiKey.trim()) {
        set({ settingsOpen: true });
        throw new Error("请先在设置中配置 New-API 中转站地址与 API Key");
      }

      const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
      if (!session) return;

      const assistantIdx = session.messages.findIndex((m) => m.id === assistantMsgId);
      if (assistantIdx < 0 || session.messages[assistantIdx].role !== "assistant") {
        return;
      }

      let userIdx = -1;
      for (let i = assistantIdx - 1; i >= 0; i--) {
        if (session.messages[i].role === "user") {
          userIdx = i;
          break;
        }
      }
      if (userIdx < 0) return;

      if (isStreaming || pendingApproval) {
        get().abortRun({ discardResult: true });
      }

      const targetUserMsg = session.messages[userIdx];
      const historyBefore = session.messages.slice(0, userIdx);
      const imageContents = (targetUserMsg.images || [])
        .map(dataUrlToImageContent)
        .filter((item): item is ImageContent => Boolean(item));

      await dispatchPromptTurn({
        session,
        historyBefore,
        text: targetUserMsg.content,
        attachments: targetUserMsg.attachments,
        imagesMeta: targetUserMsg.images,
        imageContents,
      });
    },

    editAndResendMessage: async (userMsgId, nextContent) => {
      const trimmed = nextContent.trim();

      const { activeSessionId, sessions, config, isStreaming, pendingApproval } = get();
      if (!config.baseUrl.trim() || !config.apiKey.trim()) {
        set({ settingsOpen: true });
        throw new Error("请先在设置中配置 New-API 中转站地址与 API Key");
      }

      const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
      if (!session) return;

      const userIdx = session.messages.findIndex((m) => m.id === userMsgId);
      if (userIdx < 0 || session.messages[userIdx].role !== "user") {
        return;
      }

      const targetUserMsg = session.messages[userIdx];
      const hasMediaOrAttachment =
        Boolean(targetUserMsg.attachments?.length) || Boolean(targetUserMsg.images?.length);
      if (!trimmed && !hasMediaOrAttachment) return;

      if (isStreaming || pendingApproval) {
        get().abortRun({ discardResult: true });
      }

      const historyBefore = session.messages.slice(0, userIdx);
      const imageContents = (targetUserMsg.images || [])
        .map(dataUrlToImageContent)
        .filter((item): item is ImageContent => Boolean(item));

      await dispatchPromptTurn({
        session,
        historyBefore,
        text: trimmed,
        attachments: targetUserMsg.attachments,
        imagesMeta: targetUserMsg.images,
        imageContents,
      });
    },

    branchFromMessage: async (messageId) => {
      const { activeSessionId, sessions } = get();
      const source = sessions.find((s) => s.id === activeSessionId);
      if (!source) return;
      const idx = source.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;

      const sliced = source.messages.slice(0, idx);
      const targetMsg = source.messages[idx];
      const branched: ChatSession = {
        ...createEmptySession(`${source.title} (分支)`, source.workspaceId),
        messages: sliced,
        totalTokens: sliced.reduce((acc, m) => acc + (m.usage?.totalTokens || 0), 0),
      };

      set((state) => ({
        sessions: [branched, ...state.sessions],
        activeSessionId: branched.id,
        isStreaming: false,
        pendingApproval: null,
        pendingQuestionnaire: null,
      }));
      await saveSession(branched);

      if (targetMsg.role === "user") {
        const imageContents = (targetMsg.images || [])
          .map(dataUrlToImageContent)
          .filter((item): item is ImageContent => Boolean(item));
        await dispatchPromptTurn({
          session: branched,
          historyBefore: sliced,
          text: targetMsg.content,
          attachments: targetMsg.attachments,
          imagesMeta: targetMsg.images,
          imageContents,
        });
      }
    },

    abortRun: (options) => {
      const targetId = options?.sessionId || get().activeSessionId;
      manuallyAbortedSessions.add(targetId);
      const isActiveTarget = targetId === get().activeSessionId;

      const pending =
        get().pendingApprovalsBySession[targetId] ??
        (isActiveTarget ? get().pendingApproval : null);
      if (pending) {
        pending.resolve(false);
      }
      const pendingQ =
        get().pendingQuestionnairesBySession[targetId] ??
        (isActiveTarget ? get().pendingQuestionnaire : null);
      if (pendingQ) {
        pendingQ.resolve(null);
      }
      sessionRunners.get(targetId)?.abort({ discardResult: options?.discardResult });

      set((state) => {
        const nextRunning = { ...state.runningSessionIds };
        delete nextRunning[targetId];
        const nextApprovals = { ...state.pendingApprovalsBySession };
        delete nextApprovals[targetId];
        const nextQuestionnaires = { ...state.pendingQuestionnairesBySession };
        delete nextQuestionnaires[targetId];
        return {
          runningSessionIds: nextRunning,
          pendingApprovalsBySession: nextApprovals,
          pendingQuestionnairesBySession: nextQuestionnaires,
          isStreaming: Boolean(nextRunning[state.activeSessionId]),
          pendingApproval: nextApprovals[state.activeSessionId] ?? null,
          pendingQuestionnaire: nextQuestionnaires[state.activeSessionId] ?? null,
        };
      });
    },

    setPermissionMode: async (mode) => {
      await get().updateSettings({ permissionMode: mode });
    },

    cyclePermissionMode: async () => {
      const current = get().settings.permissionMode ?? "auto-edits";
      const next = cycleModeHelper(current);
      await get().updateSettings({ permissionMode: next });
      return next;
    },

    approvePlanAndExecute: async (sessionId) => {
      const targetId = sessionId || get().activeSessionId;
      const targetSession = get().sessions.find((s) => s.id === targetId);
      if (!targetSession) return;
      await get().updateSettings({ permissionMode: "auto-edits" });
      if (get().runningSessionIds[targetId]) {
        get().pushToast("当前会话正在执行中", "info");
        return;
      }
      await dispatchPromptTurn({
        session: targetSession,
        historyBefore: [...targetSession.messages],
        text: "已批准上述规划方案，请按步骤立即开始执行落地。",
        permissionModeOverride: "auto-edits",
      });
    },

    setDiffReviewOpen: (open) => set({ diffReviewOpen: open }),

    acceptSessionFileChange: async (path) => {
      const sid = get().activeSessionId;
      let updatedTarget: ChatSession | undefined;
      set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.id !== sid || !s.fileChanges) return s;
          updatedTarget = {
            ...s,
            fileChanges: s.fileChanges.map((fc) =>
              fc.path === path ? { ...fc, reviewed: "accepted" } : fc
            ),
            updatedAt: Date.now(),
          };
          return updatedTarget;
        }),
      }));
      if (updatedTarget) {
        await saveSession(updatedTarget);
      }
    },

    acceptAllSessionFileChanges: async () => {
      const sid = get().activeSessionId;
      let updatedTarget: ChatSession | undefined;
      set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.id !== sid || !s.fileChanges) return s;
          updatedTarget = {
            ...s,
            fileChanges: s.fileChanges.map((fc) =>
              fc.reviewed === "reverted" ? fc : { ...fc, reviewed: "accepted" }
            ),
            updatedAt: Date.now(),
          };
          return updatedTarget;
        }),
      }));
      if (updatedTarget) {
        await saveSession(updatedTarget);
      }
      get().pushToast("已确认保留本会话全部文件改动", "success");
    },

    revertSessionFileChange: async (path) => {
      const sid = get().activeSessionId;
      const session = get().sessions.find((s) => s.id === sid);
      const change = session?.fileChanges?.find((fc) => fc.path === path);
      if (!change || change.reviewed === "reverted") return;

      if (!change.existedBefore) {
        await workspaceVfs.deleteFile(path).catch(() => undefined);
      } else if (change.beforeSnapshotId) {
        await workspaceVfs.restoreSnapshot(change.beforeSnapshotId, path);
      } else {
        throw new Error(`文件「${path}」缺少改前快照，无法自动回滚`);
      }

      let updatedTarget: ChatSession | undefined;
      set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.id !== sid || !s.fileChanges) return s;
          updatedTarget = {
            ...s,
            fileChanges: s.fileChanges.map((fc) =>
              fc.path === path ? { ...fc, reviewed: "reverted" } : fc
            ),
            updatedAt: Date.now(),
          };
          return updatedTarget;
        }),
      }));
      if (updatedTarget) {
        await saveSession(updatedTarget);
      }
      await get().refreshFiles();
      get().pushToast(`已回滚文件：${path}`, "success");
    },

    revertAllSessionFileChanges: async () => {
      const sid = get().activeSessionId;
      const session = get().sessions.find((s) => s.id === sid);
      const list = (session?.fileChanges || []).filter((fc) => fc.reviewed !== "reverted");
      if (list.length === 0) return;

      let revertedCount = 0;
      for (const item of list) {
        try {
          if (!item.existedBefore) {
            await workspaceVfs.deleteFile(item.path).catch(() => undefined);
          } else if (item.beforeSnapshotId) {
            await workspaceVfs.restoreSnapshot(item.beforeSnapshotId, item.path);
          } else {
            continue;
          }
          revertedCount += 1;
        } catch {
          // 跳过个别无法恢复的文件，继续回滚其余文件
        }
      }

      let updatedTarget: ChatSession | undefined;
      set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.id !== sid || !s.fileChanges) return s;
          updatedTarget = {
            ...s,
            fileChanges: s.fileChanges.map((fc) => ({ ...fc, reviewed: "reverted" })),
            updatedAt: Date.now(),
          };
          return updatedTarget;
        }),
      }));
      if (updatedTarget) {
        await saveSession(updatedTarget);
      }
      await get().refreshFiles();
      get().pushToast(`已回滚本会话 ${revertedCount} 个文件改动`, "success");
    },

    enqueueMessage: (text, attachmentPaths = []) => {
      const clean = text.trim();
      if (!clean && attachmentPaths.length === 0) return;
      const sid = get().activeSessionId;
      if (!sid) return;
      const item: QueuedMessageItem = {
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text: clean,
        attachmentPaths: [...attachmentPaths],
        createdAt: Date.now(),
      };
      set((state) => {
        const prev = state.queuedMessagesBySession[sid] || [];
        return {
          queuedMessagesBySession: {
            ...state.queuedMessagesBySession,
            [sid]: [...prev, item],
          },
        };
      });
      get().pushToast("已加入发送队列，将在当前轮次完成后自动执行", "info", {
        durationMs: 2600,
      });
    },

    removeQueuedMessage: (id, sessionId) => {
      const sid = sessionId || get().activeSessionId;
      set((state) => ({
        queuedMessagesBySession: {
          ...state.queuedMessagesBySession,
          [sid]: (state.queuedMessagesBySession[sid] || []).filter((q) => q.id !== id),
        },
      }));
    },

    sendQueuedMessageNow: async (id, sessionId) => {
      const sid = sessionId || get().activeSessionId;
      const queue = get().queuedMessagesBySession[sid] || [];
      const target = queue.find((q) => q.id === id);
      if (!target) return;
      get().removeQueuedMessage(id, sid);

      const runner = getOrCreateRunner(sid);
      if (runner.isRunning()) {
        const steerMsg: UiMessage = {
          id: `msg_${Date.now()}_steer`,
          role: "user",
          content: `[中途补充引导] ${target.text}`,
          createdAt: Date.now(),
        };
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sid
              ? { ...s, messages: [...s.messages, steerMsg], updatedAt: Date.now() }
              : s
          ),
        }));
        runner.steer(target.text);
        return;
      }

      const sessionObj = get().sessions.find((s) => s.id === sid);
      if (!sessionObj) return;
      await dispatchPromptTurn({
        session: sessionObj,
        historyBefore: [...sessionObj.messages],
        text: target.text,
        attachments: target.attachmentPaths.map((p) => ({
          path: p,
          name: p.split("/").pop() || p,
          category: detectFileCategory(p),
        })),
      });
    },

    compactActiveSession: async () => {
      const { sessions, activeSessionId, config, models } = get();
      const source = sessions.find((s) => s.id === activeSessionId);
      if (!source || source.messages.length === 0) {
        throw new Error("当前会话暂无对话历史可压缩");
      }

      const fallbackHandoff = buildHandoffFromSession(source, source.todos || []);
      let summaryMarkdown = "";

      if (config.baseUrl.trim() && config.apiKey.trim()) {
        try {
          const modelInfo =
            models.find((m) => m.id === config.selectedModelId) ??
            inferModelMetadata(config.selectedModelId || "gpt-4o", config);
          const piModel = toPiModel(modelInfo, config);
          const streamFn = createNewApiStreamFn(() => getPlatformAdapter().getFetch());

          const transcript = source.messages
            .slice(-24)
            .map((m) => {
              const roleLabel = m.role === "user" ? "用户" : "助手";
              const body = (m.content || "").slice(0, 1200);
              const tools = (m.toolCalls || [])
                .map((tc) => `${tc.name}${tc.modifiedPath ? `(${tc.modifiedPath})` : ""}`)
                .join(", ");
              return `【${roleLabel}】${body}${tools ? `\n[工具: ${tools}]` : ""}`;
            })
            .join("\n\n---\n\n");

          const compactAgent = new Agent({
            initialState: {
              systemPrompt:
                "你是上下文压缩器。请把以下办公会话精炼成 4 段 Markdown 摘要（① 核心目标与背景 ② 已达成结论与关键数据 ③ 已新建/修改的工作区文件清单 ④ 待办与下一步动作），总字数控制在 500 字以内，只保留高信息密度事实。",
              model: piModel,
              thinkingLevel: "off",
              tools: [],
              messages: [] as AgentMessage[],
            },
            streamFn,
            getApiKey: () => config.apiKey.trim(),
          });

          let latestText = "";
          const unsub = compactAgent.subscribe((ev) => {
            if (ev.type === "message_end" && ev.message.role === "assistant") {
              const am = ev.message as AssistantMessage;
              latestText = am.content
                .filter((b): b is TextContent => b.type === "text")
                .map((b) => b.text)
                .join("");
            }
          });
          try {
            await compactAgent.prompt(
              `请压缩以下会话记录：\n\n${transcript.slice(0, 14000)}`
            );
            await compactAgent.waitForIdle();
          } finally {
            unsub();
          }
          if (latestText.trim()) {
            summaryMarkdown = latestText.trim();
          }
        } catch {
          // 网络或额度受限时自动降级为本地结构化交接摘要
        }
      }

      if (!summaryMarkdown) {
        summaryMarkdown = [
          `### 核心摘要\n${fallbackHandoff.summary}`,
          fallbackHandoff.relevantFiles.length > 0
            ? `### 涉及文件\n${fallbackHandoff.relevantFiles.map((f) => `- ${f}`).join("\n")}`
            : "",
          fallbackHandoff.nextSteps.length > 0
            ? `### 待续步骤\n${fallbackHandoff.nextSteps.map((n) => `- ${n}`).join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
      }

      const now = Date.now();
      const compactedTitle = source.title.includes("(压缩延续)")
        ? source.title
        : `${source.title} (压缩延续)`;
      const nextSession: ChatSession = {
        ...createEmptySession(compactedTitle, source.workspaceId),
        todos: source.todos,
        messages: [
          {
            id: `msg_${now}_compact_u`,
            role: "user",
            content: `[上下文压缩摘要 · 承接自「${source.title}」]\n\n${summaryMarkdown}`,
            createdAt: now,
          },
          {
            id: `msg_${now + 1}_compact_a`,
            role: "assistant",
            content:
              "已继承上述压缩上下文与工作区文件状态。上下文窗口已大幅释放，请直接告诉我下一步要处理的任务。",
            createdAt: now + 1,
          },
        ],
      };

      set((state) => ({
        sessions: [nextSession, ...state.sessions],
        activeSessionId: nextSession.id,
        isStreaming: false,
        pendingApproval: null,
        pendingQuestionnaire: null,
        tokenBurden: undefined,
        mobileTab: "chat",
      }));
      await saveSession(nextSession);
      get().pushToast(`已将对话压缩至清爽新会话「${nextSession.title}」`, "success");
    },

    openOrCreateProjectInstructions: async () => {
      const files = await workspaceVfs.listFiles();
      const existing = findProjectInstructionFile(files);
      if (existing) {
        get().openPreview(existing.path);
        return;
      }
      await workspaceVfs.writeText("MIZURISU.md", DEFAULT_MIZURISU_MD_TEMPLATE, {
        snapshotNote: "新建工作区协作规范",
      });
      await get().refreshFiles();
      get().openPreview("MIZURISU.md");
      get().pushToast("已创建 MIZURISU.md 项目规范文档（每次对话将自动加载）", "success");
    },

    refreshFiles: async () => {
      const seq = ++fileListSeq;
      const files = await workspaceVfs.listFiles();
      if (seq === fileListSeq) {
        set({
          files,
          projectInstructionPath: findProjectInstructionFile(files)?.path ?? null,
        });
      }
    },

    uploadFilesToWorkspace: async (fileList) => {
      const arr = Array.from(fileList);
      const uploaded: WorkspaceFileMeta[] = [];
      for (const file of arr) {
        const buf = new Uint8Array(await file.arrayBuffer());
        const meta = await workspaceVfs.writeBytes(file.name, buf, {
          snapshotNote: "上传覆盖前快照",
        });
        uploaded.push(meta);
      }
      if (uploaded.length > 0) {
        const last = uploaded[uploaded.length - 1];
        set((state) => ({
          activePreviewPath: last.path,
          previewOpen: true,
          previewRevision: state.previewRevision + 1,
        }));
      }
      return uploaded;
    },

    deleteWorkspaceFile: async (path) => {
      const rec = await workspaceVfs.readRecord(path).catch(() => null);
      const backupData = rec ? new Uint8Array(rec.data) : null;
      const backupPath = rec?.path || path;
      await workspaceVfs.deleteFile(path);
      await get().refreshFiles();
      if (backupData) {
        get().pushToast(`已删除 ${backupPath}`, "info", {
          durationMs: 6000,
          action: {
            label: "撤销",
            onClick: async () => {
              await workspaceVfs.writeBytes(backupPath, backupData, {
                snapshotNote: "撤销删除恢复",
              });
              await get().refreshFiles();
              get().openPreview(backupPath);
            },
          },
        });
      }
    },

    renameWorkspaceFile: async (oldPath, newPath) => {
      const normOld = oldPath
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+/g, "/")
        .trim();
      const prevPreview = get().activePreviewPath;
      const wasActivePreview =
        prevPreview !== null && (prevPreview === oldPath || prevPreview === normOld);

      const meta = await workspaceVfs.renameFile(oldPath, newPath);
      const seq = ++fileListSeq;
      const files = await workspaceVfs.listFiles();

      set((state) => ({
        ...(seq === fileListSeq ? { files } : {}),
        ...(wasActivePreview && state.activePreviewPath !== meta.path
          ? {
              activePreviewPath: meta.path,
              previewRevision: state.previewRevision + 1,
            }
          : {}),
      }));
      get().pushToast(`已将文件重命名为 ${meta.path}`, "success");
    },

    exportWorkspaceFile: async (path) => {
      const rec = await workspaceVfs.readRecord(path);
      await getPlatformAdapter().exportFile(
        rec.name,
        rec.data,
        rec.mimeType || inferMimeType(rec.path)
      );
    },

    exportWorkspaceZip: async () => {
      const metas = await workspaceVfs.listFiles();
      if (metas.length === 0) {
        get().pushToast("当前工作区暂无可导出的文件", "warning");
        return;
      }
      const entries = await Promise.all(
        metas.map(async (meta) => ({
          path: meta.path,
          data: await workspaceVfs.readBytes(meta.path),
        }))
      );
      const zipBytes = await createWorkspaceZip(entries);
      const filename = `mizurisu-workspace-${formatYmd()}.zip`;
      await getPlatformAdapter().exportFile(filename, zipBytes, "application/zip");
      get().pushToast(`已打包导出工作区（共 ${entries.length} 个文件）`, "success");
    },

    mountNativeDirectory: async () => {
      const platform = getPlatformAdapter();
      const { activeWorkspaceId, workspaces } = get();

      // Desktop 优先启用「真本地文件夹模式」（直接按需读写删本地磁盘并监听外部修改，无 250 文件拷贝上限）
      if (platform.pickNativeDirectoryPath && platform.listNativeDirectoryFiles) {
        const dirPath = await platform.pickNativeDirectoryPath();
        if (!dirPath) return;
        const nextWorkspaces = workspaces.map((w) =>
          w.id === activeWorkspaceId ? { ...w, nativeDir: dirPath } : w
        );
        workspaceVfs.setActiveWorkspace(activeWorkspaceId, dirPath);
        await kvSet("workspaces_meta", nextWorkspaces);
        await get().updateSettings({ mountedNativeDir: dirPath });
        await syncNativeDirWatcher(dirPath);
        const files = await workspaceVfs.listFiles();
        set({
          workspaces: nextWorkspaces,
          files,
          activePreviewPath: files[0]?.path ?? null,
          previewOpen: files.length > 0,
          statusBanner: `已直连本地目录：${dirPath}（${files.length} 个文件）`,
        });
        setTimeout(() => set({ statusBanner: undefined }), 4000);
        return;
      }

      const res = await platform.pickNativeDirectory();
      if (!res) return;
      workspaceVfs.setMountedNativeDir(res.path);
      await get().updateSettings({ mountedNativeDir: res.path });
      await workspaceVfs.importBatch(res.files, { skipNativeSync: true });
      set({ statusBanner: `已挂载本机目录：${res.path}（同步 ${res.files.length} 个文件）` });
      setTimeout(() => set({ statusBanner: undefined }), 4000);
    },

    switchWorkspace: async (workspaceId) => {
      const target = get().workspaces.find((w) => w.id === workspaceId);
      if (!target) return;
      // 切换工作区时底层 VFS 根目录将变更，中止所有运行中的会话任务
      for (const sid of Object.keys(get().runningSessionIds)) {
        get().abortRun({ sessionId: sid });
      }
      for (const sid of Object.keys(get().pendingApprovalsBySession)) {
        get().abortRun({ sessionId: sid });
      }

      workspaceVfs.setActiveWorkspace(target.id, target.nativeDir);
      await kvSet("active_workspace_id", target.id);
      await get().updateSettings({ mountedNativeDir: target.nativeDir });
      await syncNativeDirWatcher(target.nativeDir);

      const files = await workspaceVfs.listFiles();
      let sessions = get().sessions;
      let matching = sessions.filter((s) => (s.workspaceId || "default") === target.id);
      if (matching.length === 0) {
        const fresh = createEmptySession("新对话", target.id);
        sessions = [fresh, ...sessions];
        matching = [fresh];
        await saveSession(fresh);
      }

      const nextPreview =
        files.find((f) => f.path.endsWith(".xlsx"))?.path ?? files[0]?.path ?? null;

      set({
        activeWorkspaceId: target.id,
        sessions,
        activeSessionId: matching[0].id,
        files,
        projectInstructionPath: findProjectInstructionFile(files)?.path ?? null,
        activePreviewPath: nextPreview,
        previewOpen: Boolean(nextPreview),
        tokenBurden: undefined,
        diffReviewOpen: false,
      });
      get().pushToast(`已切换工作区：${target.name}`, "info");
    },

    createWorkspace: async (name, nativeDir) => {
      const cleanName = name.trim() || "新建项目";
      const profile: WorkspaceProfile = {
        id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: cleanName,
        ...(nativeDir?.trim() ? { nativeDir: nativeDir.trim() } : {}),
        createdAt: Date.now(),
      };
      const next = [...get().workspaces, profile];
      await kvSet("workspaces_meta", next);
      set({ workspaces: next });
      await get().switchWorkspace(profile.id);
      return profile;
    },

    deleteWorkspace: async (workspaceId) => {
      if (!workspaceId || workspaceId === "default") {
        throw new Error("默认工作区不能删除");
      }
      const next = get().workspaces.filter((w) => w.id !== workspaceId);
      await workspaceVfs.purgeWorkspaceFiles(workspaceId);
      await kvSet("workspaces_meta", next);
      set({ workspaces: next });
      if (get().activeWorkspaceId === workspaceId) {
        await get().switchWorkspace("default");
      }
    },

    openNativeFolderWorkspace: async () => {
      const platform = getPlatformAdapter();
      if (!platform.pickNativeDirectoryPath) {
        await get().mountNativeDirectory();
        return;
      }
      const dirPath = await platform.pickNativeDirectoryPath();
      if (!dirPath) return;
      const existing = get().workspaces.find((w) => w.nativeDir === dirPath);
      if (existing) {
        await get().switchWorkspace(existing.id);
        return;
      }
      const folderName = dirPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "本地文件夹";
      await get().createWorkspace(folderName, dirPath);
    },

    setActiveSkill: (skillId) => set({ activeSkillId: skillId }),

    saveCustomSkill: async (skill) => {
      await dbSaveCustomSkill(skill);
      const customSkills = await dbListCustomSkills();
      set({ customSkills });
    },

    deleteCustomSkill: async (id) => {
      await dbDeleteCustomSkill(id);
      const customSkills = await dbListCustomSkills();
      set((state) => ({
        customSkills,
        activeSkillId: state.activeSkillId === id ? undefined : state.activeSkillId,
      }));
    },

    importSkillMarkdown: async (rawMarkdown, fallbackName) => {
      const parsed = parseSkillMarkdown(rawMarkdown, fallbackName);
      await dbSaveCustomSkill(parsed);
      const customSkills = await dbListCustomSkills();
      set({ customSkills });
      return parsed;
    },

    resolveApproval: (approved, options) => {
      const activeId = get().activeSessionId;
      const pending = get().pendingApprovalsBySession[activeId] ?? get().pendingApproval;
      if (pending) {
        const sid = pending.sessionId || activeId;
        pending.resolve(approved, options);
        set((state) => {
          const nextMap = { ...state.pendingApprovalsBySession };
          delete nextMap[sid];
          return {
            pendingApprovalsBySession: nextMap,
            pendingApproval: nextMap[state.activeSessionId] ?? null,
          };
        });
      }
    },

    resolveQuestionnaire: (answers) => {
      const activeId = get().activeSessionId;
      const pendingQ =
        get().pendingQuestionnairesBySession[activeId] ?? get().pendingQuestionnaire;
      if (pendingQ) {
        const sid = pendingQ.sessionId || activeId;
        pendingQ.resolve(answers);
        set((state) => {
          const nextMap = { ...state.pendingQuestionnairesBySession };
          delete nextMap[sid];
          return {
            pendingQuestionnairesBySession: nextMap,
            pendingQuestionnaire: nextMap[state.activeSessionId] ?? null,
          };
        });
      }
    },

    togglePlugin: async (pluginId, enabled) => {
      const prev = get().settings.enabledPlugins || {};
      await get().updateSettings({
        enabledPlugins: { ...prev, [pluginId]: enabled },
      });
    },

    toggleProtectedPath: async (path) => {
      const clean = path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
      const prev = get().settings.protectedPaths || [];
      const exists = prev.includes(clean);
      const next = exists ? prev.filter((p) => p !== clean) : [...prev, clean];
      await get().updateSettings({ protectedPaths: next });
      return !exists;
    },

    handoffActiveSession: async (customPayload) => {
      const { sessions, activeSessionId } = get();
      const source = sessions.find((s) => s.id === activeSessionId);
      const payload =
        customPayload ?? buildHandoffFromSession(source, source?.todos || []);
      const next = createEmptySession(payload.title || "接力新会话");
      if (source?.workspaceId) {
        next.workspaceId = source.workspaceId;
      }
      set((state) => ({
        sessions: [next, ...state.sessions],
        activeSessionId: next.id,
        isStreaming: false,
        pendingApproval: null,
        pendingQuestionnaire: null,
        mobileTab: "chat",
        composerDraft: payload.promptDraft,
        tokenBurden: undefined,
      }));
      await saveSession(next);
      get().pushToast(`已创建接力新会话「${next.title}」，按 Enter 即可发送继续`, "success");
    },

    clearComposerDraft: () => set({ composerDraft: undefined }),

    resetAllData: async () => {
      for (const sid of Array.from(sessionRunners.keys())) {
        get().abortRun({ discardResult: true, sessionId: sid });
      }
      sessionRunners.clear();
      manuallyAbortedSessions.clear();
      initPromise = null;
      for (const timer of toastTimers.values()) {
        clearTimeout(timer);
      }
      toastTimers.clear();
      // 先清空内存会话与流式状态，防止异步清库期间旧运行微任务回写数据
      set({
        isStreaming: false,
        runningSessionIds: {},
        unreadCompletedSessionIds: {},
        pendingApprovalsBySession: {},
        pendingQuestionnairesBySession: {},
        sessionAllowedTools: {},
        queuedMessagesBySession: {},
        diffReviewOpen: false,
        projectInstructionPath: null,
        pendingApproval: null,
        pendingQuestionnaire: null,
        tokenBurden: undefined,
        composerDraft: undefined,
        sessions: [],
        activeSessionId: "",
        toasts: [],
      });
      await syncNativeDirWatcher(undefined);
      workspaceVfs.setActiveWorkspace("default", undefined);
      await getPlatformAdapter().clearSessionCookies?.().catch(() => undefined);
      await clearAllLocalData();
      const fresh = createEmptySession("新对话", "default");
      await saveSession(fresh);
      await workspaceVfs.seedStarterWorkspaceIfEmpty();
      const files = await workspaceVfs.listFiles();
      const starterPreview =
        files.find((f) => f.path.endsWith(".xlsx"))?.path ?? files[0]?.path ?? null;
      const defaultSettings = getDefaultSettings();
      applyThemeToDocument(defaultSettings.theme, defaultSettings.highContrast);
      set({
        config: getDefaultConfig(),
        settings: defaultSettings,
        authSession: null,
        authBusy: false,
        authProgress: undefined,
        authError: undefined,
        commandPaletteOpen: false,
        shortcutHelpOpen: false,
        models: [],
        modelsError: undefined,
        billing: undefined,
        sessions: [fresh],
        activeSessionId: fresh.id,
        workspaces: [DEFAULT_WORKSPACE],
        activeWorkspaceId: "default",
        isStreaming: false,
        pendingApproval: null,
        pendingQuestionnaire: null,
        tokenBurden: undefined,
        composerDraft: undefined,
        toasts: [],
        files,
        customSkills: [],
        activeSkillId: undefined,
        activePreviewPath: starterPreview,
        previewOpen: Boolean(starterPreview),
      });
    },
  };
});
