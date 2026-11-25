export interface SlashCommandSpec {
  name: string;
  label: string;
  description: string;
  usage?: string;
  keywords: string;
  category: "mode" | "session" | "review" | "workspace";
}

export const BUILTIN_SLASH_COMMANDS: SlashCommandSpec[] = [
  {
    name: "plan",
    label: "/plan",
    description: "切换到 Plan 只读规划模式（可选附带规划需求）",
    usage: "/plan [任务描述]",
    keywords: "plan mode 只读 规划 方案 计划",
    category: "mode",
  },
  {
    name: "ask",
    label: "/ask",
    description: "切换到 Ask 每次写入/命令均弹窗询问模式",
    usage: "/ask",
    keywords: "ask confirm permission 询问 审批 确认",
    category: "mode",
  },
  {
    name: "auto",
    label: "/auto",
    description: "切换到 Auto Edits 自动编辑模式（支持传 full 进入 Full Auto）",
    usage: "/auto [full]",
    keywords: "auto edits full auto 自动 编辑 执行",
    category: "mode",
  },
  {
    name: "diff",
    label: "/diff",
    description: "打开本会话文件变更审查中心与红绿 Diff 对比",
    usage: "/diff",
    keywords: "diff review changes 差异 变更 审查 回滚",
    category: "review",
  },
  {
    name: "review",
    label: "/review",
    description: "让 Agent 对本会话修改的文档进行质量核查与口径复核",
    usage: "/review [关注重点]",
    keywords: "review check audit 复核 核查 审查",
    category: "review",
  },
  {
    name: "compact",
    label: "/compact",
    description: "智能压缩当前长对话历史，生成清爽接力新会话延续工作",
    usage: "/compact",
    keywords: "compact handoff summarize 压缩 上下文 摘要 接力",
    category: "session",
  },
  {
    name: "clear",
    label: "/clear",
    description: "开启一个干净的空白新会话（保留工作区文件）",
    usage: "/clear",
    keywords: "clear reset new session 清空 新建 会话",
    category: "session",
  },
  {
    name: "init",
    label: "/init",
    description: "扫描工作区目录并自动生成 MIZURISU.md 项目协作规范",
    usage: "/init",
    keywords: "init instructions mizurisu claude.md 初始化 规范",
    category: "workspace",
  },
  {
    name: "memory",
    label: "/memory",
    description: "在文档台打开或新建工作区规范文件 MIZURISU.md",
    usage: "/memory",
    keywords: "memory rules mizurisu.md claude.md 记忆 规范",
    category: "workspace",
  },
];

/** 解析用户输入文本是否匹配内置可执行 /slash 命令 */
export function parseSlashInput(
  raw: string
): { command: SlashCommandSpec; arg: string } | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null;
  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const cmdName = match[1].toLowerCase();
  const command = BUILTIN_SLASH_COMMANDS.find((c) => c.name === cmdName);
  if (!command) return null;
  return {
    command,
    arg: (match[2] || "").trim(),
  };
}

/** 按关键词过滤 /slash 命令列表，供输入框浮层展示 */
export function filterSlashCommands(query: string): SlashCommandSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return BUILTIN_SLASH_COMMANDS;
  return BUILTIN_SLASH_COMMANDS.filter(
    (c) =>
      c.name.includes(q) ||
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.keywords.toLowerCase().includes(q)
  );
}
