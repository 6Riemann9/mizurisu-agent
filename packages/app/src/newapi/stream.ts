import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

type ApiModule = {
  streamSimple: (
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions
  ) => AssistantMessageEventStream;
};

async function loadBrowserSafeApi(api: Api): Promise<ApiModule> {
  switch (api) {
    case "openai-responses":
      return (await import("@earendil-works/pi-ai/api/openai-responses")) as unknown as ApiModule;
    case "anthropic-messages":
      return (await import("@earendil-works/pi-ai/api/anthropic-messages")) as unknown as ApiModule;
    case "google-generative-ai":
      return (await import("@earendil-works/pi-ai/api/google-generative-ai")) as unknown as ApiModule;
    case "openai-completions":
    default:
      return (await import("@earendil-works/pi-ai/api/openai-completions")) as unknown as ApiModule;
  }
}

function makeErrorAssistantMessage(
  model: Model<Api>,
  errorMessage: string,
  reason: "error" | "aborted"
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: reason,
    errorMessage,
    timestamp: Date.now(),
  };
}

/**
 * 构建供 Pi Agent 使用的浏览器安全 StreamFn：
 * - 按 model.api 动态按需加载 4 个浏览器原生安全的 pi-ai 子模块
 * - 注入平台原生 fetch（Tauri / Capacitor 自动绕过 CORS）
 * - 严格遵守 StreamFn 契约：绝不向外抛异常，错误通过 EventStream 发送
 */
export function createNewApiStreamFn(getFetch: () => typeof fetch): StreamFn {
  return (model, context, options) => {
    const outer = new AssistantMessageEventStream();

    (async () => {
      if (!model.baseUrl) {
        throw new Error("未配置 New-API 站点地址，请先在设置中填写");
      }
      if (!options?.apiKey) {
        throw new Error("未配置 New-API Key，请先在设置中填写");
      }

      const apiMod = await loadBrowserSafeApi(model.api);
      const inner = apiMod.streamSimple(model, context, {
        ...options,
        fetch: options.fetch ?? getFetch(),
      });

      let finalMessage: AssistantMessage | undefined;
      for await (const event of inner) {
        outer.push(event);
        if (event.type === "done") finalMessage = event.message;
        else if (event.type === "error") finalMessage = event.error;
      }
      if (!finalMessage && typeof inner.result === "function") {
        finalMessage = await inner.result();
      }
      outer.end(finalMessage);
    })().catch((err) => {
      const reason = options?.signal?.aborted ? "aborted" : "error";
      const message = makeErrorAssistantMessage(
        model,
        err instanceof Error ? err.message : String(err),
        reason
      );
      outer.push({ type: "error", reason, error: message });
      outer.end(message);
    });

    return outer;
  };
}
