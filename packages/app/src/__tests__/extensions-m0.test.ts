import { describe, expect, it } from "vitest";
import {
  buildHandoffFromSession,
  buildHandoffPrompt,
  createDefaultExtensionHost,
  estimateCostUsd,
  estimateTokenBurden,
  formatTodoSummaryForContext,
  mergeTodos,
} from "../agent/extensions";
import type { ExtensionRuntimeContext } from "../agent/extensions";
import { exportSkillToMarkdown, parseSkillMarkdown } from "../agent/skill-md";
import type { ChatSession } from "../types";
import { WorkspaceVFS } from "../storage/workspace-vfs";

function createMockRuntimeContext(overrides?: Partial<ExtensionRuntimeContext>): ExtensionRuntimeContext {
  const vfs = new WorkspaceVFS();
  return {
    sessionId: "sess_test",
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
      throw new Error("not used in unit test");
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

describe("M0: Mizurisu-Pi Extension Host 与工作流插件", () => {
  it("关闭插件后不会注入任何工具、系统提示词或钩子（0 Token 开销）", () => {
    const host = createDefaultExtensionHost();
    const ctxAll = createMockRuntimeContext();
    const allCompiled = host.compile(ctxAll);
    expect(allCompiled.tools.some((t) => t.name === "todo_write")).toBe(true);
    expect(allCompiled.tools.some((t) => t.name === "session_handoff")).toBe(true);

    const allDisabledMap = Object.fromEntries(
      host.getRegisteredExtensions().map((ext) => [ext.id, false])
    );
    const ctxDisabled = createMockRuntimeContext({
      settings: {
        theme: "dark",
        autoApproveDelete: false,
        previewWidth: 520,
        enabledPlugins: allDisabledMap,
      },
    });
    const disabledCompiled = host.compile(ctxDisabled);
    expect(disabledCompiled.tools).toHaveLength(0);
    expect(disabledCompiled.promptSnippets).toHaveLength(0);
    expect(disabledCompiled.beforeHooks).toHaveLength(0);
    expect(disabledCompiled.transformHooks).toHaveLength(0);
  });

  it("pi-todo-list 支持 replace/upsert 持久化并在 transformContext 保活未完成进度", async () => {
    const host = createDefaultExtensionHost();
    let persisted = mergeTodos([], [
      { id: "s1", content: "读取季度销售表", status: "completed" },
      { id: "s2", content: "生成复盘 PPT", status: "in_progress" },
    ]);
    const ctx = createMockRuntimeContext({
      todos: persisted,
      updateTodos: (next) => {
        persisted = next;
      },
    });

    const compiled = host.compile(ctx);
    const todoWrite = compiled.tools.find((t) => t.name === "todo_write")!;
    await todoWrite.execute("tc_todo_1", {
      mode: "upsert",
      todos: [{ id: "s3", content: "导出可交付 PDF", status: "pending" }],
    });

    expect(persisted).toHaveLength(3);
    expect(formatTodoSummaryForContext(persisted)).toContain("已完成 1/3");

    const transformed = await host.runTransformContext(
      compiled.transformHooks,
      [{ role: "user", content: "继续下一步", timestamp: Date.now() }],
      ctx
    );
    expect(transformed.length).toBe(2);
    expect(String(transformed[1].content)).toContain("导出可交付 PDF");
  });

  it("pi-questionnaire 支持正常提交并在 AbortSignal 触发时安全解除等待避免死锁", async () => {
    const host = createDefaultExtensionHost();
    let capturedCancelId = "";
    const ctx = createMockRuntimeContext({
      requestQuestionnaire: (req) => {
        // 模拟正常返回用户选择的分支
        if (req.id === "tc_ok") {
          req.resolve({ style: ["极简商务风"], pages: ["8页"] });
        }
      },
      cancelQuestionnaire: (id) => {
        capturedCancelId = id;
      },
    });

    const compiled = host.compile(ctx);
    const askTool = compiled.tools.find((t) => t.name === "ask_user_questions")!;
    const okRes = await askTool.execute("tc_ok", {
      title: "确认汇报风格",
      questions: [
        { id: "style", question: "偏好风格", options: ["极简商务风", "科技深色"] },
        { id: "pages", question: "期望页数", options: ["5页", "8页"] },
      ],
    });
    expect((okRes.content[0] as { text: string }).text).toContain("极简商务风");

    // 模拟用户等待弹窗时点击停止按钮触发 abort
    const controller = new AbortController();
    const pendingPromise = askTool.execute(
      "tc_abort",
      {
        questions: [{ id: "q1", question: "选一项", options: ["A", "B"] }],
      },
      controller.signal
    );
    controller.abort();
    const abortRes = await pendingPromise;
    expect(capturedCancelId).toBe("tc_abort");
    expect((abortRes.content[0] as { text: string }).text).toContain("取消或跳过");
  });

  it("pi-handoff 能从长会话提炼结构化交接草稿并触发回调", async () => {
    const sampleSession: ChatSession = {
      id: "sess_1",
      title: "季度财务汇报",
      createdAt: 1000,
      updatedAt: 2000,
      totalTokens: 5000,
      messages: [
        {
          id: "u1",
          role: "user",
          content: "帮我基于销售数据做 Word 报告和 PPT",
          attachments: [{ path: "销售.xlsx", name: "销售.xlsx", category: "excel" }],
          createdAt: 1000,
        },
        {
          id: "a1",
          role: "assistant",
          content: "已完成销售汇总分析，下一步准备撰写报告。",
          createdAt: 1500,
        },
      ],
    };

    const handoff = buildHandoffFromSession(sampleSession, [
      { id: "1", content: "生成最终 PPTX", status: "pending", updatedAt: 1500 },
    ]);
    expect(handoff.relevantFiles).toContain("销售.xlsx");
    expect(handoff.promptDraft).toContain("生成最终 PPTX");
    expect(buildHandoffPrompt({
      title: "测试交接",
      summary: "已完成清洗",
      keyDecisions: ["单位用万元"],
      relevantFiles: ["a.xlsx"],
      nextSteps: ["写总结"],
    })).toContain("单位用万元");
  });

  it("pi-token-burden 能精确汇总各分项占比与会话估算费用", () => {
    const host = createDefaultExtensionHost();
    const ctx = createMockRuntimeContext();
    const compiled = host.compile(ctx);

    const report = estimateTokenBurden({
      systemPrompt: "A".repeat(3000),
      tools: compiled.tools,
      historyMessages: [{ role: "user", content: "B".repeat(6000), timestamp: 1000 }],
      uiMessages: [
        {
          id: "m1",
          role: "assistant",
          content: "ok",
          modelId: "gpt-4o",
          usage: { inputTokens: 10000, outputTokens: 2000, totalTokens: 12000 },
          createdAt: 1000,
        },
      ],
      contextWindow: 128000,
      modelId: "gpt-4o",
      perPluginToolTokens: compiled.perPluginToolTokens,
    });

    expect(report.systemPromptTokens).toBe(1000);
    expect(report.toolSchemaTokens).toBeGreaterThan(50);
    expect(report.historyTokens).toBeGreaterThan(2000);
    expect(report.usagePercent).toBeGreaterThan(0);
    expect(report.estimatedSessionCostUsd).toBe(estimateCostUsd("gpt-4o", 10000, 2000));
  });

  it("标准 SKILL.md 导入器支持 YAML Frontmatter 与纯 Markdown 回环", () => {
    const raw = `---
name: "季度经营复盘专家"
description: "按麦肯锡金字塔原则输出管理层汇报"
category: ppt
prompt: "请按季度经营复盘技能整理数据并输出汇报"
---

# 季度经营复盘专家

1. 先核对同比与环比口径
2. 用结论先行结构组织汇报页
`;
    const parsed = parseSkillMarkdown(raw);
    expect(parsed.name).toBe("季度经营复盘专家");
    expect(parsed.category).toBe("ppt");
    expect(parsed.systemHint).toContain("先核对同比与环比口径");

    const exported = exportSkillToMarkdown(parsed);
    const reparsed = parseSkillMarkdown(exported);
    expect(reparsed.name).toBe(parsed.name);
    expect(reparsed.description).toBe(parsed.description);

    const plain = parseSkillMarkdown("# 合同对比助手\n\n逐条标红甲乙双方义务差异。", "fallback.md");
    expect(plain.name).toBe("合同对比助手");
    expect(plain.category).toBe("custom");
  });
});
