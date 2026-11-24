import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { beforeEach, describe, expect, it } from "vitest";
import { PiAgentRunner } from "../agent/runtime";
import { createOfficeTools } from "../agent/tools/office-tools";
import { createSandboxTools } from "../agent/tools/sandbox-tools";
import { clearAllLocalData } from "../storage/db";
import { WorkspaceVFS } from "../storage/workspace-vfs";
import type { NewApiConfig, UiMessage } from "../types";

describe("VFS 快照、Office 工具集与 PiAgentRunner", () => {
  let vfs: WorkspaceVFS;

  beforeEach(async () => {
    await clearAllLocalData();
    vfs = new WorkspaceVFS();
  });

  it("覆盖写入自动生成历史快照并支持版本回滚", async () => {
    await vfs.writeText("note.md", "版本 1 内容");
    await vfs.writeText("note.md", "版本 2 内容", { snapshotNote: "手动更新" });

    expect(await vfs.readText("note.md")).toBe("版本 2 内容");
    const snaps = await vfs.getSnapshots("note.md");
    expect(snaps.length).toBe(1);

    await vfs.restoreSnapshot(snaps[0].id, "note.md");
    expect(await vfs.readText("note.md")).toBe("版本 1 内容");
  });

  it("Office 工具与 JS 沙箱工具能协同读写并计算汇总", async () => {
    const officeTools = createOfficeTools(vfs);
    const sandboxTools = createSandboxTools(vfs);

    const excelCreate = officeTools.find((t) => t.name === "excel_create")!;
    const createRes = await excelCreate.execute("call_1", {
      path: "budget.xlsx",
      sheets: [
        {
          name: "预算",
          headers: ["项目", "金额"],
          rows: [
            ["服务器", 1200],
            ["带宽", 800],
          ],
        },
      ],
    });
    expect((createRes.details as { modifiedPath?: string }).modifiedPath).toBe("budget.xlsx");

    const jsTool = sandboxTools[0];
    const calcRes = await jsTool.execute("call_2", {
      dataPath: "budget.xlsx",
      code: "return data.records.reduce((s, r) => s + Number(r['金额'] || 0), 0);",
    });
    expect(calcRes.content[0]).toEqual({ type: "text", text: "2000" });
  });

  it("PiAgentRunner 能通过 Pi 核心循环触发工具调用并实时流式通知 UI", async () => {
    let callTurn = 0;
    const mockStreamFn: StreamFn = (model) => {
      const stream = new AssistantMessageEventStream();
      callTurn += 1;

      queueMicrotask(() => {
        if (callTurn === 1) {
          const msgWithTool: AssistantMessage = {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "tc_write_1",
                name: "write_text_file",
                arguments: { path: "result.md", content: "# 自动生成结果\nOK" },
              },
            ],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 10,
              output: 8,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 18,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "toolUse",
            timestamp: Date.now(),
          };
          stream.push({ type: "start", partial: msgWithTool });
          stream.push({ type: "done", reason: "toolUse", message: msgWithTool });
          stream.end(msgWithTool);
        } else {
          const finalMsg: AssistantMessage = {
            role: "assistant",
            content: [{ type: "text", text: "已完成写入 result.md。" }],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 20,
              output: 12,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 32,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: Date.now(),
          };
          stream.push({ type: "start", partial: finalMsg });
          stream.push({ type: "done", reason: "stop", message: finalMsg });
          stream.end(finalMsg);
        }
      });

      return stream;
    };

    const modifiedPaths: string[] = [];
    let lastAssistant: UiMessage | undefined;
    let finished = false;

    const runner = new PiAgentRunner(
      vfs,
      {
        onAssistantUpdate: (_sid, msg) => {
          lastAssistant = msg;
        },
        onToolModifiedFile: (path) => {
          modifiedPaths.push(path);
        },
        onRequestApproval: (req) => req.resolve(true),
        onRunFinished: () => {
          finished = true;
        },
      },
      mockStreamFn
    );

    const config: NewApiConfig = {
      brandName: "PiDesk",
      baseUrl: "https://relay.example.com",
      apiKey: "sk-mock",
      protocolMode: "compatible",
      selectedModelId: "gpt-4o",
      thinkingLevel: "off",
      customModels: [],
      modelProtocolOverrides: {},
    };

    await runner.runTurn({
      sessionId: "sess_1",
      userMessage: {
        id: "u_1",
        role: "user",
        content: "帮我写一个 result.md",
        createdAt: Date.now(),
      },
      historyBeforeUser: [],
      config,
      models: [],
      settings: { theme: "dark", autoApproveDelete: false, previewWidth: 520 },
    });

    const settled = lastAssistant as UiMessage | undefined;
    expect(finished).toBe(true);
    expect(modifiedPaths).toEqual(["result.md"]);
    expect(await vfs.readText("result.md")).toBe("# 自动生成结果\nOK");
    expect(settled?.content).toContain("已完成写入 result.md");
    expect(settled?.toolCalls?.[0].status).toBe("success");
  });
});
