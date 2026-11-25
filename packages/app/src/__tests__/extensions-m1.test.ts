import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultExtensionHost,
  htmlToReadableMarkdown,
  matchesProtectedPath,
  parseBingSearchResults,
  parseDuckDuckGoHtmlResults,
  parseSearxngJsonResults,
  readMemoryScopes,
  searchWorkspaceFiles,
  writeMemoryScope,
} from "../agent/extensions";
import type { ExtensionRuntimeContext } from "../agent/extensions";
import { createExcelWorkbook, createWordDocument } from "../office";
import { clearAllLocalData } from "../storage/db";
import { WorkspaceVFS } from "../storage/workspace-vfs";
import type { MessageUsage } from "../types";

function makeAssistantMessage(text: string, tokens = 120): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "openai",
    model: "gpt-4o",
    usage: {
      input: Math.floor(tokens * 0.7),
      output: Math.ceil(tokens * 0.3),
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: tokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function createRuntimeCtx(
  vfs: WorkspaceVFS,
  overrides?: Partial<ExtensionRuntimeContext>
): ExtensionRuntimeContext {
  const mockStreamFn: StreamFn = () => {
    const stream = new AssistantMessageEventStream();
    queueMicrotask(() => {
      const msg = makeAssistantMessage("子代理分析结论：Q2 同比增长 28%。", 200);
      stream.push({ type: "start", partial: msg });
      stream.push({ type: "done", reason: "stop", message: msg });
    });
    return stream;
  };

  return {
    sessionId: "sess_m1",
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
    streamFn: mockStreamFn,
    platform: {
      kind: "desktop",
      label: "Desktop",
      canRunShell: true,
      canMountNativeDir: true,
      getFetch: () => globalThis.fetch,
      sessionRequest: async () => ({ status: 200, ok: true, text: "" }),
      fetchWebUrl: async () => ({
        status: 200,
        ok: true,
        text: "<html><head><title>测试行业报告</title></head><body><h1>核心结论</h1><p>市场规模增长 35%。</p><script>alert(1)</script></body></html>",
      }),
      exportFile: async () => undefined,
      pickNativeDirectory: async () => null,
    },
    subagentDepth: 0,
    todos: [],
    updateTodos: () => undefined,
    ...overrides,
  };
}

describe("M1: Memory / Search / Web Access / Subagents / Protected Paths", () => {
  let vfs: WorkspaceVFS;

  beforeEach(async () => {
    await clearAllLocalData();
    vfs = new WorkspaceVFS();
  });

  it("pi-gl-mem 支持全局与工作区长期记忆读写、上下文注入以及跨 Office 全文检索", async () => {
    await writeMemoryScope(vfs, "global", "所有报告默认使用简体中文与万元单位", "append");
    await writeMemoryScope(vfs, "workspace", "本项目客户为星辰科技有限公司", "append");

    const mem = await readMemoryScopes(vfs, "both");
    expect(mem.globalMemory).toContain("万元单位");
    expect(mem.workspaceMemory).toContain("星辰科技");

    const docxBytes = await createWordDocument({
      title: "合同补充协议",
      blocks: [{ type: "paragraph", text: "违约金上限为合同总额的 20%，交付验收周期 15 个工作日。" }],
    });
    const xlsxBytes = await createExcelWorkbook({
      sheets: [
        {
          name: "明细",
          headers: ["客户", "季度金额"],
          rows: [["星辰科技", 450]],
        },
      ],
    });
    await vfs.writeBytes("协议.docx", docxBytes);
    await vfs.writeBytes("台账.xlsx", xlsxBytes);
    await vfs.writeText("纪要.md", "周例会结论：星辰科技项目按期上线。");

    const hits = await searchWorkspaceFiles(vfs, "星辰科技");
    expect(hits.map((h) => h.path).sort()).toEqual(["台账.xlsx", "纪要.md"]);

    const wordHits = await searchWorkspaceFiles(vfs, "违约金上限");
    expect(wordHits).toHaveLength(1);
    expect(wordHits[0].path).toBe("协议.docx");

    const host = createDefaultExtensionHost();
    const ctx = createRuntimeCtx(vfs);
    const compiled = host.compile(ctx);
    const injected = await host.runTransformContext(
      compiled.transformHooks,
      [{ role: "user", content: "写周报", timestamp: Date.now() }],
      ctx
    );
    expect(String(injected[0].content)).toContain("[长期记忆 MEMORY]");
    expect(String(injected[0].content)).toContain("万元单位");
  });

  it("pi-web-access 支持 HTML 清洗、Bing/DDG/SearXNG 解析与 fetch_url", async () => {
    const md = htmlToReadableMarkdown(
      "<html><head><title>AI 办公趋势</title></head><body><h1>要点</h1><p>纯本机运行。</p><script>bad()</script></body></html>"
    );
    expect(md).toContain("# AI 办公趋势");
    expect(md).toContain("纯本机运行");
    expect(md).not.toContain("bad()");

    const ddg = parseDuckDuckGoHtmlResults(
      `<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">示例结果</a><a class="result__snippet">这是摘要</a>`
    );
    expect(ddg[0]).toMatchObject({
      title: "示例结果",
      url: "https://example.com/a",
      snippet: "这是摘要",
      source: "DuckDuckGo",
    });

    const bing = parseBingSearchResults(
      `<li class="b_algo"><h2><a href="https://example.org/b">Bing 标题</a></h2><div class="b_caption"><p>Bing 摘要</p></div></li>`
    );
    expect(bing[0]?.url).toBe("https://example.org/b");

    const searx = parseSearxngJsonResults(
      JSON.stringify({ results: [{ title: "SX", url: "https://sx.test", content: "ok" }] })
    );
    expect(searx[0]?.source).toBe("SearXNG");

    const host = createDefaultExtensionHost();
    const ctx = createRuntimeCtx(vfs);
    const fetchTool = host.compile(ctx).tools.find((t) => t.name === "fetch_url")!;
    const res = await fetchTool.execute("tc_fetch", { url: "https://example.com/report" });
    expect((res.content[0] as { text: string }).text).toContain("市场规模增长 35%");
    expect((res.content[0] as { text: string }).text).not.toContain("alert(1)");
  });

  it("pi-subagents 支持并行分工、Usage 回传汇总，并在子代理内禁止递归派生", async () => {
    const usages: MessageUsage[] = [];
    const host = createDefaultExtensionHost();
    const rootCtx = createRuntimeCtx(vfs, {
      onSubagentUsage: (u) => usages.push(u),
    });

    const rootTools = host.compile(rootCtx).tools;
    const delegate = rootTools.find((t) => t.name === "delegate_subagents");
    expect(delegate).toBeDefined();

    // 验证 subagentDepth = 1 时不注入 delegate_subagents 和 ask_user_questions
    const childTools = host.compile({ ...rootCtx, subagentDepth: 1 }).tools;
    expect(childTools.some((t) => t.name === "delegate_subagents")).toBe(false);
    expect(childTools.some((t) => t.name === "ask_user_questions")).toBe(false);

    const out = await delegate!.execute("tc_sub", {
      tasks: [
        { role: "财报核对员", goal: "核对 Q2 同比" },
        { role: "行业检索员", goal: "总结行业趋势" },
      ],
    });
    expect((out.content[0] as { text: string }).text).toContain("Q2 同比增长 28%");
    expect(usages).toHaveLength(2);
    expect(usages.reduce((s, u) => s + u.totalTokens, 0)).toBe(400);
  });

  it("pi-protected-paths 支持精确与通配路径匹配并在拒绝时拦截写入", async () => {
    expect(matchesProtectedPath("重要合同原件.docx", ["重要合同原件.docx"])).toBe(true);
    expect(matchesProtectedPath("templates/报价单.xlsx", ["templates/*.xlsx"])).toBe(true);
    expect(matchesProtectedPath("drafts/草稿.docx", ["templates/*.xlsx"])).toBe(false);

    const host = createDefaultExtensionHost();
    const ctx = createRuntimeCtx(vfs, {
      settings: {
        theme: "dark",
        autoApproveDelete: false,
        previewWidth: 520,
        protectedPaths: ["重要合同原件.docx"],
      },
      requestApproval: (req) => {
        req.resolve(false);
      },
    });
    const compiled = host.compile(ctx);
    const blockRes = await host.runBeforeToolCall(
      compiled.beforeHooks,
      {
        toolCall: { type: "toolCall", id: "tc_1", name: "word_create", arguments: { path: "重要合同原件.docx" } },
        args: { path: "重要合同原件.docx" },
        assistantMessage: makeAssistantMessage("call"),
        context: { messages: [] },
      },
      ctx
    );
    expect(blockRes?.block).toBe(true);
    expect(blockRes?.reason).toContain("重要合同原件.docx");
  });
});
