import { mkdir, unlink, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rawMedia, settings,applyDirectoryRules, listMediaTags, refreshMediaStats, reconcileAllCovers, mediaColumns, readMediaRows, type LuminaDatabase } from '@lumina/storage';
import { exists, moveExclusive, hashFile } from './file-operations.js';
import type {OrganizedMedia} from '@lumina/storage';
import {mediaOrder,type MediaSortBy} from '@lumina/storage';

type Entry = { media_id: string; original_path: string; stored_path: string; state: string; snapshot_json: string; expires_at: string | null; expiry_action: 'system' | 'permanent' };
export type BatchOutcome = { id: string; ok: boolean; error?: string; path?: string };
export class RecycleBin {
  private busy = new Set<string>();
  private cancelled = false;
  private attributedDirs=new Set<string>();
  constructor(private db: LuminaDatabase, private systemTrash?: (file: string) => Promise<void>,private onRemoved?:(media:OrganizedMedia)=>void) {}
  private forget(media:OrganizedMedia){this.db.transaction(()=>{this.db.prepare('DELETE FROM media_fts WHERE media_id=?').run(media.id);this.db.prepare('DELETE FROM media WHERE id=?').run(media.id);this.onRemoved?.(media);})();}
  private async deletionStat(media:OrganizedMedia,file:string,signal?:AbortSignal){
    try{return await lstat(file);}catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      // An absent/offline drive is not proof that the media was deleted.
      if(!(await stat(path.parse(path.resolve(file)).root)).isDirectory())throw error;
      try{return await lstat(file);}catch(second){if((second as NodeJS.ErrnoException).code!=='ENOENT')throw second;}
      if(signal?.aborted)throw new Error('已取消，未执行');this.forget(media);return undefined;
    }
  }
  list(limit = 200, offset = 0,sortBy?:MediaSortBy,sort?:'asc'|'desc') {
    return readMediaRows(this.db.prepare(`SELECT ${mediaColumns},x.original_path AS originalPath,x.stored_path AS storedPath,
      x.state,x.expires_at AS expiresAt,x.created_at AS deletedAt,x.expiry_action AS expiryAction FROM media m JOIN trash_entries x ON x.media_id=m.id
      ORDER BY ${sortBy?mediaOrder(sortBy,sort):'x.expires_at IS NULL,x.expires_at,x.media_id'} LIMIT ? OFFSET ?`).all(limit, offset));
  }
  ids(options:{sortBy?:MediaSortBy;sort?:'asc'|'desc';timeFromMs?:number;timeBeforeMs?:number}={}){
    const time=options.sortBy==='capturedAt'?'COALESCE(m.captured_at_ms,m.modified_at_ms)':'m.modified_at_ms';
    return (this.db.prepare(`SELECT m.id FROM media m JOIN trash_entries x ON x.media_id=m.id WHERE (? IS NULL OR ${time}>=?) AND (? IS NULL OR ${time}<?) ORDER BY ${mediaOrder(options.sortBy,options.sort)}`).all(options.timeFromMs??null,options.timeFromMs??null,options.timeBeforeMs??null,options.timeBeforeMs??null) as {id:string}[]).map(row=>row.id);
  }
  timeline(capturedTime=false){const time=capturedTime?'COALESCE(m.captured_at_ms,m.modified_at_ms)':'m.modified_at_ms';return this.db.prepare(`SELECT strftime('%Y-%m',${time}/1000,'unixepoch','localtime') AS month,COUNT(*) AS count FROM media m JOIN trash_entries x ON x.media_id=m.id GROUP BY month ORDER BY month DESC`).all() as {month:string;count:number}[];}
  stats():{total:number;sizeBytes:number}{
    return this.db.prepare('SELECT COUNT(*) AS total,COALESCE(SUM(m.size_bytes),0) AS sizeBytes FROM trash_entries x JOIN media m ON m.id=x.media_id').get() as {total:number;sizeBytes:number};
  }
  preview(ids: string[]) {
    const items = ids.map((id) => rawMedia(this.db, id)).filter((item) => !!item);
    const albums = new Set<string>();
    for (const item of items) for (const row of this.db.prepare('SELECT album_id FROM album_media WHERE media_id=?').all(item.id) as { album_id: string }[]) albums.add(row.album_id);
    return { count: items.length, sizeBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0), albumCount: albums.size };
  }
  async batch(ids: string[], action: (id: string) => Promise<void>,refresh=true): Promise<BatchOutcome[]> {
    if(!ids.length)return [];
    this.cancelled = false;
    const results: BatchOutcome[] = [];
    for (const id of [...new Set(ids)]) {
      if (this.cancelled) { results.push({ id, ok: false, error: '已取消，未执行' }); continue; }
      if (this.busy.has(id)) { results.push({ id, ok: false, error: '文件正在处理中' }); continue; }
      this.busy.add(id);
      try { await action(id); results.push({ id, ok: true }); }
      catch (error) { results.push({ id, ok: false, path: rawMedia(this.db,id)?.absolutePath, error: error instanceof Error ? error.message : String(error) }); }
      finally { this.busy.delete(id); }
    }
    if(refresh){refreshMediaStats(this.db);reconcileAllCovers(this.db);}return results;
  }
  cancel() { this.cancelled = true; }
  async put(id: string,signal?:AbortSignal) {
    const existing = this.db.prepare('SELECT * FROM trash_entries WHERE media_id=?').get(id) as Entry | undefined;
    const media = rawMedia(this.db, id); if (!media) throw new Error('媒体不存在');
    if(existing?.state==='stored'){await this.deletionStat(media,existing.stored_path,signal);return;}
    const current=!existing?await this.deletionStat(media,media.absolutePath,signal):undefined;if(!existing && !current)return;
    const config = settings(this.db);
    const stored = existing?.stored_path ?? path.join(path.dirname(media.absolutePath), '.lumina-trash', randomUUID(), path.basename(media.absolutePath));
    if (!existing) {
      if (current!.size !== media.sizeBytes || Math.abs(current!.mtimeMs - media.modifiedAtMs) > 1) throw new Error('文件已改变，请重新扫描后再删除');
      const cached=this.db.prepare('SELECT content_hash AS hash FROM media_details WHERE media_id=? AND hash_fingerprint=?').get(id,media.fingerprint) as {hash:string|null}|undefined;
      const snapshot = { media, sha256: cached?.hash??await hashFile(media.absolutePath,signal), tags: listMediaTags(this.db, id), albums: this.db.prepare('SELECT album_id FROM album_media WHERE media_id=?').all(id), hidden: media.hidden };
      this.db.prepare('INSERT INTO trash_entries(media_id,original_path,stored_path,state,snapshot_json,retention_days,expires_at,expiry_action) VALUES(?,?,?,\'moving\',?,?,?,?)')
        .run(id, media.absolutePath, stored, JSON.stringify(snapshot), config.retentionDays, config.retentionDays === null ? null : new Date(Date.now() + config.retentionDays * 86400000).toISOString(), config.expiryAction);
    }
    const snapshot = JSON.parse((this.db.prepare('SELECT snapshot_json FROM trash_entries WHERE media_id=?').get(id) as { snapshot_json: string }).snapshot_json);
    try {
      if (await exists(media.absolutePath)) {
        if (await exists(stored)) {
          if (await hashFile(stored,signal) !== snapshot.sha256 || await hashFile(media.absolutePath,signal) !== snapshot.sha256) throw new Error('回收区存在冲突，已保留两个文件');
          await unlink(media.absolutePath);
        } else await moveExclusive(media.absolutePath, stored, snapshot.sha256,signal);
      }
      else if (!await exists(stored)) throw new Error('原文件或所在目录不可用，未删除组织信息');
      this.db.prepare("UPDATE trash_entries SET state='stored' WHERE media_id=?").run(id);
      const trashDirectory=path.dirname(path.dirname(stored));if (process.platform === 'win32' && !this.attributedDirs.has(trashDirectory)) await promisify(execFile)('attrib.exe', ['+h', trashDirectory], { windowsHide: true }).then(()=>this.attributedDirs.add(trashDirectory)).catch(() => {});
    } catch (error) {
      if (await exists(media.absolutePath) && !await exists(stored)) this.db.prepare('DELETE FROM trash_entries WHERE media_id=?').run(id);
      throw error;
    }
  }
  async restore(id: string, directory?: string,signal?:AbortSignal) {
    const entry = this.db.prepare('SELECT * FROM trash_entries WHERE media_id=?').get(id) as Entry | undefined;
    if (!entry) throw new Error('回收站条目不存在');
    const snapshot = JSON.parse(entry.snapshot_json);
    const target = directory ? path.join(path.resolve(directory), path.basename(entry.original_path)) : entry.original_path;
    if (await exists(target)) {
      if (entry.state !== 'restoring' || snapshot.restoreTarget !== target || await hashFile(target,signal) !== snapshot.sha256) throw new Error('原位置已有同名文件，未覆盖；请选择其他还原目录');
      if (await exists(entry.stored_path)) {
        if (await hashFile(entry.stored_path,signal) !== snapshot.sha256) throw new Error('回收区文件已变化，请检查后重试');
        await unlink(entry.stored_path);
      }
      await this.finishRestore(id, target); return;
    }
    const managed = this.db.prepare('SELECT absolute_path AS path FROM library_roots WHERE enabled=1').all() as { path: string }[];
    if (!managed.some((root) => { const relative = path.relative(root.path, target); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); })) throw new Error('还原位置不在启用的图库目录内，请先添加/启用目录或重指定位置');
    // An absent root (e.g. disconnected disk) must not be recreated on another volume.
    const root = managed.find((root) => !path.relative(root.path, target).startsWith('..'));
    if (root) await stat(root.path);
    this.db.prepare("UPDATE trash_entries SET state='restoring',snapshot_json=? WHERE media_id=?").run(JSON.stringify({ ...snapshot, restoreTarget: target }), id);
    await moveExclusive(entry.stored_path, target, snapshot.sha256,signal);
    await this.finishRestore(id, target);
  }
  private async finishRestore(id: string, target: string) {
    const info=await lstat(target);
    if(!info.isFile())throw new Error('还原位置的文件类型已变化，请检查后重试');
    const fingerprint=createHash('sha256').update(`${target}\0${info.size}\0${info.mtimeMs}`).digest('hex');
    this.db.transaction(() => {
      this.db.prepare('UPDATE media SET absolute_path=?,file_name=?,size_bytes=?,modified_at_ms=?,fingerprint=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(target,path.basename(target),info.size,info.mtimeMs,fingerprint,id);
      this.db.prepare('UPDATE media_details SET file_identity=?,hash_fingerprint=NULL,missing=0 WHERE media_id=?').run(info.ino ? `${info.dev}:${info.ino}` : null,id);
      this.db.prepare('DELETE FROM trash_entries WHERE media_id=?').run(id);
      applyDirectoryRules(this.db,id,target);
      this.db.prepare('DELETE FROM media_fts WHERE media_id=?').run(id);
      this.db.prepare('INSERT INTO media_fts(media_id,searchable) SELECT id,absolute_path || \' \' || kind FROM media WHERE id=?').run(id);
    })();
  }
  async recover() {
    let changed=false;
    for (const entry of this.db.prepare("SELECT * FROM trash_entries WHERE state IN('moving','restoring')").all() as Entry[]) {
      try {
        const snapshot = JSON.parse(entry.snapshot_json);
        if (entry.state === 'moving' && !await exists(entry.original_path) && await exists(entry.stored_path) && await hashFile(entry.stored_path) === snapshot.sha256) { this.db.prepare("UPDATE trash_entries SET state='stored' WHERE media_id=?").run(entry.media_id);changed=true; }
        else if (entry.state === 'restoring' && snapshot.restoreTarget && !await exists(entry.stored_path) && await exists(snapshot.restoreTarget) && await hashFile(snapshot.restoreTarget) === snapshot.sha256) { await this.finishRestore(entry.media_id, snapshot.restoreTarget);changed=true; }
      } catch { /* Keep snapshots until the file or volume becomes available. */ }
    }
    if(changed)refreshMediaStats(this.db);
  }
  async purge(id: string, destination: 'system' | 'permanent',signal?:AbortSignal) {
    const entry = this.db.prepare('SELECT * FROM trash_entries WHERE media_id=?').get(id) as Entry | undefined;
    const media = rawMedia(this.db, id); if (!media) throw new Error('媒体不存在');
    const file = entry?.stored_path ?? media.absolutePath;
    if(entry && entry.state!=='stored')throw new Error('回收站条目正在移动或还原，请稍后重试');
    const before = await this.deletionStat(media,file,signal);if(!before)return;
    if (!before.isFile()) throw new Error('文件类型已变化，未删除；请重新扫描后检查');
    if (entry) {
      if (entry.state !== 'stored') throw new Error('回收站条目正在移动或还原，请稍后重试');
      const snapshot = JSON.parse(entry.snapshot_json);
      if (!snapshot.sha256 || await hashFile(file,signal) !== snapshot.sha256) throw new Error('回收区文件内容已变化，已保留文件和记录');
    } else {
      const details = this.db.prepare('SELECT file_identity AS identity,content_hash AS hash,hash_fingerprint AS fingerprint FROM media_details WHERE media_id=?').get(id) as { identity: string | null; hash: string | null; fingerprint: string | null } | undefined;
      if (before.size !== media.sizeBytes || Math.abs(before.mtimeMs - media.modifiedAtMs) > 1 ||
          details?.identity && details.identity !== `${before.dev}:${before.ino}` ||
          details?.hash && details.fingerprint === media.fingerprint && await hashFile(file,signal) !== details.hash) {
        throw new Error('文件已改变，请重新扫描后再删除');
      }
    }
    // Hashing yields to the filesystem: verify that the same file is still there.
    const after = await lstat(file);
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('文件在检查过程中变化，已保留文件');
    if(signal?.aborted)throw new Error('已取消，未执行');
    if (destination === 'system') {
      if (!this.systemTrash) throw new Error('系统回收站不可用，原文件已保留');
      await this.systemTrash(file);
    } else await unlink(file);
    this.forget(media);
  }
  async expired(protectedIds: string[]) {
    // A nonempty selection freezes the expiry sweep, preventing reordering under a user.
    if (protectedIds.length) return [];
    const entries = this.db.prepare("SELECT * FROM trash_entries WHERE state='stored' AND expires_at IS NOT NULL AND expires_at<=?").all(new Date().toISOString()) as Entry[];
    return this.batch(entries.map((entry) => entry.media_id), (id) => this.purge(id, entries.find((entry) => entry.media_id === id)!.expiry_action));
  }
}
