import type { SkillTemplate } from "../types";

const VALID_CATEGORIES = new Set<SkillTemplate["category"]>([
  "excel",
  "word",
  "ppt",
  "analysis",
  "custom",
]);

function normalizeCategory(raw?: string): SkillTemplate["category"] {
  const clean = (raw || "").trim().toLowerCase() as SkillTemplate["category"];
  return VALID_CATEGORIES.has(clean) ? clean : "custom";
}

function unquoteYamlValue(val: string): string {
  const trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * 解析标准 Pi / 开源 Agent `SKILL.md` 文件（支持 YAML Frontmatter + Markdown 正文）。
 * 兼容仅有 `# 标题` + 正文的纯 Markdown 技能文件。
 */
export function parseSkillMarkdown(
  raw: string,
  fallbackName = "导入的办公技能"
): SkillTemplate {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "").trim();
  if (!normalized) {
    throw new Error("SKILL.md 内容为空");
  }

  let body = normalized;
  const frontmatter: Record<string, string> = {};

  if (normalized.startsWith("---\n") || normalized === "---") {
    const endIdx = normalized.indexOf("\n---", 3);
    if (endIdx > 0) {
      const fmBlock = normalized.slice(4, endIdx);
      body = normalized.slice(endIdx + 4).replace(/^\n+/, "").trim();
      for (const line of fmBlock.split("\n")) {
        const colon = line.indexOf(":");
        if (colon <= 0) continue;
        const key = line.slice(0, colon).trim().toLowerCase();
        const val = unquoteYamlValue(line.slice(colon + 1));
        if (key && val) {
          frontmatter[key] = val;
        }
      }
    }
  }

  const headingMatch = body.match(/^#\s+(.+)$/m);
  const name =
    frontmatter.name ||
    (headingMatch ? headingMatch[1].trim() : "") ||
    fallbackName.replace(/\.(md|markdown)$/i, "").trim() ||
    "导入的办公技能";

  const firstParagraph = body
    .split(/\n{2,}/)
    .map((p) => p.replace(/^#+\s+.*$/gm, "").trim())
    .find((p) => p.length > 0);

  const description =
    frontmatter.description ||
    (firstParagraph ? firstParagraph.slice(0, 90) : "从 SKILL.md 导入的智能办公技能");

  const systemHint = body || description;
  const prompt =
    frontmatter.prompt ||
    `请启用技能「${name}」处理当前工作区任务，并严格遵循其步骤与输出规范。`;

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return {
    id: `skillmd_${slug || "custom"}_${Date.now().toString(36)}`,
    name,
    description,
    category: normalizeCategory(frontmatter.category),
    prompt,
    systemHint,
    builtin: false,
  };
}

/** 将技能导出为兼容 Pi 生态的标准 `SKILL.md` 文本 */
export function exportSkillToMarkdown(skill: SkillTemplate): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  return [
    "---",
    `name: "${esc(skill.name)}"`,
    `description: "${esc(skill.description)}"`,
    `category: ${skill.category}`,
    `prompt: "${esc(skill.prompt)}"`,
    "---",
    "",
    `# ${skill.name}`,
    "",
    skill.systemHint || skill.prompt,
    "",
  ].join("\n");
}
