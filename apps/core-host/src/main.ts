import { createInterface } from 'node:readline';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { getHealth, LibraryService } from '@lumina/core';
import { closeDatabase, openDatabase } from '@lumina/storage';

const databasePath = process.env.LUMINA_DB_PATH ?? path.resolve('data/lumina.db');
mkdirSync(path.dirname(databasePath), { recursive: true });
const db = openDatabase(databasePath);
const hostPending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
const service = new LibraryService(db, path.join(path.dirname(databasePath), 'thumbnails'), {
  defaultCacheRoot:process.env.LUMINA_DEFAULT_CACHE_DIR,
  notify: () => { if (process.argv.includes('--stdio')) process.stdout.write(`${JSON.stringify({ event: 'library-changed' })}\n`); },
  systemTrash: (file) => new Promise<void>((resolve, reject) => {
    const requestId = `trash-${Date.now()}-${Math.random()}`; hostPending.set(requestId, { resolve, reject });
    process.stdout.write(`${JSON.stringify({ event: 'system-trash', hostRequestId: requestId, path: file })}\n`);
  }),
});

if (process.argv.includes('--stdio')) {
  service.start();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', async (line) => {
    if (!line.trim()) return;
    const request = JSON.parse(line) as { requestId?: string; command?: unknown; hostResponseId?: string; ok?: boolean; error?: string };
    if (request.hostResponseId) {
      const pending = hostPending.get(request.hostResponseId); hostPending.delete(request.hostResponseId);
      if (request.ok) pending?.resolve(); else pending?.reject(new Error(request.error ?? '系统回收站失败，文件已保留')); return;
    }
    const requestId = request.requestId;
    try {
      const data = await service.handle(request.command ?? request);
      process.stdout.write(`${JSON.stringify({ requestId, ok: true, data })}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${JSON.stringify({ requestId, ok: false, error: message })}\n`);
    }
  });
  input.on('close', () => { service.close(); closeDatabase(db); });
} else {
  console.log(JSON.stringify({ service: 'lumina-core', databasePath, health: getHealth(db) }, null, 2));
  closeDatabase(db);
}
