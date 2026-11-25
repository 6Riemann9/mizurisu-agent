import { beforeEach, describe, expect, it } from "vitest";
import {
  cyclePermissionMode,
  evaluateToolPermission,
} from "../agent/permission";
import { loadProjectInstructions } from "../agent/project-instructions";
import { filterSlashCommands, parseSlashInput } from "../agent/slash-commands";
import { buildSystemPrompt } from "../agent/system-prompt";
import { clearAllLocalData } from "../storage/db";
import { WorkspaceVFS } from "../storage/workspace-vfs";
import { computeLineDiff, isTextDiffablePath } from "../utils/text-diff";

describe("Claude Code Desktop 风格核心能力", () => {
  beforeEach(async () => {
    await clearAllLocalData();
  });

  it("权限模式引擎应按 Plan / Ask / Auto Edits / Full Auto 与会话记忆放行规则精确决策", () => {
    // 1. 循环切换顺序
    expect(cyclePermissionMode("plan")).toBe("ask");
    expect(cyclePermissionMode("ask")).toBe("auto-edits");
    expect(cyclePermissionMode("auto-edits")).toBe("full-auto");
    expect(cyclePermissionMode("full-auto")).toBe("plan");

    // 2. Plan 模式：拦截所有写/删/命令，放行只读工具
    expect(
      evaluateToolPermission({
        toolName: "write_text_file",
        mode: "plan",
      }).decision
    ).toBe("block");
    expect(
      evaluateToolPermission({
        toolName: "mcp_proxy",
        args: { action: "call_tool" },
        mode: "plan",
      }).decision
    ).toBe("block");
    expect(
      evaluateToolPermission({
        toolName: "read_text_file",
        mode: "plan",
      }).decision
    ).toBe("allow");
    expect(
      evaluateToolPermission({
        toolName: "mcp_proxy",
        args: { action: "search_tools" },
        mode: "plan",
      }).decision
    ).toBe("allow");

    // 3. Ask 模式：写入询问，已记入 sessionAllowedTools 时直接放行
    expect(
      evaluateToolPermission({
        toolName: "excel_create",
        mode: "ask",
      }).decision
    ).toBe("ask");
    expect(
      evaluateToolPermission({
        toolName: "excel_create",
        mode: "ask",
        sessionAllowedTools: ["excel_create"],
      }).decision
    ).toBe("allow");

    // 4. Auto Edits 模式：放行写文档，询问 Shell/删文件（或配置了 autoApproveDelete）
    expect(
      evaluateToolPermission({
        toolName: "word_update",
        mode: "auto-edits",
      }).decision
    ).toBe("allow");
    expect(
      evaluateToolPermission({
        toolName: "run_shell_command",
        mode: "auto-edits",
      }).decision
    ).toBe("ask");
    expect(
      evaluateToolPermission({
        toolName: "delete_file",
        mode: "auto-edits",
        autoApproveDelete: true,
      }).decision
    ).toBe("allow");

    // 5. Full Auto 模式：自动放行常规及 Shell/删除工具
    expect(
      evaluateToolPermission({
        toolName: "run_shell_command",
        mode: "full-auto",
      }).decision
    ).toBe("allow");
  });

  it("逐行 Diff 引擎应准确计算中文文本增删改并识别可 Diff 文件扩展名", () => {
    expect(isTextDiffablePath("docs/README.md")).toBe(true);
    expect(isTextDiffablePath("deck.slides.html")).toBe(true);
    expect(isTextDiffablePath("finance.xlsx")).toBe(false);

    const unchanged = computeLineDiff("第一行\n第二行", "第一行\n第二行");
    expect(unchanged.additions).toBe(0);
    expect(unchanged.deletions).toBe(0);
    expect(unchanged.lines).toHaveLength(2);

    const modified = computeLineDiff(
      "标题\n旧目标：100万\n尾部",
      "标题\n新目标：150万\n新增附注\n尾部"
    );
    expect(modified.deletions).toBe(1);
    expect(modified.additions).toBe(2);
    expect(modified.lines.some((l) => l.type === "del" && l.text.includes("100万"))).toBe(true);
    expect(modified.lines.some((l) => l.type === "add" && l.text.includes("150万"))).toBe(true);
    expect(modified.lines.some((l) => l.type === "context" && l.text === "尾部")).toBe(true);
  });

  it("可执行 /slash 命令解析与过滤应精准匹配系统指令", () => {
    const planParsed = parseSlashInput("/plan 先分析销售表再给大纲");
    expect(planParsed?.command.name).toBe("plan");
    expect(planParsed?.arg).toBe("先分析销售表再给大纲");

    const compactParsed = parseSlashInput("/compact");
    expect(compactParsed?.command.name).toBe("compact");
    expect(compactParsed?.arg).toBe("");

    expect(parseSlashInput("/not_exist_cmd test")).toBeNull();
    expect(parseSlashInput("普通对话消息")).toBeNull();

    const filtered = filterSlashCommands("diff");
    expect(filtered.some((c) => c.name === "diff")).toBe(true);
  });

  it("项目规范加载器应按 MIZURISU.md > CLAUDE.md 优先级读取并注入系统提示词", async () => {
    const vfs = new WorkspaceVFS();
    await vfs.writeText("CLAUDE.md", "来自 CLAUDE.md 的规则");
    const firstLoad = await loadProjectInstructions(vfs);
    expect(firstLoad?.path).toBe("CLAUDE.md");
    expect(firstLoad?.content).toContain("CLAUDE.md");

    await vfs.writeText("MIZURISU.md", "优先使用 MIZURISU.md 规范");
    const preferredLoad = await loadProjectInstructions(vfs);
    expect(preferredLoad?.path).toBe("MIZURISU.md");
    expect(preferredLoad?.content).toContain("MIZURISU.md");

    const prompt = buildSystemPrompt({
      brandName: "Mizurisu Agent",
      platformKind: "desktop",
      files: await vfs.listFiles(),
      permissionMode: "plan",
      projectInstructions: preferredLoad,
    });
    expect(prompt).toContain("Plan（只读规划模式");
    expect(prompt).toContain("自动加载自 MIZURISU.md");
    expect(prompt).toContain("优先使用 MIZURISU.md 规范");
  });
});
