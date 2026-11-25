import { ExtensionHost } from "./host";
import { handoffExtension } from "./builtin/handoff";
import { mcpAdapterExtension } from "./builtin/mcp-adapter";
import { memoryExtension } from "./builtin/memory";
import { officeProExtension } from "./builtin/office-pro";
import { protectedPathsExtension } from "./builtin/protected-paths";
import { questionnaireExtension } from "./builtin/questionnaire";
import { createSubagentsExtension } from "./builtin/subagents";
import { todoListExtension } from "./builtin/todo-list";
import { tokenBurdenExtension } from "./builtin/token-burden";
import { visionOcrExtension } from "./builtin/vision-ocr";
import { webAccessExtension } from "./builtin/web-access";
import type { MizurisuExtension } from "./types";

export * from "./types";
export * from "./host";
export { buildHandoffFromSession, buildHandoffPrompt } from "./builtin/handoff";
export {
  getWorkspaceMemoryKey,
  readMemoryScopes,
  searchWorkspaceFiles,
  writeMemoryScope,
} from "./builtin/memory";
export {
  callMcpServerTool,
  listMcpServerTools,
  parseJsonRpcResponsePayload,
} from "./builtin/mcp-adapter";
export { matchesProtectedPath } from "./builtin/protected-paths";
export { runSingleSubagent } from "./builtin/subagents";
export { estimateTokenBurden, estimateCostUsd, getEstimatedModelPricing } from "./builtin/token-burden";
export { formatTodoSummaryForContext, mergeTodos } from "./builtin/todo-list";
export { recognizeImageWithFallback } from "./builtin/vision-ocr";
export {
  htmlToReadableMarkdown,
  parseBingSearchResults,
  parseDuckDuckGoHtmlResults,
  parseSearxngJsonResults,
} from "./builtin/web-access";

const subagentsExtension: MizurisuExtension = createSubagentsExtension(
  () => BUILTIN_EXTENSIONS
);

export const BUILTIN_EXTENSIONS: MizurisuExtension[] = [
  todoListExtension,
  questionnaireExtension,
  handoffExtension,
  tokenBurdenExtension,
  memoryExtension,
  webAccessExtension,
  subagentsExtension,
  protectedPathsExtension,
  officeProExtension,
  visionOcrExtension,
  mcpAdapterExtension,
];

export function createDefaultExtensionHost(): ExtensionHost {
  return new ExtensionHost(BUILTIN_EXTENSIONS);
}
