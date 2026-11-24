import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { exportToPptxMock } = vi.hoisted(() => ({
  exportToPptxMock: vi.fn(),
}));

vi.mock("dom-to-pptx", () => ({
  exportToPptx: exportToPptxMock,
}));

import { BUILTIN_SKILLS } from "../agent/skills";
import { buildSystemPrompt } from "../agent/system-prompt";
import { createOfficeTools } from "../agent/tools/office-tools";
import {
  SLIDE_THEMES,
  buildSlidesHtmlDocument,
  createStarterDemoSlidesHtml,
  detectFileCategory,
  exportHtmlSlidesToPptxBytes,
  getSlideThemeStyles,
  parseSlidesHtmlDocument,
  parseSlidesHtmlWithRegex,
  switchSlidesHtmlTheme,
  updateSlideInHtmlDocument,
  validateSlidesHtml,
  type SlideDeckSpec,
} from "../office";
import { clearAllLocalData, kvGet, kvSet } from "../storage/db";
import { WorkspaceVFS } from "../storage/workspace-vfs";

describe("HTML-First 幻灯片引擎与工具闭环", () => {
  let vfs: WorkspaceVFS;

  beforeEach(async () => {
    await clearAllLocalData();
    vfs = new WorkspaceVFS();
    exportToPptxMock.mockReset();
    exportToPptxMock.mockResolvedValue(new Blob([new Uint8Array([80, 75, 3, 4])]));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("5 套主题样式严格作用域化且不含 dom-to-pptx 黑名单 CSS", () => {
    expect(SLIDE_THEMES.map((t) => t.id)).toEqual([
      "linear-dark",
      "apple-keynote",
      "consulting-exec",
      "swiss-editorial",
      "warm-founder",
    ]);

    for (const theme of SLIDE_THEMES) {
      const css = getSlideThemeStyles(theme.id);
      expect(css).toContain(".mizurisu-slide-scope .slide");
      expect(css).toContain("width: 1280px;");
      expect(css).toContain("height: 720px;");
      expect(css).toContain("font-size: 64px;");
      expect(css).toContain("tabular-nums");

      // 严禁全局选择器污染宿主 UI
      expect(css).not.toMatch(/(^|\n)\s*(html|body|\*|h1|h2|p|table)\s*\{/m);

      // 严禁黑名单 CSS
      expect(css).not.toMatch(/backdrop-filter/i);
      expect(css).not.toMatch(/radial-gradient/i);
      expect(css).not.toMatch(/conic-gradient/i);
      expect(css).not.toMatch(/(?:translate|scale|skew)\s*\(/i);
      expect(css).not.toMatch(/\d+v[hw]\b/i);
      expect(css).not.toMatch(/@keyframes/i);
    }
  });

  it("支持构建、DOMParser/正则双解析、转义解码、换肤与单页局部更新", () => {
    const spec: SlideDeckSpec = {
      title: 'Q2 "核心" 复盘 & 路线图',
      theme: "linear-dark",
      customCss: ".mizurisu-slide-scope .custom-tag { color: #38bdf8; }",
      slides: [
        {
          title: '封面 <Beta> & "2026"',
          notes: "第一行备注\n第二行 \"重点\" & 提示",
          html: '<div class="cover-stage"><h1 class="slide-h1">开场标题</h1><section class="nested">嵌套块</section></div>',
        },
        {
          title: "第二页 KPI",
          notes: "强调 +31% 增速",
          html: '<div class="kpi-grid"><div class="kpi-card"><div class="kpi-num">99.9%</div></div></div>',
        },
      ],
    };

    const html = buildSlidesHtmlDocument(spec);
    expect(html).toContain('<meta name="mizurisu-deck"');
    expect(html).toContain('data-theme="linear-dark"');
    expect(html).toContain("<style data-mizurisu-theme>");
    expect(html).toContain("<style data-mizurisu-custom>");
    expect(html).toContain('data-slide-index="1"');
    expect(html).toContain("width: 1280px; height: 720px; position: relative; overflow: hidden;");

    const parsedDom = parseSlidesHtmlDocument(html);
    expect(parsedDom.title).toBe(spec.title);
    expect(parsedDom.theme).toBe("linear-dark");
    expect(parsedDom.customCss).toContain(".custom-tag");
    expect(parsedDom.slides).toHaveLength(2);
    expect(parsedDom.slides[0].title).toBe('封面 <Beta> & "2026"');
    expect(parsedDom.slides[0].notes).toBe('第一行备注\n第二行 "重点" & 提示');
    expect(parsedDom.slides[0].html).toContain('<section class="nested">嵌套块</section>');

    // 显式验证无 DOMParser 时的正则平衡标签兜底解析
    const parsedRegex = parseSlidesHtmlWithRegex(html);
    expect(parsedRegex).toEqual(parsedDom);

    // 换肤
    const switched = switchSlidesHtmlTheme(html, "consulting-exec");
    const parsedSwitched = parseSlidesHtmlDocument(switched);
    expect(parsedSwitched.theme).toBe("consulting-exec");
    expect(parsedSwitched.slides).toHaveLength(2);
    expect(switched).toContain('data-theme="consulting-exec"');
    expect(switched).toContain("#1d4ed8");

    // 单页局部更新
    const updated = updateSlideInHtmlDocument(switched, 2, {
      title: "第二页 KPI（已校准）",
      html: '<div class="kpi-grid"><div class="kpi-card"><div class="kpi-num">100%</div></div></div>',
    });
    const parsedUpdated = parseSlidesHtmlDocument(updated);
    expect(parsedUpdated.slides[0].title).toBe('封面 <Beta> & "2026"');
    expect(parsedUpdated.slides[1].title).toBe("第二页 KPI（已校准）");
    expect(parsedUpdated.slides[1].notes).toBe("强调 +31% 增速");
    expect(parsedUpdated.slides[1].html).toContain("100%");

    expect(() => updateSlideInHtmlDocument(updated, 0, { title: "无效" })).toThrow();
    expect(() => updateSlideInHtmlDocument(updated, 3, { title: "越界" })).toThrow();
  });

  it("validateSlidesHtml 精准捕获 CSS 黑名单与 1280×720 溢出且不误伤正文单词", () => {
    const badHtml = buildSlidesHtmlDocument({
      title: "黑名单校验",
      theme: "apple-keynote",
      customCss: `
        .mizurisu-slide-scope .glass { backdrop-filter: blur(12px); height: 80vh; }
        @keyframes pulse { from { opacity: 0.4; } to { opacity: 1; } }
      `,
      slides: [
        {
          title: "正常文本含英文 scale/translate",
          html: '<p class="slide-lead">Economies of scale translate into durable growth.</p>',
        },
        {
          title: "违规内联样式页",
          html: '<div style="background: radial-gradient(#fff, #000); transform: translateY(-4px) scale(1.05); width: 50vw;">bad</div><div style="background: conic-gradient(red, blue);">pie</div>',
        },
      ],
    });

    const report = validateSlidesHtml(badHtml);
    expect(report.ok).toBe(false);
    expect(report.slideCount).toBe(2);

    const codes = report.issues.map((i) => `${i.slideIndex}:${i.code}`);
    expect(codes).toContain("0:CSS_FORBIDDEN_BACKDROP_FILTER");
    expect(codes).toContain("0:CSS_FORBIDDEN_VIEWPORT_UNIT");
    expect(codes).toContain("0:CSS_FORBIDDEN_KEYFRAMES");
    expect(codes).toContain("2:CSS_FORBIDDEN_RADIAL_GRADIENT");
    expect(codes).toContain("2:CSS_FORBIDDEN_CONIC_GRADIENT");
    expect(codes).toContain("2:CSS_FORBIDDEN_TRANSFORM");
    expect(codes).toContain("2:CSS_FORBIDDEN_VIEWPORT_UNIT");

    // 第 1 页正文里的英文 scale / translate 不应误报
    expect(report.issues.some((i) => i.slideIndex === 1)).toBe(false);

    // 模拟浏览器环境 scrollHeight > 724 / scrollWidth > 1284 溢出检测
    const cleanHtml = buildSlidesHtmlDocument({
      title: "溢出测试",
      theme: "linear-dark",
      slides: [{ title: "高内容页", html: "<div>内容过长</div>" }],
    });
    const heightSpy = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(790);
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(1340);

    const overflowReport = validateSlidesHtml(cleanHtml);
    heightSpy.mockRestore();
    widthSpy.mockRestore();

    expect(overflowReport.ok).toBe(false);
    expect(overflowReport.issues.map((i) => i.code)).toEqual([
      "SLIDE_OVERFLOW_Y",
      "SLIDE_OVERFLOW_X",
    ]);
    expect(overflowReport.issues[0].message).toContain("70px");
    expect(overflowReport.issues[1].message).toContain("60px");
  });

  it("createStarterDemoSlidesHtml 生成 4 页标杆演示并通过 0 违规体检", () => {
    const demoHtml = createStarterDemoSlidesHtml();
    const deck = parseSlidesHtmlDocument(demoHtml);

    expect(deck.theme).toBe("linear-dark");
    expect(deck.slides).toHaveLength(4);
    expect(deck.slides[0].html).toContain("cover-stage");
    expect(deck.slides[1].html).toContain("kpi-num");
    expect(deck.slides[2].html).toContain("bento-grid");
    expect(deck.slides[3].html).toContain("<svg");
    expect(deck.slides[3].html).toContain("385");

    const report = validateSlidesHtml(demoHtml);
    expect(report.ok).toBe(true);
    expect(report.slideCount).toBe(4);
    expect(report.issues).toEqual([]);
  });

  it("exportHtmlSlidesToPptxBytes 挂载无 transform 离屏节点、调用 dom-to-pptx 并在 finally 清理", async () => {
    const demoHtml = createStarterDemoSlidesHtml();
    let capturedHostTransform = "";
    let capturedSlideCount = 0;

    exportToPptxMock.mockImplementationOnce(async (slideEls: HTMLElement[]) => {
      capturedSlideCount = slideEls.length;
      const host = slideEls[0]?.parentElement;
      expect(host?.classList.contains("mizurisu-slide-scope")).toBe(true);
      expect(host?.style.visibility).toBe("visible");
      expect(host?.style.opacity).toBe("1");
      capturedHostTransform = host?.style.transform || "";
      return new Blob([new Uint8Array([1, 2, 3, 4])]);
    });

    const bytes = await exportHtmlSlidesToPptxBytes(demoHtml, "q2.pptx");
    expect(capturedSlideCount).toBe(4);
    expect(capturedHostTransform).toBe("");
    expect(exportToPptxMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        skipDownload: true,
        width: 13.333,
        height: 7.5,
        fileName: "q2.pptx",
      })
    );
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    expect(document.querySelector(".mizurisu-slide-scope")).toBeNull();

    // 即使 exportToPptx 抛错也必须清理离屏节点
    exportToPptxMock.mockRejectedValueOnce(new Error("mock export error"));
    await expect(exportHtmlSlidesToPptxBytes(demoHtml)).rejects.toThrow("mock export error");
    expect(document.querySelector(".mizurisu-slide-scope")).toBeNull();
  });

  it("VFS 支持空工作区种子初始化与既有旧工作区单次补种示例幻灯片", async () => {
    // 1. 全新空工作区一次性种齐 3 个示例文件
    await vfs.seedStarterWorkspaceIfEmpty();
    const files1 = await vfs.listFiles();
    expect(files1.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        "示例_季度销售数据.xlsx",
        "示例_项目周报模板.md",
        "示例_产品季度汇报.slides.html",
      ])
    );
    expect(await kvGet<boolean>("starter_slides_seeded")).toBe(true);

    // 2. 模拟老用户工作区：曾 seed 过旧工作区但尚未有示例幻灯片、也未标记 starter_slides_seeded
    await clearAllLocalData();
    const legacyVfs = new WorkspaceVFS();
    await legacyVfs.writeText("legacy_note.md", "# 老用户文件");
    await kvSet("starter_workspace_seeded", true);

    await legacyVfs.seedStarterWorkspaceIfEmpty();
    expect(await legacyVfs.exists("示例_产品季度汇报.slides.html")).toBe(true);
    expect(detectFileCategory("示例_产品季度汇报.slides.html")).toBe("slides");
    expect(await kvGet<boolean>("starter_slides_seeded")).toBe(true);

    // 3. 若用户主动删除示范幻灯片，再次初始化不应强行复活
    await legacyVfs.deleteFile("示例_产品季度汇报.slides.html");
    await legacyVfs.seedStarterWorkspaceIfEmpty();
    expect(await legacyVfs.exists("示例_产品季度汇报.slides.html")).toBe(false);
  });

  it("Agent 工具闭环：slides_create 体检报错 -> slides_update_slide 修复 -> slides_read 校验 -> 自动导出 pptx", async () => {
    const tools = createOfficeTools(vfs);
    const slidesCreate = tools.find((t) => t.name === "slides_create")!;
    const slidesUpdate = tools.find((t) => t.name === "slides_update_slide")!;
    const slidesRead = tools.find((t) => t.name === "slides_read")!;

    // 1. 创建含违规 CSS 的幻灯片并验证工具明确列出逐页问题
    const createRes = await slidesCreate.execute("tc_1", {
      path: "board_deck.slides.html",
      title: "董事会季度汇报",
      theme: "apple-keynote",
      slides: [
        {
          title: "封面",
          notes: "开场页备注",
          html: '<div class="cover-stage"><h1 class="slide-h1">Q2 经营复盘</h1></div>',
        },
        {
          title: "问题页",
          html: '<div style="backdrop-filter: blur(8px);">违规毛玻璃</div>',
        },
      ],
    });

    const createText = (createRes.content[0] as { text: string }).text;
    expect(createText).toContain("CSS_FORBIDDEN_BACKDROP_FILTER");
    expect(createText).toContain("第 2 页");
    expect((createRes.details as { modifiedPath?: string }).modifiedPath).toBe(
      "board_deck.slides.html"
    );

    // 2. 调用 slides_update_slide 修复第 2 页并验证快照与 0 问题状态
    const updateRes = await slidesUpdate.execute("tc_2", {
      path: "board_deck.slides.html",
      slideIndex: 2,
      notes: "补全第 2 页演讲者备注",
      html: '<div class="kpi-grid"><div class="kpi-card"><div class="kpi-num">98%</div></div></div>',
    });

    const updateText = (updateRes.content[0] as { text: string }).text;
    expect(updateText).toContain("0 项违规或溢出");
    const snaps = await vfs.getSnapshots("board_deck.slides.html");
    expect(snaps.length).toBe(1);

    // 3. 调用 slides_read 校验最终结构与备注
    const readRes = await slidesRead.execute("tc_3", {
      path: "board_deck.slides.html",
    });
    const parsedRead = JSON.parse((readRes.content[0] as { text: string }).text);
    expect(parsedRead.theme).toBe("apple-keynote");
    expect(parsedRead.slideCount).toBe(2);
    expect(parsedRead.slides[1].notes).toBe("补全第 2 页演讲者备注");
    expect(parsedRead.validation.ok).toBe(true);

    // 4. 验证 alsoExportPptx: true 在 DOM 环境下自动导出同名 .pptx 到 VFS
    const exportRes = await slidesCreate.execute("tc_4", {
      path: "auto_export.slides.html",
      title: "自动导出测试",
      slides: [
        {
          title: "首页",
          html: '<div class="cover-stage"><h1 class="slide-h1">Hello Slides</h1></div>',
        },
      ],
      alsoExportPptx: true,
    });
    expect(await vfs.exists("auto_export.pptx")).toBe(true);
    expect((exportRes.details as { pptxPath?: string }).pptxPath).toBe("auto_export.pptx");
  });

  it("Skill 与 System Prompt 已升级引导优先使用 slides_create 与防溢出规范", () => {
    const pptSkill = BUILTIN_SKILLS.find((s) => s.id === "skill-ppt-deck");
    expect(pptSkill).toBeDefined();
    expect(pptSkill?.systemHint).toContain("slides_create");
    expect(pptSkill?.systemHint).toContain("slides_update_slide");
    expect(pptSkill?.systemHint).toContain("backdrop-filter");
    expect(pptSkill?.systemHint).toContain("60 字");

    const prompt = buildSystemPrompt({
      brandName: "Mizurisu Agent",
      platformKind: "web",
      files: [],
      activeSkill: pptSkill,
    });
    expect(prompt).toContain("slides_create");
    expect(prompt).toContain("slides_update_slide");
    expect(prompt).toContain("slides_read");
    expect(prompt).toContain("1280×720");
  });
});
