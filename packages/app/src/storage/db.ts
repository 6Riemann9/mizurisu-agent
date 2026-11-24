import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  AppSettings,
  ChatSession,
  FileSnapshot,
  NewApiConfig,
  SkillTemplate,
  WorkspaceFileRecord,
} from "../types";

interface MizurisuAgentSchema extends DBSchema {
  kv: {
    key: string;
    value: unknown;
  };
  sessions: {
    key: string;
    value: ChatSession;
    indexes: { "by-updated": number };
  };
  files: {
    key: string;
    value: WorkspaceFileRecord;
    indexes: { "by-updated": number };
  };
  snapshots: {
    key: string;
    value: FileSnapshot;
    indexes: { "by-path": string; "by-created": number };
  };
  skills: {
    key: string;
    value: SkillTemplate;
  };
}

const DB_NAME = "mizurisu-agent-db";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<MizurisuAgentSchema>> | null = null;

const memoryFallback = {
  kv: new Map<string, unknown>(),
  sessions: new Map<string, ChatSession>(),
  files: new Map<string, WorkspaceFileRecord>(),
  snapshots: new Map<string, FileSnapshot>(),
  skills: new Map<string, SkillTemplate>(),
};

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

export async function getDb(): Promise<IDBPDatabase<MizurisuAgentSchema> | null> {
  if (!hasIndexedDb()) return null;
  if (!dbPromise) {
    dbPromise = openDB<MizurisuAgentSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("kv")) {
          db.createObjectStore("kv");
        }
        if (!db.objectStoreNames.contains("sessions")) {
          const s = db.createObjectStore("sessions", { keyPath: "id" });
          s.createIndex("by-updated", "updatedAt");
        }
        if (!db.objectStoreNames.contains("files")) {
          const f = db.createObjectStore("files", { keyPath: "path" });
          f.createIndex("by-updated", "updatedAt");
        }
        if (!db.objectStoreNames.contains("snapshots")) {
          const sn = db.createObjectStore("snapshots", { keyPath: "id" });
          sn.createIndex("by-path", "path");
          sn.createIndex("by-created", "createdAt");
        }
        if (!db.objectStoreNames.contains("skills")) {
          db.createObjectStore("skills", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  if (!db) return memoryFallback.kv.get(key) as T | undefined;
  return (await db.get("kv", key)) as T | undefined;
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryFallback.kv.set(key, value);
    return;
  }
  await db.put("kv", value, key);
}

export async function loadAllSessions(): Promise<ChatSession[]> {
  const db = await getDb();
  if (!db) {
    return [...memoryFallback.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  const list = await db.getAllFromIndex("sessions", "by-updated");
  return list.reverse();
}

export async function saveSession(session: ChatSession): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryFallback.sessions.set(session.id, session);
    return;
  }
  await db.put("sessions", session);
}

export async function deleteSessionById(id: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryFallback.sessions.delete(id);
    return;
  }
  await db.delete("sessions", id);
}

export async function dbListFiles(): Promise<WorkspaceFileRecord[]> {
  const db = await getDb();
  if (!db) {
    return [...memoryFallback.files.values()].sort((a, b) => a.path.localeCompare(b.path));
  }
  const list = await db.getAll("files");
  return list.sort((a, b) => a.path.localeCompare(b.path));
}

export async function dbGetFile(path: string): Promise<WorkspaceFileRecord | undefined> {
  const db = await getDb();
  if (!db) return memoryFallback.files.get(path);
  return await db.get("files", path);
}

export async function dbPutFile(record: WorkspaceFileRecord): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryFallback.files.set(record.path, record);
    return;
  }
  await db.put("files", record);
}

export async function dbDeleteFile(path: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryFallback.files.delete(path);
    return;
  }
  await db.delete("files", path);
}

export async function dbAddSnapshot(snapshot: FileSnapshot, maxPerFile = 15): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryFallback.snapshots.set(snapshot.id, snapshot);
    const samePath = [...memoryFallback.snapshots.values()]
      .filter((s) => s.path === snapshot.path)
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const old of samePath.slice(maxPerFile)) {
      memoryFallback.snapshots.delete(old.id);
    }
    return;
  }
  await db.put("snapshots", snapshot);
  const existing = await db.getAllFromIndex("snapshots", "by-path", snapshot.path);
  if (existing.length > maxPerFile) {
    existing.sort((a, b) => b.createdAt - a.createdAt);
    const tx = db.transaction("snapshots", "readwrite");
    for (const stale of existing.slice(maxPerFile)) {
      await tx.store.delete(stale.id);
    }
    await tx.done;
  }
}

export async function dbGetSnapshots(path: string): Promise<FileSnapshot[]> {
  const db = await getDb();
  if (!db) {
    return [...memoryFallback.snapshots.values()]
      .filter((s) => s.path === path)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  const items = await db.getAllFromIndex("snapshots", "by-path", path);
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function dbListCustomSkills(): Promise<SkillTemplate[]> {
  const db = await getDb();
  if (!db) return [...memoryFallback.skills.values()];
  return await db.getAll("skills");
}

export async function dbSaveCustomSkill(skill: SkillTemplate): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryFallback.skills.set(skill.id, skill);
    return;
  }
  await db.put("skills", skill);
}

export async function dbDeleteCustomSkill(id: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryFallback.skills.delete(id);
    return;
  }
  await db.delete("skills", id);
}

export interface BackupBundle {
  version: 1;
  exportedAt: number;
  secretsRedacted?: boolean;
  config?: NewApiConfig;
  settings?: AppSettings;
  sessions: ChatSession[];
  skills: SkillTemplate[];
  files: Array<{
    path: string;
    name: string;
    mimeType: string;
    size: number;
    updatedAt: number;
    category: WorkspaceFileRecord["category"];
    base64: string;
  }>;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export async function exportBackupBundle(options?: {
  includeSecrets?: boolean;
}): Promise<BackupBundle> {
  const includeSecrets = options?.includeSecrets === true;
  const [rawConfig, settings, sessions, skills, files] = await Promise.all([
    kvGet<NewApiConfig>("newapi_config"),
    kvGet<AppSettings>("app_settings"),
    loadAllSessions(),
    dbListCustomSkills(),
    dbListFiles(),
  ]);
  // 默认脱敏导出：避免备份 JSON 意外明文泄露 apiKey
  const config =
    rawConfig && !includeSecrets ? { ...rawConfig, apiKey: "" } : rawConfig;
  return {
    version: 1,
    exportedAt: Date.now(),
    secretsRedacted: !includeSecrets,
    config,
    settings,
    sessions,
    skills,
    files: files.map((f) => ({
      path: f.path,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      updatedAt: f.updatedAt,
      category: f.category,
      base64: toBase64(f.data),
    })),
  };
}

export async function importBackupBundle(bundle: BackupBundle): Promise<void> {
  if (bundle.version !== 1) {
    throw new Error("不支持的备份文件版本");
  }
  if (bundle.config) await kvSet("newapi_config", bundle.config);
  if (bundle.settings) await kvSet("app_settings", bundle.settings);
  for (const session of bundle.sessions || []) {
    await saveSession(session);
  }
  for (const skill of bundle.skills || []) {
    await dbSaveCustomSkill(skill);
  }
  for (const file of bundle.files || []) {
    const bytes = fromBase64(file.base64);
    await dbPutFile({
      path: file.path,
      name: file.name,
      mimeType: file.mimeType,
      size: bytes.byteLength,
      updatedAt: file.updatedAt,
      category: file.category,
      data: bytes,
    });
  }
}

export async function clearAllLocalData(): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryFallback.kv.clear();
    memoryFallback.sessions.clear();
    memoryFallback.files.clear();
    memoryFallback.snapshots.clear();
    memoryFallback.skills.clear();
    return;
  }
  const stores = ["kv", "sessions", "files", "snapshots", "skills"] as const;
  const tx = db.transaction([...stores], "readwrite");
  for (const name of stores) {
    await tx.objectStore(name).clear();
  }
  await tx.done;
}
