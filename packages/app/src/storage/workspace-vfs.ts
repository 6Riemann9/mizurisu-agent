import { getPlatformAdapter } from "../platform";
import {
  createExcelWorkbook,
  createStarterDemoSlidesHtml,
  detectFileCategory,
  inferMimeType,
} from "../office";
import type { FileSnapshot, WorkspaceFileMeta, WorkspaceFileRecord } from "../types";
import {
  dbAddSnapshot,
  dbDeleteFile,
  dbGetFile,
  dbGetSnapshots,
  dbListFiles,
  dbPutFile,
  kvGet,
  kvSet,
} from "./db";

const WORKSPACE_PREFIX = "__ws__/";
const MAX_DISK_SNAPSHOT_BYTES = 15 * 1024 * 1024;

export function normalizeVfsPath(rawPath: string): string {
  const clean = rawPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").trim();
  if (!clean || clean === "." || clean.includes("..")) {
    throw new Error(`非法文件路径: "${rawPath}"`);
  }
  return clean;
}

export interface VfsEvent {
  type: "write" | "delete" | "sync" | "rename";
  path?: string;
  previousPath?: string;
}

type VfsListener = (event: VfsEvent) => void;

export class WorkspaceVFS {
  private listeners = new Set<VfsListener>();
  private activeWorkspaceId = "default";
  private mountedNativeDir: string | undefined;
  private directNativeMode = false;

  getActiveWorkspaceId(): string {
    return this.activeWorkspaceId;
  }

  isDirectNativeMode(): boolean {
    return Boolean(this.directNativeMode && this.mountedNativeDir);
  }

  setActiveWorkspace(workspaceId: string, nativeDir?: string): void {
    this.activeWorkspaceId = workspaceId.trim() || "default";
    this.setMountedNativeDir(nativeDir);
  }

  setMountedNativeDir(dir?: string): void {
    const clean = dir?.trim() || undefined;
    this.mountedNativeDir = clean;
    const platform = getPlatformAdapter();
    this.directNativeMode = Boolean(
      clean && platform.listNativeDirectoryFiles && platform.readFromNativeDirectory
    );
  }

  getMountedNativeDir(): string | undefined {
    return this.mountedNativeDir;
  }

  /** 将工作区逻辑路径映射为底层 IndexedDB 存储键（默认工作区保持无前缀向后兼容） */
  private toDbKey(cleanPath: string): string {
    if (this.activeWorkspaceId === "default") {
      return cleanPath;
    }
    return `${WORKSPACE_PREFIX}${this.activeWorkspaceId}/${cleanPath}`;
  }

  private fromDbKey(dbKey: string): string | null {
    if (this.activeWorkspaceId === "default") {
      if (dbKey.startsWith(WORKSPACE_PREFIX)) return null;
      return dbKey;
    }
    const prefix = `${WORKSPACE_PREFIX}${this.activeWorkspaceId}/`;
    if (!dbKey.startsWith(prefix)) return null;
    return dbKey.slice(prefix.length);
  }

  subscribe(listener: VfsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitSync(): void {
    this.emit({ type: "sync" });
  }

  private emit(event: VfsEvent): void {
    for (const l of this.listeners) {
      l(event);
    }
  }

  async listFiles(): Promise<WorkspaceFileMeta[]> {
    if (this.isDirectNativeMode()) {
      const platform = getPlatformAdapter();
      const raw = await platform.listNativeDirectoryFiles!(this.mountedNativeDir!);
      return raw.map((item) => ({
        path: item.path,
        name: item.name,
        mimeType: inferMimeType(item.path),
        size: item.size,
        updatedAt: item.updatedAt,
        category: detectFileCategory(item.path),
      }));
    }

    const records = await dbListFiles();
    const out: WorkspaceFileMeta[] = [];
    for (const rec of records) {
      const logicalPath = this.fromDbKey(rec.path);
      if (!logicalPath) continue;
      const { data: _data, ...meta } = rec;
      out.push({ ...meta, path: logicalPath });
    }
    return out;
  }

  async exists(rawPath: string): Promise<boolean> {
    const path = normalizeVfsPath(rawPath);
    if (this.isDirectNativeMode()) {
      const files = await this.listFiles();
      return files.some((f) => f.path === path);
    }
    return Boolean(await dbGetFile(this.toDbKey(path)));
  }

  async readRecord(rawPath: string): Promise<WorkspaceFileRecord> {
    const path = normalizeVfsPath(rawPath);
    if (this.isDirectNativeMode()) {
      const platform = getPlatformAdapter();
      const bytes = await platform.readFromNativeDirectory!(this.mountedNativeDir!, path);
      return {
        path,
        name: path.split("/").pop() || path,
        mimeType: inferMimeType(path),
        size: bytes.byteLength,
        updatedAt: Date.now(),
        category: detectFileCategory(path),
        data: bytes,
      };
    }

    const rec = await dbGetFile(this.toDbKey(path));
    if (!rec) {
      throw new Error(`工作区文件不存在: ${path}`);
    }
    return { ...rec, path };
  }

  async readBytes(rawPath: string): Promise<Uint8Array> {
    const rec = await this.readRecord(rawPath);
    return new Uint8Array(rec.data);
  }

  async readText(rawPath: string): Promise<string> {
    const bytes = await this.readBytes(rawPath);
    return new TextDecoder("utf-8").decode(bytes);
  }

  async writeBytes(
    rawPath: string,
    data: Uint8Array,
    options?: { snapshotNote?: string; skipNativeSync?: boolean }
  ): Promise<WorkspaceFileMeta> {
    const path = normalizeVfsPath(rawPath);
    const dbKey = this.toDbKey(path);
    const copy = new Uint8Array(data);
    const now = Date.now();

    if (this.isDirectNativeMode()) {
      const platform = getPlatformAdapter();
      // 真本地模式下，写入前先尝试对现有磁盘原件拍一次快照以支持一键回滚
      try {
        const prevBytes = await platform.readFromNativeDirectory!(this.mountedNativeDir!, path);
        if (prevBytes.byteLength <= MAX_DISK_SNAPSHOT_BYTES) {
          await dbAddSnapshot({
            id: `${dbKey}::${now}::${Math.random().toString(36).slice(2, 7)}`,
            path: dbKey,
            size: prevBytes.byteLength,
            createdAt: now,
            note: options?.snapshotNote || "修改前自动快照",
            data: prevBytes,
          });
        }
      } catch {
        // 新建文件尚无旧版，忽略
      }
      await platform.writeToNativeDirectory!(this.mountedNativeDir!, path, copy);
      this.emit({ type: "write", path });
      return {
        path,
        name: path.split("/").pop() || path,
        mimeType: inferMimeType(path),
        size: copy.byteLength,
        updatedAt: now,
        category: detectFileCategory(path),
      };
    }

    const existing = await dbGetFile(dbKey);
    if (existing) {
      await dbAddSnapshot({
        id: `${dbKey}::${now}::${Math.random().toString(36).slice(2, 7)}`,
        path: dbKey,
        size: existing.size,
        createdAt: existing.updatedAt,
        note: options?.snapshotNote || "修改前自动快照",
        data: new Uint8Array(existing.data),
      });
    }

    const record: WorkspaceFileRecord = {
      path: dbKey,
      name: path.split("/").pop() || path,
      mimeType: inferMimeType(path),
      size: copy.byteLength,
      updatedAt: now,
      category: detectFileCategory(path),
      data: copy,
    };

    await dbPutFile(record);

    if (!options?.skipNativeSync && this.mountedNativeDir) {
      const platform = getPlatformAdapter();
      if (platform.writeToNativeDirectory) {
        await platform
          .writeToNativeDirectory(this.mountedNativeDir, path, copy)
          .catch(() => undefined);
      }
    }

    this.emit({ type: "write", path });
    const { data: _omit, ...meta } = record;
    return { ...meta, path };
  }

  async writeText(
    rawPath: string,
    text: string,
    options?: { snapshotNote?: string; skipNativeSync?: boolean }
  ): Promise<WorkspaceFileMeta> {
    const bytes = new TextEncoder().encode(text);
    return await this.writeBytes(rawPath, bytes, options);
  }

  async deleteFile(rawPath: string): Promise<void> {
    const path = normalizeVfsPath(rawPath);
    const dbKey = this.toDbKey(path);
    const platform = getPlatformAdapter();

    if (this.isDirectNativeMode()) {
      try {
        const prevBytes = await platform.readFromNativeDirectory!(this.mountedNativeDir!, path);
        if (prevBytes.byteLength <= MAX_DISK_SNAPSHOT_BYTES) {
          await dbAddSnapshot({
            id: `${dbKey}::${Date.now()}::del`,
            path: dbKey,
            size: prevBytes.byteLength,
            createdAt: Date.now(),
            note: "删除前自动快照",
            data: prevBytes,
          });
        }
      } catch {
        // 忽略读取失败
      }
      await platform.deleteFromNativeDirectory!(this.mountedNativeDir!, path);
      this.emit({ type: "delete", path });
      return;
    }

    const existing = await dbGetFile(dbKey);
    if (!existing) {
      throw new Error(`工作区文件不存在: ${path}`);
    }
    await dbAddSnapshot({
      id: `${dbKey}::${Date.now()}::del`,
      path: dbKey,
      size: existing.size,
      createdAt: existing.updatedAt,
      note: "删除前自动快照",
      data: new Uint8Array(existing.data),
    });
    await dbDeleteFile(dbKey);

    if (this.mountedNativeDir && platform.deleteFromNativeDirectory) {
      await platform
        .deleteFromNativeDirectory(this.mountedNativeDir, path)
        .catch(() => undefined);
    }

    this.emit({ type: "delete", path });
  }

  /** 安全重命名或移动工作区文件，保留旧路径快照并禁止覆盖已有目标文件 */
  async renameFile(oldRawPath: string, newRawPath: string): Promise<WorkspaceFileMeta> {
    const oldPath = normalizeVfsPath(oldRawPath);
    const newPath = normalizeVfsPath(newRawPath);

    if (oldPath === newPath) {
      throw new Error(`新旧文件路径相同: ${oldPath}`);
    }

    const oldKey = this.toDbKey(oldPath);
    const newKey = this.toDbKey(newPath);
    const platform = getPlatformAdapter();

    if (this.isDirectNativeMode()) {
      const prevBytes = await platform.readFromNativeDirectory!(this.mountedNativeDir!, oldPath);
      if (prevBytes.byteLength <= MAX_DISK_SNAPSHOT_BYTES) {
        await dbAddSnapshot({
          id: `${oldKey}::${Date.now()}::rename`,
          path: oldKey,
          size: prevBytes.byteLength,
          createdAt: Date.now(),
          note: `重命名为 ${newPath} 前自动快照`,
          data: prevBytes,
        });
      }
      await platform.renameInNativeDirectory!(this.mountedNativeDir!, oldPath, newPath);
      this.emit({ type: "rename", path: newPath, previousPath: oldPath });
      return {
        path: newPath,
        name: newPath.split("/").pop() || newPath,
        mimeType: inferMimeType(newPath),
        size: prevBytes.byteLength,
        updatedAt: Date.now(),
        category: detectFileCategory(newPath),
      };
    }

    const existing = await dbGetFile(oldKey);
    if (!existing) {
      throw new Error(`工作区文件不存在: ${oldPath}`);
    }

    const targetExisting = await dbGetFile(newKey);
    if (targetExisting) {
      throw new Error(`目标文件已存在: ${newPath}`);
    }

    await dbAddSnapshot({
      id: `${oldKey}::${Date.now()}::rename`,
      path: oldKey,
      size: existing.size,
      createdAt: existing.updatedAt,
      note: `重命名为 ${newPath} 前自动快照`,
      data: new Uint8Array(existing.data),
    });

    const now = Date.now();
    const copy = new Uint8Array(existing.data);
    const newRecord: WorkspaceFileRecord = {
      path: newKey,
      name: newPath.split("/").pop() || newPath,
      mimeType: inferMimeType(newPath),
      size: copy.byteLength,
      updatedAt: now,
      category: detectFileCategory(newPath),
      data: copy,
    };

    await dbPutFile(newRecord);
    await dbDeleteFile(oldKey);

    if (this.mountedNativeDir) {
      if (platform.renameInNativeDirectory) {
        await platform
          .renameInNativeDirectory(this.mountedNativeDir, oldPath, newPath)
          .catch(() => undefined);
      } else if (platform.writeToNativeDirectory) {
        await platform
          .writeToNativeDirectory(this.mountedNativeDir, newPath, copy)
          .catch(() => undefined);
      }
    }

    this.emit({ type: "rename", path: newPath, previousPath: oldPath });

    const { data: _omit, ...meta } = newRecord;
    return { ...meta, path: newPath };
  }

  async getSnapshots(rawPath: string): Promise<FileSnapshot[]> {
    const path = normalizeVfsPath(rawPath);
    return await dbGetSnapshots(this.toDbKey(path));
  }

  async restoreSnapshot(snapshotId: string, rawPath: string): Promise<WorkspaceFileMeta> {
    const snapshots = await this.getSnapshots(rawPath);
    const snap = snapshots.find((s) => s.id === snapshotId);
    if (!snap) {
      throw new Error("未找到指定历史快照");
    }
    return await this.writeBytes(rawPath, snap.data, {
      snapshotNote: "回滚版本前快照",
    });
  }

  async importBatch(
    files: Array<{ path: string; data: Uint8Array }>,
    options?: { skipNativeSync?: boolean }
  ): Promise<WorkspaceFileMeta[]> {
    const results: WorkspaceFileMeta[] = [];
    for (const f of files) {
      const meta = await this.writeBytes(f.path, f.data, {
        snapshotNote: "导入覆盖前快照",
        skipNativeSync: options?.skipNativeSync,
      });
      results.push(meta);
    }
    this.emit({ type: "sync" });
    return results;
  }

  /** 清空非默认工作区的 IndexedDB 隔离文件（切换或删除工作区时调用） */
  async purgeWorkspaceFiles(workspaceId: string): Promise<void> {
    if (!workspaceId || workspaceId === "default") return;
    const prefix = `${WORKSPACE_PREFIX}${workspaceId}/`;
    const all = await dbListFiles();
    for (const rec of all) {
      if (rec.path.startsWith(prefix)) {
        await dbDeleteFile(rec.path);
      }
    }
  }

  async seedStarterWorkspaceIfEmpty(): Promise<void> {
    if (this.activeWorkspaceId !== "default" || this.isDirectNativeMode()) {
      return;
    }
    const seeded = await kvGet<boolean>("starter_workspace_seeded");
    const existing = await this.listFiles();

    if (!seeded && existing.length === 0) {
      try {
        const sampleExcel = await createExcelWorkbook({
          sheets: [
            {
              name: "季度销售明细",
              headers: ["区域", "产品线", "Q1营收(万)", "Q2营收(万)", "半年度合计", "同比增速"],
              rows: [
                ["华东区", "企业版 SaaS", 320, 385, { formula: "C2+D2", result: 705 }, 0.24],
                ["华南区", "API 中转网关", 210, 268, { formula: "C3+D3", result: 478 }, 0.31],
                ["华北区", "私有化部署", 180, 195, { formula: "C4+D4", result: 375 }, 0.12],
                ["西南区", "企业版 SaaS", 125, 162, { formula: "C5+D5", result: 287 }, 0.29],
                [
                  "合计",
                  "-",
                  { formula: "SUM(C2:C5)", result: 835 },
                  { formula: "SUM(D2:D5)", result: 1010 },
                  { formula: "SUM(E2:E5)", result: 1845 },
                  { formula: "AVERAGE(F2:F5)", result: 0.24 },
                ],
              ],
              numberFormats: { 2: "#,##0", 3: "#,##0", 4: "#,##0", 5: "0.0%" },
            },
          ],
        });

        await this.writeBytes("示例_季度销售数据.xlsx", sampleExcel, { skipNativeSync: true });
        await this.writeText(
          "示例_项目周报模板.md",
          [
            "# 本周项目进展周报",
            "",
            "## 一、核心指标概览",
            "- 工作区已内置 `示例_季度销售数据.xlsx`，你可以直接在右侧表格预览、双击编辑，或让 Mizurisu Agent 读取分析并生成 Word 报告 / PPT 汇报。",
            "",
            "## 二、本周重点完成事项",
            "1. 接入 Mizurisu / 多模型 AI 中转网关，支持自动拉取模型与余额查询。",
            "2. 打通 Word / Excel / PPT / PDF 纯本机客户端读写与实时预览闭环。",
            "",
            "## 三、下周计划",
            "- 根据季度销售数据自动生成 Q3 预算预测与高管汇报 PPT。",
          ].join("\n"),
          { skipNativeSync: true }
        );
        await this.writeText(
          "示例_产品季度汇报.slides.html",
          createStarterDemoSlidesHtml(),
          { skipNativeSync: true }
        );
        await kvSet("starter_workspace_seeded", true);
        await kvSet("starter_slides_seeded", true);
        return;
      } catch {
        // 示例初始化失败不影响正常使用
      }
    }

    try {
      const slidesSeeded = await kvGet<boolean>("starter_slides_seeded");
      const hasStarterSlides = existing.some(
        (f) => f.path === "示例_产品季度汇报.slides.html"
      );
      if (!slidesSeeded && !hasStarterSlides) {
        await this.writeText(
          "示例_产品季度汇报.slides.html",
          createStarterDemoSlidesHtml(),
          { skipNativeSync: true }
        );
        await kvSet("starter_slides_seeded", true);
      } else if (hasStarterSlides && !slidesSeeded) {
        await kvSet("starter_slides_seeded", true);
      }
    } catch {
      // 示范幻灯片补种失败不影响正常使用
    }
  }
}

export const workspaceVfs = new WorkspaceVFS();
