import JSZip from "jszip";
import type { ChatSession } from "../types";
import type { CreatePdfSpec, PdfSection } from "./pdf";
import type { CreateWordSpec, WordBlock } from "./word";

type ParsedMarkdownNode =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; items: string[] }
  | { kind: "numbered"; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] };

/** 规范化 ZIP 归档路径，去除前导斜杠并统一分隔符 */
function normalizeZipEntryPath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim();
}

/** 将行内 Markdown 语法简化为纯文本，便于 Word / PDF 排版输出 */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .trim();
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") && !/^:?-{3,}:?$/.test(trimmed)) {
    return false;
  }
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(trimmed);
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed
    .split(/(?<!\\)\|/)
    .map((cell) => stripInlineMarkdown(cell.replace(/\\\|/g, "|")));
}

function isSpecialBlockStart(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (/^(```|~~~)/.test(trimmed)) return true;
  if (/^>\s?/.test(trimmed)) return true;
  if (/^[-*+]\s+/.test(trimmed)) return true;
  if (/^\d+\.\s+/.test(trimmed)) return true;
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return true;
  return false;
}

/** 解析 Markdown 为统一结构化节点，提取首个一级标题作为文档主标题 */
function parseMarkdownDocument(
  markdown: string,
  fallbackTitle = "导出文档"
): { title: string; nodes: ParsedMarkdownNode[] } {
  const lines = (markdown || "").replace(/\r\n/g, "\n").split("\n");
  const nodes: ParsedMarkdownNode[] = [];
  let title: string | undefined;
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 水平分割线跳过
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      i += 1;
      continue;
    }

    // 围栏代码块简化为段落
    const fenceMatch = trimmed.match(/^(```|~~~)/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const codeText = codeLines.join("\n").trimEnd();
      if (codeText) {
        nodes.push({ kind: "paragraph", text: codeText });
      }
      continue;
    }

    // 标题 # / ## / ###（更深层级归并为 3 级）
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const rawLevel = headingMatch[1].length;
      const level: 1 | 2 | 3 = rawLevel === 1 ? 1 : rawLevel === 2 ? 2 : 3;
      const headingText = stripInlineMarkdown(headingMatch[2].replace(/\s+#+\s*$/, ""));
      if (rawLevel === 1 && title === undefined) {
        title = headingText;
      } else if (headingText) {
        nodes.push({ kind: "heading", level, text: headingText });
      }
      i += 1;
      continue;
    }

    // GFM 表格（含表头行 + 分隔行）
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headers = splitTableRow(lines[i]);
      const colCount = Math.max(1, headers.length);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length) {
        const rowLine = lines[i].trim();
        if (!rowLine || !rowLine.includes("|")) break;
        const cells = splitTableRow(lines[i]);
        const normalized = Array.from({ length: colCount }, (_, idx) => cells[idx] ?? "");
        rows.push(normalized);
        i += 1;
      }
      nodes.push({ kind: "table", headers, rows });
      continue;
    }

    // 引用块简化为段落
    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(stripInlineMarkdown(lines[i].trim().replace(/^>\s?/, "")));
        i += 1;
      }
      const quoteText = quoteLines.filter(Boolean).join("\n");
      if (quoteText) {
        nodes.push({ kind: "paragraph", text: quoteText });
      }
      continue;
    }

    // 无序列表（- / * / +）
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(stripInlineMarkdown(lines[i].trim().replace(/^[-*+]\s+/, "")));
        i += 1;
      }
      if (items.length > 0) {
        nodes.push({ kind: "bullet", items });
      }
      continue;
    }

    // 有序列表（1. / 2.）
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(stripInlineMarkdown(lines[i].trim().replace(/^\d+\.\s+/, "")));
        i += 1;
      }
      if (items.length > 0) {
        nodes.push({ kind: "numbered", items });
      }
      continue;
    }

    // 普通段落：合并连续非特殊文本行
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      if (isSpecialBlockStart(cur)) break;
      if (
        cur.trim().includes("|") &&
        i + 1 < lines.length &&
        isTableSeparatorLine(lines[i + 1])
      ) {
        break;
      }
      paraLines.push(stripInlineMarkdown(cur));
      i += 1;
    }
    const paraText = paraLines.join(" ").replace(/\s+/g, " ").trim();
    if (paraText) {
      nodes.push({ kind: "paragraph", text: paraText });
    }
  }

  return {
    title: title || fallbackTitle,
    nodes,
  };
}

/** 将工作区多个文件打包为 deflate 压缩的 ZIP 二进制 */
export async function createWorkspaceZip(
  files: Array<{ path: string; data: Uint8Array }>
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const file of files) {
    const cleanPath = normalizeZipEntryPath(file.path);
    if (!cleanPath) continue;
    zip.file(cleanPath, file.data);
  }
  const output = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return new Uint8Array(output);
}

/** 将 Markdown 文本转换为结构化 Word 生成规格 */
export function markdownToWordSpec(
  markdown: string,
  fallbackTitle?: string
): CreateWordSpec {
  const { title, nodes } = parseMarkdownDocument(markdown, fallbackTitle);
  const blocks: WordBlock[] = nodes.map((node) => {
    switch (node.kind) {
      case "heading":
        return { type: "heading", level: node.level, text: node.text };
      case "bullet":
        return { type: "bullet", items: node.items };
      case "numbered":
        return { type: "numbered", items: node.items };
      case "table":
        return { type: "table", headers: node.headers, rows: node.rows };
      case "paragraph":
      default:
        return { type: "paragraph", text: node.text };
    }
  });

  return {
    title,
    headerText: title,
    showPageNumbers: true,
    blocks,
  };
}

/** 将 Markdown 文本转换为结构化 PDF 生成规格 */
export function markdownToPdfSpec(
  markdown: string,
  fallbackTitle?: string
): CreatePdfSpec {
  const { title, nodes } = parseMarkdownDocument(markdown, fallbackTitle);
  const sections: PdfSection[] = nodes.map((node) => {
    switch (node.kind) {
      case "heading":
        return { type: "heading", level: node.level, text: node.text };
      case "bullet":
        return { type: "bullets", items: node.items };
      case "numbered":
        return {
          type: "paragraph",
          text: node.items.map((item, idx) => `${idx + 1}. ${item}`).join("\n"),
        };
      case "table":
        return { type: "table", headers: node.headers, rows: node.rows };
      case "paragraph":
      default:
        return { type: "paragraph", text: node.text };
    }
  });

  return {
    title,
    sections,
    footerText: "Mizurisu Agent",
  };
}

function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return new Date(ms).toISOString();
  }
}

/** 将聊天会话导出为适合交付归档的结构化 Markdown 文档 */
export function formatSessionToMarkdown(session: ChatSession): string {
  const sortedMessages = [...session.messages].sort((a, b) => a.createdAt - b.createdAt);

  const usedModels = Array.from(
    new Set(
      sortedMessages
        .map((m) => m.modelId?.trim())
        .filter((id): id is string => Boolean(id))
    )
  );

  let inputTokens = 0;
  let outputTokens = 0;
  let usageTotalTokens = 0;
  for (const m of sortedMessages) {
    if (m.usage) {
      inputTokens += m.usage.inputTokens || 0;
      outputTokens += m.usage.outputTokens || 0;
      usageTotalTokens += m.usage.totalTokens || 0;
    }
  }
  const effectiveTotalTokens = session.totalTokens || usageTotalTokens;

  const lines: string[] = [
    `# ${session.title || "未命名会话"}`,
    "",
    `- **导出时间**：${formatTimestamp(Date.now())}`,
    `- **会话创建**：${formatTimestamp(session.createdAt)}`,
    `- **最近更新**：${formatTimestamp(session.updatedAt)}`,
    `- **使用模型**：${usedModels.length > 0 ? usedModels.join("、") : "未记录"}`,
    `- **累计 Token 统计**：共 ${effectiveTotalTokens} tokens（输入 ${inputTokens} / 输出 ${outputTokens}）`,
    "",
    "---",
  ];

  if (sortedMessages.length === 0) {
    lines.push("", "_当前会话暂无对话记录。_");
    return lines.join("\n");
  }

  for (const msg of sortedMessages) {
    const timeLabel = formatTimestamp(msg.createdAt);
    if (msg.role === "user") {
      lines.push("", `## 用户提问（${timeLabel}）`);
      if (msg.content.trim()) {
        lines.push("", msg.content.trim());
      }
      if (msg.attachments && msg.attachments.length > 0) {
        lines.push("", "**附件列表：**");
        for (const att of msg.attachments) {
          lines.push(`- \`${att.path}\` (${att.category})`);
        }
      }
      continue;
    }

    const modelTag = msg.modelId ? ` · 模型: ${msg.modelId}` : "";
    lines.push("", `## 助手回复（${timeLabel}${modelTag}）`);

    if (msg.content.trim()) {
      lines.push("", msg.content.trim());
    } else if (msg.errorMessage) {
      lines.push("", `> 执行出错：${msg.errorMessage}`);
    }

    if (msg.errorMessage && msg.content.trim()) {
      lines.push("", `> 异常提示：${msg.errorMessage}`);
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      const modifiedFiles = Array.from(
        new Map(
          msg.toolCalls
            .filter((tc) => Boolean(tc.modifiedPath))
            .map((tc) => [tc.modifiedPath!, tc])
        ).values()
      );

      if (modifiedFiles.length > 0) {
        lines.push("", "**生成与修改文件：**");
        for (const tc of modifiedFiles) {
          lines.push(`- \`${tc.modifiedPath}\`（工具：\`${tc.name}\`，状态：${tc.status}）`);
        }
      } else {
        const toolNames = Array.from(new Set(msg.toolCalls.map((tc) => tc.name)));
        lines.push("", `**调用工具：** ${toolNames.map((n) => `\`${n}\``).join("、")}`);
      }
    }

    if (msg.usage) {
      lines.push(
        "",
        `> Token 消耗：输入 ${msg.usage.inputTokens} / 输出 ${msg.usage.outputTokens} / 合计 ${msg.usage.totalTokens}`
      );
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}
