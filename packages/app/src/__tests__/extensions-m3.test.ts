import { beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultExtensionHost,
  listMcpServerTools,
  parseJsonRpcResponsePayload,
} from "../agent/extensions";
import type { ExtensionRuntimeContext } from "../agent/extensions";
import { APP_VERSION, checkLatestRelease, compareSemver } from "../platform/updater";
import { clearAllLocalData } from "../storage/db";
import { WorkspaceVFS } from "../storage/workspace-vfs";
import type { McpServerConfig } from "../types";

function createCtx(
  vfs: WorkspaceVFS,
  overrides?: Partial<ExtensionRuntimeContext>
): ExtensionRuntimeContext {
  return {
    sessionId: "sess_m3",
    vfs,
    config: {
      brandName: "Mizurisu Agent",
      baseUrl: "https://www.mizurisu.com",
      apiKey: "sk-test",
      protocolMode: "compatible",
      selectedModelId: "gpt-4o",
      thinkingLevel: "medium",
      customModels: [],
      modelProtocolOverrides: {},
    },
    settings: {
      theme: "dark",
      autoApproveDelete: false,
      previewWidth: 520,
    },
    model: {
      id: "gpt-4o",
      name: "GPT-4o",
      api: "openai-completions",
      provider: "openai",
      baseUrl: "https://www.mizurisu.com/v1",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    },
    models: [],
    streamFn: (() => {
      throw new Error("not used");
    }) as unknown as ExtensionRuntimeContext["streamFn"],
    platform: {
      kind: "web",
      label: "Web",
      canRunShell: false,
      canMountNativeDir: false,
      getFetch: () => globalThis.fetch,
      sessionRequest: async () => ({ status: 200, ok: true, text: "" }),
      exportFile: async () => undefined,
      pickNativeDirectory: async () => null,
    },
    subagentDepth: 0,
    todos: [],
    updateTodos: () => undefined,
    ...overrides,
  };
}

describe("M3: Remote MCP 按需代理、多工作区隔离与版本更新检查", () => {
  beforeEach(async () => {
    await clearAllLocalData();
  });

  it("pi-mcp-adapter 未配置启用的服务器时 0 工具注入，启用后支持按需发现与审批调用", async () => {
    const vfs = new WorkspaceVFS();
    const host = createDefaultExtensionHost();

    // 1. 无 MCP 配置时不占用模型上下文工具栏
    const emptyTools = host.compile(createCtx(vfs)).tools;
    expect(emptyTools.some((t) => t.name === "mcp_proxy")).toBe(false);

    // 2. SSE JSON-RPC 响应体解析
    const sseParsed = parseJsonRpcResponsePayload(
      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"feishu_send"}]}}\n\n'
    );
    expect((sseParsed.result as { tools: Array<{ name: string }> }).tools[0].name).toBe("feishu_send");

    // 3. 启用 Remote MCP 后按需检索、调用与审批保护
    const mockServer: McpServerConfig = {
      id: "srv_demo",
      name: "Demo MCP",
      url: "https://mcp.example.com/rpc",
      transport: "streamable-http",
      enabled: true,
    };

    const mockFetch: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as {
        id: string;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          status: 200,
        });
      }
      if (body.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "query_crm",
                  description: "查询客户商机状态",
                  inputSchema: { type: "object", properties: { name: { type: "string" } } },
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: `CRM命中:${body.params?.arguments?.name}` }] },
        }),
        { status: 200 }
      );
    };

    const tools = await listMcpServerTools(mockServer, mockFetch, true);
    expect(tools[0].name).toBe("query_crm");

    const ctxWithMcp = createCtx(vfs, {
      settings: {
        theme: "dark",
        autoApproveDelete: false,
        previewWidth: 520,
        mcpServers: [mockServer],
      },
      platform: {
        kind: "web",
        label: "Web",
        canRunShell: false,
        canMountNativeDir: false,
        getFetch: () => mockFetch,
        sessionRequest: async () => ({ status: 200, ok: true, text: "" }),
        exportFile: async () => undefined,
        pickNativeDirectory: async () => null,
      },
      requestApproval: (req) => req.resolve(false),
    });

    const compiled = host.compile(ctxWithMcp);
    const mcpProxy = compiled.tools.find((t) => t.name === "mcp_proxy")!;
    expect(mcpProxy).toBeDefined();

    const searchRes = await mcpProxy.execute("tc_s", {
      action: "search_tools",
      query: "crm",
    });
    expect((searchRes.content[0] as { text: string }).text).toContain("query_crm");

    const callRes = await mcpProxy.execute("tc_c", {
      action: "call_tool",
      toolName: "query_crm",
      arguments: { name: "星辰科技" },
    });
    expect((callRes.content[0] as { text: string }).text).toContain("星辰科技");

    // 审批钩子应在拒绝时拦截外部 call_tool
    const blocked = await host.runBeforeToolCall(
      compiled.beforeHooks,
      {
        toolCall: { type: "toolCall", id: "tc_b", name: "mcp_proxy", arguments: { action: "call_tool" } },
        args: { action: "call_tool", toolName: "query_crm" },
        assistantMessage: {
          role: "assistant",
          content: [{ type: "text", text: "call" }],
          api: "openai-completions",
          provider: "openai",
          model: "gpt-4o",
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        },
        context: { messages: [] },
      },
      ctxWithMcp
    );
    expect(blocked?.block).toBe(true);
  });

  it("多工作区 VFS 完全隔离文件且默认工作区保持无前缀向后兼容", async () => {
    const vfs = new WorkspaceVFS();
    await vfs.writeText("默认文档.md", "default content");

    vfs.setActiveWorkspace("ws_client_a");
    expect((await vfs.listFiles()).length).toBe(0);
    await vfs.writeText("合同.md", "client a");

    expect((await vfs.listFiles()).map((f) => f.path)).toEqual(["合同.md"]);

    vfs.setActiveWorkspace("default");
    expect((await vfs.listFiles()).map((f) => f.path)).toEqual(["默认文档.md"]);
  });

  it("GitHub Releases 更新检查器能准确比较版本并识别对应系统安装包", async () => {
    expect(compareSemver("0.2.0", "0.1.0")).toBe(1);
    expect(compareSemver("v0.1.0", "0.1.0")).toBe(0);
    expect(compareSemver("0.1.0", "1.0.0")).toBe(-1);

    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          tag_name: "v0.2.0",
          html_url: "https://github.com/6Riemann9/mizurisu-agent/releases/tag/v0.2.0",
          body: "新增 M0-M3 插件体系",
          assets: [
            {
              name: "Mizurisu Agent_0.2.0_x64-setup.exe",
              browser_download_url: "https://example.com/setup.exe",
            },
          ],
        }),
        { status: 200 }
      );

    const info = await checkLatestRelease(mockFetch, APP_VERSION);
    expect(info.hasUpdate).toBe(true);
    expect(info.latestVersion).toBe("0.2.0");
    expect(info.message).toContain("发现新版本");
  });
});
