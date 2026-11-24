import { CapacitorPlatformAdapter } from "./capacitor-adapter";
import { TauriPlatformAdapter } from "./tauri-adapter";
import type { PlatformAdapter } from "./types";
import { WebPlatformAdapter } from "./web-adapter";

export type { ImportedNativeFile, PlatformAdapter, ShellExecutionResult } from "./types";

let cachedAdapter: PlatformAdapter | null = null;

export function detectPlatformKind(): "desktop" | "mobile" | "web" {
  if (typeof window === "undefined") return "web";
  const w = window as unknown as {
    __TAURI_INTERNALS__?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  if (w.__TAURI_INTERNALS__) return "desktop";
  if (w.Capacitor?.isNativePlatform?.()) return "mobile";
  return "web";
}

export function getPlatformAdapter(): PlatformAdapter {
  if (cachedAdapter) return cachedAdapter;
  const kind = detectPlatformKind();
  if (kind === "desktop") {
    cachedAdapter = new TauriPlatformAdapter();
  } else if (kind === "mobile") {
    cachedAdapter = new CapacitorPlatformAdapter();
  } else {
    cachedAdapter = new WebPlatformAdapter();
  }
  return cachedAdapter;
}
