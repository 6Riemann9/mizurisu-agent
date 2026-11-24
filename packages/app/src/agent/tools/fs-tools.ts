import type { AgentTool } from "@earendil-works/pi-agent-core";
import { int, obj, opt, str } from "@earendil-works/pi-schema";
import type { WorkspaceVFS } from "../../storage/workspace-vfs";

const listFilesParams = obj({
  prefix: opt(str({ description: "可选路径前缀过滤，例如 reports/" })),
});

const readTextParams = obj({
  path: str({ description: "工作区内的相对文件路径，如 notes.md" }),
  startLine: opt(int({ description: "起始行号（从 1 开始）", minimum: 1 })),
  maxLines: opt(int({ description: "最多读取行数，默认 300", minimum: 1, maximum: 2000 })),
});

const writeTextParams = obj({
  path: str({ description: "要创建或覆盖的文件路径，如 summary.md" }),
  content: str({ description: "完整 UTF-8 文本内容" }),
});

const editTextParams = obj({
  path: str({ description: "要编辑的文本文件路径" }),
  oldText: str({ description: "要替换的精确原文本片段" }),
  newText: str({ description: "替换后的新文本片段" }),
});

const deleteFileParams = obj({
  path: str({ description: "要删除的工作区文件路径" }),
});

export function createFsTools(vfs: WorkspaceVFS): AgentTool[] {
  const listFilesTool: AgentTool<typeof listFilesParams> = {
    name: "list_files",
    label: "列出工作区文件",
    description: "列出当前本地工作区中的全部文件及大小、类型与更新时间。",
    parameters: listFilesParams,
    execute: async (_id, params) => {
      const files = await vfs.listFiles();
      const filtered = params.prefix
        ? files.filter((f) => f.path.startsWith(params.prefix!))
        : files;
      const summary =
        filtered.length === 0
          ? "当前工作区为空。"
          : filtered
              .map(
                (f) =>
                  `- ${f.path} [${f.category}] (${(f.size / 1024).toFixed(1)} KB, 更新于 ${new Date(f.updatedAt).toLocaleString()})`
              )
              .join("\n");
      return {
        content: [{ type: "text", text: summary }],
        details: { count: filtered.length, files: filtered.map((f) => f.path) },
      };
    },
  };

  const readTextTool: AgentTool<typeof readTextParams> = {
    name: "read_text_file",
    label: "读取文本文件",
    description: "读取工作区中的 Markdown、TXT、JSON、CSV、代码等纯文本文件内容。若为 .xlsx/.docx/.pptx/.pdf 请使用专用 Office 工具读取。",
    parameters: readTextParams,
    execute: async (_id, params) => {
      const text = await vfs.readText(params.path);
      const lines = text.split(/\r?\n/);
      const start = Math.max(1, params.startLine ?? 1);
      const limit = Math.max(1, params.maxLines ?? 300);
      const slice = lines.slice(start - 1, start - 1 + limit);
      const numbered = slice.map((line, i) => `${start + i}: ${line}`).join("\n");
      const truncated = start - 1 + limit < lines.length;
      return {
        content: [
          {
            type: "text",
            text: `文件: ${params.path} (共 ${lines.length} 行)\n\n${numbered}${truncated ? `\n\n...(已截断，后续行请传 startLine=${start + limit})` : ""}`,
          },
        ],
        details: { path: params.path, totalLines: lines.length },
      };
    },
  };

  const writeTextTool: AgentTool<typeof writeTextParams> = {
    name: "write_text_file",
    label: "写入文本文件",
    description: "创建或覆盖工作区内的纯文本/Markdown/JSON/CSV/代码文件（覆盖前自动保留历史快照）。",
    parameters: writeTextParams,
    execute: async (_id, params) => {
      const meta = await vfs.writeText(params.path, params.content, {
        snapshotNote: "Agent 写入文本前快照",
      });
      return {
        content: [
          {
            type: "text",
            text: `已写入文件 ${meta.path} (${meta.size} 字节)。`,
          },
        ],
        details: { modifiedPath: meta.path, size: meta.size },
      };
    },
  };

  const editTextTool: AgentTool<typeof editTextParams> = {
    name: "edit_text_file",
    label: "局部编辑文本文件",
    description: "精确查找替换文本文件中的指定片段，适合对 Markdown 或代码做局部修改。",
    parameters: editTextParams,
    execute: async (_id, params) => {
      const text = await vfs.readText(params.path);
      if (!text.includes(params.oldText)) {
        return {
          content: [{ type: "text", text: `未在 ${params.path} 中找到匹配的原文本片段。` }],
          details: { path: params.path },
          isError: true,
        };
      }
      const next = text.replace(params.oldText, params.newText);
      const meta = await vfs.writeText(params.path, next, {
        snapshotNote: "Agent 局部编辑前快照",
      });
      return {
        content: [{ type: "text", text: `已更新 ${meta.path} (${meta.size} 字节)。` }],
        details: { modifiedPath: meta.path, size: meta.size },
      };
    },
  };

  const deleteFileTool: AgentTool<typeof deleteFileParams> = {
    name: "delete_file",
    label: "删除文件",
    description: "从工作区删除指定文件（删除前会保留一份历史快照，且默认可能需要用户确认）。",
    parameters: deleteFileParams,
    execute: async (_id, params) => {
      await vfs.deleteFile(params.path);
      return {
        content: [{ type: "text", text: `已删除文件: ${params.path}` }],
        details: { deletedPath: params.path },
      };
    },
  };

  return [listFilesTool, readTextTool, writeTextTool, editTextTool, deleteFileTool];
}
