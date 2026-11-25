import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentMessage,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import type {
  AfterToolCallHook,
  BeforeToolCallHook,
  ExtensionAPI,
  ExtensionInfo,
  ExtensionRuntimeContext,
  MizurisuExtension,
  TransformContextHook,
} from "./types";

/** 估算单个工具定义（名称 + 描述 + JSON Schema）占用的上下文 Token 数（约 3 字符 / token） */
export function estimateToolSchemaTokens(tool: Pick<AgentTool<any>, "name" | "description" | "parameters">): number {
  const schemaLen = JSON.stringify(tool.parameters || {}).length;
  const chars = (tool.name || "").length + (tool.description || "").length + schemaLen + 24;
  return Math.max(12, Math.ceil(chars / 3));
}

export function isExtensionEnabled(
  ext: Pick<MizurisuExtension, "id" | "defaultEnabled">,
  enabledPlugins?: Record<string, boolean>
): boolean {
  if (!enabledPlugins || !(ext.id in enabledPlugins)) {
    return ext.defaultEnabled;
  }
  return enabledPlugins[ext.id] !== false;
}

interface CollectedExtensionState {
  tools: AgentTool<any>[];
  promptSnippets: string[];
  beforeHooks: BeforeToolCallHook[];
  afterHooks: AfterToolCallHook[];
  transformHooks: TransformContextHook[];
  perPluginToolTokens: Record<string, number>;
  perPluginToolNames: Record<string, string[]>;
}

/**
 * Mizurisu-Pi 轻量插件宿主：
 * 复用 @earendil-works/pi-agent-core 的工具与生命周期钩子，实现零 Node.js、三端通用的插件注册与隔离启停。
 */
export class ExtensionHost {
  private readonly extensions: MizurisuExtension[] = [];

  constructor(initialExtensions: MizurisuExtension[] = []) {
    for (const ext of initialExtensions) {
      this.registerExtension(ext);
    }
  }

  registerExtension(ext: MizurisuExtension): void {
    const idx = this.extensions.findIndex((item) => item.id === ext.id);
    if (idx >= 0) {
      this.extensions[idx] = ext;
    } else {
      this.extensions.push(ext);
    }
  }

  getRegisteredExtensions(): MizurisuExtension[] {
    return [...this.extensions];
  }

  resolveActiveExtensions(enabledPlugins?: Record<string, boolean>): MizurisuExtension[] {
    return this.extensions.filter((ext) => isExtensionEnabled(ext, enabledPlugins));
  }

  /**
   * 静态或按需扫描所有已注册插件的元数据与工具 Token 开销（供设置中心与统计面板展示）。
   * 禁用插件不会注入任何运行时上下文，此处仅用于透明展示其潜在开销。
   */
  listExtensions(
    enabledPlugins?: Record<string, boolean>,
    runtimeCtx?: ExtensionRuntimeContext
  ): ExtensionInfo[] {
    return this.extensions.map((ext) => {
      const enabled = isExtensionEnabled(ext, enabledPlugins);
      const localTools: AgentTool<any>[] = [];
      const dryApi: ExtensionAPI = {
        registerTool: (tool) => localTools.push(tool),
        injectSystemPrompt: () => undefined,
        onBeforeToolCall: () => undefined,
        onAfterToolCall: () => undefined,
        onTransformContext: () => undefined,
      };
      ext.register(dryApi, runtimeCtx);

      const estimatedToolTokens = localTools.reduce(
        (sum, t) => sum + estimateToolSchemaTokens(t),
        0
      );

      return {
        id: ext.id,
        name: ext.name,
        description: ext.description,
        category: ext.category,
        enabled,
        defaultEnabled: ext.defaultEnabled,
        toolNames: localTools.map((t) => t.name),
        estimatedToolTokens,
      };
    });
  }

  /** 按当前启停开关绑定运行期上下文并收集工具、提示词与钩子（关闭的插件 0 开销跳过） */
  compile(runtimeCtx: ExtensionRuntimeContext): CollectedExtensionState {
    const tools: AgentTool<any>[] = [];
    const promptSnippets: string[] = [];
    const beforeHooks: BeforeToolCallHook[] = [];
    const afterHooks: AfterToolCallHook[] = [];
    const transformHooks: TransformContextHook[] = [];
    const perPluginToolTokens: Record<string, number> = {};
    const perPluginToolNames: Record<string, string[]> = {};

    const active = this.resolveActiveExtensions(runtimeCtx.settings.enabledPlugins);

    for (const ext of active) {
      let extTokens = 0;
      const extToolNames: string[] = [];

      const api: ExtensionAPI = {
        registerTool: (tool) => {
          tools.push(tool);
          extToolNames.push(tool.name);
          extTokens += estimateToolSchemaTokens(tool);
        },
        injectSystemPrompt: (snippet) => {
          const clean = snippet.trim();
          if (clean) promptSnippets.push(clean);
        },
        onBeforeToolCall: (hook) => beforeHooks.push(hook),
        onAfterToolCall: (hook) => afterHooks.push(hook),
        onTransformContext: (hook) => transformHooks.push(hook),
      };

      ext.register(api, runtimeCtx);
      perPluginToolTokens[ext.id] = extTokens;
      perPluginToolNames[ext.id] = extToolNames;
    }

    return {
      tools,
      promptSnippets,
      beforeHooks,
      afterHooks,
      transformHooks,
      perPluginToolTokens,
      perPluginToolNames,
    };
  }

  async runBeforeToolCall(
    hooks: BeforeToolCallHook[],
    context: BeforeToolCallContext,
    runtimeCtx: ExtensionRuntimeContext,
    signal?: AbortSignal
  ): Promise<BeforeToolCallResult | undefined> {
    for (const hook of hooks) {
      const res = await hook(context, runtimeCtx, signal);
      if (res?.block) {
        return res;
      }
    }
    return undefined;
  }

  async runAfterToolCall(
    hooks: AfterToolCallHook[],
    context: AfterToolCallContext,
    runtimeCtx: ExtensionRuntimeContext,
    signal?: AbortSignal
  ): Promise<AfterToolCallResult | undefined> {
    let finalResult: AfterToolCallResult | undefined;
    for (const hook of hooks) {
      const res = await hook(context, runtimeCtx, signal);
      if (res) {
        finalResult = { ...finalResult, ...res };
      }
    }
    return finalResult;
  }

  async runTransformContext(
    hooks: TransformContextHook[],
    messages: AgentMessage[],
    runtimeCtx: ExtensionRuntimeContext,
    signal?: AbortSignal
  ): Promise<AgentMessage[]> {
    let current = messages;
    for (const hook of hooks) {
      current = await hook(current, runtimeCtx, signal);
    }
    return current;
  }
}
