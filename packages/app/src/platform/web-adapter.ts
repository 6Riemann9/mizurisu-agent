import type {
  ImportedNativeFile,
  PlatformAdapter,
  SessionRequestOptions,
  SessionResponse,
} from "./types";

interface FileSystemDirectoryHandleLike {
  name: string;
  values(): AsyncIterableIterator<FileSystemHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandleLike>;
}

interface FileSystemHandleLike {
  kind: "file" | "directory";
  name: string;
}

interface FileSystemFileHandleLike extends FileSystemHandleLike {
  kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }>;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "target", ".next"]);
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_IMPORT_FILES = 200;

async function collectDirectoryFiles(
  dirHandle: FileSystemDirectoryHandleLike,
  prefix: string,
  out: ImportedNativeFile[]
): Promise<void> {
  for await (const entry of dirHandle.values()) {
    if (out.length >= MAX_IMPORT_FILES) return;
    if (entry.kind === "directory") {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const subDir = await dirHandle.getDirectoryHandle(entry.name);
      await collectDirectoryFiles(subDir, prefix ? `${prefix}/${entry.name}` : entry.name, out);
    } else if (entry.kind === "file") {
      const fileHandle = entry as FileSystemFileHandleLike;
      const file = await fileHandle.getFile();
      if (file.size <= MAX_IMPORT_BYTES) {
        const buf = new Uint8Array(await file.arrayBuffer());
        out.push({
          path: prefix ? `${prefix}/${entry.name}` : entry.name,
          data: buf,
        });
      }
    }
  }
}

export class WebPlatformAdapter implements PlatformAdapter {
  readonly kind = "web" as const;
  readonly label = "Web / PWA";
  readonly canRunShell = false;
  readonly canMountNativeDir =
    typeof window !== "undefined" && "showDirectoryPicker" in window;

  getFetch(): typeof fetch {
    return globalThis.fetch.bind(globalThis);
  }

  async sessionRequest(
    url: string,
    options: SessionRequestOptions = {}
  ): Promise<SessionResponse> {
    const res = await globalThis.fetch(url, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.body,
      credentials: "include",
    });
    const text = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      text,
    };
  }

  async clearSessionCookies(): Promise<void> {
    // 浏览器环境由服务端 Set-Cookie / /api/user/logout 管理 HttpOnly Cookie
  }

  async exportFile(filename: string, data: Uint8Array, mimeType: string): Promise<void> {
    const copy = new Uint8Array(data);
    const blob = new Blob([copy], { type: mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.split("/").pop() || filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async pickNativeDirectory(): Promise<{ path: string; files: ImportedNativeFile[] } | null> {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike> })
      .showDirectoryPicker;
    if (!picker) return null;
    try {
      const handle = await picker();
      const files: ImportedNativeFile[] = [];
      await collectDirectoryFiles(handle, "", files);
      return { path: handle.name, files };
    } catch {
      return null;
    }
  }
}
