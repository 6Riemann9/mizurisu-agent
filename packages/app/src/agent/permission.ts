import type { PermissionMode } from "../types";

export const PERMISSION_MODE_ORDER: PermissionMode[] = [
  "plan",
  "ask",
  "auto-edits",
  "full-auto",
];

export interface PermissionModeMeta {
  mode: PermissionMode;
  label: string;
  shortLabel: string;
  description: string;
  tone: "indigo" | "neutral" | "accent" | "warning";
}

export const PERMISSION_MODE_META: Record<PermissionMode, PermissionModeMeta> = {
  plan: {
    mode: "plan",
    label: "Plan 只读规划",
    shortLabel: "Plan 规划",
    description: "仅允许只读调研与方案输出，禁止写文档、删文件或运行命令",
    tone: "indigo",
  },
  ask: {
    mode: "ask",
    label: "Ask 每次询问",
    shortLabel: "Ask 询问",
    description: "新建或修改文档、删文件及外部命令前均需您弹窗确认",
    tone: "neutral",
  },
  "auto-edits": {
    mode: "auto-edits",
    label: "Auto Edits 自动改文档",
    shortLabel: "Auto Edits",
    description: "自动写入/编辑文档（留快照可回滚），删文件/Shell/MCP 仍询问",
    tone: "accent",
  },
  "full-auto": {
    mode: "full-auto",
    label: "Full Auto 全自动",
    shortLabel: "Full Auto",
    description: "自动放行除受保护原件外的所有工具操作（谨慎开启）",
    tone: "warning",
  },
};

/** 创建或修改工作区文件的工具集合（不包括 delete_file） */
export const WRITE_FILE_TOOLS = new Set([
  "write_text_file",
  "edit_text_file",
  "excel_create",
  "excel_update",
  "word_create",
  "word_update",
  "ppt_create",
  "ppt_update",
  "slides_create",
  "slides_update_slide",
  "pdf_create",
  "pdf_merge",
  "pdf_split",
  "pdf_watermark",
  "markdown_export",
]);

/** 判断工具调用是否属于高风险删除、宿主机命令或外部 MCP 写入/调用 */
export function isDestructiveOrExternalTool(
  toolName: string,
  args?: Record<string, unknown>
): boolean {
  if (toolName === "run_shell_command" || toolName === "delete_file") {
    return true;
  }
  if (toolName === "mcp_proxy") {
    return args?.action === "call_tool";
  }
  return false;
}

/** 判断工具调用是否会对工作区或外部状态产生变更 */
export function isWriteOrMutatingTool(
  toolName: string,
  args?: Record<string, unknown>
): boolean {
  return WRITE_FILE_TOOLS.has(toolName) || isDestructiveOrExternalTool(toolName, args);
}

/** 按 Shift+Tab 顺序循环切换执行模式 */
export function cyclePermissionMode(current: PermissionMode = "auto-edits"): PermissionMode {
  const idx = PERMISSION_MODE_ORDER.indexOf(current);
  if (idx < 0) return "auto-edits";
  return PERMISSION_MODE_ORDER[(idx + 1) % PERMISSION_MODE_ORDER.length];
}

export type PermissionDecision =
  | { decision: "allow" }
  | { decision: "block"; reason: string }
  | {
      decision: "ask";
      title: string;
      description: string;
      allowSessionToolOption: boolean;
    };

function buildAskPromptDetails(
  toolName: string,
  args?: Record<string, unknown>
): { title: string; description: string; allowSessionToolOption: boolean } {
  if (toolName === "run_shell_command") {
    return {
      title: "确认执行本机 Shell 命令",
      description: "Agent 请求在您的电脑上执行以下命令，请确认安全后再放行：",
      allowSessionToolOption: true,
    };
  }
  if (toolName === "delete_file") {
    return {
      title: "确认删除工作区文件",
      description: "Agent 请求删除工作区中的以下文件（删除前仍会保留快照）：",
      allowSessionToolOption: true,
    };
  }
  if (toolName === "mcp_proxy") {
    const serverName = typeof args?.server === "string" ? args.server : "MCP 服务";
    const remoteTool = typeof args?.tool === "string" ? args.tool : "远程工具";
    return {
      title: `确认调用外部 MCP 工具（${serverName}）`,
      description: `Agent 请求调用远程服务「${serverName}」的工具 \`${remoteTool}\`，请确认参数安全后再放行：`,
      allowSessionToolOption: true,
    };
  }
  const target =
    (typeof args?.path === "string" && args.path) ||
    (typeof args?.outputPath === "string" && args.outputPath) ||
    "工作区文件";
  return {
    title: `Ask 模式：确认执行写入操作（${toolName}）`,
    description: `当前处于「Ask 每次询问」模式，Agent 请求写入或修改「${target}」（操作前会自动留存快照）：`,
    allowSessionToolOption: true,
  };
}

/** 根据当前执行模式、工具类型与本会话已记住的放行列表评估工具权限 */
export function evaluateToolPermission(params: {
  toolName: string;
  args?: Record<string, unknown>;
  mode: PermissionMode;
  sessionAllowedTools?: ReadonlySet<string> | string[];
  autoApproveDelete?: boolean;
}): PermissionDecision {
  const { toolName, args, mode, sessionAllowedTools, autoApproveDelete } = params;
  const mutating = isWriteOrMutatingTool(toolName, args);

  if (!mutating) {
    return { decision: "allow" };
  }

  if (mode === "plan") {
    return {
      decision: "block",
      reason:
        `当前处于 Plan 只读规划模式，已拦截变更操作 \`${toolName}\`。` +
        `请先仅使用只读工具完成调研并输出结构化执行方案，待用户点击「批准并开始执行」后再进行修改。`,
    };
  }

  if (mode === "full-auto") {
    return { decision: "allow" };
  }

  const allowedSet =
    sessionAllowedTools instanceof Set
      ? sessionAllowedTools
      : new Set(sessionAllowedTools || []);

  if (allowedSet.has(toolName)) {
    return { decision: "allow" };
  }

  if (mode === "ask") {
    if (toolName === "delete_file" && autoApproveDelete) {
      return { decision: "allow" };
    }
    return {
      decision: "ask",
      ...buildAskPromptDetails(toolName, args),
    };
  }

  // auto-edits 模式：文档创建/写入直接放行（自动保留快照），高危删除/Shell/MCP 外部调用仍需确认
  if (WRITE_FILE_TOOLS.has(toolName)) {
    return { decision: "allow" };
  }

  if (toolName === "delete_file" && autoApproveDelete) {
    return { decision: "allow" };
  }

  if (isDestructiveOrExternalTool(toolName, args)) {
    return {
      decision: "ask",
      ...buildAskPromptDetails(toolName, args),
    };
  }

  return { decision: "allow" };
}
