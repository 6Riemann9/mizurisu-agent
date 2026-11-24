import type {
  ImportedNativeFile,
  PlatformAdapter,
  SessionRequestOptions,
  SessionResponse,
} from "./types";

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export class CapacitorPlatformAdapter implements PlatformAdapter {
  readonly kind = "mobile" as const;
  readonly label = "Mobile (Capacitor)";
  readonly canRunShell = false;
  readonly canMountNativeDir = false;
  private cachedFetch: typeof fetch | null = null;

  getFetch(): typeof fetch {
    if (this.cachedFetch) return this.cachedFetch;
    // CapacitorHttp 在配置启用后会自动拦截 globalThis.fetch；此处保留标准接口便于扩展
    this.cachedFetch = globalThis.fetch.bind(globalThis);
    return this.cachedFetch;
  }

  async sessionRequest(
    url: string,
    options: SessionRequestOptions = {}
  ): Promise<SessionResponse> {
    const fetchImpl = this.getFetch();
    const res = await fetchImpl(url, {
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
    // 移动端 WebView Cookie 由原生容器与 /api/user/logout 管理
  }

  async exportFile(filename: string, data: Uint8Array, mimeType: string): Promise<void> {
    const safeName = (filename.split("/").pop() || "document").replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");
      const written = await Filesystem.writeFile({
        path: safeName,
        data: uint8ToBase64(data),
        directory: Directory.Cache,
        recursive: true,
      });
      await Share.share({
        title: safeName,
        url: written.uri,
        dialogTitle: `导出或分享 ${safeName}`,
      });
    } catch {
      const copy = new Uint8Array(data);
      const blob = new Blob([copy], { type: mimeType || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = safeName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async pickNativeDirectory(): Promise<{ path: string; files: ImportedNativeFile[] } | null> {
    return null;
  }
}
