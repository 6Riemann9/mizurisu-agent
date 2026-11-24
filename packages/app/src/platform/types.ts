import type { PlatformKind } from "../types";

export interface ImportedNativeFile {
  path: string;
  data: Uint8Array;
}

export interface ShellExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SessionRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface SessionResponse {
  status: number;
  ok: boolean;
  text: string;
}

export interface PlatformAdapter {
  readonly kind: PlatformKind;
  readonly label: string;
  readonly canRunShell: boolean;
  readonly canMountNativeDir: boolean;
  /** 优先使用无 CORS 原生 HTTP（Desktop / Mobile），Web 回退到 window.fetch */
  getFetch(): typeof fetch;
  /** 发送携带会话 Cookie 的 HTTP 请求（用于 New-API 账号登录与令牌管理） */
  sessionRequest(url: string, options?: SessionRequestOptions): Promise<SessionResponse>;
  /** 清理本地持久化的会话 Cookie（桌面端 reqwest CookieStore） */
  clearSessionCookies?(): Promise<void>;
  /** 导出/下载文件或调用系统分享面板 */
  exportFile(filename: string, data: Uint8Array, mimeType: string): Promise<void>;
  /** 选择本机目录（Desktop Tauri dialog 或 Web File System Access API） */
  pickNativeDirectory(): Promise<{ path: string; files: ImportedNativeFile[] } | null>;
  /** 将文件同步写回已挂载的本机目录（如支持） */
  writeToNativeDirectory?(dirHandleOrPath: string, relativePath: string, data: Uint8Array): Promise<void>;
  /** 仅 Desktop 支持：在指定或沙箱工作目录执行 Shell 命令 */
  runShellCommand?(command: string, cwd?: string): Promise<ShellExecutionResult>;
}
