import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, type LuminaDatabase } from '@lumina/storage';
import { scanDirectory } from './index.js';
import sharp from 'sharp';

let db: LuminaDatabase | undefined;
let tempRoot: string | undefined;

afterEach(async () => {
  if (db) closeDatabase(db);
  db = undefined;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('media scanning', () => {
  it('is repeatable and keeps a stable media id for the same path', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lumina-core-'));
    const filePath = path.join(tempRoot, 'photo.jpg');
    await writeFile(filePath, await sharp({ create: { width: 16, height: 16, channels: 3, background: 'blue' } }).jpeg().toBuffer());
    db = openDatabase(':memory:');
    const first = await scanDirectory(db, tempRoot);
    await writeFile(filePath, await sharp({ create: { width: 32, height: 16, channels: 3, background: 'white' } }).jpeg().toBuffer());
    const second = await scanDirectory(db, tempRoot);
    expect(first.media[0]?.id).toBe(second.media[0]?.id);
    expect(second.media).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM media').get()).toEqual({ count: 1 });
    expect(second.task.status).toBe('completed');
  });

  it('skips unsupported files such as desktop metadata and jxr images', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lumina-core-filter-'));
    await writeFile(path.join(tempRoot, 'desktop.ini'), 'metadata');
    await writeFile(path.join(tempRoot, 'wallpaper.jxr'), 'unsupported');
    await writeFile(path.join(tempRoot, 'photo.png'), await sharp({ create: { width: 16, height: 16, channels: 3, background: 'blue' } }).png().toBuffer());
    await writeFile(path.join(tempRoot, 'broken.jpg'), 'not an image');
    db = openDatabase(':memory:');
    const result = await scanDirectory(db, tempRoot);
    expect(result.media.map((item) => item.absolutePath)).toEqual([path.join(tempRoot, 'photo.png')]);
    expect(result.task.total).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS count FROM media WHERE kind='unknown'").get()).toEqual({ count: 0 });
  });
});
