import type { WorkspaceVFS } from "../storage/workspace-vfs";
import type { WorkspaceFileMeta } from "../types";

export const PROJECT_INSTRUCTION_CANDIDATES = [
  "MIZURISU.md",
  "CLAUDE.md",
  ".mizurisu/instructions.md",
] as const;

const MAX_PROJECT_INSTRUCTION_CHARS = 8000;

export const DEFAULT_MIZURISU_MD_TEMPLATE = `# MIZURISU.md — 工作区协作规范

> 当工作区根目录存在 \`MIZURISU.md\` 或 \`CLAUDE.md\` 时，Mizurisu Agent 会在每次对话开始自动读取并遵守以下规范。

## 1. 文档命名与格式规范
- 交付表格优先使用 \`.xlsx\`（金额保留两位小数 \`#,##0.00\`，保留统计公式）。
- 正式汇报或方案文档优先输出 \`.docx\` 或高颜值 \`.slides.html\`（并附演讲备注）。
- 修改既有核心原件前，优先另存为带日期或 \`_修订版\` 后缀的副本（或将原件设为只读保护）。

## 2. 口径与风格约束
- 默认使用清晰简洁的**简体中文**输出结论，关键数字需核对原始数据源后给出，不凭空估算。
- 输出结论时附带变更文件路径与关键数值摘要。
`;

/** 按候选顺序查找当前工作区中的项目规范文件（大小写兼容，优先精确匹配） */
export function findProjectInstructionFile(
  files: WorkspaceFileMeta[]
): WorkspaceFileMeta | null {
  if (!files || files.length === 0) return null;
  for (const candidate of PROJECT_INSTRUCTION_CANDIDATES) {
    const exact = files.find((f) => f.path === candidate);
    if (exact) return exact;
    const lower = candidate.toLowerCase();
    const insensitive = files.find((f) => f.path.toLowerCase() === lower);
    if (insensitive) return insensitive;
  }
  return null;
}

/** 读取并规范化工作区项目规范文件内容（超过 8000 字符安全截断） */
export async function loadProjectInstructions(
  vfs: WorkspaceVFS,
  files?: WorkspaceFileMeta[]
): Promise<{ path: string; content: string; truncated?: boolean } | null> {
  const fileList = files ?? (await vfs.listFiles().catch(() => []));
  const target = findProjectInstructionFile(fileList);
  if (!target) return null;

  try {
    const raw = (await vfs.readText(target.path)).trim();
    if (!raw) return null;
    if (raw.length <= MAX_PROJECT_INSTRUCTION_CHARS) {
      return { path: target.path, content: raw };
    }
    const truncatedNotice = `\n\n...(规范文档超过 ${MAX_PROJECT_INSTRUCTION_CHARS} 字符，已自动截断后续内容)`;
    return {
      path: target.path,
      content: `${raw.slice(0, MAX_PROJECT_INSTRUCTION_CHARS - truncatedNotice.length)}${truncatedNotice}`,
      truncated: true,
    };
  } catch {
    return null;
  }
}

/** 构造 /init 指令提示词，引导 Agent 扫描工作区后生成 MIZURISU.md */
export function buildInitInstructionsPrompt(files: WorkspaceFileMeta[]): string {
  const sampleFiles =
    files.length === 0
      ? "（当前工作区尚无文件）"
      : files
          .slice(0, 30)
          .map((f) => `- ${f.path} [${f.category}]`)
          .join("\n");

  return (
    `请先使用只读工具调研当前工作区的目录与代表性文件内容，随后在根目录创建或更新一份精炼实用的 \`MIZURISU.md\` 工作区规范文档（约 200~500 字），包含：\n` +
    `1. 工作区核心资产与文档类型概览\n` +
    `2. 文件命名、版本号与输出格式约定（Excel / Word / 幻灯片 / PDF）\n` +
    `3. 关键数据校验口径、禁止直接覆盖的原件清单及沟通语言偏好\n\n` +
    `当前工作区文件参考：\n${sampleFiles}`
  );
}
