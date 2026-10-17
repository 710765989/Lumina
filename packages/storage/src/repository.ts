import { randomUUID } from 'node:crypto';
import type { MediaKind, MediaRecord } from '@lumina/contracts';
import type { LuminaDatabase } from './index.js';

export interface LibraryRootRecord {
  id: string;
  absolutePath: string;
  label: string;
  enabled: boolean;
}

export interface AlbumRecord {
  id: string;
  name: string;
  description: string;
  coverMode: 'auto' | 'manual';
  manualCoverMediaId: string | null;
}

export interface MediaListItem extends MediaRecord {
  hidden: boolean;
}

type MediaRow = {
  id: string;
  absolute_path: string;
  kind: MediaKind;
  size_bytes: number;
  modified_at_ms: number;
  fingerprint: string;
  hidden: number;
};

function toMedia(row: MediaRow): MediaListItem {
  return {
    id: row.id,
    absolutePath: row.absolute_path,
    kind: row.kind,
    sizeBytes: row.size_bytes,
    modifiedAtMs: row.modified_at_ms,
    fingerprint: row.fingerprint,
    hidden: row.hidden === 1,
  };
}

export function addLibraryRoot(db: LuminaDatabase, absolutePath: string, label = absolutePath): LibraryRootRecord {
  const id = randomUUID();
  db.prepare(`INSERT INTO library_roots(id, absolute_path, label)
    VALUES (?, ?, ?)
    ON CONFLICT(absolute_path) DO UPDATE SET label=excluded.label, enabled=1, updated_at=CURRENT_TIMESTAMP`)
    .run(id, absolutePath, label);
  return db.prepare(`SELECT id, absolute_path as absolutePath, label, enabled
    FROM library_roots WHERE absolute_path=?`).get(absolutePath) as LibraryRootRecord;
}

export function listLibraryRoots(db: LuminaDatabase): LibraryRootRecord[] {
  return db.prepare(`SELECT id, absolute_path as absolutePath, label, enabled
    FROM library_roots ORDER BY label COLLATE NOCASE, id`).all() as LibraryRootRecord[];
}

export function setLibraryRootEnabled(db: LuminaDatabase, id: string, enabled: boolean): void {
  db.prepare('UPDATE library_roots SET enabled=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(enabled ? 1 : 0, id);
}

export function removeLibraryRoot(db: LuminaDatabase, id: string): void {
  db.prepare('DELETE FROM library_roots WHERE id=?').run(id);
}

export function syncMediaSearchIndex(db: LuminaDatabase, record: MediaRecord): void {
  db.prepare('DELETE FROM media_fts WHERE media_id=?').run(record.id);
  db.prepare('INSERT INTO media_fts(media_id, searchable) VALUES (?, ?)').run(
    record.id,
    `${record.absolutePath} ${record.kind}`,
  );
}

export function listMedia(db: LuminaDatabase, options: { includeHidden?: boolean; limit?: number; offset?: number } = {}): MediaListItem[] {
  const includeHidden = options.includeHidden ?? false;
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const offset = Math.max(0, options.offset ?? 0);
  const hiddenClause = includeHidden ? '' : 'AND h.media_id IS NULL';
  const rows = db.prepare(`SELECT m.id, m.absolute_path, m.kind, m.size_bytes, m.modified_at_ms,
    m.fingerprint, CASE WHEN h.media_id IS NULL THEN 0 ELSE 1 END AS hidden
    FROM media m LEFT JOIN hidden_media h ON h.media_id=m.id
    WHERE 1=1 ${hiddenClause}
    ORDER BY m.modified_at_ms DESC, m.id ASC LIMIT ? OFFSET ?`).all(limit, offset) as MediaRow[];
  return rows.map(toMedia);
}

export function searchMedia(db: LuminaDatabase, query: string, options: { includeHidden?: boolean; limit?: number } = {}): MediaListItem[] {
  const normalized = query.trim();
  if (!normalized) return listMedia(db, options);
  const includeHidden = options.includeHidden ?? false;
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const hiddenClause = includeHidden ? '' : 'AND h.media_id IS NULL';
  const matchQuery = normalized
    .split(/\s+/u)
    .map((token) => token.replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(Boolean)
    .map((token) => `"${token}"*`)
    .join(' AND ');
  const ids = new Set<string>();
  if (matchQuery) {
    const ftsRows = db.prepare('SELECT media_id FROM media_fts WHERE media_fts MATCH ?').all(matchQuery) as Array<{ media_id: string }>;
    for (const row of ftsRows) ids.add(row.media_id);
  }
  const fallbackRows = db.prepare(`SELECT m.id FROM media m
    LEFT JOIN hidden_media h ON h.media_id=m.id
    WHERE (m.absolute_path LIKE ? OR EXISTS (
      SELECT 1 FROM media_tags mt JOIN tags t ON t.id=mt.tag_id
      WHERE mt.media_id=m.id AND t.name LIKE ?
    )) ${hiddenClause}`).all(`%${normalized}%`, `%${normalized}%`) as Array<{ id: string }>;
  for (const row of fallbackRows) ids.add(row.id);
  if (ids.size === 0) return [];
  const idList = [...ids];
  const placeholders = idList.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT m.id, m.absolute_path, m.kind, m.size_bytes, m.modified_at_ms,
    m.fingerprint, CASE WHEN h.media_id IS NULL THEN 0 ELSE 1 END AS hidden
    FROM media m LEFT JOIN hidden_media h ON h.media_id=m.id
    WHERE m.id IN (${placeholders}) ${hiddenClause}
    ORDER BY m.modified_at_ms DESC, m.id ASC LIMIT ?`).all(...idList, limit) as MediaRow[];
  return rows.map(toMedia);
}

export function hideMedia(db: LuminaDatabase, mediaId: string): void {
  db.prepare('INSERT OR IGNORE INTO hidden_media(media_id) VALUES (?)').run(mediaId);
}

export function unhideMedia(db: LuminaDatabase, mediaId: string): void {
  db.prepare('DELETE FROM hidden_media WHERE media_id=?').run(mediaId);
}

/** Remove an item from Lumina's index while leaving the user's file untouched. */
export function removeMediaFromIndex(db: LuminaDatabase, mediaId: string): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM media_fts WHERE media_id=?').run(mediaId);
    db.prepare('DELETE FROM media WHERE id=?').run(mediaId);
  });
  tx();
}

export function createAlbum(db: LuminaDatabase, name: string, description = ''): AlbumRecord {
  const id = randomUUID();
  db.prepare('INSERT INTO albums(id, name, description) VALUES (?, ?, ?)').run(id, name.trim(), description.trim());
  return getAlbum(db, id)!;
}

export function getAlbum(db: LuminaDatabase, id: string): AlbumRecord | undefined {
  return db.prepare(`SELECT id, name, description, cover_mode as coverMode,
    manual_cover_media_id as manualCoverMediaId FROM albums WHERE id=?`).get(id) as AlbumRecord | undefined;
}

export function listAlbums(db: LuminaDatabase): AlbumRecord[] {
  return db.prepare(`SELECT id, name, description, cover_mode as coverMode,
    manual_cover_media_id as manualCoverMediaId FROM albums ORDER BY updated_at DESC, id`).all() as AlbumRecord[];
}

export function updateAlbum(db: LuminaDatabase, id: string, changes: { name?: string; description?: string }): void {
  if (changes.name !== undefined) db.prepare('UPDATE albums SET name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(changes.name.trim(), id);
  if (changes.description !== undefined) db.prepare('UPDATE albums SET description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(changes.description.trim(), id);
}

export function deleteAlbum(db: LuminaDatabase, id: string): void {
  db.prepare('DELETE FROM albums WHERE id=?').run(id);
}

export function addMediaToAlbum(db: LuminaDatabase, albumId: string, mediaIds: string[]): number {
  const insert = db.prepare('INSERT OR IGNORE INTO album_media(album_id, media_id) VALUES (?, ?)');
  let added = 0;
  const tx = db.transaction((ids: string[]) => { for (const mediaId of ids) added += Number(insert.run(albumId, mediaId).changes); });
  tx(mediaIds);
  return added;
}

export function removeMediaFromAlbum(db: LuminaDatabase, albumId: string, mediaIds: string[]): number {
  const remove = db.prepare('DELETE FROM album_media WHERE album_id=? AND media_id=?');
  let removed = 0;
  const tx = db.transaction((ids: string[]) => { for (const mediaId of ids) removed += Number(remove.run(albumId, mediaId).changes); });
  tx(mediaIds);
  return removed;
}

export function listAlbumMedia(db: LuminaDatabase, albumId: string, options: { includeHidden?: boolean; limit?: number; offset?: number } = {}): MediaListItem[] {
  const includeHidden = options.includeHidden ?? false;
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const offset = Math.max(0, options.offset ?? 0);
  const hiddenClause = includeHidden ? '' : 'AND h.media_id IS NULL';
  const rows = db.prepare(`SELECT m.id, m.absolute_path, m.kind, m.size_bytes, m.modified_at_ms,
    m.fingerprint, CASE WHEN h.media_id IS NULL THEN 0 ELSE 1 END AS hidden
    FROM album_media am JOIN media m ON m.id=am.media_id
    LEFT JOIN hidden_media h ON h.media_id=m.id
    WHERE am.album_id=? ${hiddenClause}
    ORDER BY m.modified_at_ms DESC, m.id ASC LIMIT ? OFFSET ?`).all(albumId, limit, offset) as MediaRow[];
  return rows.map(toMedia);
}

export function setAlbumCover(db: LuminaDatabase, albumId: string, mediaId: string | null): void {
  if (mediaId === null) {
    db.prepare("UPDATE albums SET cover_mode='auto', manual_cover_media_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(albumId);
    return;
  }
  db.prepare("UPDATE albums SET cover_mode='manual', manual_cover_media_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(mediaId, albumId);
}

export function createTag(db: LuminaDatabase, name: string): string {
  const id = randomUUID();
  db.prepare('INSERT INTO tags(id, name) VALUES (?, ?) ON CONFLICT(name) DO NOTHING').run(id, name.trim());
  return String((db.prepare('SELECT id FROM tags WHERE name=?').get(name.trim()) as { id: string }).id);
}

export function deleteTag(db: LuminaDatabase, tagId: string): void {
  db.prepare('DELETE FROM tags WHERE id=?').run(tagId);
}

export function setMediaTags(db: LuminaDatabase, mediaId: string, tagNames: string[]): void {
  const names = [...new Set(tagNames.map((name) => name.trim()).filter(Boolean))];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM media_tags WHERE media_id=?').run(mediaId);
    for (const name of names) {
      const tagId = createTag(db, name);
      db.prepare('INSERT OR IGNORE INTO media_tags(media_id, tag_id) VALUES (?, ?)').run(mediaId, tagId);
    }
  });
  tx();
}

export function addTagToMedia(db: LuminaDatabase, mediaId: string, tagName: string): void {
  const tagId = createTag(db, tagName);
  db.prepare('INSERT OR IGNORE INTO media_tags(media_id, tag_id) VALUES (?, ?)').run(mediaId, tagId);
}

export function removeTagFromMedia(db: LuminaDatabase, mediaId: string, tagName: string): void {
  db.prepare(`DELETE FROM media_tags WHERE media_id=? AND tag_id IN (SELECT id FROM tags WHERE name=?)`).run(mediaId, tagName.trim());
}

export function listTags(db: LuminaDatabase): Array<{ id: string; name: string }> {
  return db.prepare('SELECT id, name FROM tags ORDER BY name COLLATE NOCASE, id').all() as Array<{ id: string; name: string }>;
}
