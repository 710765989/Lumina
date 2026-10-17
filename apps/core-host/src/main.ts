import { createInterface } from 'node:readline';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { getHealth, LibraryService } from '@lumina/core';
import { closeDatabase, openDatabase } from '@lumina/storage';

const databasePath = process.env.LUMINA_DB_PATH ?? path.resolve('data/lumina.db');
mkdirSync(path.dirname(databasePath), { recursive: true });
const db = openDatabase(databasePath);
const service = new LibraryService(db);

if (process.argv.includes('--stdio')) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', async (line) => {
    if (!line.trim()) return;
    try {
      const data = await service.handle(JSON.parse(line));
      process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    }
  });
  input.on('close', () => closeDatabase(db));
} else {
  console.log(JSON.stringify({ service: 'lumina-core', databasePath, health: getHealth(db) }, null, 2));
  closeDatabase(db);
}
