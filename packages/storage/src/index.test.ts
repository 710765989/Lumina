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
  listMedia,
  listMediaTags,
  getMediaStats,
  removeLibraryRoot,
  listTags,
  openDatabase,
  searchMedia,
  setAlbumCover,
  setMediaTags,
  setLibraryRootEnabled,
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
    expect(listMediaTags(db, 'media-1').map((tag) => tag.name)).toEqual(['海边']);
    expect(db.prepare('SELECT COUNT(*) AS count FROM media_tags WHERE tag_id=?').get(tagId)).toEqual({ count: 1 });
    expect(searchMedia(db, 'photo')).toHaveLength(1);
    expect(searchMedia(db, '海边')).toHaveLength(1);
    expect(searchMedia(db, '', { excludeTagNames: ['海边'] })).toHaveLength(0);
    expect(listTags(db)).toEqual([{ id: tagId, name: '海边',englishName:'' }]);
    removeTagFromMedia(db, 'media-1', '海边');
    expect(searchMedia(db, '海边')).toHaveLength(0);
    hideMedia(db, 'media-1');
    expect(searchMedia(db, 'photo')).toHaveLength(0);
    expect(searchMedia(db, 'photo', { includeHidden: true })).toHaveLength(1);
    removeMediaFromIndex(db, 'media-1');
    expect(searchMedia(db, 'photo', { includeHidden: true })).toHaveLength(0);
    expect(root.label).toBe('Photos');
  });

  it('paginates album media in modified-time order', () => {
    db = openDatabase(':memory:');
    db.prepare(`INSERT INTO media(id, absolute_path, kind, size_bytes, modified_at_ms, fingerprint)
      VALUES ('media-1', 'C:/Photos/photo-1.jpg', 'photo', 10, 100, 'fp-1'),
             ('media-2', 'C:/Photos/photo-2.jpg', 'photo', 12, 90, 'fp-2')`).run();
    const album = createAlbum(db, '旅行');
    expect(addMediaToAlbum(db, album.id, ['media-1', 'media-2'])).toBe(2);
    expect(listAlbumMedia(db, album.id, { limit: 1, offset: 0 }).map((media) => media.id)).toEqual(['media-1']);
    expect(listAlbumMedia(db, album.id, { limit: 1, offset: 1 }).map((media) => media.id)).toEqual(['media-2']);
  });

  it('filters library media by kind and supports both date directions', () => {
    db = openDatabase(':memory:');
    addLibraryRoot(db, 'C:/Photos', 'Photos');
    db.prepare(`INSERT INTO media(id, absolute_path, kind, size_bytes, modified_at_ms, fingerprint)
      VALUES ('photo-new', 'C:/Photos/new.jpg', 'photo', 10, 200, 'fp-photo-new'),
             ('video-old', 'C:/Photos/old.mp4', 'video', 12, 100, 'fp-video-old'),
             ('photo-old', 'C:/Photos/old.jpg', 'photo', 14, 50, 'fp-photo-old')`).run();

    expect(listMedia(db, { kind: 'photo' }).map((media) => media.id)).toEqual(['photo-new', 'photo-old']);
    expect(listMedia(db, { kind: 'video' }).map((media) => media.id)).toEqual(['video-old']);
    expect(listMedia(db, { sort: 'asc' }).map((media) => media.id)).toEqual(['photo-old', 'video-old', 'photo-new']);
    expect(searchMedia(db, 'old', { kind: 'photo' }).map((media) => media.id)).toEqual(['photo-old']);
    expect(getMediaStats(db)).toEqual({ total: 3, photo: 2, video: 1, totalSizeBytes: 36, photoSizeBytes: 24, videoSizeBytes: 12 });
    removeMediaFromIndex(db, 'video-old');
    expect(getMediaStats(db)).toEqual({ total: 2, photo: 2, video: 0, totalSizeBytes: 24, photoSizeBytes: 24, videoSizeBytes: 0 });
  });

  it('supports added time, capture time, name, and size ordering', () => {
    db = openDatabase(':memory:');
    addLibraryRoot(db, 'C:/Photos', 'Photos');
    db.prepare(`INSERT INTO media(id, absolute_path, kind, size_bytes, modified_at_ms, fingerprint, created_at)
      VALUES ('media-a', 'C:/Photos/z-last.jpg', 'photo', 20, 100, 'fp-a', '2026-01-03 00:00:00'),
             ('media-b', 'C:/Photos/a-first.jpg', 'photo', 10, 300, 'fp-b', '2026-01-01 00:00:00'),
             ('media-c', 'C:/Photos/m-middle.jpg', 'photo', 30, 200, 'fp-c', '2026-01-02 00:00:00')`).run();

    expect(listMedia(db, { sortBy: 'addedAt' }).map((media) => media.id)).toEqual(['media-a', 'media-c', 'media-b']);
    expect(listMedia(db, { sortBy: 'fileTime' }).map((media) => media.id)).toEqual(['media-b', 'media-c', 'media-a']);
    expect(listMedia(db, { sortBy: 'capturedAt' }).map((media) => media.id)).toEqual(['media-b', 'media-c', 'media-a']);
    expect(listMedia(db, { sortBy: 'name', sort: 'asc' }).map((media) => media.id)).toEqual(['media-b', 'media-c', 'media-a']);
    expect(listMedia(db, { sortBy: 'size', sort: 'asc' }).map((media) => media.id)).toEqual(['media-b', 'media-a', 'media-c']);
  });

  it('pauses and removes a library root without touching media records', () => {
    db = openDatabase(':memory:');
    const root = addLibraryRoot(db, 'C:/Photos', 'Photos');
    setLibraryRootEnabled(db, root.id, false);
    expect(listLibraryRoots(db)[0]?.enabled).toBe(false);
    db.prepare(`INSERT INTO media(id, absolute_path, kind, size_bytes, modified_at_ms, fingerprint)
      VALUES ('media-1', 'C:/Photos/photo.jpg', 'photo', 10, 100, 'fp-1')`).run();
    expect(listMedia(db)).toHaveLength(0);
    setLibraryRootEnabled(db, root.id, true);
    expect(listMedia(db)).toHaveLength(1);
    setLibraryRootEnabled(db, root.id, false);
    removeLibraryRoot(db, root.id);
    expect(listLibraryRoots(db)).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM media').get()).toEqual({ count: 0 });
  });
});
