import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, bool, int, map, num, obj, opt, str } from "@earendil-works/pi-schema";
import {
  splitPdfDocument,
  updatePptDocumentInPlace,
  updateWordDocumentInPlace,
  watermarkPdfDocument,
} from "../../../office";
import type { ExtensionRuntimeContext, MizurisuExtension } from "../types";

const wordUpdateParams = obj({
  path: str({ description: "工作区既有 .docx 文件路径" }),
  variables: opt(
    map(str(), { description: "模板变量字典，例如 {\"客户名称\": \"星辰科技\"} 将替换 {{客户名称}}" })
  ),
  replacements: opt(
    arr(
      obj({
        find: str({ description: "要查找的原文文本" }),
        replace: str({ description: "替换后的新文本" }),
        replaceAll: opt(bool({ description: "是否全部替换，默认 true" })),
      })
    )
  ),
  tableUpdates: opt(
    arr(
      obj({
        tableIndex: int({ description: "表格序号（从 0 开始）", minimum: 0 }),
        rowIndex: int({ description: "行号（从 0 开始）", minimum: 0 }),
        colIndex: int({ description: "列号（从 0 开始）", minimum: 0 }),
        text: str({ description: "更新后的单元格文本" }),
      })
    )
  ),
  appendParagraphs: opt(
    arr(
      obj({
        text: str({ description: "追加段落文本" }),
        headingLevel: opt(int({ description: "可选标题级别 1-3", minimum: 1, maximum: 3 })),
      })
    )
  ),
});

const pptUpdateParams = obj({
  path: str({ description: "工作区既有 .pptx 文件路径" }),
  variables: opt(
    map(str(), { description: "全局模板变量映射（替换全部页面的 {{key}}）" })
  ),
  slideUpdates: opt(
    arr(
      obj({
        slideIndex: int({ description: "目标幻灯片页码（从 1 开始）", minimum: 1 }),
        replacements: opt(
          arr(
            obj({
              find: str(),
              replace: str(),
              replaceAll: opt(bool()),
            })
          )
        ),
        tableUpdates: opt(
          arr(
            obj({
              tableIndex: opt(int({ minimum: 0 })),
              rowIndex: int({ minimum: 0 }),
              colIndex: int({ minimum: 0 }),
              text: str(),
            })
          )
        ),
        notes: opt(str({ description: "更新该页演讲者备注" })),
      })
    )
  ),
});

const pdfSplitParams = obj({
  path: str({ description: "源 .pdf 文件路径" }),
  pageRanges: str({ description: "页码范围表达式，例如 \"1-3,5\"" }),
  outputPath: str({ description: "输出的新 .pdf 文件路径" }),
});

const pdfWatermarkParams = obj({
  path: str({ description: "源 .pdf 文件路径" }),
  text: str({ description: "水印文字（支持中英文，如 内部机密 严禁外传）" }),
  outputPath: opt(str({ description: "可选输出路径，省略时原地覆盖源 PDF 并保留快照" })),
  opacity: opt(num({ description: "透明度 0.05-0.85，默认 0.22", minimum: 0.05, maximum: 0.85 })),
  fontSize: opt(int({ description: "字号 16-72，默认 36", minimum: 16, maximum: 72 })),
  angle: opt(int({ description: "旋转角度，默认 32", minimum: -90, maximum: 90 })),
});

async function getLatestSnapshotId(
  runtimeCtx: ExtensionRuntimeContext,
  path: string
): Promise<string | undefined> {
  const snaps = await runtimeCtx.vfs.getSnapshots(path).catch(() => []);
  return snaps[0]?.id;
}

export const officeProExtension: MizurisuExtension = {
  id: "pi-office-pro",
  name: "Office 保格式原地精修 (Office Pro)",
  description: "保留原文档样式/公章/母版原地修改 Word (.docx) 与 PPT (.pptx)，提供变更摘要与一键回滚，并支持 PDF 拆分与水印。",
  category: "office",
  defaultEnabled: true,
  register(api, runtimeCtx?: ExtensionRuntimeContext) {
    const wordUpdateTool: AgentTool<typeof wordUpdateParams> = {
      name: "word_update",
      label: "原地精修 Word（保格式）",
      description:
        "在保留既有 .docx 排版、字体、页眉页脚、公章与复杂表格样式的前提下，原地替换文本、填充 {{变量}} 模板、更新表格或追加段落（生成变更摘要与回滚快照）。",
      parameters: wordUpdateParams,
      execute: async (_id, params) => {
        if (!runtimeCtx?.vfs) throw new Error("未绑定工作区 VFS");
        const prev = await runtimeCtx.vfs.readBytes(params.path);
        const result = await updateWordDocumentInPlace(prev, {
          variables: params.variables as Record<string, string> | undefined,
          replacements: params.replacements,
          tableUpdates: params.tableUpdates,
          appendParagraphs: params.appendParagraphs?.map((p) => ({
            text: p.text,
            headingLevel:
              p.headingLevel === 1 || p.headingLevel === 2 || p.headingLevel === 3
                ? p.headingLevel
                : undefined,
          })),
        });
        const meta = await runtimeCtx.vfs.writeBytes(params.path, result.bytes, {
          snapshotNote: `Word 原地修改：${result.diffSummary}`,
        });
        const rollbackSnapshotId = await getLatestSnapshotId(runtimeCtx, meta.path);

        return {
          content: [
            {
              type: "text",
              text: `已原地更新 Word 文档 ${meta.path}：${result.diffSummary}。\n${result.details.join("\n")}`,
            },
          ],
          details: {
            modifiedPath: meta.path,
            size: meta.size,
            changeSummary: result.diffSummary,
            rollbackSnapshotId,
            rollbackPath: meta.path,
          },
        };
      },
    };

    const pptUpdateTool: AgentTool<typeof pptUpdateParams> = {
      name: "ppt_update",
      label: "原地更新 PPTX（保母版）",
      description:
        "保留既有 .pptx 企业母版、主题、图形与动画，按页码原地替换文字、填充 {{变量}}、更新表格或备注（生成变更摘要与回滚快照）。",
      parameters: pptUpdateParams,
      execute: async (_id, params) => {
        if (!runtimeCtx?.vfs) throw new Error("未绑定工作区 VFS");
        const prev = await runtimeCtx.vfs.readBytes(params.path);
        const result = await updatePptDocumentInPlace(prev, {
          variables: params.variables as Record<string, string> | undefined,
          slideUpdates: params.slideUpdates,
        });
        const meta = await runtimeCtx.vfs.writeBytes(params.path, result.bytes, {
          snapshotNote: `PPT 原地修改：${result.diffSummary}`,
        });
        const rollbackSnapshotId = await getLatestSnapshotId(runtimeCtx, meta.path);

        return {
          content: [
            {
              type: "text",
              text: `已原地更新 PPT 文档 ${meta.path}：${result.diffSummary}。\n${result.details.join("\n")}`,
            },
          ],
          details: {
            modifiedPath: meta.path,
            size: meta.size,
            modifiedSlides: result.modifiedSlides,
            changeSummary: result.diffSummary,
            rollbackSnapshotId,
            rollbackPath: meta.path,
          },
        };
      },
    };

    const pdfSplitTool: AgentTool<typeof pdfSplitParams> = {
      name: "pdf_split",
      label: "拆分提取 PDF 页面",
      description: "按页码范围（如 \"1-3,5\"）从源 PDF 中提取指定页面保存为新 PDF。",
      parameters: pdfSplitParams,
      execute: async (_id, params) => {
        if (!runtimeCtx?.vfs) throw new Error("未绑定工作区 VFS");
        const src = await runtimeCtx.vfs.readBytes(params.path);
        const res = await splitPdfDocument(src, params.pageRanges);
        const meta = await runtimeCtx.vfs.writeBytes(params.outputPath, res.bytes, {
          snapshotNote: "拆分 PDF 前快照",
        });
        return {
          content: [
            {
              type: "text",
              text: `已从 ${params.path}（共 ${res.sourcePageCount} 页）提取第 ${res.extractedPages.join("、")} 页至 ${meta.path}。`,
            },
          ],
          details: {
            modifiedPath: meta.path,
            extractedPages: res.extractedPages,
            changeSummary: `提取第 ${res.extractedPages.join(",")} 页`,
          },
        };
      },
    };

    const pdfWatermarkTool: AgentTool<typeof pdfWatermarkParams> = {
      name: "pdf_watermark",
      label: "为 PDF 添加水印",
      description: "为工作区 PDF 每页叠加半透明斜向水印（支持中文）。",
      parameters: pdfWatermarkParams,
      execute: async (_id, params) => {
        if (!runtimeCtx?.vfs) throw new Error("未绑定工作区 VFS");
        const src = await runtimeCtx.vfs.readBytes(params.path);
        const targetPath = params.outputPath?.trim() || params.path;
        const res = await watermarkPdfDocument(src, {
          text: params.text,
          opacity: params.opacity,
          fontSize: params.fontSize,
          angle: params.angle,
        });
        const meta = await runtimeCtx.vfs.writeBytes(targetPath, res.bytes, {
          snapshotNote: `添加 PDF 水印「${params.text}」前快照`,
        });
        const rollbackSnapshotId =
          targetPath === params.path ? await getLatestSnapshotId(runtimeCtx, meta.path) : undefined;
        return {
          content: [
            {
              type: "text",
              text: `已为 ${meta.path}（共 ${res.pageCount} 页）叠加水印「${params.text}」。`,
            },
          ],
          details: {
            modifiedPath: meta.path,
            pageCount: res.pageCount,
            changeSummary: `叠加水印「${params.text}」`,
            rollbackSnapshotId,
            rollbackPath: meta.path,
          },
        };
      },
    };

    api.registerTool(wordUpdateTool);
    api.registerTool(pptUpdateTool);
    api.registerTool(pdfSplitTool);
    api.registerTool(pdfWatermarkTool);
    api.injectSystemPrompt(
      "- 修改用户上传的既有正式 `.docx` / `.pptx` 模板时，**优先使用 `word_update` / `ppt_update`** 原地改字或填 `{{变量}}`，切勿用 `word_create` / `ppt_create` 重写覆盖导致原有公章与企业母版丢失。"
    );
  },
};
