import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, type LuminaDatabase } from '@lumina/storage';
import { LibraryService } from './service.js';

let db: LuminaDatabase | undefined;
let tempRoot: string | undefined;

afterEach(async () => {
  if (db) closeDatabase(db);
  db = undefined;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('LibraryService IPC commands', () => {
  it('validates and executes the M1 library flow', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lumina-service-'));
    const libraryPath = path.join(tempRoot, 'library');
    await mkdir(libraryPath, { recursive: true });
    await writeFile(path.join(libraryPath, 'one.jpg'), 'one');
    db = openDatabase(':memory:');
    const service = new LibraryService(db);
    const scanned = await service.handle({ type: 'roots.addAndScan', absolutePath: libraryPath, label: '手机导入' }) as { task: { status: string }; media: Array<{ id: string }> };
    expect(scanned.task.status).toBe('completed');
    const album = await service.handle({ type: 'albums.create', name: '旅行', description: 'M1' }) as { id: string };
    await service.handle({ type: 'albums.addMedia', id: album.id, mediaIds: [scanned.media[0]!.id] });
    expect(await service.handle({ type: 'albums.media', id: album.id })).toHaveLength(1);
    await service.handle({ type: 'media.setTags', id: scanned.media[0]!.id, tagNames: ['旅行'] });
    expect(await service.handle({ type: 'media.search', query: '旅行' })).toHaveLength(1);
  });

  it('rejects malformed commands before touching storage', async () => {
    db = openDatabase(':memory:');
    const service = new LibraryService(db);
    await expect(service.handle({ type: 'media.list', limit: 0 })).rejects.toThrow();
  });
});
