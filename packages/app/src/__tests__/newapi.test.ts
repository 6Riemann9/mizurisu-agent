import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticateAndBootstrapKey,
  buildNewApiAuthHeaders,
  extractAuthFromUrl,
  formatQuotaDisplay,
  formatQuotaUsd,
  isMaskedKey,
  logoutNewApiAccount,
  maskApiKey,
  normalizeApiKey,
  resolvePlaintextKeyForToken,
  tryResumeExistingSession,
  type SessionPlatform,
} from "../newapi/auth";
import {
  buildProtocolBaseUrl,
  fetchNewApiBilling,
  fetchNewApiModels,
  inferModelMetadata,
  inferProtocolForModel,
  normalizeNewApiBaseUrl,
  pickDefaultStationModel,
  toPiModel,
} from "../newapi/client";
import { WebPlatformAdapter } from "../platform/web-adapter";
import { clearAllLocalData, kvGet } from "../storage/db";
import { useAppStore } from "../store/useAppStore";
import type { AuthSession, ModelInfo, NewApiConfig } from "../types";

const baseConfig: NewApiConfig = {
  brandName: "Mizurisu Agent",
  baseUrl: "https://relay.example.com/v1/",
  apiKey: "sk-test-123456",
  protocolMode: "auto",
  selectedModelId: "claude-sonnet-4-5-20250929",
  thinkingLevel: "medium",
  customModels: ["my-private-model"],
  modelProtocolOverrides: {},
};

function jsonSessionRes(data: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: JSON.stringify(data),
  };
}

describe("New-API 适配器与账号鉴权", () => {
  beforeEach(async () => {
    await clearAllLocalData();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("正确归一化多种格式的站点地址", () => {
    expect(normalizeNewApiBaseUrl("https://api.foo.com/")).toBe("https://api.foo.com");
    expect(normalizeNewApiBaseUrl("https://api.foo.com/v1")).toBe("https://api.foo.com");
    expect(normalizeNewApiBaseUrl("https://api.foo.com/v1/")).toBe("https://api.foo.com");
    expect(normalizeNewApiBaseUrl("https://api.foo.com/v1beta/")).toBe("https://api.foo.com");
  });

  it("严格按 pi-ai 协议规则生成各协议 baseUrl", () => {
    expect(buildProtocolBaseUrl("https://api.foo.com/v1", "openai-completions")).toBe(
      "https://api.foo.com/v1"
    );
    expect(buildProtocolBaseUrl("https://api.foo.com", "openai-responses")).toBe(
      "https://api.foo.com/v1"
    );
    expect(buildProtocolBaseUrl("https://api.foo.com/v1", "anthropic-messages")).toBe(
      "https://api.foo.com"
    );
    expect(buildProtocolBaseUrl("https://api.foo.com", "google-generative-ai")).toBe(
      "https://api.foo.com/v1beta"
    );
  });

  it("支持 compatible 与 auto 协议路由及单模型覆写", () => {
    expect(inferProtocolForModel("claude-sonnet-4-5", "compatible")).toBe(
      "openai-completions"
    );
    expect(inferProtocolForModel("claude-sonnet-4-5", "auto")).toBe("anthropic-messages");
    expect(inferProtocolForModel("gemini-2.5-pro", "auto")).toBe("google-generative-ai");
    expect(inferProtocolForModel("gpt-4o", "auto")).toBe("openai-completions");
    expect(
      inferProtocolForModel("gpt-5", "auto", { "gpt-5": "openai-responses" })
    ).toBe("openai-responses");
  });

  it("正确转换完整合法的 Pi Model 对象", () => {
    const info = inferModelMetadata("claude-sonnet-4-5-20250929", baseConfig);
    const piModel = toPiModel(info, baseConfig);
    expect(piModel.api).toBe("anthropic-messages");
    expect(piModel.baseUrl).toBe("https://relay.example.com");
    expect(piModel.reasoning).toBe(true);
    expect(piModel.input).toEqual(["text", "image"]);
    expect(piModel.contextWindow).toBe(200000);
  });

  it("从 /v1/models 拉取并合并自定义模型", async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://relay.example.com/v1/models");
      expect((init?.headers as Record<string, string>)?.Authorization).toBe(
        "Bearer sk-test-123456"
      );
      return new Response(
        JSON.stringify({
          data: [
            { id: "gpt-4o", owned_by: "openai" },
            { id: "claude-3-7-sonnet", owned_by: "anthropic" },
            { id: "gemini-2.5-flash", owned_by: "google" },
          ],
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const list = await fetchNewApiModels(baseConfig, mockFetch);
    expect(list.map((m) => m.id)).toEqual([
      "claude-3-7-sonnet",
      "gemini-2.5-flash",
      "gpt-4o",
      "my-private-model",
    ]);
    expect(list.find((m) => m.id === "claude-3-7-sonnet")?.providerGroup).toBe("anthropic");
  });

  it("在 /v1/models 失败时通过 sessionRequest 兜底拉取 GET /api/user/models", async () => {
    const failingFetch = vi.fn(
      async () => new Response("Forbidden", { status: 403 })
    ) as unknown as typeof fetch;
    const sessionRequest = vi.fn(async (url: string, opts?: { headers?: Record<string, string> }) => {
      expect(url).toBe("https://relay.example.com/api/user/models");
      expect(opts?.headers?.["New-Api-User"]).toBe("7");
      return jsonSessionRes({
        success: true,
        data: ["deepseek-chat", "claude-sonnet-4-5-20250929"],
      });
    });

    const list = await fetchNewApiModels(baseConfig, failingFetch, {
      sessionRequest,
      authHeaders: { "New-Api-User": "7" },
    });
    expect(list.map((m) => m.id)).toEqual([
      "claude-sonnet-4-5-20250929",
      "deepseek-chat",
      "my-private-model",
    ]);
  });

  it("pickDefaultStationModel 按站点真实模型选择且绝不硬塞缺失模型", () => {
    const makeModels = (ids: string[]): ModelInfo[] =>
      ids.map((id) => inferModelMetadata(id, baseConfig));

    // 1. 存在 preferredId 时优先选中
    const stationA = makeModels(["deepseek-chat", "gpt-4o", "my-custom"]);
    expect(pickDefaultStationModel(stationA, "my-custom")).toBe("my-custom");

    // 2. preferredId 不在站点中时，按主流对话顺序从站点实际列表中选
    expect(pickDefaultStationModel(stationA, "non-existent")).toBe("gpt-4o");

    // 3. 仅有专属/非 OpenAI 模型时绝不硬塞 gpt-4o，且跳过 embedding
    const stationB = makeModels(["text-embedding-3-small", "qwen-max-latest", "z-private"]);
    expect(pickDefaultStationModel(stationB, "gpt-4o")).toBe("qwen-max-latest");

    const stationOnlyPrivate = makeModels(["text-embedding-3-large", "acme-office-llm"]);
    expect(pickDefaultStationModel(stationOnlyPrivate, "gpt-4o")).toBe("acme-office-llm");

    // 4. 空列表返回空字符串
    expect(pickDefaultStationModel([], "gpt-4o")).toBe("");
  });

  it("支持余额查询并在 404 时优雅降级", async () => {
    const okFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("subscription")) {
        return new Response(JSON.stringify({ hard_limit_usd: 50, balance: 32.5 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ total_usage: 1750 }), { status: 200 });
    }) as unknown as typeof fetch;

    const okBilling = await fetchNewApiBilling(baseConfig, okFetch);
    expect(okBilling.supported).toBe(true);
    expect(okBilling.remainingUsd).toBe(32.5);
    expect(okBilling.usedUsd).toBe(17.5);

    const unsupportedFetch = vi.fn(
      async () => new Response("Not Found", { status: 404 })
    ) as unknown as typeof fetch;
    const unsupported = await fetchNewApiBilling(baseConfig, unsupportedFetch);
    expect(unsupported.supported).toBe(false);
    expect(unsupported.message).toContain("未开放");
  });

  it("Key 归一化、掩码检测与额度换算工具函数正确", () => {
    expect(normalizeApiKey("  Bearer abc123456  ")).toBe("sk-abc123456");
    expect(normalizeApiKey("sk-xyz789")).toBe("sk-xyz789");
    expect(normalizeApiKey("   ")).toBe("");

    expect(isMaskedKey("sk-abcd****wxyz")).toBe(true);
    expect(isMaskedKey("abcd••••wxyz")).toBe(true);
    expect(isMaskedKey("sk-ab...yz")).toBe(true);
    expect(isMaskedKey("sk-1234567890abcdef")).toBe(false);
    expect(isMaskedKey("")).toBe(false);

    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-1234****cdef");
    expect(maskApiKey("sk-abcd****wxyz")).toBe("sk-abcd****wxyz");

    expect(formatQuotaUsd(500000)).toBe("$1.00");
    expect(formatQuotaUsd(2500000)).toBe("$5.00");
    expect(formatQuotaUsd(0)).toBe("$0.00");
    expect(formatQuotaUsd(2500)).toBe("$0.0050");
    expect(formatQuotaUsd(100000, 100000)).toBe("$1.00");

    expect(buildNewApiAuthHeaders(42, "jwt-token")).toEqual({
      Accept: "application/json",
      "New-Api-User": "42",
      Authorization: "Bearer jwt-token",
    });
  });

  it("resolvePlaintextKeyForToken 支持明文直出、POST /key 揭露与 GET /token/:id 兜底", async () => {
    const noopPlatform: SessionPlatform = {
      sessionRequest: vi.fn(),
    };

    // 1. 非掩码直接归一化返回，不发起请求
    const direct = await resolvePlaintextKeyForToken(
      "https://relay.example.com",
      { id: 1, key: "rawplain123456" },
      { "New-Api-User": "1" },
      noopPlatform
    );
    expect(direct).toBe("sk-rawplain123456");
    expect(noopPlatform.sessionRequest).not.toHaveBeenCalled();

    // 2. 掩码通过 POST /api/token/${id}/key 揭露
    const postPlatform: SessionPlatform = {
      sessionRequest: vi.fn(async (url, opts) => {
        expect(url).toBe("https://relay.example.com/api/token/5/key");
        expect(opts?.method).toBe("POST");
        return jsonSessionRes({ success: true, data: { key: "revealedViaPost999" } });
      }),
    };
    expect(
      await resolvePlaintextKeyForToken(
        "https://relay.example.com",
        { id: 5, key: "sk-reve****999" },
        { "New-Api-User": "1" },
        postPlatform
      )
    ).toBe("sk-revealedViaPost999");

    // 3. POST /key 返回 404 时回退 GET /api/token/${id}
    const fallbackPlatform: SessionPlatform = {
      sessionRequest: vi.fn(async (url, opts) => {
        if (url.endsWith("/5/key") && opts?.method === "POST") {
          return jsonSessionRes({ success: false, message: "not found" }, 404);
        }
        expect(url).toBe("https://relay.example.com/api/token/5");
        expect(opts?.method).toBe("GET");
        return jsonSessionRes({ success: true, data: { id: 5, key: "sk-fromGet12345" } });
      }),
    };
    expect(
      await resolvePlaintextKeyForToken(
        "https://relay.example.com",
        { id: 5, key: "sk-from****45" },
        { "New-Api-User": "1" },
        fallbackPlatform
      )
    ).toBe("sk-fromGet12345");
  });

  it("账号密码登录后拉取用户信息、令牌并揭露首个可用启用令牌的掩码 Key", async () => {
    const progressMsgs: string[] = [];
    const sessionRequest = vi.fn(
      async (url: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        if (url === "https://relay.example.com/api/status") {
          return jsonSessionRes({
            success: true,
            data: {
              system_name: "MyNewAPI",
              quota_per_unit: 500000,
              display_in_currency: true,
            },
          });
        }
        if (url === "https://relay.example.com/api/user/login") {
          expect(opts?.method).toBe("POST");
          expect(JSON.parse(opts?.body || "{}")).toEqual({
            username: "alice",
            password: "secret",
          });
          return jsonSessionRes({
            success: true,
            data: {
              id: 88,
              username: "alice",
              display_name: "Alice Chen",
              role: 1,
              quota: 1500000,
              used_quota: 500000,
              group: "vip",
              access_token: "jwt-acc-88",
            },
          });
        }
        if (url === "https://relay.example.com/api/user/self") {
          expect(opts?.headers?.["New-Api-User"]).toBe("88");
          expect(opts?.headers?.Authorization).toBe("Bearer jwt-acc-88");
          return jsonSessionRes({
            success: true,
            data: {
              id: 88,
              username: "alice",
              display_name: "Alice Chen",
              role: 1,
              quota: 2500000,
              used_quota: 500000,
              group: "vip",
            },
          });
        }
        if (url === "https://relay.example.com/api/token/?p=0&size=50") {
          expect(opts?.headers?.["New-Api-User"]).toBe("88");
          return jsonSessionRes({
            success: true,
            data: {
              items: [
                {
                  id: 10,
                  name: "Disabled",
                  key: "sk-disa****1111",
                  status: 2,
                  remain_quota: 1000000,
                  unlimited_quota: false,
                  expired_time: -1,
                },
                {
                  id: 11,
                  name: "WorkKey",
                  key: "sk-work****9999",
                  status: 1,
                  remain_quota: 0,
                  unlimited_quota: true,
                  expired_time: -1,
                },
              ],
            },
          });
        }
        if (url === "https://relay.example.com/api/token/11/key") {
          return jsonSessionRes({
            success: true,
            data: { key: "worksecretkey1234569999" },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      }
    );

    const session = await authenticateAndBootstrapKey(
      {
        baseUrl: "https://relay.example.com/v1",
        username: "alice",
        password: "secret",
        onProgress: (m) => progressMsgs.push(m),
      },
      { sessionRequest }
    );

    expect(session.mode).toBe("account");
    expect(session.baseUrl).toBe("https://relay.example.com");
    expect(session.siteStatus?.systemName).toBe("MyNewAPI");
    expect(session.user?.quota).toBe(2500000);
    expect(session.activeTokenId).toBe(11);
    expect(session.activeApiKey).toBe("sk-worksecretkey1234569999");
    expect(session.tokens.find((t) => t.id === 11)?.key).toBe(
      "sk-worksecretkey1234569999"
    );
    expect(progressMsgs.length).toBeGreaterThanOrEqual(4);
  });

  it("账户无可用明文令牌时自动创建名为 Mizurisu Agent 的无限额令牌", async () => {
    let created = false;
    const sessionRequest = vi.fn(
      async (url: string, opts?: { method?: string; body?: string }) => {
        if (url.endsWith("/api/status")) {
          return jsonSessionRes({ success: true, data: { quota_per_unit: 500000 } });
        }
        if (url.endsWith("/api/user/login")) {
          return jsonSessionRes({
            success: true,
            data: { id: 9, username: "bob", display_name: "Bob", role: 1, quota: 1000000, used_quota: 0 },
          });
        }
        if (url.endsWith("/api/user/self")) {
          return jsonSessionRes({
            success: true,
            data: { id: 9, username: "bob", display_name: "Bob", role: 1, quota: 1000000, used_quota: 0 },
          });
        }
        if (url.endsWith("/api/token/?p=0&size=50")) {
          if (!created) {
            return jsonSessionRes({ success: true, data: [] });
          }
          return jsonSessionRes({
            success: true,
            data: [
              {
                id: 99,
                name: "Mizurisu Agent",
                key: "sk-auto****8888",
                status: 1,
                remain_quota: 0,
                unlimited_quota: true,
                expired_time: -1,
              },
            ],
          });
        }
        if (url.endsWith("/api/token/") && opts?.method === "POST") {
          const body = JSON.parse(opts.body || "{}") as Record<string, unknown>;
          expect(body.name).toBe("Mizurisu Agent");
          expect(body.unlimited_quota).toBe(true);
          expect(body.expired_time).toBe(-1);
          created = true;
          // 模拟旧版 One-API 返回 data: null，触发列表重查 + /key 揭露
          return jsonSessionRes({ success: true, data: null });
        }
        if (url.endsWith("/api/token/99/key") && opts?.method === "POST") {
          return jsonSessionRes({
            success: true,
            data: { key: "sk-autocreatedmizurisu8888" },
          });
        }
        if (url.endsWith("/api/user/logout")) {
          return jsonSessionRes({ success: true });
        }
        throw new Error(`Unexpected URL: ${url}`);
      }
    );
    const clearSessionCookies = vi.fn(async () => undefined);

    const session = await authenticateAndBootstrapKey(
      { baseUrl: "https://relay.example.com", username: "bob", password: "pw" },
      { sessionRequest, clearSessionCookies }
    );

    expect(created).toBe(true);
    expect(session.activeTokenId).toBe(99);
    expect(session.activeApiKey).toBe("sk-autocreatedmizurisu8888");

    await logoutNewApiAccount(
      session.baseUrl,
      buildNewApiAuthHeaders(session.user?.id, session.accessToken),
      { sessionRequest, clearSessionCookies }
    );
    expect(clearSessionCookies).toHaveBeenCalledTimes(1);
  });

  it("Store 默认暗色主题、previewWidth=520、账号登录同步与切换令牌完整闭环", async () => {
    const classSet = new Set<string>();
    vi.stubGlobal("document", {
      documentElement: {
        classList: {
          toggle: (cls: string, force?: boolean) => {
            if (force) classSet.add(cls);
            else classSet.delete(cls);
          },
        },
      },
    });

    vi.spyOn(WebPlatformAdapter.prototype, "sessionRequest").mockImplementation(
      async (url, opts) => {
        if (url.endsWith("/api/status")) {
          return jsonSessionRes({
            success: true,
            data: { system_name: "PiRelay", quota_per_unit: 500000, display_in_currency: true },
          });
        }
        if (url.endsWith("/api/user/login")) {
          return jsonSessionRes({
            success: true,
            data: {
              id: 5,
              username: "charlie",
              display_name: "Charlie",
              role: 1,
              quota: 3000000,
              used_quota: 100000,
            },
          });
        }
        if (url.endsWith("/api/user/self")) {
          return jsonSessionRes({
            success: true,
            data: {
              id: 5,
              username: "charlie",
              display_name: "Charlie",
              role: 1,
              quota: 3000000,
              used_quota: 100000,
            },
          });
        }
        if (url.endsWith("/api/token/?p=0&size=50")) {
          return jsonSessionRes({
            success: true,
            data: {
              items: [
                {
                  id: 1,
                  name: "Primary",
                  key: "sk-prim****1111",
                  status: 1,
                  remain_quota: 0,
                  unlimited_quota: true,
                  expired_time: -1,
                },
                {
                  id: 2,
                  name: "Secondary",
                  key: "sk-seco****2222",
                  status: 1,
                  remain_quota: 0,
                  unlimited_quota: true,
                  expired_time: -1,
                },
              ],
            },
          });
        }
        if (url.endsWith("/api/token/1/key")) {
          return jsonSessionRes({ success: true, data: { key: "sk-primary-plain-1111" } });
        }
        if (url.endsWith("/api/token/2/key")) {
          return jsonSessionRes({ success: true, data: { key: "sk-secondary-plain-2222" } });
        }
        if (url.endsWith("/api/token/") && opts?.method === "POST") {
          return jsonSessionRes({
            success: true,
            data: {
              id: 3,
              name: "CustomOffice",
              key: "sk-custom-plain-3333",
              status: 1,
              remain_quota: 0,
              unlimited_quota: true,
              expired_time: -1,
            },
          });
        }
        if (url.endsWith("/api/user/logout")) {
          return jsonSessionRes({ success: true });
        }
        throw new Error(`Unexpected session URL: ${url}`);
      }
    );

    vi.spyOn(WebPlatformAdapter.prototype, "getFetch").mockImplementation(
      () =>
        (async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.endsWith("/v1/models")) {
            return new Response(
              JSON.stringify({
                data: [
                  { id: "deepseek-chat", owned_by: "deepseek" },
                  { id: "claude-sonnet-4-5-20250929", owned_by: "anthropic" },
                ],
              }),
              { status: 200 }
            );
          }
          return new Response("Not Found", { status: 404 });
        }) as unknown as typeof fetch
    );

    // 重置 store 初始化标记以测试 init
    useAppStore.setState({ initialized: false, authSession: null });
    await useAppStore.getState().init();

    const initState = useAppStore.getState();
    expect(initState.settings.theme).toBe("dark");
    expect(initState.settings.previewWidth).toBe(520);
    expect(classSet.has("dark")).toBe(true);
    expect(classSet.has("light")).toBe(false);

    await initState.toggleTheme();
    expect(useAppStore.getState().settings.theme).toBe("light");
    expect(classSet.has("light")).toBe(true);
    expect(classSet.has("dark")).toBe(false);

    await useAppStore.getState().loginWithAccount("https://relay.example.com", "charlie", "pw");
    const afterLogin = useAppStore.getState();
    expect(afterLogin.authSession?.activeApiKey).toBe("sk-primary-plain-1111");
    expect(afterLogin.config.apiKey).toBe("sk-primary-plain-1111");
    expect(afterLogin.config.selectedModelId).toBe("claude-sonnet-4-5-20250929");
    expect(afterLogin.models.map((m) => m.id)).toEqual([
      "claude-sonnet-4-5-20250929",
      "deepseek-chat",
    ]);

    await useAppStore.getState().switchActiveToken(2);
    expect(useAppStore.getState().authSession?.activeTokenId).toBe(2);
    expect(useAppStore.getState().config.apiKey).toBe("sk-secondary-plain-2222");

    const created = await useAppStore.getState().createAccountToken("CustomOffice");
    expect(created.key).toBe("sk-custom-plain-3333");
    expect(useAppStore.getState().authSession?.activeTokenId).toBe(3);
    expect(useAppStore.getState().config.apiKey).toBe("sk-custom-plain-3333");

    const persisted = await kvGet<AuthSession | null>("auth_session");
    expect(persisted?.activeTokenId).toBe(3);

    await useAppStore.getState().logout();
    expect(useAppStore.getState().authSession).toBeNull();
    expect(useAppStore.getState().config.apiKey).toBe("");
    expect(await kvGet<AuthSession | null>("auth_session")).toBeNull();
  });

  it("支持按站点货币显示 CNY (¥) 额度与解析免登跳转参数", () => {
    expect(
      formatQuotaDisplay(70000, {
        quotaPerUnit: 70000,
        quotaDisplayType: "CNY",
      })
    ).toBe("¥1.00");

    expect(
      formatQuotaDisplay(500000, {
        quotaPerUnit: 500000,
        quotaDisplayType: "USD",
      })
    ).toBe("$1.00");

    expect(
      extractAuthFromUrl("https://www.mizurisu.com/agent/#key=sk-abc123&address=https://www.mizurisu.com/")
    ).toEqual({
      apiKey: "sk-abc123",
      baseUrl: "https://www.mizurisu.com",
    });

    expect(extractAuthFromUrl("https://www.mizurisu.com/agent/")).toBeNull();
  });

  it("同源已有登录会话时静默恢复身份并自动拉取 Key，未登录则返回 null", async () => {
    const loggedInPlatform: SessionPlatform = {
      sessionRequest: vi.fn(async (url) => {
        if (url.endsWith("/api/user/self")) {
          return jsonSessionRes({
            success: true,
            data: { id: 7, username: "demo_user", display_name: "Demo User", role: 1, quota: 70000, used_quota: 0 },
          });
        }
        if (url.endsWith("/api/status")) {
          return jsonSessionRes({
            success: true,
            data: { system_name: "Example New-API", quota_per_unit: 70000, quota_display_type: "CNY" },
          });
        }
        if (url.endsWith("/api/token/?p=0&size=50")) {
          return jsonSessionRes({
            success: true,
            data: {
              items: [
                { id: 21, name: "Default", key: "sk-resumed-key-987654321", status: 1, remain_quota: 0, unlimited_quota: true, expired_time: -1 },
              ],
            },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      }),
    };

    const resumed = await tryResumeExistingSession("https://relay.example.com", loggedInPlatform);
    expect(resumed?.mode).toBe("account");
    expect(resumed?.username).toBe("demo_user");
    expect(resumed?.activeApiKey).toBe("sk-resumed-key-987654321");
    expect(resumed?.siteStatus?.quotaDisplayType).toBe("CNY");

    const guestPlatform: SessionPlatform = {
      sessionRequest: vi.fn(async () => jsonSessionRes({ success: false, message: "未登录" }, 401)),
    };
    expect(await tryResumeExistingSession("https://relay.example.com", guestPlatform)).toBeNull();
  });
});
