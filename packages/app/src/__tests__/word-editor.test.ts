import { cleanup, render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WordEditor } from "../components/preview/WordEditor";
import { WordViewer } from "../components/preview/WordViewer";
import { createPdfDocument, readPdfDocument } from "../office/pdf";
import { createWordDocument, readWordDocument } from "../office/word";
import {
  sanitizeWordEditorHtml,
  tiptapJsonToPdfSpec,
  tiptapJsonToWordBytes,
  wordBytesToEditorHtml,
} from "../office/word-editor-bridge";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Word 富文本双向桥接与工作台 (word-editor)", () => {
  it("createWordDocument -> wordBytesToEditorHtml 正确解析标题、加粗、列表与表格", async () => {
    const docxBytes = await createWordDocument({
      title: "季度产品规划报告",
      subtitle: "2026 Q3 评审版本",
      headerText: "内部审阅文档",
      blocks: [
        { type: "heading", level: 1, text: "一、核心研发目标" },
        { type: "heading", level: 2, text: "1.1 关键交付里程碑" },
        {
          type: "paragraph",
          text: "重点增强原生 Office 实时编辑能力。",
          bold: true,
        },
        {
          type: "bullet",
          items: ["支持 Tiptap 富文本编辑器", "支持表格行列即时增删"],
        },
        {
          type: "table",
          headers: ["模块", "负责人", "状态"],
          rows: [
            ["Word 编辑器", "客户端组", "已完成"],
            ["PDF 导出", "引擎组", "测试中"],
          ],
        },
      ],
    });

    const html = await wordBytesToEditorHtml(docxBytes);
    expect(html).toContain("<h1");
    expect(html).toContain("季度产品规划报告");
    expect(html).toContain("一、核心研发目标");
    expect(html).toContain("<h2");
    expect(html).toContain("1.1 关键交付里程碑");
    expect(html).toContain("<strong>重点增强原生 Office 实时编辑能力。</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>支持 Tiptap 富文本编辑器</li>");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>");
    expect(html).toContain("Word 编辑器");
    expect(html).toContain("已完成");
  });

  it("wordBytesToEditorHtml 对空文档返回 <p></p> 且清理危险脚本属性", async () => {
    const emptyBytes = await createWordDocument({ blocks: [] });
    const emptyHtml = await wordBytesToEditorHtml(emptyBytes);
    expect(emptyHtml).toBe("<p></p>");

    expect(await wordBytesToEditorHtml(new Uint8Array(0))).toBe("<p></p>");

    const dirtyHtml =
      '<p onclick="alert(1)">安全正文</p><script>alert(2)</script><a href="javascript:evil()">链接</a><style>body{background:url(javascript:1)}</style>';
    const sanitized = sanitizeWordEditorHtml(dirtyHtml);
    expect(sanitized).toContain("安全正文");
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("<style");
  });

  it("Tiptap JSON -> tiptapJsonToWordBytes -> readWordDocument & OOXML 完整闭环", async () => {
    const tiptapDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, textAlign: "center" },
          content: [{ type: "text", text: "2026 年度客户交付白皮书" }],
        },
        {
          type: "heading",
          attrs: { level: 2, textAlign: "left" },
          content: [{ type: "text", text: "一、富文本混排能力验证" }],
        },
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [
            { type: "text", text: "粗体", marks: [{ type: "bold" }] },
            { type: "text", text: "、" },
            { type: "text", text: "斜体", marks: [{ type: "italic" }] },
            { type: "text", text: "、" },
            { type: "text", text: "下划线", marks: [{ type: "underline" }] },
            { type: "text", text: "、" },
            { type: "text", text: "删除线", marks: [{ type: "strike" }] },
            { type: "text", text: "、" },
            {
              type: "text",
              text: "警示红字",
              marks: [{ type: "textStyle", attrs: { color: "#DC2626" } }],
            },
            { type: "text", text: "、" },
            {
              type: "text",
              text: "荧光高亮",
              marks: [{ type: "highlight", attrs: { color: "#fef08a" } }],
            },
            { type: "hardBreak" },
            { type: "text", text: "换行后行内代码", marks: [{ type: "code" }] },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "无序主条目" }],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "嵌套子条目" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "第一步准备数据" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "第二步导出交付" }],
                },
              ],
            },
          ],
        },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "重要提示：所有数据仅在本地处理。" }],
            },
          ],
        },
        {
          type: "codeBlock",
          content: [{ type: "text", text: "const status = 'ready';" }],
        },
        {
          type: "horizontalRule",
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "指标" }] },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "数值" }] },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "可用性 SLA" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "99.99%" }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const docxBytes = await tiptapJsonToWordBytes(tiptapDoc, {
      title: "2026 年度客户交付白皮书",
      headerText: "Mizurisu 交付中心",
    });

    // 1. readWordDocument 读回校验文本、HTML 与段落结构
    const readBack = await readWordDocument(docxBytes);
    expect(readBack.text).toContain("2026 年度客户交付白皮书");
    expect(readBack.text).toContain("粗体、斜体、下划线、删除线、警示红字、荧光高亮");
    expect(readBack.text).toContain("换行后行内代码");
    expect(readBack.text).toContain("无序主条目");
    expect(readBack.text).toContain("嵌套子条目");
    expect(readBack.text).toContain("第一步准备数据");
    expect(readBack.text).toContain("第二步导出交付");
    expect(readBack.text).toContain("重要提示：所有数据仅在本地处理。");
    expect(readBack.text).toContain("const status = 'ready';");
    expect(readBack.text).toContain("可用性 SLA");
    expect(readBack.text).toContain("99.99%");

    expect(readBack.html).toContain("<h1>2026 年度客户交付白皮书</h1>");
    expect(readBack.html).toContain("<h2>一、富文本混排能力验证</h2>");
    expect(readBack.html).toContain("<strong>粗体</strong>");
    expect(readBack.html).toContain("<em>斜体</em>");
    expect(readBack.html).toContain("<s>删除线</s>");
    expect(readBack.html).toContain("<ul>");
    expect(readBack.html).toContain("<ol>");
    expect(readBack.html).toContain("<table>");

    // 2. 再次转回编辑器 HTML，校验下划线、引用与荧光高亮往返保留
    const roundTripHtml = await wordBytesToEditorHtml(docxBytes);
    expect(roundTripHtml).toContain("<u>下划线</u>");
    expect(roundTripHtml).toContain("<blockquote>");
    expect(roundTripHtml).toContain("<mark");

    // 3. 深入检验 OOXML 底层属性（对齐、颜色、高亮、页眉页脚）
    const zip = await JSZip.loadAsync(docxBytes);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain('w:val="center"');
    expect(documentXml).toContain('w:val="DC2626"');
    expect(documentXml).toContain('w:val="yellow"');
    expect(documentXml).toContain('w:u w:val="single"');
    expect(documentXml).toContain("<w:strike/>");

    const headerFiles = Object.keys(zip.files).filter((f) =>
      f.startsWith("word/header")
    );
    expect(headerFiles.length).toBeGreaterThan(0);
    const headerXml = await zip.file(headerFiles[0])!.async("string");
    expect(headerXml).toContain("Mizurisu 交付中心");

    // 4. 校验 tiptapJsonToPdfSpec 与矢量 PDF 导出闭环
    const pdfSpec = tiptapJsonToPdfSpec(tiptapDoc, "Fallback");
    expect(pdfSpec.title).toBe("2026 年度客户交付白皮书");
    expect(pdfSpec.sections?.some((s) => s.type === "table")).toBe(true);
    expect(pdfSpec.sections?.some((s) => s.type === "bullets")).toBe(true);

    const asciiPdfDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Enterprise Delivery Report" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Service availability reached 99.99%." }],
        },
      ],
    };
    const asciiPdfBytes = await createPdfDocument(
      tiptapJsonToPdfSpec(asciiPdfDoc, "Fallback")
    );
    const pdfParsed = await readPdfDocument(asciiPdfBytes);
    expect(pdfParsed.pageCount).toBeGreaterThanOrEqual(1);
    expect(pdfParsed.pages[0].text).toContain("Enterprise Delivery Report");
    expect(pdfParsed.pages[0].text).toContain("99.99%");
  });

  it("WordEditor 无 Tiptap 重复扩展警告且正常渲染工具栏、大纲与文档正文", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const docxBytes = await createWordDocument({
      title: "产品需求评审",
      blocks: [
        { type: "heading", level: 2, text: "二、功能清单" },
        { type: "paragraph", text: "支持在线实时编辑与自动保存。" },
      ],
    });

    render(
      React.createElement(WordEditor, {
        path: "docs/review.docx",
        bytes: docxBytes,
      })
    );

    await waitFor(() => {
      expect(screen.getByText("保存 .docx")).toBeTruthy();
      expect(screen.getByText("插入表格")).toBeTruthy();
      expect(screen.getByText("导出 PDF")).toBeTruthy();
      expect(
        screen.getByText((content) => content.includes("支持在线实时编辑与自动保存。"))
      ).toBeTruthy();
    });

    const duplicateWarnings = warnSpy.mock.calls.filter((call) =>
      call.some((arg) =>
        String(arg).toLowerCase().includes("duplicate extension")
      )
    );
    expect(duplicateWarnings).toHaveLength(0);
  });

  it("WordViewer 无 path 时隐藏文档编辑模式并渲染缩放与打印控制", async () => {
    const docxBytes = await createWordDocument({
      title: "只读预览文档",
      blocks: [{ type: "paragraph", text: "仅查看模式正文。" }],
    });

    render(React.createElement(WordViewer, { bytes: docxBytes }));

    expect(screen.queryByText("文档编辑")).toBeNull();
    expect(screen.getByText("原版排版")).toBeTruthy();
    expect(screen.getByText("纯文本提取")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByText("125%")).toBeTruthy();
    expect(screen.getByText("150%")).toBeTruthy();
    expect(screen.getByText("打印")).toBeTruthy();
  });

  it("WordViewer 传入 path 时默认进入文档编辑模式并懒加载 WordEditor", async () => {
    const docxBytes = await createWordDocument({
      title: "可编辑文档",
      blocks: [{ type: "paragraph", text: "欢迎编辑 Word 文档。" }],
    });

    render(
      React.createElement(WordViewer, {
        path: "docs/editable.docx",
        bytes: docxBytes,
      })
    );

    expect(screen.getByText("文档编辑")).toBeTruthy();
    expect(screen.getByText("原版排版")).toBeTruthy();
    expect(screen.getByText("纯文本提取")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("保存 .docx")).toBeTruthy();
      expect(
        screen.getByText((content) => content.includes("欢迎编辑 Word 文档。"))
      ).toBeTruthy();
    });
  });
});
