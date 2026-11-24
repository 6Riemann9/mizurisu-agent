import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { WorkspaceVFS } from "../../storage/workspace-vfs";
import { createDesktopTools } from "./desktop-tools";
import { createFsTools } from "./fs-tools";
import { createOfficeTools } from "./office-tools";
import { createSandboxTools } from "./sandbox-tools";

export function buildAgentTools(vfs: WorkspaceVFS): AgentTool[] {
  return [
    ...createFsTools(vfs),
    ...createOfficeTools(vfs),
    ...createSandboxTools(vfs),
    ...createDesktopTools(vfs),
  ];
}
