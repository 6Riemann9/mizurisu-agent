import type { AgentTool } from "@earendil-works/pi-agent-core";
import { obj, oneOf, opt, str, unknown } from "@earendil-works/pi-schema";
import type { McpServerConfig } from "../../../types";
import type { ExtensionRuntimeContext, MizurisuExtension } from "../types";

export interface McpRemoteToolInfo {
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const toolCache = new Map<string, McpRemoteToolInfo[]>();

function buildMcpHeaders(server: McpServerConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(server.headers || {}),
  };
}

/** 解析标准 JSON 或 SSE `data: {...}` 行中的 JSON-RPC 2.0 响应体 */
export function parseJsonRpcResponsePayload(rawText: string): {
  result?: unknown;
  error?: { code?: number; message?: string };
} {
  const trimmed = rawText.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    throw new Error("MCP 服务器返回空响应");
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  }

  // 解析 text/event-stream
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter((l) => l && l !== "[DONE]");

  for (let i = dataLines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(dataLines[i]);
      if (parsed && typeof parsed === "object" && ("result" in parsed || "error" in parsed)) {
        return parsed;
      }
    } catch {
      // 继续尝试上一条 data 事件
    }
  }
  throw new Error("未能从 SSE 响应中解析出有效 JSON-RPC 结果");
}

async function mcpJsonRpcRequest(
  server: McpServerConfig,
  method: string,
  params: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const res = await fetchImpl(server.url, {
    method: "POST",
    headers: buildMcpHeaders(server),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      method,
      params,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const rpc = parseJsonRpcResponsePayload(text);
  if (rpc.error) {
    throw new Error(`MCP 错误 (${rpc.error.code ?? -1}): ${rpc.error.message || "未知错误"}`);
  }
  return rpc.result;
}

export async function listMcpServerTools(
  server: McpServerConfig,
  fetchImpl: typeof fetch,
  forceRefresh = false
): Promise<McpRemoteToolInfo[]> {
  const cacheKey = `${server.id}::${server.url}`;
  if (!forceRefresh && toolCache.has(cacheKey)) {
    return toolCache.get(cacheKey)!;
  }

  // 先尝试 initialize（部分无状态服务可直接忽略或返回）
  await mcpJsonRpcRequest(
    server,
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mizurisu-agent", version: "0.1.0" },
    },
    fetchImpl
  ).catch(() => undefined);

  const res = (await mcpJsonRpcRequest(server, "tools/list", {}, fetchImpl)) as {
    tools?: Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }>;
  };

  const list: McpRemoteToolInfo[] = (res?.tools || [])
    .filter((t) => Boolean(t?.name))
    .map((t) => ({
      serverId: server.id,
      serverName: server.name,
      name: String(t.name),
      description: String(t.description || ""),
      inputSchema: t.inputSchema || {},
    }));

  toolCache.set(cacheKey, list);
  return list;
}

export async function callMcpServerTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<{ text: string; isError: boolean }> {
  const res = (await mcpJsonRpcRequest(
    server,
    "tools/call",
    { name: toolName, arguments: args },
    fetchImpl
  )) as {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };

  const texts = (res?.content || [])
    .map((c) => (typeof c.text === "string" ? c.text : JSON.stringify(c)))
    .filter(Boolean);

  return {
    text: texts.length > 0 ? texts.join("\n") : JSON.stringify(res),
    isError: Boolean(res?.isError),
  };
}

const mcpProxyParams = obj({
  action: oneOf(["list_servers", "search_tools", "describe_tool", "call_tool"] as const, {
    description:
      "list_servers=查看已配置服务器; search_tools=按需搜索可用工具; describe_tool=查看某工具参数 Schema; call_tool=调用远端 MCP 工具",
  }),
  serverId: opt(str({ description: "目标 MCP 服务器 ID 或名称" })),
  query: opt(str({ description: "search_tools 关键词" })),
  toolName: opt(str({ description: "describe_tool 或 call_tool 的目标工具名称" })),
  arguments: opt(unknown({ description: "call_tool 传入的 JSON 参数对象" })),
});

export const mcpAdapterExtension: MizurisuExtension = {
  id: "pi-mcp-adapter",
  name: "按需发现 Remote MCP 代理 (MCP Adapter)",
  description:
    "兼容 Streamable HTTP / SSE 远端 MCP 服务器，仅向模型注入约 200 Token 的单一代理工具，按需发现并调用外部工具（需审批确认）。",
  category: "ecosystem",
  defaultEnabled: true,
  register(api, runtimeCtx?: ExtensionRuntimeContext) {
    const enabledServers = (runtimeCtx?.settings.mcpServers || []).filter((s) => s.enabled);
    // 无任何已启用的 MCP 服务器时，在运行期 0 工具注入（0 Token 开销）
    if (runtimeCtx && enabledServers.length === 0) {
      return;
    }

    const mcpProxyTool: AgentTool<typeof mcpProxyParams> = {
      name: "mcp_proxy",
      label: "Remote MCP 按需代理",
      description:
        "连接外部 Remote MCP 服务的轻量统一入口：先 list_servers / search_tools 按需发现工具与 describe_tool 查参数，再用 call_tool 执行调用。",
      parameters: mcpProxyParams,
      execute: async (_id, params) => {
        if (!runtimeCtx) throw new Error("未绑定运行时上下文");
        const servers = (runtimeCtx.settings.mcpServers || []).filter((s) => s.enabled);
        if (servers.length === 0) {
          return {
            content: [{ type: "text", text: "当前尚未启用任何 Remote MCP 服务器。" }],
            details: { serverCount: 0 },
          };
        }

        const fetchImpl = runtimeCtx.platform.getFetch();

        if (params.action === "list_servers") {
          return {
            content: [
              {
                type: "text",
                text: servers
                  .map((s) => `- ${s.name} (id=${s.id}, transport=${s.transport}, url=${s.url})`)
                  .join("\n"),
              },
            ],
            details: { servers: servers.map((s) => ({ id: s.id, name: s.name })) },
          };
        }

        const resolveTargetServers = () => {
          if (!params.serverId) return servers;
          const found = servers.filter(
            (s) => s.id === params.serverId || s.name === params.serverId
          );
          if (found.length === 0) {
            throw new Error(`未找到已启用的 MCP 服务器：${params.serverId}`);
          }
          return found;
        };

        if (params.action === "search_tools") {
          const targets = resolveTargetServers();
          const allTools: McpRemoteToolInfo[] = [];
          for (const srv of targets) {
            const list = await listMcpServerTools(srv, fetchImpl);
            allTools.push(...list);
          }
          const q = (params.query || "").trim().toLowerCase();
          const matched = q
            ? allTools.filter(
                (t) =>
                  t.name.toLowerCase().includes(q) ||
                  t.description.toLowerCase().includes(q)
              )
            : allTools;
          return {
            content: [
              {
                type: "text",
                text:
                  matched.length > 0
                    ? matched
                        .slice(0, 30)
                        .map(
                          (t) =>
                            `- [${t.serverId}] ${t.name}：${t.description.slice(0, 100)}`
                        )
                        .join("\n")
                    : "未匹配到符合条件的远端 MCP 工具。",
              },
            ],
            details: { count: matched.length },
          };
        }

        const targets = resolveTargetServers();
        if (!params.toolName) {
          throw new Error(`执行 ${params.action} 必须提供 toolName`);
        }

        let matchedServer: McpServerConfig | undefined;
        let matchedTool: McpRemoteToolInfo | undefined;
        for (const srv of targets) {
          const list = await listMcpServerTools(srv, fetchImpl);
          const hit = list.find((t) => t.name === params.toolName);
          if (hit) {
            matchedServer = srv;
            matchedTool = hit;
            break;
          }
        }
        if (!matchedServer || !matchedTool) {
          throw new Error(`未在已配置 MCP 服务器中找到工具：${params.toolName}`);
        }

        if (params.action === "describe_tool") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    serverId: matchedServer.id,
                    name: matchedTool.name,
                    description: matchedTool.description,
                    inputSchema: matchedTool.inputSchema,
                  },
                  null,
                  2
                ),
              },
            ],
            details: { serverId: matchedServer.id, toolName: matchedTool.name },
          };
        }

        const rawArgs =
          params.arguments && typeof params.arguments === "object"
            ? (params.arguments as Record<string, unknown>)
            : {};
        const callRes = await callMcpServerTool(
          matchedServer,
          matchedTool.name,
          rawArgs,
          fetchImpl
        );
        return {
          content: [{ type: "text", text: callRes.text }],
          details: { serverId: matchedServer.id, toolName: matchedTool.name },
          isError: callRes.isError,
        };
      },
    };

    api.registerTool(mcpProxyTool);
    api.injectSystemPrompt(
      "- 当前工作台已接入外部 Remote MCP 工具，调用前请先用 `mcp_proxy(action=\"search_tools\")` 查清工具名与 `describe_tool` 参数。"
    );

    // 外部 MCP call_tool 走审批拦截，防止未经确认写入外部系统
    api.onBeforeToolCall(async ({ toolCall, args }, ctx, signal) => {
      if (toolCall.name !== "mcp_proxy") return undefined;
      const action = (args as { action?: string } | undefined)?.action;
      if (action !== "call_tool") return undefined;
      if (!ctx.requestApproval) return undefined;

      const approved = await new Promise<boolean>((resolve) => {
        let settled = false;
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        const safeResolve = (v: boolean) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(v);
        };
        const onAbort = () => {
          ctx.cancelApproval?.(toolCall.id);
          safeResolve(false);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) {
          onAbort();
          return;
        }
        ctx.requestApproval?.({
          id: toolCall.id,
          toolName: "mcp_proxy",
          title: "确认调用外部 Remote MCP 工具",
          description: "Agent 请求通过 Remote MCP 代理调用外部服务工具，请确认参数安全后再执行：",
          argsPreview: JSON.stringify(args, null, 2),
          resolve: safeResolve,
        });
      });

      if (!approved || signal?.aborted) {
        return {
          block: true,
          reason: signal?.aborted ? "用户已终止执行" : "用户拒绝执行该外部 MCP 工具调用",
        };
      }
      return undefined;
    });
  },
};
