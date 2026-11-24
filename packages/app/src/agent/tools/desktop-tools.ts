import type { AgentTool } from "@earendil-works/pi-agent-core";
import { obj, opt, str } from "@earendil-works/pi-schema";
import { getPlatformAdapter } from "../../platform";
import type { WorkspaceVFS } from "../../storage/workspace-vfs";

const shellParams = obj({
  command: str({ description: "要执行的本地命令（Windows 下在 PowerShell/cmd，macOS/Linux 下在 sh）" }),
  cwd: opt(str({ description: "可选工作目录，省略时使用当前已挂载的本机目录" })),
});

export function createDesktopTools(vfs: WorkspaceVFS): AgentTool[] {
  const platform = getPlatformAdapter();
  if (!platform.canRunShell || !platform.runShellCommand) {
    return [];
  }

  const runShellTool: AgentTool<typeof shellParams> = {
    name: "run_shell_command",
    label: "执行本地 Shell 命令",
    description: "仅桌面端可用：在用户批准后执行本机命令，返回退出码、stdout 与 stderr。",
    parameters: shellParams,
    execute: async (_id, params) => {
      const targetCwd = params.cwd || vfs.getMountedNativeDir();
      const res = await platform.runShellCommand!(params.command, targetCwd);
      return {
        content: [
          {
            type: "text",
            text: `Exit Code: ${res.exitCode}\n--- STDOUT ---\n${res.stdout || "(空)"}\n--- STDERR ---\n${res.stderr || "(空)"}`,
          },
        ],
        details: { exitCode: res.exitCode },
        isError: res.exitCode !== 0,
      };
    },
  };

  return [runShellTool];
}
