import type {
  ImportedNativeFile,
  NativeFileMeta,
  PlatformAdapter,
  SessionRequestOptions,
  SessionResponse,
  ShellExecutionResult,
} from "./types";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "target", ".next"]);
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_IMPORT_FILES = 250;
const WINDOWS_RESERVED_NAME_RE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

export class TauriPlatformAdapter implements PlatformAdapter {
  readonly kind = "desktop" as const;
  readonly label = "Desktop (Tauri)";
  readonly canRunShell = true;
  readonly canMountNativeDir = true;
  private cachedFetch: typeof fetch | null = null;

  getFetch(): typeof fetch {
    if (this.cachedFetch) return this.cachedFetch;
    const wrapped: typeof fetch = async (input, init) => {
      try {
        const mod = await import("@tauri-apps/plugin-http");
        return await mod.fetch(input as RequestInfo | URL, init);
      } catch {
        return await globalThis.fetch(input, init);
      }
    };
    this.cachedFetch = wrapped;
    return wrapped;
  }

  async sessionRequest(
    url: string,
    options: SessionRequestOptions = {}
  ): Promise<SessionResponse> {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<SessionResponse>("newapi_session_request", {
        url,
        method: options.method || "GET",
        headers: options.headers ?? null,
        body: options.body ?? null,
      });
    } catch (err) {
      const hasTauriRuntime =
        typeof window !== "undefined" &&
        Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
      if (!hasTauriRuntime) {
        const res = await globalThis.fetch(url, {
          method: options.method || "GET",
          headers: options.headers,
          body: options.body,
          credentials: "include",
        });
        return {
          status: res.status,
          ok: res.ok,
          text: await res.text(),
        };
      }
      throw err;
    }
  }

  async clearSessionCookies(): Promise<void> {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<void>("newapi_clear_cookies");
    } catch (err) {
      const hasTauriRuntime =
        typeof window !== "undefined" &&
        Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
      if (!hasTauriRuntime) return;
      throw err;
    }
  }

  async fetchWebUrl(url: string): Promise<SessionResponse> {
    const hasTauriRuntime =
      typeof window !== "undefined" &&
      Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
    if (hasTauriRuntime) {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<SessionResponse>("fetch_web_url", {
        url,
        timeoutSecs: 15,
      });
    }
    const res = await globalThis.fetch(url);
    return {
      status: res.status,
      ok: res.ok,
      text: await res.text(),
    };
  }

  async nativeOcrImage(imageBase64: string, lang?: string): Promise<string> {
    const hasTauriRuntime =
      typeof window !== "undefined" &&
      Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
    if (!hasTauriRuntime) {
      throw new Error("NATIVE_OCR_UNAVAILABLE");
    }
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("native_ocr_image", {
      imageBase64,
      lang: lang || null,
    });
  }

  async exportFile(filename: string, data: Uint8Array, _mimeType: string): Promise<void> {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const target = await save({
      defaultPath: filename.split("/").pop() || filename,
    });
    if (!target) return;
    await writeFile(target, data);
  }

  async pickNativeDirectory(): Promise<{ path: string; files: ImportedNativeFile[] } | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readDir, readFile, stat } = await import("@tauri-apps/plugin-fs");
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return null;

    const files: ImportedNativeFile[] = [];
    const walk = async (absDir: string, relPrefix: string): Promise<void> => {
      if (files.length >= MAX_IMPORT_FILES) return;
      const entries = await readDir(absDir);
      for (const entry of entries) {
        if (files.length >= MAX_IMPORT_FILES) break;
        if (!entry.name || entry.name.startsWith(".")) continue;
        const childAbs = `${absDir.replace(/[\\/]+$/, "")}/${entry.name}`;
        const childRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory) {
          if (SKIP_DIRS.has(entry.name)) continue;
          await walk(childAbs, childRel);
        } else if (entry.isFile) {
          const info = await stat(childAbs);
          if (info.size <= MAX_IMPORT_BYTES) {
            const bytes = await readFile(childAbs);
            files.push({ path: childRel, data: new Uint8Array(bytes) });
          }
        }
      }
    };

    await walk(selected, "");
    return { path: selected, files };
  }

  async pickNativeDirectoryPath(): Promise<string | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    return selected && typeof selected === "string" ? selected : null;
  }

  async listNativeDirectoryFiles(rootPath: string): Promise<NativeFileMeta[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeFileMeta[]>("native_list_workspace_files", {
      root: rootPath,
    });
  }

  async readFromNativeDirectory(rootPath: string, relativePath: string): Promise<Uint8Array> {
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = await invoke<number[]>("native_read_workspace_file", {
      root: rootPath,
      relativePath,
    });
    return new Uint8Array(bytes);
  }

  async deleteFromNativeDirectory(rootPath: string, relativePath: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<void>("native_delete_workspace_file", {
      root: rootPath,
      relativePath,
    });
  }

  async renameInNativeDirectory(
    rootPath: string,
    oldRelativePath: string,
    newRelativePath: string
  ): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<void>("native_rename_workspace_file", {
      root: rootPath,
      oldRel: oldRelativePath,
      newRel: newRelativePath,
    });
  }

  async watchNativeDirectory(rootPath: string, onChanged: () => void): Promise<() => void> {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    await invoke<void>("native_watch_workspace_dir", { root: rootPath });
    const unlisten = await listen("workspace-fs-changed", () => {
      onChanged();
    });
    return () => {
      unlisten();
      invoke<void>("native_unwatch_workspace_dir").catch(() => undefined);
    };
  }

  async writeToNativeDirectory(
    rootPath: string,
    relativePath: string,
    data: Uint8Array
  ): Promise<void> {
    if (!rootPath || !rootPath.trim()) {
      throw new Error("无效的本地挂载根目录");
    }
    // 统一将反斜杠转为正斜杠后严格校验路径，拦截目录穿越与绝对/盘符路径
    const normalizedRel = relativePath.replace(/\\/g, "/");
    if (!normalizedRel) {
      throw new Error("写入挂载目录的相对路径不能为空");
    }
    if (normalizedRel.startsWith("/")) {
      throw new Error(`禁止使用绝对路径写入挂载目录: ${relativePath}`);
    }
    if (/^[a-zA-Z]:/.test(normalizedRel)) {
      throw new Error(`禁止使用包含盘符的路径写入挂载目录: ${relativePath}`);
    }
    if (normalizedRel.includes("\0")) {
      throw new Error(`路径包含非法空字符: ${relativePath}`);
    }
    const parts = normalizedRel.split("/");
    if (
      parts.some(
        (seg) =>
          seg === "" ||
          seg === "." ||
          seg === ".." ||
          seg.endsWith(" ") ||
          seg.endsWith(".") ||
          WINDOWS_RESERVED_NAME_RE.test(seg)
      )
    ) {
      throw new Error(`检测到非法路径段（空段、穿越、保留设备名或末尾空格/句点）: ${relativePath}`);
    }

    const { mkdir, writeFile } = await import("@tauri-apps/plugin-fs");
    const normalizedRoot = rootPath.replace(/[\\/]+$/, "");
    const cleanRel = parts.join("/");
    if (parts.length > 1) {
      const parent = `${normalizedRoot}/${parts.slice(0, -1).join("/")}`;
      await mkdir(parent, { recursive: true });
    }
    await writeFile(`${normalizedRoot}/${cleanRel}`, data);
  }

  async runShellCommand(command: string, cwd?: string): Promise<ShellExecutionResult> {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<ShellExecutionResult>("run_workspace_command", {
      command,
      cwd: cwd || null,
    });
  }
}
