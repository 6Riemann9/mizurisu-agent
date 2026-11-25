import { Agent, type AgentEvent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import { arr, int, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import { renderPdfPagesToPngDataUrls } from "../../../office";
import type { ExtensionRuntimeContext, MizurisuExtension } from "../types";

const visionOcrParams = obj({
  path: str({ description: "工作区内的图片（.png/.jpg/.webp）或 PDF（.pdf）文件路径" }),
  pages: opt(
    arr(int({ minimum: 1 }), {
      description: "当目标为 PDF 时要识别的页码列表（从 1 开始），默认 [1, 2, 3]",
    })
  ),
  mode: opt(
    oneOf(["auto", "ocr", "vision"] as const, {
      description: "auto=优先系统原生OCR，不可用时回退视觉模型或Tesseract；ocr=仅本地OCR；vision=直接用多模态大模型识图",
    })
  ),
  prompt: opt(
    str({ description: "自定义识图提取要求（仅视觉模型模式生效），例如：提取发票金额、税号和开票日期" })
  ),
});

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function dataUrlToBase64AndMime(dataUrl: string): { base64: string; mimeType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (match) {
    return { mimeType: match[1], base64: match[2] };
  }
  return { mimeType: "image/png", base64: dataUrl };
}

function modelSupportsVision(runtimeCtx: ExtensionRuntimeContext): boolean {
  return Boolean(
    runtimeCtx.modelInfo?.supportsVision ||
      runtimeCtx.model.input?.includes("image") ||
      /gpt-4o|gpt-4\.1|gpt-5|claude-3|claude-4|gemini|vl|vision/i.test(runtimeCtx.model.id)
  );
}

async function recognizeViaVisionModel(
  runtimeCtx: ExtensionRuntimeContext,
  dataUrl: string,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const { base64, mimeType } = dataUrlToBase64AndMime(dataUrl);
  const visionAgent = new Agent({
    initialState: {
      systemPrompt:
        "你是一个高精度办公图文识图与表格提取引擎。请忠实提取图片中的文字、表格结构与印章/关键字段，绝不编造不存在的内容。",
      model: runtimeCtx.model,
      tools: [],
      messages: [],
    },
    streamFn: runtimeCtx.streamFn,
    getApiKey: () => runtimeCtx.config.apiKey.trim(),
  });

  let finalText = "";
  let errorText = "";
  const unsubscribe = visionAgent.subscribe((ev: AgentEvent) => {
    if (ev.type === "message_end" && ev.message.role === "assistant") {
      const am = ev.message as AssistantMessage;
      const text = am.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
      if (text) finalText = text;
      if (am.errorMessage) errorText = am.errorMessage;
    }
  });

  const onAbort = () => visionAgent.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await visionAgent.prompt(prompt, [{ type: "image", data: base64, mimeType }]);
    await visionAgent.waitForIdle();
    if (errorText && !finalText) {
      throw new Error(errorText);
    }
    return finalText || "（视觉模型未识别到有效文字）";
  } finally {
    signal?.removeEventListener("abort", onAbort);
    unsubscribe();
  }
}

async function recognizeViaTesseract(dataUrl: string): Promise<string> {
  const mod = await import("tesseract.js");
  const createWorker =
    (mod as unknown as { createWorker?: (langs?: string) => Promise<{ recognize: (img: string) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> }> }).createWorker ??
    (mod as unknown as { default?: { createWorker?: (langs?: string) => Promise<{ recognize: (img: string) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> }> } }).default?.createWorker;
  if (!createWorker) {
    throw new Error("tesseract.js 加载失败");
  }
  const worker = await createWorker("chi_sim+eng");
  try {
    const out = await worker.recognize(dataUrl);
    return (out?.data?.text || "").trim();
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

export interface RecognizeImageChainResult {
  text: string;
  engine: "native-ocr" | "vision-model" | "tesseract";
}

export async function recognizeImageWithFallback(
  runtimeCtx: ExtensionRuntimeContext,
  dataUrl: string,
  options?: {
    mode?: "auto" | "ocr" | "vision";
    prompt?: string;
    signal?: AbortSignal;
  }
): Promise<RecognizeImageChainResult> {
  const mode = options?.mode ?? "auto";
  const prompt =
    options?.prompt?.trim() || "请完整识别提取图中全部中文/英文文字、数字与表格内容（保留原有结构）。";

  if (mode === "vision") {
    if (!modelSupportsVision(runtimeCtx)) {
      throw new Error(`当前模型 ${runtimeCtx.model.id} 不支持视觉识图，请切换到多模态模型或改用 mode="ocr"`);
    }
    const text = await recognizeViaVisionModel(runtimeCtx, dataUrl, prompt, options?.signal);
    return { text, engine: "vision-model" };
  }

  // 1. 优先尝试桌面端零体积系统原生离线 OCR（WinRT / macOS Vision）
  if (runtimeCtx.platform.nativeOcrImage) {
    try {
      const { base64 } = dataUrlToBase64AndMime(dataUrl);
      const text = await runtimeCtx.platform.nativeOcrImage(base64, "zh-Hans-CN");
      if (text && text.trim()) {
        return { text: text.trim(), engine: "native-ocr" };
      }
    } catch {
      // 原生 OCR 不可用（如 Linux / Web 或缺少语言包）时继续回退
    }
  }

  // 2. 若当前模型支持 Vision 且允许 auto，优先走视觉大模型（对表格/印章/版式精度最高）
  if (mode === "auto" && modelSupportsVision(runtimeCtx) && runtimeCtx.config.apiKey.trim()) {
    try {
      const text = await recognizeViaVisionModel(runtimeCtx, dataUrl, prompt, options?.signal);
      if (text) return { text, engine: "vision-model" };
    } catch {
      // 视觉接口失败时兜底到 Tesseract
    }
  }

  // 3. 按需懒加载 Tesseract.js 离线/浏览器兜底
  const text = await recognizeViaTesseract(dataUrl);
  return { text: text || "（未识别到可读文字）", engine: "tesseract" };
}

export const visionOcrExtension: MizurisuExtension = {
  id: "pi-vision-ocr",
  name: "轻量辅助视觉与 OCR (Vision & OCR)",
  description: "遇到扫描版 PDF、发票或截图时，按「系统原生 OCR → 视觉大模型 → 按需 Tesseract」三层链路精准提字。",
  category: "knowledge",
  defaultEnabled: true,
  register(api, runtimeCtx?: ExtensionRuntimeContext) {
    const visionOcrTool: AgentTool<typeof visionOcrParams> = {
      name: "vision_ocr",
      label: "图片 / 扫描 PDF 识别提取",
      description:
        "识别工作区中的图片（PNG/JPG/WebP）或扫描版 PDF 页面内容；桌面端自动利用系统原生离线 OCR（0 体积增量），并支持多模态模型识图或懒加载 Tesseract 兜底。",
      parameters: visionOcrParams,
      execute: async (_id, params, signal) => {
        if (!runtimeCtx?.vfs) throw new Error("未绑定工作区 VFS");
        const bytes = await runtimeCtx.vfs.readBytes(params.path);
        const lower = params.path.toLowerCase();
        const mode = params.mode ?? "auto";

        if (lower.endsWith(".pdf")) {
          const targetPages = (params.pages && params.pages.length > 0 ? params.pages : [1, 2, 3]).slice(0, 6);
          const rendered = await renderPdfPagesToPngDataUrls(bytes, targetPages, 1.5);
          if (rendered.length === 0) {
            throw new Error(`未在 ${params.path} 中找到指定有效页码`);
          }
          const pageResults: Array<{ pageNumber: number; engine: string; text: string }> = [];
          for (const pageImg of rendered) {
            const out = await recognizeImageWithFallback(runtimeCtx, pageImg.dataUrl, {
              mode,
              prompt: params.prompt,
              signal,
            });
            pageResults.push({
              pageNumber: pageImg.pageNumber,
              engine: out.engine,
              text: out.text,
            });
          }
          return {
            content: [
              {
                type: "text",
                text: pageResults
                  .map((r) => `## 第 ${r.pageNumber} 页（引擎：${r.engine}）\n${r.text}`)
                  .join("\n\n"),
              },
            ],
            details: { path: params.path, pages: pageResults },
          };
        }

        const mime = lower.endsWith(".jpg") || lower.endsWith(".jpeg")
          ? "image/jpeg"
          : lower.endsWith(".webp")
            ? "image/webp"
            : "image/png";
        const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
        const out = await recognizeImageWithFallback(runtimeCtx, dataUrl, {
          mode,
          prompt: params.prompt,
          signal,
        });

        return {
          content: [
            {
              type: "text",
              text: `图像识别结果（${params.path} · 引擎：${out.engine}）：\n\n${out.text}`,
            },
          ],
          details: { path: params.path, engine: out.engine },
        };
      },
    };

    api.registerTool(visionOcrTool);
    api.injectSystemPrompt(
      "- 读取扫描版 PDF 发现 `suspectedScannedPages` 或提取文本几乎为空时，立即调用 `vision_ocr` 识别对应页面。"
    );
  },
};
