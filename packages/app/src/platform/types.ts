import type { PlatformKind } from "../types";

export interface ImportedNativeFile {
  path: string;
  data: Uint8Array;
}

export interface NativeFileMeta {
  path: string;
  name: string;
  size: number;
  updatedAt: number;
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
  /** 无 Cookie 抓取网页内容（桌面端走 Rust 原生 HTTP 绕过 CORS） */
  fetchWebUrl?(url: string): Promise<SessionResponse>;
  /** 调用桌面端系统原生离线 OCR 提取图片文字（0 体积增量） */
  nativeOcrImage?(imageBase64: string, lang?: string): Promise<string>;
  /** 清理本地持久化的会话 Cookie（桌面端 reqwest CookieStore） */
  clearSessionCookies?(): Promise<void>;
  /** 导出/下载文件或调用系统分享面板 */
  exportFile(filename: string, data: Uint8Array, mimeType: string): Promise<void>;
  /** 选择本机目录（Desktop Tauri dialog 或 Web File System Access API） */
  pickNativeDirectory(): Promise<{ path: string; files: ImportedNativeFile[] } | null>;
  /** 仅选择本机目录路径（真本地文件夹直连模式，不一次性拷贝全目录） */
  pickNativeDirectoryPath?(): Promise<string | null>;
  /** 列出本地绑定目录全部文件元数据（跳过构建/隐藏目录） */
  listNativeDirectoryFiles?(rootPath: string): Promise<NativeFileMeta[]>;
  /** 按需从本地绑定目录读取文件字节 */
  readFromNativeDirectory?(rootPath: string, relativePath: string): Promise<Uint8Array>;
  /** 将文件同步写回已挂载的本机目录（如支持） */
  writeToNativeDirectory?(dirHandleOrPath: string, relativePath: string, data: Uint8Array): Promise<void>;
  /** 从本地绑定目录同步删除文件（消除幽灵文件） */
  deleteFromNativeDirectory?(rootPath: string, relativePath: string): Promise<void>;
  /** 在本地绑定目录同步重命名/移动文件 */
  renameInNativeDirectory?(rootPath: string, oldRelativePath: string, newRelativePath: string): Promise<void>;
  /** 监听本地目录变化并在变更时触发回调，返回取消监听函数 */
  watchNativeDirectory?(rootPath: string, onChanged: () => void): Promise<() => void>;
  /** 仅 Desktop 支持：在指定或沙箱工作目录执行 Shell 命令 */
  runShellCommand?(command: string, cwd?: string): Promise<ShellExecutionResult>;
}
