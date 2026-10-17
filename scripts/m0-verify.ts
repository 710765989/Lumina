import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanDirectory, getHealth } from '@lumina/core';
import { closeDatabase, openDatabase } from '@lumina/storage';

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lumina-m0-'));
const mediaRoot = path.join(tempRoot, 'library');
await mkdir(path.join(mediaRoot, 'nested'), { recursive: true });
await writeFile(path.join(mediaRoot, 'one.jpg'), 'fixture-photo');
await writeFile(path.join(mediaRoot, 'nested', 'two.mp4'), 'fixture-video');
const db = openDatabase(path.join(tempRoot, 'lumina.db'));
try {
  const result = await scanDirectory(db, mediaRoot);
  const health = getHealth(db);
  if (health.foreignKeys !== 1 || health.mediaCount !== 2 || result.task.status !== 'completed') throw new Error(`M0 verification failed: ${JSON.stringify({ health, task: result.task })}`);
  console.log(JSON.stringify({ ok: true, mediaCount: health.mediaCount, task: result.task }, null, 2));
} finally {
  closeDatabase(db);
  await rm(tempRoot, { recursive: true, force: true });
}
