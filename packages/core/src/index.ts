import {cacheInventoryChanged} from './storage-cache.js';
import {orderedScanReads,scanMetadataRead} from './scan-reads.js';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
// Persistent previews already live in our disk cache. Vips must release source
// file handles so a photo can be moved/deleted immediately after viewing on Windows.
sharp.cache(false);
import { extractMetadata,scannedGeography } from './geography.js';
import { probeVideoMetadata } from './thumbnail.js';
import type { MediaKind, MediaRecord, TaskRecord, TaskStatus } from '@lumina/contracts';
import {
  addLibraryRoot,applyDirectoryRules,directoryRuleContext,
  listLibraryRoots,
  refreshMediaStats,
  syncMediaSearchIndex,
  type LibraryRootRecord,
  type LuminaDatabase,
} from '@lumina/storage';

const photoExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.avif', '.tif', '.tiff', '.raw', '.cr2', '.nef', '.arw', '.dng']);
const videoExtensions = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);

function exifNumber(buffer: Buffer, offset: number, littleEndian: boolean, bytes: 2 | 4): number {
  return bytes === 2
    ? (littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset))
    : (littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset));
}

function exifAscii(buffer: Buffer, tiffOffset: number, ifdOffset: number, tagId: number): string | undefined {
  const littleEndian = buffer.toString('ascii', tiffOffset, tiffOffset + 2) === 'II';
  const ifd = tiffOffset + ifdOffset;
  if (ifd < 0 || ifd + 2 > buffer.length) return undefined;
  const count = exifNumber(buffer, ifd, littleEndian, 2);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > buffer.length) break;
    if (exifNumber(buffer, entry, littleEndian, 2) !== tagId) continue;
    const type = exifNumber(buffer, entry + 2, littleEndian, 2);
    const valueCount = exifNumber(buffer, entry + 4, littleEndian, 4);
    if (type !== 2 || valueCount === 0) return undefined;
    const valueBytes = valueCount;
    const valueOffset = valueBytes <= 4 ? entry + 8 : tiffOffset + exifNumber(buffer, entry + 8, littleEndian, 4);
    if (valueOffset < 0 || valueOffset + valueBytes > buffer.length) return undefined;
    return buffer.toString('ascii', valueOffset, valueOffset + valueBytes).replace(/\0.*$/u, '').trim();
  }
  return undefined;
}

function exifLong(buffer: Buffer, tiffOffset: number, ifdOffset: number, tagId: number): number | undefined {
  const littleEndian = buffer.toString('ascii', tiffOffset, tiffOffset + 2) === 'II';
  const ifd = tiffOffset + ifdOffset;
  if (ifd < 0 || ifd + 2 > buffer.length) return undefined;
  const count = exifNumber(buffer, ifd, littleEndian, 2);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > buffer.length) break;
    if (exifNumber(buffer, entry, littleEndian, 2) !== tagId) continue;
    const type = exifNumber(buffer, entry + 2, littleEndian, 2);
    const valueCount = exifNumber(buffer, entry + 4, littleEndian, 4);
    if (type !== 4 || valueCount < 1) return undefined;
    return exifNumber(buffer, entry + 8, littleEndian, 4);
  }
  return undefined;
}

function parseExifDate(value: string | undefined): number | null {
  const match = value?.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/u);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

async function readCaptureTimeMs(filePath: string, kind: MediaKind): Promise<number | null> {
  if (kind !== 'photo') return null;
  try {
    const metadata = await sharp(filePath, { failOn: 'none' }).metadata();
    const exif = metadata.exif;
    if (!exif || exif.length < 14 || exif.toString('ascii', 0, 6) !== 'Exif\0\0') return null;
    const tiffOffset = 6;
    const littleEndian = exif.toString('ascii', tiffOffset, tiffOffset + 2) === 'II';
    if (exifNumber(exif, tiffOffset + 2, littleEndian, 2) !== 42) return null;
    const ifd0Offset = exifNumber(exif, tiffOffset + 4, littleEndian, 4);
    const exifIfdOffset = exifLong(exif, tiffOffset, ifd0Offset, 0x8769);
    const original = parseExifDate(exifIfdOffset === undefined ? undefined : exifAscii(exif, tiffOffset, exifIfdOffset, 0x9003));
    if (original !== null) return original;
    const digitized = parseExifDate(exifIfdOffset === undefined ? undefined : exifAscii(exif, tiffOffset, exifIfdOffset, 0x9004));
    if (digitized !== null) return digitized;
    return parseExifDate(exifAscii(exif, tiffOffset, ifd0Offset, 0x0132));
  } catch {
    return null;
  }
}

export function mediaKindFromPath(filePath: string): MediaKind {
  const ext = path.extname(filePath).toLowerCase();
  if (photoExtensions.has(ext)) return 'photo';
  if (videoExtensions.has(ext)) return 'video';
  return 'unknown';
}

export async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== '.lumina-trash' && !entry.name.startsWith('.lumina-export-')) await visit(next);
      else if (entry.isFile()) result.push(next);
    }
  }
  await visit(root);
  return result.sort((a, b) => a.localeCompare(b));
}

type ScanOptions = { continueIf?:()=>boolean;taskId?: string; rootId?: string; notify?: () => void; retryFiles?: string[]; changedPaths?: string[] };
type ScanResult = { task: TaskRecord; media: MediaRecord[] };
const scanFlights = new WeakMap<LuminaDatabase,Map<string,Promise<ScanResult>>>();
const scanOwners = new WeakMap<LuminaDatabase,Map<string,string|undefined>>();
export function scanIsActive(db:LuminaDatabase,root:string) { return scanFlights.get(db)?.has(path.resolve(root).toLocaleLowerCase()) ?? false; }
export async function scanDirectory(db: LuminaDatabase, root: string, options: ScanOptions = {}): Promise<ScanResult> {
  let flights=scanFlights.get(db);if(!flights){flights=new Map();scanFlights.set(db,flights);}
  let owners=scanOwners.get(db);if(!owners){owners=new Map();scanOwners.set(db,owners);}
  const key=path.resolve(root).toLocaleLowerCase();const existing=flights.get(key);
  if(existing){if(!options.taskId && !options.changedPaths && (!options.rootId || owners.get(key)===options.rootId))return existing;await existing.catch(()=>{});return scanDirectory(db,root,options);}
  const request=performScanDirectory(db,root,options).finally(()=>{flights!.delete(key);owners!.delete(key);});owners.set(key,options.rootId);flights.set(key,request);return request;
}
async function performScanDirectory(db: LuminaDatabase, root: string, options: ScanOptions): Promise<ScanResult> {
  const managedId = options.rootId ?? listLibraryRoots(db).find((item) => path.resolve(item.absolutePath).toLocaleLowerCase() === path.resolve(root).toLocaleLowerCase())?.id;
  const rootKey=path.resolve(root).toLocaleLowerCase(),rootState=db.prepare('SELECT enabled,absolute_path AS path FROM library_roots WHERE id=?');
  const available=()=>{if(options.continueIf&&!options.continueIf())return false;if(!managedId)return true;const row=rootState.get(managedId) as {enabled:number;path:string}|undefined;return Boolean(row?.enabled&&path.resolve(row.path).toLocaleLowerCase()===rootKey);};
  if (!available()) throw new Error('图库目录已移除或停用，未启动扫描');
  const directoryContext=directoryRuleContext(db);
  const changedFiles: string[]=[];let missingChanged=false;
  if(options.changedPaths)for(const changed of [...new Set(options.changedPaths)]){
    const relative=path.relative(root,changed);if(relative==='..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))continue;
    try {const info=await stat(changed);if(info.isDirectory())changedFiles.push(...await listFiles(changed));else if(info.isFile())changedFiles.push(changed);}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT' && available())for(const row of db.prepare('SELECT id,absolute_path AS path FROM media WHERE absolute_path=? OR absolute_path LIKE ? ESCAPE char(92)').all(changed,`${(changed+path.sep).replace(/[\\%_]/gu,'\\$&')}%`) as {id:string;path:string}[])missingChanged=Boolean(db.prepare('INSERT INTO media_details(media_id,missing) VALUES(?,1) ON CONFLICT(media_id) DO UPDATE SET missing=1 WHERE media_details.missing<>1').run(row.id).changes)||missingChanged;}
  }
  let files = (options.retryFiles ?? (options.changedPaths ? [...new Set(changedFiles)] : await listFiles(root))).filter((filePath) => mediaKindFromPath(filePath) !== 'unknown');
  if(options.changedPaths){
    const changed:string[]=[];
    for(const file of files){
      try{const info=await stat(file),fingerprint=createHash('sha256').update(`${file}\0${info.size}\0${info.mtimeMs}`).digest('hex');
        const previous=db.prepare('SELECT m.fingerprint,d.missing FROM media m LEFT JOIN media_details d ON d.media_id=m.id WHERE m.absolute_path=?').get(file) as {fingerprint:string;missing:number}|undefined;
        if(previous?.fingerprint!==fingerprint || previous.missing!==0)changed.push(file);
      }catch{changed.push(file);}
    }
    files=changed;
    if(!files.length){if(missingChanged){refreshMediaStats(db);cacheInventoryChanged(db);options.notify?.();}const prior=db.prepare("SELECT id,kind,status,processed,total,error_code AS errorCode FROM tasks WHERE kind='scan' AND status='completed' AND json_extract(payload_json,'$.rootId')=? AND json_extract(payload_json,'$.incremental')=1 ORDER BY created_at DESC LIMIT 1").get(managedId) as TaskRecord|undefined;return {task:prior??{id:'unchanged',kind:'scan',status:'completed',processed:0,total:0,errorCode:null},media:[]};}
  }
  if (!available()) throw new Error('图库目录已移除或停用，未启动扫描');
  const priorBackground=options.changedPaths ? db.prepare("SELECT id FROM tasks WHERE kind='scan' AND status='completed' AND json_extract(payload_json,'$.rootId')=? AND json_extract(payload_json,'$.incremental')=1 ORDER BY created_at DESC LIMIT 1").get(managedId) as {id:string}|undefined : undefined;
  const taskId = options.taskId ?? priorBackground?.id ?? randomUUID();
  const previousTask = options.retryFiles ? db.prepare('SELECT total,processed FROM tasks WHERE id=?').get(taskId) as {total:number;processed:number} | undefined : undefined;
  const completedBefore = previousTask ? Math.max(0,previousTask.processed-files.length) : 0;
  const total = previousTask?.total ?? files.length;
  db.prepare("DELETE FROM media_fts WHERE media_id IN (SELECT id FROM media WHERE kind='unknown')").run();
  db.prepare("DELETE FROM media WHERE kind='unknown'").run();
  db.prepare("INSERT INTO tasks(id, kind, status, total,processed,payload_json) VALUES (?, 'scan', 'running', ?,?,?) ON CONFLICT(id) DO UPDATE SET status='running',total=excluded.total,processed=excluded.processed,error_message=NULL,payload_json=excluded.payload_json").run(taskId, total, completedBefore, JSON.stringify({ root, rootId: managedId, incremental:Boolean(options.changedPaths) }));
  db.prepare('DELETE FROM job_items WHERE task_id=?').run(taskId);
  const insert = db.prepare(`INSERT INTO media(id, absolute_path, kind, size_bytes, modified_at_ms, captured_at_ms, fingerprint,file_name)
    VALUES (@id, @absolutePath, @kind, @sizeBytes, @modifiedAtMs, @capturedAtMs, @fingerprint,@fileName)
    ON CONFLICT(absolute_path) DO UPDATE SET kind=excluded.kind, size_bytes=excluded.size_bytes,
      modified_at_ms=excluded.modified_at_ms, captured_at_ms=excluded.captured_at_ms, fingerprint=excluded.fingerprint,file_name=excluded.file_name, updated_at=CURRENT_TIMESTAMP`);
  const media: MediaRecord[] = [];
  const failures: Array<{ path: string; error: string }> = [];
  let processed = completedBefore;
  let lastNotify=Date.now(),lastStats=Date.now();
  const taskState=db.prepare('SELECT status FROM tasks WHERE id=?');
  const running=()=>available() && (taskState.get(taskId) as {status:string}|undefined)?.status==='running';
  const read=async(filePath:string)=>{
    if(!running())return null;
    return scanMetadataRead(mediaKindFromPath(filePath)==='video',async()=>{
      if(!running())return null;
    const info = await stat(filePath);
    const kind = mediaKindFromPath(filePath);
    const previous = db.prepare('SELECT m.id,m.fingerprint,m.captured_at_ms AS capturedAtMs,d.metadata_json AS metadata,d.missing,d.file_identity AS fileIdentity FROM media m LEFT JOIN media_details d ON d.media_id=m.id WHERE m.absolute_path=?').get(filePath) as {id:string;fingerprint:string;capturedAtMs:number|null;metadata:string|null;missing:number;fileIdentity:string|null}|undefined;
    const unchanged = previous?.fingerprint === createHash('sha256').update(`${filePath}\0${info.size}\0${info.mtimeMs}`).digest('hex');
    const savedMetadata=previous?.metadata ? JSON.parse(previous.metadata) : null;
    const metadata = unchanged && savedMetadata?.width ? savedMetadata : kind === 'photo' ? scannedGeography(await extractMetadata(filePath),savedMetadata??{}) : await probeVideoMetadata(filePath);
      return {info,kind,previous,unchanged,savedMetadata,metadata};
    });
  };
  for await (const result of orderedScanReads(files,read)) {
    const filePath=result.filePath;
    if(!running())break;
    try {
    if(result.error)throw result.error;
    if(!result.value)break;
    const {info,kind,previous,unchanged,savedMetadata,metadata}=result.value;
    const capturedAtMs = 'capturedAtMs' in metadata && typeof metadata.capturedAtMs === 'number' ? metadata.capturedAtMs : null;
    const fingerprint = createHash('sha256').update(`${filePath}\0${info.size}\0${info.mtimeMs}`).digest('hex');
    let id = createHash('sha256').update(filePath).digest('hex').slice(0, 32);
    const existing = db.prepare('SELECT id FROM media WHERE absolute_path=?').get(filePath) as { id: string } | undefined;
    if (existing) id = existing.id;
    else if (info.ino) {
      const previous = db.prepare('SELECT m.id,m.absolute_path AS path FROM media m JOIN media_details d ON d.media_id=m.id WHERE d.file_identity=? AND NOT EXISTS(SELECT 1 FROM trash_entries t WHERE t.media_id=m.id)').get(`${info.dev}:${info.ino}`) as { id: string; path: string } | undefined;
      if (previous) {
        let missing = false; try { await stat(previous.path); } catch (error) { missing = (error as NodeJS.ErrnoException).code === 'ENOENT'; }
        if (missing && running()) { id = previous.id; db.prepare('UPDATE media SET absolute_path=? WHERE id=?').run(filePath, id); }
      }
    }
    const record = { id, absolutePath: filePath, kind, sizeBytes: info.size, modifiedAtMs: info.mtimeMs, capturedAtMs, fingerprint };
    // A root may be disabled/removed while EXIF or filesystem reads are pending.
    if(!available() || (db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId) as {status:string}).status!=='running')break;
    if(!(unchanged && savedMetadata && previous?.missing===0 && previous?.fileIdentity)) db.transaction(() => {
      insert.run({ ...record,fileName: path.basename(filePath) });
      db.prepare(`INSERT INTO media_details(media_id,metadata_json,file_identity,missing) VALUES(?,?,?,0)
        ON CONFLICT(media_id) DO UPDATE SET metadata_json=json_patch(media_details.metadata_json,excluded.metadata_json),file_identity=excluded.file_identity,missing=0`).run(id, JSON.stringify(metadata), info.ino ? `${info.dev}:${info.ino}` : null);
      syncMediaSearchIndex(db, record);
    })();
    db.transaction(()=>applyDirectoryRules(db,id,filePath,directoryContext))();
    media.push(record);
    } catch (error) {
      const message=error instanceof Error ? error.message : String(error);failures.push({ path: filePath, error: message });
      const fileId=createHash('sha256').update(filePath).digest('hex').slice(0,32);
      db.prepare("INSERT OR REPLACE INTO job_items(task_id,media_id,status,error,file_path,ordinal) VALUES(?,?,'failed',?,?,?)").run(taskId,fileId,message,filePath,processed+1);
    }
    processed++;
    if(processed%32===0 || processed===total) db.prepare('UPDATE tasks SET processed=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(processed, taskId);
    if(Date.now()-lastNotify>=1000 || processed===total){if(Date.now()-lastStats>=5000){refreshMediaStats(db);lastStats=Date.now();}options.notify?.();lastNotify=Date.now();}
    if(processed%32===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  if (available() && !options.retryFiles && !options.changedPaths && processed === files.length) {
    const indexed = new Set(media.map((record) => record.id));
    for (const row of db.prepare('SELECT m.id,m.absolute_path AS path FROM media m WHERE NOT EXISTS(SELECT 1 FROM trash_entries t WHERE t.media_id=m.id)').all() as { id: string; path: string }[]) {
      const relative = path.relative(root, row.path);
      if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) && !indexed.has(row.id)) {
        missingChanged=Boolean(db.prepare('INSERT INTO media_details(media_id,missing) VALUES(?,1) ON CONFLICT(media_id) DO UPDATE SET missing=1 WHERE media_details.missing<>1').run(row.id).changes)||missingChanged;
      }
    }
  }
  db.prepare('UPDATE tasks SET processed=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(processed,taskId);
  refreshMediaStats(db);
  db.prepare("UPDATE tasks SET status=?, processed=?,error_message=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running'").run(failures.length ? 'failed' : 'completed', processed, failures.length ? `${failures.length} 个文件无法识别或读取，可查看明细并仅重试失败项` : null, taskId);
  if(processed===total)cacheInventoryChanged(db);
  options.notify?.();
  const row = db.prepare('SELECT id, kind, status, processed, total, error_code as errorCode FROM tasks WHERE id=?').get(taskId) as TaskRecord;
  return { task: row, media };
}

export async function addAndScanLibraryRoot(
  db: LuminaDatabase,
  absolutePath: string,
  label = absolutePath,
): Promise<{ root: LibraryRootRecord; task: TaskRecord; media: MediaRecord[] }> {
  const root = addLibraryRoot(db, absolutePath, label);
  const result = await scanDirectory(db, absolutePath, {rootId:root.id});
  return { root, ...result };
}

export async function scanEnabledLibraryRoots(
  db: LuminaDatabase,
): Promise<Array<{ root: LibraryRootRecord; task: TaskRecord; media: MediaRecord[] }>> {
  const results: Array<{ root: LibraryRootRecord; task: TaskRecord; media: MediaRecord[] }> = [];
  for (const root of listLibraryRoots(db).filter((item) => item.enabled)) {
    results.push({ root, ...(await scanDirectory(db, root.absolutePath, {rootId:root.id})) });
  }
  return results;
}

export function getHealth(db: LuminaDatabase): { journalMode: string; foreignKeys: number; mediaCount: number } {
  return {
    journalMode: String(db.pragma('journal_mode', { simple: true })),
    foreignKeys: Number(db.pragma('foreign_keys', { simple: true })),
    mediaCount: Number((db.prepare('SELECT COUNT(*) AS count FROM media').get() as {count: number}).count),
  };
}

export function updateTaskStatus(db: LuminaDatabase, id: string, status: TaskStatus): void {
  db.prepare('UPDATE tasks SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, id);
}

export { LibraryService } from './service.js';
export { generateMediaThumbnail, generatePhotoThumbnail, generateVideoThumbnail, getCachedThumbnail, thumbnailCachePath, type ThumbnailOptions, type ThumbnailResult } from './thumbnail.js';
