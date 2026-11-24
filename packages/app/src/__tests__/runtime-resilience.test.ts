import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PiAgentRunner,
  trimHistoryToBudget,
  uiMessagesToPiMessages,
} from "../agent/runtime";
import { buildSystemPrompt } from "../agent/system-prompt";
import {
  classifyApiError,
  DEFAULT_NEWAPI_URL,
  getMizurisuConsoleLinks,
  inferModelMetadata,
  toPiModel,
} from "../newapi/client";
import { WebPlatformAdapter } from "../platform/web-adapter";
import { clearAllLocalData } from "../storage/db";
import { workspaceVfs, WorkspaceVFS } from "../storage/workspace-vfs";
import { useAppStore } from "../store/useAppStore";
import type { ApprovalRequest, NewApiConfig, UiMessage } from "../types";

const baseConfig: NewApiConfig = {
  brandName: "Mizurisu Agent",
  baseUrl: "https://relay.example.com",
  apiKey: "sk-test-123456",
  protocolMode: "auto",
  selectedModelId: "claude-sonnet-4-5-20250929",
  thinkingLevel: "off",
  customModels: [],
  modelProtocolOverrides: {},
};

describe("客户级运行时韧性、错误诊断与模型智能分类", () => {
  beforeEach(async () => {
    await clearAllLocalData();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("classifyApiError 精准诊断各类 HTTP、额度、模型、上下文、CORS 与服务端异常", () => {
    const auth401 = classifyApiError("HTTP 401 Unauthorized: invalid_api_key");
    expect(auth401.code).toBe("auth");
    expect(auth401.retryable).toBe(false);
    expect(auth401.suggestOpenSettings).toBe(true);

    const auth403 = classifyApiError("403 Forbidden: 令牌已过期");
    expect(auth403.code).toBe("auth");

    const quota402 = classifyApiError("HTTP 402: 余额不足");
    expect(quota402.code).toBe("quota");
    expect(quota402.retryable).toBe(false);
    expect(quota402.suggestBillingConsole).toBe(true);

    const quota429 = classifyApiError("429 You exceeded your current quota (insufficient_quota)");
    expect(quota429.code).toBe("quota");

    const rateLimit = classifyApiError("HTTP 429 Too Many Requests: Rate limit reached");
    expect(rateLimit.code).toBe("rate_limit");
    expect(rateLimit.retryable).toBe(true);
    expect(rateLimit.suggestSwitchModel).toBe(true);

    const model404 = classifyApiError("404 model_not_found: 当前分组下无可用渠道");
    expect(model404.code).toBe("model_unavailable");
    expect(model404.suggestSwitchModel).toBe(true);

    const channel503 = classifyApiError("HTTP 503: 当前分组下对于模型 gpt-x 无可用渠道");
    expect(channel503.code).toBe("model_unavailable");

    const ctxErr = classifyApiError("This model's maximum context length is 128000 tokens (too many tokens)");
    expect(ctxErr.code).toBe("context_length");
    expect(ctxErr.retryable).toBe(false);
    expect(ctxErr.suggestSwitchModel).toBe(true);

    const corsWithBase = classifyApiError(
      "TypeError: Failed to fetch",
      "https://api.custom.com/v1/"
    );
    expect(corsWithBase.code).toBe("cors_network");
    expect(corsWithBase.retryable).toBe(true);
    expect(corsWithBase.advice).toContain("https://api.custom.com");
    expect(corsWithBase.advice).toContain("同源");
    expect(corsWithBase.advice).toContain("桌面端");

    const corsNoBase = classifyApiError("NetworkError when attempting to fetch resource");
    expect(corsNoBase.code).toBe("cors_network");

    const server503 = classifyApiError("HTTP 503 Service Unavailable");
    expect(server503.code).toBe("server");
    expect(server503.retryable).toBe(true);

    const unknown = classifyApiError("Unexpected parser hiccup");
    expect(unknown.code).toBe("unknown");
    expect(unknown.advice).toContain("Unexpected parser hiccup");
  });

  it("getMizurisuConsoleLinks 正确生成控制台地址并对非法 URL 安全回落", () => {
    expect(getMizurisuConsoleLinks("https://station.example.com/v1/")).toEqual({
      homeUrl: "https://station.example.com",
      tokenUrl: "https://station.example.com/console/token",
      topupUrl: "https://station.example.com/console/topup",
      logUrl: "https://station.example.com/console/log",
    });

    const fallback = DEFAULT_NEWAPI_URL.replace(/\/+$/, "");
    expect(getMizurisuConsoleLinks("javascript:alert(1)").homeUrl).toBe(fallback);
    expect(getMizurisuConsoleLinks("not-a-valid-url").tokenUrl).toBe(`${fallback}/console/token`);
    expect(getMizurisuConsoleLinks("").logUrl).toBe(`${fallback}/console/log`);
  });

  it("inferModelMetadata 准确区分对话模型、推荐旗舰与非对话模型并生成中文标签", () => {
    const claude = inferModelMetadata("claude-sonnet-4-5-20250929", baseConfig);
    expect(claude.isChatCapable).toBe(true);
    expect(claude.recommended).toBe(true);
    expect(claude.tags).toEqual(["推荐", "推理", "视觉"]);
    expect((claude.tags || []).length).toBeLessThanOrEqual(3);

    const gpt41 = inferModelMetadata("gpt-4.1", baseConfig);
    expect(gpt41.isChatCapable).toBe(true);
    expect(gpt41.recommended).toBe(true);
    expect(gpt41.tags).toEqual(["推荐", "视觉", "长文本"]);

    const gpt4oMini = inferModelMetadata("gpt-4o-mini", baseConfig);
    expect(gpt4oMini.isChatCapable).toBe(true);
    expect(gpt4oMini.recommended).toBe(false);
    expect(gpt4oMini.tags).toContain("轻量");

    const deepseek = inferModelMetadata("deepseek-reasoner", baseConfig);
    expect(deepseek.isChatCapable).toBe(true);
    expect(deepseek.recommended).toBe(true);
    expect(deepseek.tags).toEqual(["推荐", "推理"]);

    const gemini = inferModelMetadata("gemini-2.5-pro", baseConfig);
    expect(gemini.isChatCapable).toBe(true);
    expect(gemini.recommended).toBe(true);

    const nonChatIds = [
      "text-embedding-3-large",
      "tts-1-hd",
      "whisper-1",
      "dall-e-3",
      "gpt-image-1",
      "flux-pro",
      "midjourney-v6",
      "sora-1",
      "kling-v1.6",
      "suno-v4",
      "bge-large-zh-v1.5",
      "jina-embeddings-v3",
      "voyage-3",
      "gpt-4o-realtime-preview",
    ];
    for (const id of nonChatIds) {
      const meta = inferModelMetadata(id, baseConfig);
      expect(meta.isChatCapable).toBe(false);
      expect(meta.recommended).toBe(false);
      expect(meta.tags).toEqual(["非对话"]);
    }
  });

  it("trimHistoryToBudget 在超出上下文预算时保留首条系统说明与最新完整轮次", () => {
    const sysMsg: AgentMessage = {
      role: "system",
      content: "系统说明：始终基于真实文件输出。",
      timestamp: 1,
    };

    // 每条助手回复约 9000 字符（~3000 tokens），每轮约 3020 tokens
    const makeTurn = (idx: number, chars = 9000): AgentMessage[] => [
      { role: "user", content: `问题 ${idx}`, timestamp: idx * 10 },
      {
        role: "assistant",
        content: [{ type: "text", text: `回答${idx}_`.padEnd(chars, "字") }],
        api: "openai-completions",
        provider: "openai",
        model: "gpt-4o",
        usage: {
          input: 100,
          output: 100,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 200,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: idx * 10 + 1,
      },
    ];

    const history: AgentMessage[] = [
      sysMsg,
      ...makeTurn(1),
      ...makeTurn(2),
      ...makeTurn(3),
      ...makeTurn(4),
    ];

    // contextWindow=12000 => 预算 Math.max(8000, Math.floor(12000 * 0.65)) = 8000 tokens（最多保留 2 轮最新对话 + system）
    const trimmed = trimHistoryToBudget(history, 12000);
    expect(trimmed[0].role).toBe("system");
    const texts = trimmed.map((m) =>
      typeof m.content === "string"
        ? m.content
        : m.content.map((b) => (b.type === "text" ? b.text : "")).join("")
    );
    expect(texts.some((t) => t.includes("问题 1"))).toBe(false);
    expect(texts.some((t) => t.includes("问题 2"))).toBe(false);
    expect(texts.some((t) => t.includes("问题 3"))).toBe(true);
    expect(texts.some((t) => t.includes("问题 4"))).toBe(true);

    // 校验总估算字符不超过 8000 * 3 = 24000
    const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
    expect(totalChars).toBeLessThanOrEqual(8000 * 3);

    // 单轮超巨型历史也应裁切受控，绝不超预算
    const hugeSingle: AgentMessage[] = [
      { role: "user", content: "超长上下文".repeat(12000), timestamp: 100 },
    ];
    const trimmedHuge = trimHistoryToBudget(hugeSingle, 10000);
    expect(trimmedHuge.length).toBe(1);
    const singleContent = trimmedHuge[0].content as string;
    expect(singleContent.length).toBeLessThanOrEqual(8000 * 3);
  });

  it("uiMessagesToPiMessages 注入历史工具摘要并使用目标模型协议字段", () => {
    const targetModel = toPiModel(
      inferModelMetadata("claude-sonnet-4-5-20250929", baseConfig),
      baseConfig
    );
    const history: UiMessage[] = [
      {
        id: "u1",
        role: "user",
        content: "生成汇总",
        createdAt: 100,
        images: [{ name: "chart.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA" }],
      },
      {
        id: "a1",
        role: "assistant",
        content: "已生成文件。",
        createdAt: 200,
        toolCalls: [
          {
            id: "tc1",
            name: "write_text_file",
            args: { path: "summary.md", content: "ok" },
            status: "success",
            modifiedPath: "summary.md",
          },
        ],
      },
    ];

    const piMsgs = uiMessagesToPiMessages(history, targetModel);
    expect(piMsgs.length).toBe(2);
    expect(piMsgs[0].role).toBe("user");
    expect(String(piMsgs[0].content)).toContain("[用户附带图片: chart.png]");

    const assistant = piMsgs[1] as AssistantMessage;
    expect(assistant.api).toBe("anthropic-messages");
    expect(assistant.provider).toBe("anthropic");
    const text = assistant.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    expect(text).toContain("已生成文件。");
    expect(text).toContain("[历史工具操作: write_text_file -> summary.md]");
  });

  it("PiAgentRunner 在审批挂起期间调用 abort() 会触发 onCancelApproval 并立即结束 run", async () => {
    const vfs = new WorkspaceVFS();
    await vfs.writeText("secret.txt", "temp");

    let turnCount = 0;
    const mockStreamFn: StreamFn = (model, _ctx, options) => {
      const stream = new AssistantMessageEventStream();
      turnCount += 1;

      queueMicrotask(() => {
        if (options?.signal?.aborted) {
          const abortedMsg: AssistantMessage = {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "aborted",
            errorMessage: "用户已终止执行",
            timestamp: Date.now(),
          };
          stream.push({ type: "error", reason: "aborted", error: abortedMsg });
          stream.end(abortedMsg);
          return;
        }

        const msgWithDelete: AssistantMessage = {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tc_del_1",
              name: "delete_file",
              arguments: { path: "secret.txt" },
            },
          ],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 15,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse",
          timestamp: Date.now(),
        };
        stream.push({ type: "start", partial: msgWithDelete });
        stream.push({ type: "done", reason: "toolUse", message: msgWithDelete });
        stream.end(msgWithDelete);
      });

      return stream;
    };

    const cancelledIds: string[] = [];
    let pendingReq: ApprovalRequest | null = null;
    let finished = false;

    const runner = new PiAgentRunner(
      vfs,
      {
        onAssistantUpdate: () => undefined,
        onToolModifiedFile: () => undefined,
        onRequestApproval: (req) => {
          pendingReq = req;
          // 模拟用户在弹窗停留期间点击“停止生成”
          queueMicrotask(() => runner.abort());
        },
        onCancelApproval: (approvalId) => {
          cancelledIds.push(approvalId);
        },
        onRunFinished: () => {
          finished = true;
        },
      },
      mockStreamFn
    );

    await runner.runTurn({
      sessionId: "sess_abort",
      userMessage: {
        id: "u_abort",
        role: "user",
        content: "删除 secret.txt",
        createdAt: Date.now(),
      },
      historyBeforeUser: [],
      config: { ...baseConfig, selectedModelId: "gpt-4o", protocolMode: "compatible" },
      models: [],
      settings: { theme: "dark", autoApproveDelete: false, previewWidth: 520 },
    });

    const settledReq = pendingReq as ApprovalRequest | null;
    expect(turnCount).toBeGreaterThanOrEqual(1);
    expect(settledReq?.id).toBe("tc_del_1");
    expect(cancelledIds).toEqual(["tc_del_1"]);
    expect(finished).toBe(true);
    expect(runner.isRunning()).toBe(false);
    // 被中断删除的文件仍应完好存在
    expect(await vfs.exists("secret.txt")).toBe(true);
  });

  it("PiAgentRunner 多轮工具调用保留前置说明文本并累加各轮 Token 统计", async () => {
    const vfs = new WorkspaceVFS();
    let callTurn = 0;

    const mockStreamFn: StreamFn = (model) => {
      const stream = new AssistantMessageEventStream();
      callTurn += 1;

      queueMicrotask(() => {
        if (callTurn === 1) {
          const round1: AssistantMessage = {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "先检查并写入交付文件" },
              { type: "text", text: "我将先创建交付文档 report.md。" },
              {
                type: "toolCall",
                id: "tc_write_round1",
                name: "write_text_file",
                arguments: { path: "report.md", content: "# 交付报告\nOK" },
              },
            ],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 100,
              output: 40,
              cacheRead: 10,
              cacheWrite: 0,
              totalTokens: 140,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "toolUse",
            timestamp: Date.now(),
          };
          stream.push({ type: "start", partial: round1 });
          stream.push({ type: "done", reason: "toolUse", message: round1 });
          stream.end(round1);
        } else {
          const round2: AssistantMessage = {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "补充总结交付结果" },
              { type: "text", text: "已完成 report.md 写入，请在右侧预览。" },
            ],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 160,
              output: 55,
              cacheRead: 25,
              cacheWrite: 0,
              totalTokens: 215,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: Date.now(),
          };
          stream.push({ type: "start", partial: round2 });
          stream.push({ type: "done", reason: "stop", message: round2 });
          stream.end(round2);
        }
      });

      return stream;
    };

    let lastAssistant: UiMessage | undefined;
    const runner = new PiAgentRunner(
      vfs,
      {
        onAssistantUpdate: (_sid, msg) => {
          lastAssistant = msg;
        },
        onToolModifiedFile: () => undefined,
        onRequestApproval: (req) => req.resolve(true),
        onRunFinished: () => undefined,
      },
      mockStreamFn
    );

    await runner.runTurn({
      sessionId: "sess_multi",
      userMessage: {
        id: "u_multi",
        role: "user",
        content: "帮我生成 report.md",
        createdAt: Date.now(),
      },
      historyBeforeUser: [],
      config: { ...baseConfig, selectedModelId: "gpt-4o", protocolMode: "compatible" },
      models: [],
      settings: { theme: "dark", autoApproveDelete: false, previewWidth: 520 },
    });

    expect(lastAssistant?.content).toBe(
      "我将先创建交付文档 report.md。\n\n已完成 report.md 写入，请在右侧预览。"
    );
    expect(lastAssistant?.thinking).toBe("先检查并写入交付文件\n\n补充总结交付结果");
    expect(lastAssistant?.usage).toEqual({
      inputTokens: 260,
      outputTokens: 95,
      cacheReadTokens: 35,
      totalTokens: 355,
    });
  });

  it("buildSystemPrompt 包含 Mizurisu 品牌、新工具说明与客户自定义偏好", () => {
    const prompt = buildSystemPrompt({
      brandName: "Mizurisu Agent",
      platformKind: "web",
      files: [],
      customSystemPrompt: "所有报告优先采用财务视角，金额保留两位小数。",
    });

    expect(prompt).toContain("Mizurisu Agent 智能办公工作台");
    expect(prompt).not.toContain("Pi 内核驱动");
    expect(prompt).toContain("pdf_merge");
    expect(prompt).toContain("markdown_export");
    expect(prompt).toContain("dataPaths");
    expect(prompt).toContain("## 客户自定义办公偏好");
    expect(prompt).toContain("所有报告优先采用财务视角，金额保留两位小数。");
  });

  it("Store 扩展 Actions（Toast、会话重命名/导出、文件改名/打包 ZIP、收藏与引导）正常协同", async () => {
    const exportedFiles: Array<{ filename: string; data: Uint8Array; mimeType: string }> = [];
    vi.spyOn(WebPlatformAdapter.prototype, "exportFile").mockImplementation(
      async (filename, data, mimeType) => {
        exportedFiles.push({ filename, data: new Uint8Array(data), mimeType });
      }
    );

    useAppStore.setState({ initialized: false, authSession: null, toasts: [] });
    await useAppStore.getState().init();

    // 1. Toast 推送与手动关闭 & 4 秒自动消失
    vi.useFakeTimers();
    useAppStore.getState().pushToast("测试轻提示", "success");
    const toastId = useAppStore.getState().toasts[0]?.id;
    expect(toastId).toBeTruthy();
    expect(useAppStore.getState().toasts.length).toBe(1);
    vi.advanceTimersByTime(4100);
    expect(useAppStore.getState().toasts.length).toBe(0);
    vi.useRealTimers();

    // 2. 收藏模型与关闭引导
    await useAppStore.getState().toggleFavoriteModel("claude-sonnet-4-5-20250929");
    expect(useAppStore.getState().settings.favoriteModels).toEqual([
      "claude-sonnet-4-5-20250929",
    ]);
    await useAppStore.getState().toggleFavoriteModel("claude-sonnet-4-5-20250929");
    expect(useAppStore.getState().settings.favoriteModels).toEqual([]);

    await useAppStore.getState().dismissOnboarding();
    expect(useAppStore.getState().settings.onboardingDismissed).toBe(true);

    // 3. 会话重命名与导出 Markdown
    const sid = useAppStore.getState().activeSessionId;
    await useAppStore.getState().renameSession(sid, "Q3 预算复盘");
    expect(useAppStore.getState().sessions.find((s) => s.id === sid)?.title).toBe(
      "Q3 预算复盘"
    );
    await useAppStore.getState().exportSessionMarkdown(sid);
    expect(exportedFiles.some((f) => f.filename.endsWith(".md"))).toBe(true);

    // 4. 工作区文件重命名同步更新 activePreviewPath，并打包导出 ZIP
    await workspaceVfs.writeText("draft.md", "# 草案内容");
    useAppStore.getState().openPreview("draft.md");
    await useAppStore.getState().renameWorkspaceFile("draft.md", "final.md");
    expect(useAppStore.getState().activePreviewPath).toBe("final.md");

    await useAppStore.getState().exportWorkspaceZip();
    const zipExport = exportedFiles.find((f) => f.filename.endsWith(".zip"));
    expect(zipExport).toBeTruthy();
    expect(zipExport!.filename).toMatch(/^mizurisu-workspace-\d{4}-\d{2}-\d{2}\.zip$/);

    const parsedZip = await JSZip.loadAsync(zipExport!.data);
    expect(await parsedZip.file("final.md")?.async("string")).toBe("# 草案内容");

    // 5. abortRun 应同时清理 pendingApproval 与 isStreaming
    let resolved = false;
    useAppStore.setState({
      isStreaming: true,
      pendingApproval: {
        id: "app_1",
        toolName: "delete_file",
        title: "确认",
        description: "desc",
        argsPreview: "{}",
        resolve: () => {
          resolved = true;
        },
      },
    });
    useAppStore.getState().abortRun();
    expect(resolved).toBe(true);
    expect(useAppStore.getState().isStreaming).toBe(false);
    expect(useAppStore.getState().pendingApproval).toBeNull();
  });

  it("Store 支持 sendMessage 图片持久化、editAndResendMessage 与 regenerateMessage", async () => {
    const capturedTurns: Array<{
      userContent: string;
      historyLen: number;
      hasImage: boolean;
      customPrompt?: string;
    }> = [];

    const runSpy = vi
      .spyOn(PiAgentRunner.prototype, "runTurn")
      .mockImplementation(async (opts) => {
        capturedTurns.push({
          userContent: opts.userMessage.content,
          historyLen: opts.historyBeforeUser.length,
          hasImage: Boolean(opts.images && opts.images.length > 0),
          customPrompt: opts.settings.customSystemPrompt,
        });
        const sid = opts.sessionId;
        const assistantReply: UiMessage = {
          id: `msg_mock_a_${capturedTurns.length}`,
          role: "assistant",
          content: `回复: ${opts.userMessage.content}`,
          createdAt: Date.now(),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        };
        useAppStore.setState((state) => ({
          isStreaming: false,
          sessions: state.sessions.map((s) =>
            s.id === sid
              ? { ...s, messages: [...s.messages, assistantReply], totalTokens: 30 }
              : s
          ),
        }));
      });

    useAppStore.setState({ initialized: false, authSession: null, toasts: [] });
    await useAppStore.getState().init();
    await useAppStore.getState().updateConfig({
      baseUrl: "https://relay.example.com",
      apiKey: "sk-mock-key",
    });
    await useAppStore.getState().updateSettings({
      customSystemPrompt: "默认输出中文简报",
    });

    const imgFile = new File([new Uint8Array([137, 80, 78, 71])], "chart.png", {
      type: "image/png",
    });

    await useAppStore.getState().sendMessage("分析这张图表", ["示例_季度销售数据.xlsx"], [imgFile]);

    let activeSession = useAppStore
      .getState()
      .sessions.find((s) => s.id === useAppStore.getState().activeSessionId)!;
    expect(activeSession.messages.length).toBe(2);
    const firstUserMsg = activeSession.messages[0];
    const firstAssistantMsg = activeSession.messages[1];
    expect(firstUserMsg.images?.[0].name).toBe("chart.png");
    expect(firstUserMsg.images?.[0].dataUrl).toContain("data:image/png;base64,");
    expect(capturedTurns[0]).toEqual({
      userContent: "分析这张图表",
      historyLen: 0,
      hasImage: true,
      customPrompt: "默认输出中文简报",
    });

    // 测试 regenerateMessage：截断并保留原用户消息图片与附件重新发起
    await useAppStore.getState().regenerateMessage(firstAssistantMsg.id);
    activeSession = useAppStore
      .getState()
      .sessions.find((s) => s.id === useAppStore.getState().activeSessionId)!;
    expect(activeSession.messages.length).toBe(2);
    expect(capturedTurns[1].hasImage).toBe(true);
    expect(capturedTurns[1].userContent).toBe("分析这张图表");

    // 测试 editAndResendMessage：修改用户消息并截断旧回复重发
    const regeneratedUserMsg = activeSession.messages[0];
    await useAppStore
      .getState()
      .editAndResendMessage(regeneratedUserMsg.id, "请改用表格形式总结图表");
    activeSession = useAppStore
      .getState()
      .sessions.find((s) => s.id === useAppStore.getState().activeSessionId)!;
    expect(activeSession.messages.length).toBe(2);
    expect(activeSession.messages[0].content).toBe("请改用表格形式总结图表");
    expect(activeSession.messages[1].content).toBe("回复: 请改用表格形式总结图表");
    expect(capturedTurns[2].hasImage).toBe(true);
    expect(runSpy).toHaveBeenCalledTimes(3);
  });
});
