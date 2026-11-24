import type { AgentTool } from "@earendil-works/pi-agent-core";
import { obj, opt, str } from "@earendil-works/pi-schema";
import { detectFileCategory, inspectExcel, readExcelSheet } from "../../office";
import type { WorkspaceVFS } from "../../storage/workspace-vfs";

const sandboxParams = obj({
  code: str({
    description:
      "要执行的纯 JavaScript 表达式或函数体，必须通过 `return` 返回结果。若传入 dataPath，可通过全局变量 `data` 访问解析后的数据。",
  }),
  dataPath: opt(
    str({
      description: "可选工作区文件路径（支持 .xlsx/.csv/.json），会自动解析并注入为全局变量 `data`",
    })
  ),
  sheetName: opt(str({ description: "当 dataPath 为 Excel 时可指定工作表名" })),
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

function executeInBlobWorker(code: string, data: unknown, timeoutMs = 8000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === "undefined" || typeof Blob === "undefined") {
      // 无 Web Worker 环境（如单测）时受控降级执行
      try {
        const fn = new Function("data", `"use strict";\n${code}`);
        resolve(fn(data));
      } catch (err) {
        reject(err);
      }
      return;
    }

    const workerSource = `
      self.onmessage = function(e) {
        try {
          const data = e.data.data;
          const fn = new Function("data", '"use strict";\\n' + e.data.code);
          const result = fn(data);
          self.postMessage({ ok: true, result });
        } catch (err) {
          self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
        }
      };
    `;
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

    worker.postMessage({ code, data });
  });
}

export function createSandboxTools(vfs: WorkspaceVFS): AgentTool[] {
  const analysisTool: AgentTool<typeof sandboxParams> = {
    name: "run_js_analysis",
    label: "JS 数据分析沙箱",
    description:
      "在隔离 Web Worker 中运行纯 JavaScript 对表格或 JSON 做精确计算、分组汇总、过滤和统计（带 8 秒超时，三端可用）。",
    parameters: sandboxParams,
    execute: async (_id, params) => {
      const data = params.dataPath
        ? await loadDatasetForWorker(vfs, params.dataPath, params.sheetName)
        : undefined;
      const result = await executeInBlobWorker(params.code, data);
      const formatted =
        typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return {
        content: [{ type: "text", text: formatted ?? "undefined" }],
        details: { dataPath: params.dataPath },
      };
    },
  };

  return [analysisTool];
}
