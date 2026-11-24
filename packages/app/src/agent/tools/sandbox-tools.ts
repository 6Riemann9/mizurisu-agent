import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, obj, opt, str } from "@earendil-works/pi-schema";
import { detectFileCategory, inspectExcel, readExcelSheet } from "../../office";
import type { WorkspaceVFS } from "../../storage/workspace-vfs";

const SANDBOX_NETWORK_ERROR_MSG = "安全沙箱禁止网络请求与外部脚本加载";
const SANDBOX_ESCAPE_ERROR_MSG = "安全沙箱禁止动态导入或逃逸构造";

/**
 * 在执行前对用户分析脚本进行静态安全预检，阻断动态 import()、importScripts、eval、
 * Function 构造函数及原型链 .constructor 逃逸构造，同时完整兼容正常数据结构与统计运算。
 */
export function assertSafeAnalysisCode(code: string): void {
  if (/\bimportScripts\b/.test(code)) {
    throw new Error(`${SANDBOX_NETWORK_ERROR_MSG}（禁止动态导入或逃逸构造）`);
  }
  // 兼容空白、/*...*/ 块注释及 //... 行注释隔断的 import(...) 与 import.meta 写法
  if (/\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*(?:\(|\.)/.test(code)) {
    throw new Error(SANDBOX_ESCAPE_ERROR_MSG);
  }
  if (/\bFunction\b/.test(code) || /\beval\b/.test(code) || /\bconstructor\b/.test(code)) {
    throw new Error(SANDBOX_ESCAPE_ERROR_MSG);
  }
}

const sandboxParams = obj({
  code: str({
    description:
      "要执行的纯 JavaScript 表达式或函数体，必须通过 `return` 返回结果。若传入 dataPath，可通过全局变量 `data` 访问解析后的数据；若传入 dataPaths，可通过全局变量 `datasets`（键为文件路径）访问多份数据。",
  }),
  dataPath: opt(
    str({
      description: "可选工作区文件路径（支持 .xlsx/.csv/.json），会自动解析并注入为全局变量 `data`",
    })
  ),
  dataPaths: opt(
    arr(str(), {
      description:
        "可选多个工作区文件路径数组（支持 .xlsx/.csv/.json），并行解析并注入为全局变量 `datasets`（Record<string, unknown>，键为文件路径）",
    })
  ),
  sheetName: opt(str({ description: "当 dataPath 或 dataPaths 为 Excel 时可指定工作表名" })),
});

async function loadDatasetForWorker(
  vfs: WorkspaceVFS,
  dataPath: string,
  sheetName?: string
): Promise<unknown> {
  const cat = detectFileCategory(dataPath);
  if (cat === "excel") {
    const bytes = await vfs.readBytes(dataPath);
    const info = await inspectExcel(bytes, dataPath, 5);
    const targetSheet = sheetName || info.sheets[0]?.name;
    const sheet = await readExcelSheet(bytes, {
      filename: dataPath,
      sheetName: targetSheet,
      startRow: 1,
      maxRows: 5000,
    });
    const rows = sheet.rows.map((r) => r.map((c) => c.value));
    const headers = (rows[0] || []).map((h, i) => (h ? String(h) : `col_${i + 1}`));
    const records = rows.slice(1).map((row) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] ?? null;
      });
      return obj;
    });
    return { sheetName: sheet.sheetName, headers, rows: rows.slice(1), records };
  }
  const text = await vfs.readText(dataPath);
  if (dataPath.toLowerCase().endsWith(".json")) {
    return JSON.parse(text);
  }
  return text;
}

async function loadMultipleDatasetsForWorker(
  vfs: WorkspaceVFS,
  dataPaths: string[],
  sheetName?: string
): Promise<Record<string, unknown>> {
  const uniquePaths = Array.from(new Set(dataPaths));
  const entries = await Promise.all(
    uniquePaths.map(async (p) => [p, await loadDatasetForWorker(vfs, p, sheetName)] as const)
  );
  const datasets: Record<string, unknown> = {};
  for (const [p, val] of entries) {
    datasets[p] = val;
  }
  return datasets;
}

/**
 * 构造无 Worker 降级分支使用的沙箱屏蔽代理与拦截函数，阻止脚本通过任何全局引用或框架别名发起网络外泄。
 */
function createFallbackSandboxGuards() {
  // 使用普通 function（而非箭头函数），使直接调用与 new 构造均抛出统一安全错误
  const blockedNet = function blockedInSandbox(): never {
    throw new Error(SANDBOX_NETWORK_ERROR_MSG);
  };
  const blockedEscape = function blockedEscapeInSandbox(): never {
    throw new Error(SANDBOX_ESCAPE_ERROR_MSG);
  };

  const safeNavigator =
    typeof navigator !== "undefined" && navigator
      ? new Proxy(navigator, {
          get(target, prop, receiver) {
            if (prop === "sendBeacon") {
              return blockedNet;
            }
            const val = Reflect.get(target, prop, receiver);
            return typeof val === "function" ? val.bind(target) : val;
          },
        })
      : { sendBeacon: blockedNet };

  const blockedGlobalProps = new Set([
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "importScripts",
    "WebTransport",
    "Worker",
    "SharedWorker",
    "BroadcastChannel",
    "URL",
    "Blob",
  ]);
  const blockedEscapeProps = new Set(["Function", "eval"]);
  const selfAliases = new Set(["window", "self", "globalThis", "top", "parent", "frames"]);

  const safeGlobal: Record<string, unknown> = new Proxy(
    globalThis as unknown as Record<string, unknown>,
    {
      get(target, prop) {
        if (typeof prop === "string") {
          if (blockedGlobalProps.has(prop)) return blockedNet;
          if (blockedEscapeProps.has(prop)) return blockedEscape;
          if (prop === "navigator") return safeNavigator;
          if (selfAliases.has(prop)) return safeGlobal;
          if (prop === "opener") return undefined;
        }
        return Reflect.get(target, prop);
      },
    }
  );

  return { blockedNet, blockedEscape, safeNavigator, safeGlobal };
}

/**
 * 生成 Blob Web Worker 隔离执行引导代码：沿着 self 与 navigator 完整原型链向上锁定
 * 所有网络外泄与跨线程构造接口直至 Object.prototype，确保 2 层以上原型（如 WorkerGlobalScope.prototype）不可绕过。
 */
export function createWorkerSandboxSource(): string {
  return `
      (function() {
        var SandboxedFunction = Function;
        var block = function blockedInSandbox() {
          throw new Error(${JSON.stringify(SANDBOX_NETWORK_ERROR_MSG)});
        };
        var blockEscape = function blockedEscapeInSandbox() {
          throw new Error(${JSON.stringify(SANDBOX_ESCAPE_ERROR_MSG)});
        };
        var blockedApis = [
          "fetch",
          "XMLHttpRequest",
          "WebSocket",
          "EventSource",
          "importScripts",
          "WebTransport",
          "Worker",
          "SharedWorker",
          "BroadcastChannel",
          "URL",
          "Blob"
        ];
        var lockObjectProps = function(targetObj, names, replacement, onlyOwn) {
          for (var i = 0; i < names.length; i++) {
            var apiName = names[i];
            if (onlyOwn && !Object.prototype.hasOwnProperty.call(targetObj, apiName)) {
              continue;
            }
            try {
              Object.defineProperty(targetObj, apiName, {
                value: replacement,
                writable: false,
                configurable: false
              });
            } catch (_e1) {
              try {
                targetObj[apiName] = replacement;
              } catch (_e2) {}
            }
          }
        };

        var proto = self;
        var depth = 0;
        while (proto && proto !== Object.prototype && depth < 16) {
          lockObjectProps(proto, blockedApis, block, proto !== self);
          lockObjectProps(proto, ["Function", "eval"], blockEscape, proto !== self);
          try {
            proto = Object.getPrototypeOf(proto);
          } catch (_e0) {
            break;
          }
          depth += 1;
        }

        var safeNav = { sendBeacon: block };
        if (typeof self.navigator !== "undefined" && self.navigator) {
          var navProto = self.navigator;
          var navDepth = 0;
          while (navProto && navProto !== Object.prototype && navDepth < 16) {
            lockObjectProps(
              navProto,
              ["sendBeacon"],
              block,
              navProto !== self.navigator
            );
            try {
              navProto = Object.getPrototypeOf(navProto);
            } catch (_e3) {
              break;
            }
            navDepth += 1;
          }
          safeNav = new Proxy(self.navigator, {
            get: function(target, prop) {
              if (prop === "sendBeacon") return block;
              var v = target[prop];
              return typeof v === "function" ? v.bind(target) : v;
            }
          });
        }
        var postResult = self.postMessage.bind(self);
        self.onmessage = function(e) {
          try {
            var fn = new SandboxedFunction(
              "data",
              "datasets",
              "fetch",
              "XMLHttpRequest",
              "WebSocket",
              "EventSource",
              "importScripts",
              "WebTransport",
              "Worker",
              "SharedWorker",
              "BroadcastChannel",
              "URL",
              "Blob",
              "Function",
              "navigator",
              "top",
              "parent",
              "frames",
              "self",
              "globalThis",
              '"use strict";\\n' + e.data.code
            );
            var result = fn(
              e.data.data,
              e.data.datasets,
              block,
              block,
              block,
              block,
              block,
              block,
              block,
              block,
              block,
              block,
              block,
              blockEscape,
              safeNav,
              self,
              self,
              self,
              self,
              self
            );
            postResult({ ok: true, result: result });
          } catch (err) {
            postResult({ ok: false, error: err && err.message ? err.message : String(err) });
          }
        };
      })();
    `;
}

function executeInBlobWorker(
  code: string,
  data: unknown,
  datasets: Record<string, unknown> | undefined,
  timeoutMs = 8000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      assertSafeAnalysisCode(code);
    } catch (err) {
      reject(err);
      return;
    }

    if (typeof Worker === "undefined" || typeof Blob === "undefined") {
      // 无 Web Worker 环境（如单测）时受控降级执行，并通过 shadow 参数屏蔽外泄与框架全局对象
      try {
        const { blockedNet, blockedEscape, safeNavigator, safeGlobal } =
          createFallbackSandboxGuards();
        const fn = new Function(
          "data",
          "datasets",
          "fetch",
          "XMLHttpRequest",
          "WebSocket",
          "EventSource",
          "importScripts",
          "WebTransport",
          "Worker",
          "SharedWorker",
          "BroadcastChannel",
          "URL",
          "Blob",
          "Function",
          "navigator",
          "window",
          "self",
          "globalThis",
          "top",
          "parent",
          "frames",
          `"use strict";\n${code}`
        );
        resolve(
          fn(
            data,
            datasets,
            blockedNet,
            blockedNet,
            blockedNet,
            blockedNet,
            blockedNet,
            blockedNet,
            blockedNet,
            blockedNet,
            blockedNet,
            blockedNet,
            blockedNet,
            blockedEscape,
            safeNavigator,
            safeGlobal,
            safeGlobal,
            safeGlobal,
            safeGlobal,
            safeGlobal,
            safeGlobal
          )
        );
      } catch (err) {
        reject(err);
      }
      return;
    }

    const workerSource = createWorkerSandboxSource();
    const blob = new Blob([workerSource], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    const timer = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error(`JS 分析执行超时 (${timeoutMs}ms)`));
    }, timeoutMs);

    worker.onmessage = (ev) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      if (ev.data?.ok) resolve(ev.data.result);
      else reject(new Error(ev.data?.error || "Worker 执行失败"));
    };

    worker.onerror = (ev) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error(ev.message || "Worker 异常"));
    };

    worker.postMessage({ code, data, datasets });
  });
}

export function createSandboxTools(vfs: WorkspaceVFS): AgentTool[] {
  const analysisTool: AgentTool<typeof sandboxParams> = {
    name: "run_js_analysis",
    label: "JS 数据分析沙箱",
    description:
      "在隔离 Web Worker 中运行纯 JavaScript 对单表或多表（Excel/CSV/JSON）做精确计算、对账、分组汇总、过滤和统计（禁用网络请求，带 8 秒超时，三端可用）。",
    parameters: sandboxParams,
    execute: async (_id, params) => {
      const [data, datasets] = await Promise.all([
        params.dataPath
          ? loadDatasetForWorker(vfs, params.dataPath, params.sheetName)
          : Promise.resolve(undefined),
        params.dataPaths !== undefined
          ? loadMultipleDatasetsForWorker(vfs, params.dataPaths, params.sheetName)
          : Promise.resolve(undefined),
      ]);
      const result = await executeInBlobWorker(params.code, data, datasets);
      const formatted =
        typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return {
        content: [{ type: "text", text: formatted ?? "undefined" }],
        details: { dataPath: params.dataPath, dataPaths: params.dataPaths },
      };
    },
  };

  return [analysisTool];
}
