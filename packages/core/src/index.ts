import { createHash, randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { MediaKind, MediaRecord, TaskRecord, TaskStatus } from '@lumina/contracts';
import {
  addLibraryRoot,
  listLibraryRoots,
  syncMediaSearchIndex,
  type LibraryRootRecord,
  type LuminaDatabase,
} from '@lumina/storage';

const photoExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.avif', '.tif', '.tiff', '.raw', '.cr2', '.nef', '.arw', '.dng']);
const videoExtensions = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);

export function mediaKindFromPath(filePath: string): MediaKind {
  const ext = path.extname(filePath).toLowerCase();
  if (photoExtensions.has(ext)) return 'photo';
  if (videoExtensions.has(ext)) return 'video';
  return 'unknown';
}

export async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile()) result.push(next);
    }
  }
  await visit(root);
  return result.sort((a, b) => a.localeCompare(b));
}

export async function scanDirectory(db: LuminaDatabase, root: string): Promise<{ task: TaskRecord; media: MediaRecord[] }> {
  const files = await listFiles(root);
  const taskId = randomUUID();
  db.prepare("INSERT INTO tasks(id, kind, status, total) VALUES (?, 'scan', 'running', ?)").run(taskId, files.length);
  const insert = db.prepare(`INSERT INTO media(id, absolute_path, kind, size_bytes, modified_at_ms, fingerprint)
    VALUES (@id, @absolutePath, @kind, @sizeBytes, @modifiedAtMs, @fingerprint)
    ON CONFLICT(absolute_path) DO UPDATE SET kind=excluded.kind, size_bytes=excluded.size_bytes,
      modified_at_ms=excluded.modified_at_ms, fingerprint=excluded.fingerprint, updated_at=CURRENT_TIMESTAMP`);
  const tx = db.transaction((records: MediaRecord[]) => { for (const record of records) insert.run(record); });
  const media: MediaRecord[] = [];
  for (const filePath of files) {
    const info = await stat(filePath);
    const fingerprint = createHash('sha256').update(`${filePath}\0${info.size}\0${info.mtimeMs}`).digest('hex');
    const id = createHash('sha256').update(filePath).digest('hex').slice(0, 32);
    media.push({ id, absolutePath: filePath, kind: mediaKindFromPath(filePath), sizeBytes: info.size, modifiedAtMs: info.mtimeMs, fingerprint });
  }
  tx(media);
  for (const record of media) syncMediaSearchIndex(db, record);
  db.prepare("UPDATE tasks SET status='completed', processed=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(media.length, taskId);
  const row = db.prepare('SELECT id, kind, status, processed, total, error_code as errorCode FROM tasks WHERE id=?').get(taskId) as TaskRecord;
  return { task: row, media };
}

export async function addAndScanLibraryRoot(
  db: LuminaDatabase,
  absolutePath: string,
  label = absolutePath,
): Promise<{ root: LibraryRootRecord; task: TaskRecord; media: MediaRecord[] }> {
  const root = addLibraryRoot(db, absolutePath, label);
  const result = await scanDirectory(db, absolutePath);
  return { root, ...result };
}

export async function scanEnabledLibraryRoots(
  db: LuminaDatabase,
): Promise<Array<{ root: LibraryRootRecord; task: TaskRecord; media: MediaRecord[] }>> {
  const results: Array<{ root: LibraryRootRecord; task: TaskRecord; media: MediaRecord[] }> = [];
  for (const root of listLibraryRoots(db).filter((item) => item.enabled)) {
    results.push({ root, ...(await scanDirectory(db, root.absolutePath)) });
  }
  return results;
}

export function getHealth(db: LuminaDatabase): { journalMode: string; foreignKeys: number; mediaCount: number } {
  return {
    journalMode: String(db.pragma('journal_mode', { simple: true })),
    foreignKeys: Number(db.pragma('foreign_keys', { simple: true })),
    mediaCount: Number((db.prepare('SELECT COUNT(*) AS count FROM media').get() as {count: number}).count),
  };
}

export function updateTaskStatus(db: LuminaDatabase, id: string, status: TaskStatus): void {
  db.prepare('UPDATE tasks SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, id);
}

export { LibraryService } from './service.js';
