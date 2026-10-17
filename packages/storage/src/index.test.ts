import { afterEach, describe, expect, it } from 'vitest';
import {
  addLibraryRoot,
  addMediaToAlbum,
  closeDatabase,
  createAlbum,
  createTag,
  hideMedia,
  listAlbumMedia,
  listLibraryRoots,
  listTags,
  openDatabase,
  searchMedia,
  setAlbumCover,
  setMediaTags,
  syncMediaSearchIndex,
  removeTagFromMedia,
  removeMediaFromIndex,
  type LuminaDatabase,
} from './index.js';

let db: LuminaDatabase | undefined;
afterEach(() => { if (db) closeDatabase(db); db = undefined; });

describe('storage bootstrap', () => {
  it('enables WAL, foreign keys, and creates user-data tables', () => {
    db = openDatabase(':memory:');
    expect(db.pragma('journal_mode', { simple: true })).toBe('memory');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name: string}>;
    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining(['media', 'albums', 'tags', 'settings', 'tasks']));
  });

  it('supports M1 roots, albums, tags, search, and hidden media', () => {
    db = openDatabase(':memory:');
    const root = addLibraryRoot(db, 'C:/Photos', 'Photos');
    expect(listLibraryRoots(db)).toHaveLength(1);
    db.prepare(`INSERT INTO media(id, absolute_path, kind, size_bytes, modified_at_ms, fingerprint)
      VALUES ('media-1', 'C:/Photos/photo.jpg', 'photo', 10, 100, 'fp-1')`).run();
    syncMediaSearchIndex(db, {
      id: 'media-1', absolutePath: 'C:/Photos/photo.jpg', kind: 'photo', sizeBytes: 10, modifiedAtMs: 100, fingerprint: 'fp-1',
    });
    const album = createAlbum(db, '旅行', '周末照片');
    expect(addMediaToAlbum(db, album.id, ['media-1'])).toBe(1);
    setAlbumCover(db, album.id, 'media-1');
    expect(listAlbumMedia(db, album.id)).toHaveLength(1);
    const tagId = createTag(db, '海边');
    setMediaTags(db, 'media-1', ['海边']);
    expect(db.prepare('SELECT COUNT(*) AS count FROM media_tags WHERE tag_id=?').get(tagId)).toEqual({ count: 1 });
    expect(searchMedia(db, 'photo')).toHaveLength(1);
    expect(searchMedia(db, '海边')).toHaveLength(1);
    expect(listTags(db)).toEqual([{ id: tagId, name: '海边' }]);
    removeTagFromMedia(db, 'media-1', '海边');
    expect(searchMedia(db, '海边')).toHaveLength(0);
    hideMedia(db, 'media-1');
    expect(searchMedia(db, 'photo')).toHaveLength(0);
    expect(searchMedia(db, 'photo', { includeHidden: true })).toHaveLength(1);
    removeMediaFromIndex(db, 'media-1');
    expect(searchMedia(db, 'photo', { includeHidden: true })).toHaveLength(0);
    expect(root.label).toBe('Photos');
  });
});
