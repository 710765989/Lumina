import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  addMediaToAlbum,
  closeDatabase,
  createAlbum,
  createTag,
  listAlbumMedia,
  openDatabase,
  searchMedia,
  setAlbumCover,
  setMediaTags,
} from '@lumina/storage';
import { addAndScanLibraryRoot } from '@lumina/core';

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lumina-m1-'));
const mediaRoot = path.join(tempRoot, 'library');
await mkdir(mediaRoot, { recursive: true });
await writeFile(path.join(mediaRoot, 'sunset.jpg'), 'fixture-photo');
const db = openDatabase(path.join(tempRoot, 'lumina.db'));
try {
  const scan = await addAndScanLibraryRoot(db, mediaRoot, '示例图库');
  const album = createAlbum(db, '周末', 'M1 验证相册');
  const mediaId = scan.media[0]?.id;
  if (!mediaId) throw new Error('M1 verification did not index media');
  addMediaToAlbum(db, album.id, [mediaId]);
  setAlbumCover(db, album.id, mediaId);
  createTag(db, '旅行');
  setMediaTags(db, mediaId, ['旅行']);
  const checks = {
    root: scan.root.label,
    taskStatus: scan.task.status,
    albumMediaCount: listAlbumMedia(db, album.id).length,
    tagSearchCount: searchMedia(db, '旅行').length,
  };
  if (checks.taskStatus !== 'completed' || checks.albumMediaCount !== 1 || checks.tagSearchCount !== 1) {
    throw new Error(`M1 verification failed: ${JSON.stringify(checks)}`);
  }
  console.log(JSON.stringify({ ok: true, ...checks }, null, 2));
} finally {
  closeDatabase(db);
  await rm(tempRoot, { recursive: true, force: true });
}
