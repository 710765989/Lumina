import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, type LuminaDatabase } from '@lumina/storage';
import { scanDirectory } from './index.js';

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
    await writeFile(filePath, 'first');
    db = openDatabase(':memory:');
    const first = await scanDirectory(db, tempRoot);
    await writeFile(filePath, 'second-content');
    const second = await scanDirectory(db, tempRoot);
    expect(first.media[0]?.id).toBe(second.media[0]?.id);
    expect(second.media).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM media').get()).toEqual({ count: 1 });
    expect(second.task.status).toBe('completed');
  });
});
