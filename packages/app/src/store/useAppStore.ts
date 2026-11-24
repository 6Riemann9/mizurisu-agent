import type { ImageContent } from "@earendil-works/pi-ai";
import { create } from "zustand";
import { PiAgentRunner } from "../agent/runtime";
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
  normalizeNewApiBaseUrl,
  pickDefaultStationModel,
} from "../newapi/client";
import { detectFileCategory, inferMimeType } from "../office";
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
  ModelInfo,
  NewApiConfig,
  NewApiSiteStatus,
  NewApiTokenItem,
  SkillTemplate,
  UiMessage,
  WorkspaceFileMeta,
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
    autoApproveDelete: false,
    previewWidth: 520,
  };
}

function createEmptySession(title = "新对话"): ChatSession {
  const now = Date.now();
  return {
    id: `sess_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
    totalTokens: 0,
  };
}

function applyThemeToDocument(theme: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || "");
      const idx = res.indexOf(",");
      resolve(idx >= 0 ? res.slice(idx + 1) : res);
    };
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
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
  files: WorkspaceFileMeta[];
  activePreviewPath: string | null;
  previewRevision: number;
  previewOpen: boolean;
  previewExpanded: boolean;
  customSkills: SkillTemplate[];
  activeSkillId?: string;
  pendingApproval: ApprovalRequest | null;
  settingsOpen: boolean;
  mobileTab: MobileTab;
  statusBanner?: string;

  init: () => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setMobileTab: (tab: MobileTab) => void;
  setPreviewOpen: (open: boolean) => void;
  setPreviewExpanded: (expanded: boolean) => void;
  openPreview: (path: string) => void;
  closePreview: () => void;

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
  testConnectionAndSync: () => Promise<ModelInfo[]>;
  refreshBilling: () => Promise<void>;

  createSession: () => Promise<void>;
  selectSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;

  sendMessage: (
    text: string,
    attachmentPaths?: string[],
    imageFiles?: File[]
  ) => Promise<void>;
  branchFromMessage: (messageId: string) => Promise<void>;
  abortRun: () => void;

  refreshFiles: () => Promise<void>;
  uploadFilesToWorkspace: (fileList: File[] | FileList) => Promise<WorkspaceFileMeta[]>;
  deleteWorkspaceFile: (path: string) => Promise<void>;
  exportWorkspaceFile: (path: string) => Promise<void>;
  mountNativeDirectory: () => Promise<void>;

  setActiveSkill: (skillId?: string) => void;
  saveCustomSkill: (skill: SkillTemplate) => Promise<void>;
  deleteCustomSkill: (id: string) => Promise<void>;

  resolveApproval: (approved: boolean) => void;
  resetAllData: () => Promise<void>;
}

let runnerSingleton: PiAgentRunner | null = null;
let vfsUnsubscribe: (() => void) | null = null;

export const useAppStore = create<AppState>((set, get) => {
  const ensureRunner = (): PiAgentRunner => {
    if (runnerSingleton) return runnerSingleton;
    runnerSingleton = new PiAgentRunner(workspaceVfs, {
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
      onToolModifiedFile: (modifiedPath) => {
        set((state) => ({
          activePreviewPath: modifiedPath,
          previewOpen: true,
          previewRevision: state.previewRevision + 1,
        }));
      },
      onRequestApproval: (req) => {
        set({ pendingApproval: req });
      },
      onRunFinished: (sessionId) => {
        set({ isStreaming: false });
        const finished = get().sessions.find((s) => s.id === sessionId);
        if (finished) {
          saveSession(finished).catch(() => undefined);
        }
        // 每次对话结束后轻量刷新余额
        const { config } = get();
        if (config.baseUrl && config.apiKey) {
          get().refreshBilling().catch(() => undefined);
        }
      },
    });
    return runnerSingleton;
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
    files: [],
    activePreviewPath: null,
    previewRevision: 0,
    previewOpen: false,
    previewExpanded: false,
    customSkills: [],
    pendingApproval: null,
    settingsOpen: false,
    mobileTab: "chat",

    init: async () => {
      if (get().initialized) return;

      const [savedConfig, savedSettings, savedAuthSession, savedSessions, savedSkills] =
        await Promise.all([
          kvGet<NewApiConfig>("newapi_config"),
          kvGet<AppSettings>("app_settings"),
          kvGet<AuthSession | null>("auth_session"),
          loadAllSessions(),
          dbListCustomSkills(),
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
      applyThemeToDocument(settings.theme);

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

      if (settings.mountedNativeDir) {
        workspaceVfs.setMountedNativeDir(settings.mountedNativeDir);
      }

      await workspaceVfs.seedStarterWorkspaceIfEmpty();
      const files = await workspaceVfs.listFiles();

      let sessions = savedSessions;
      if (sessions.length === 0) {
        sessions = [createEmptySession()];
        await saveSession(sessions[0]);
      }

      if (!vfsUnsubscribe) {
        vfsUnsubscribe = workspaceVfs.subscribe((ev) => {
          workspaceVfs.listFiles().then((nextFiles) => {
            set((state) => ({
              files: nextFiles,
              previewRevision:
                ev.path && ev.path === state.activePreviewPath
                  ? state.previewRevision + 1
                  : state.previewRevision,
              activePreviewPath:
                ev.type === "delete" && ev.path === state.activePreviewPath
                  ? null
                  : state.activePreviewPath,
            }));
          });
        });
      }

      const starterPreview =
        files.find((f) => f.path.endsWith(".xlsx"))?.path ?? files[0]?.path ?? null;

      set({
        initialized: true,
        config,
        settings,
        authSession,
        siteStatus: authSession?.siteStatus,
        sessions,
        activeSessionId: sessions[0].id,
        files,
        customSkills: savedSkills,
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
    },

    setSettingsOpen: (open) => set({ settingsOpen: open }),
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
      applyThemeToDocument(next.theme);
      set({ settings: next });
      await kvSet("app_settings", next);
    },

    toggleTheme: async () => {
      const nextTheme = get().settings.theme === "dark" ? "light" : "dark";
      await get().updateSettings({ theme: nextTheme });
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
      if (get().isStreaming) {
        ensureRunner().abort();
      }
      const next = createEmptySession();
      set((state) => ({
        sessions: [next, ...state.sessions],
        activeSessionId: next.id,
        mobileTab: "chat",
      }));
      await saveSession(next);
    },

    selectSession: (id) => {
      if (get().isStreaming) {
        ensureRunner().abort();
      }
      set({ activeSessionId: id, mobileTab: "chat" });
    },

    deleteSession: async (id) => {
      await deleteSessionById(id);
      const remaining = get().sessions.filter((s) => s.id !== id);
      if (remaining.length === 0) {
        const fresh = createEmptySession();
        await saveSession(fresh);
        set({ sessions: [fresh], activeSessionId: fresh.id });
        return;
      }
      set((state) => ({
        sessions: remaining,
        activeSessionId:
          state.activeSessionId === id ? remaining[0].id : state.activeSessionId,
      }));
    },

    sendMessage: async (text, attachmentPaths = [], imageFiles = []) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const runner = ensureRunner();
      const { activeSessionId, sessions, config, models, settings, customSkills, activeSkillId } =
        get();

      // 若正在生成且用户发送消息，触发 Pi 原生 steer 中途插话引导
      if (get().isStreaming && runner.isRunning()) {
        const steerMsg: UiMessage = {
          id: `msg_${Date.now()}_steer`,
          role: "user",
          content: `[中途补充引导] ${trimmed}`,
          createdAt: Date.now(),
        };
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === activeSessionId
              ? { ...s, messages: [...s.messages, steerMsg], updatedAt: Date.now() }
              : s
          ),
        }));
        runner.steer(trimmed);
        return;
      }

      if (!config.baseUrl.trim() || !config.apiKey.trim()) {
        set({ settingsOpen: true });
        throw new Error("请先在设置中配置 New-API 中转站地址与 API Key");
      }

      const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
      if (!session) return;

      const historyBefore = [...session.messages];
      const userMsg: UiMessage = {
        id: `msg_${Date.now()}_u`,
        role: "user",
        content: trimmed,
        attachments: attachmentPaths.map((p) => ({
          path: p,
          name: p.split("/").pop() || p,
          category: detectFileCategory(p),
        })),
        createdAt: Date.now(),
      };

      const nextTitle =
        session.messages.length === 0
          ? trimmed.slice(0, 22) + (trimmed.length > 22 ? "..." : "")
          : session.title;

      const updatedSession: ChatSession = {
        ...session,
        title: nextTitle,
        messages: [...historyBefore, userMsg],
        updatedAt: Date.now(),
      };

      set((state) => ({
        isStreaming: true,
        sessions: state.sessions.map((s) => (s.id === session.id ? updatedSession : s)),
      }));
      await saveSession(updatedSession);

      const images: ImageContent[] = [];
      for (const img of imageFiles) {
        const b64 = await fileToBase64(img);
        images.push({
          type: "image",
          data: b64,
          mimeType: img.type || "image/png",
        });
      }

      const allSkills = [...BUILTIN_SKILLS, ...customSkills];
      const activeSkill = allSkills.find((s) => s.id === activeSkillId);

      await runner.runTurn({
        sessionId: session.id,
        userMessage: userMsg,
        historyBeforeUser: historyBefore,
        config,
        models,
        settings,
        activeSkill,
        images: images.length > 0 ? images : undefined,
      });
    },

    branchFromMessage: async (messageId) => {
      const { activeSessionId, sessions, isStreaming } = get();
      if (isStreaming) ensureRunner().abort();

      const source = sessions.find((s) => s.id === activeSessionId);
      if (!source) return;
      const idx = source.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;

      const sliced = source.messages.slice(0, idx);
      const targetMsg = source.messages[idx];
      const branched: ChatSession = {
        ...createEmptySession(`${source.title} (分支)`),
        messages: sliced,
        totalTokens: sliced.reduce((acc, m) => acc + (m.usage?.totalTokens || 0), 0),
      };

      set((state) => ({
        sessions: [branched, ...state.sessions],
        activeSessionId: branched.id,
      }));
      await saveSession(branched);

      if (targetMsg.role === "user") {
        await get().sendMessage(
          targetMsg.content,
          targetMsg.attachments?.map((a) => a.path) || []
        );
      }
    },

    abortRun: () => {
      ensureRunner().abort();
      set({ isStreaming: false });
    },

    refreshFiles: async () => {
      const files = await workspaceVfs.listFiles();
      set({ files });
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
      await workspaceVfs.deleteFile(path);
    },

    exportWorkspaceFile: async (path) => {
      const rec = await workspaceVfs.readRecord(path);
      await getPlatformAdapter().exportFile(
        rec.name,
        rec.data,
        rec.mimeType || inferMimeType(rec.path)
      );
    },

    mountNativeDirectory: async () => {
      const res = await getPlatformAdapter().pickNativeDirectory();
      if (!res) return;
      workspaceVfs.setMountedNativeDir(res.path);
      await get().updateSettings({ mountedNativeDir: res.path });
      await workspaceVfs.importBatch(res.files, { skipNativeSync: true });
      set({ statusBanner: `已挂载本机目录：${res.path}（同步 ${res.files.length} 个文件）` });
      setTimeout(() => set({ statusBanner: undefined }), 4000);
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

    resolveApproval: (approved) => {
      const pending = get().pendingApproval;
      if (pending) {
        pending.resolve(approved);
        set({ pendingApproval: null });
      }
    },

    resetAllData: async () => {
      if (get().isStreaming) ensureRunner().abort();
      await getPlatformAdapter().clearSessionCookies?.().catch(() => undefined);
      await clearAllLocalData();
      const fresh = createEmptySession();
      await saveSession(fresh);
      await workspaceVfs.seedStarterWorkspaceIfEmpty();
      const files = await workspaceVfs.listFiles();
      const defaultSettings = getDefaultSettings();
      applyThemeToDocument(defaultSettings.theme);
      set({
        config: getDefaultConfig(),
        settings: defaultSettings,
        authSession: null,
        authBusy: false,
        authProgress: undefined,
        authError: undefined,
        commandPaletteOpen: false,
        models: [],
        modelsError: undefined,
        billing: undefined,
        sessions: [fresh],
        activeSessionId: fresh.id,
        files,
        customSkills: [],
        activeSkillId: undefined,
        activePreviewPath: files[0]?.path ?? null,
      });
    },
  };
});
