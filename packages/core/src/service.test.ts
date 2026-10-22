import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { closeDatabase, openDatabase, type LuminaDatabase } from '@lumina/storage';
import { LibraryService } from './service.js';

let db: LuminaDatabase | undefined;
let tempRoot: string | undefined;

afterEach(async () => {
  if (db) closeDatabase(db);
  db = undefined;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  tempRoot = undefined;
});

describe('LibraryService IPC commands', () => {
  it('validates and executes the M1 library flow', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lumina-service-'));
    const libraryPath = path.join(tempRoot, 'library');
    await mkdir(libraryPath, { recursive: true });
    await writeFile(path.join(libraryPath, 'one.jpg'), await sharp({ create: { width: 120, height: 80, channels: 3, background: '#3478d4' } }).jpeg().toBuffer());
    db = openDatabase(':memory:');
    const service = new LibraryService(db, path.join(tempRoot, 'thumbs'));
    const scanned = await service.handle({ type: 'roots.addAndScan', absolutePath: libraryPath, label: '手机导入' }) as { task: { status: string }; media: Array<{ id: string }> };
    expect(scanned.task.status).toBe('completed');
    const album = await service.handle({ type: 'albums.create', name: '旅行', description: 'M1' }) as { id: string };
    await service.handle({ type: 'albums.addMedia', id: album.id, mediaIds: [scanned.media[0]!.id] });
    expect(await service.handle({ type: 'albums.media', id: album.id })).toHaveLength(1);
    await service.handle({ type: 'media.setTags', id: scanned.media[0]!.id, tagNames: ['旅行'] });
    expect(await service.handle({ type: 'media.search', query: '旅行' })).toHaveLength(1);
    const thumbnail = await service.handle({ type: 'media.thumbnail', id: scanned.media[0]!.id, width: 96, height: 96 }) as { taskId: string; bytes: number };
    expect(thumbnail.taskId).toBeTruthy();
    expect(thumbnail.bytes).toBeGreaterThan(0);
    expect(db.prepare("SELECT status FROM tasks WHERE id=?").get(thumbnail.taskId)).toEqual({ status: 'completed' });
    expect(await service.handle({ type: 'tasks.list', limit: 10 })).toHaveLength(2);
    const cached = await service.handle({ type: 'media.thumbnail', id: scanned.media[0]!.id, width: 96, height: 96 }) as { taskId: string | null; cached: boolean; bytes: number };
    expect(cached).toMatchObject({ taskId: null, cached: true });
    expect(cached.bytes).toBeGreaterThan(0);
    expect(await service.handle({ type: 'tasks.list', limit: 10 })).toHaveLength(2);
    const retried = await service.handle({ type: 'tasks.retryThumbnail', id: thumbnail.taskId }) as { taskId: string; bytes: number };
    expect(retried.taskId).toBe(thumbnail.taskId);
    expect(retried.bytes).toBeGreaterThan(0);
  });

  it('rejects malformed commands before touching storage', async () => {
    db = openDatabase(':memory:');
    const service = new LibraryService(db);
    await expect(service.handle({ type: 'media.list', limit: 0 })).rejects.toThrow();
  });

  it('persists album edits and tag renames, and deletes labels without deleting files or album members', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lumina-organization-'));
    const libraryPath = path.join(tempRoot, 'library');
    await mkdir(libraryPath);
    const filePath = path.join(libraryPath, 'one.jpg');
    await writeFile(filePath, await sharp({ create: { width: 80, height: 60, channels: 3, background: '#3478d4' } }).jpeg().toBuffer());
    const databasePath = path.join(tempRoot, 'lumina.db');
    db = openDatabase(databasePath);
    let service = new LibraryService(db);
    const scanned = await service.handle({ type: 'roots.addAndScan', absolutePath: libraryPath }) as { media: Array<{ id: string }> };
    const mediaId = scanned.media[0]!.id;
    const album = await service.handle({ type: 'albums.create', name: '旅行', description: '周末' }) as { id: string };
    await expect(service.handle({ type: 'albums.create', name: ' 旅行 ' })).rejects.toThrow('已存在');
    await service.handle({ type: 'albums.addMedia', id: album.id, mediaIds: [mediaId] });
    await service.handle({ type: 'albums.update', id: album.id, name: '周末旅行', description: '更新描述' });
    const tag = await service.handle({ type: 'tags.create', name: '海边' }) as { id: string };
    const other = await service.handle({ type: 'tags.create', name: '海边日落' }) as { id: string };
    await service.handle({ type: 'media.addTag', id: mediaId, tagName: '海边' });
    await expect(service.handle({ type: 'tags.rename', id: tag.id, name: '海边日落' })).rejects.toThrow('已存在');
    await service.handle({ type: 'tags.rename', id: tag.id, name: '沙滩' });
    expect(await service.handle({ type: 'tags.media', id: other.id })).toHaveLength(0);
    expect(await service.handle({ type: 'tags.media', id: tag.id })).toHaveLength(1);
    expect(await service.handle({ type: 'media.tags', id: mediaId })).toEqual([{ id: tag.id, name: '沙滩',englishName:'' }]);
    closeDatabase(db); db = openDatabase(databasePath); service = new LibraryService(db);
    expect(await service.handle({ type: 'albums.list' })).toEqual([expect.objectContaining({ id: album.id, name: '周末旅行', description: '更新描述' })]);
    expect(await service.handle({ type: 'tags.media', id: tag.id })).toHaveLength(1);
    await service.handle({ type: 'tags.delete', id: tag.id });
    expect(await service.handle({ type: 'media.tags', id: mediaId })).toHaveLength(0);
    expect(await service.handle({ type: 'albums.media', id: album.id })).toHaveLength(1);
    expect(await service.handle({ type: 'media.list' })).toHaveLength(1);
    const { stat } = await import('node:fs/promises');
    expect((await stat(filePath)).isFile()).toBe(true);
  });
});

it('groups a concurrent thumbnail batch into one task with per-file snapshots and targeted failed retry',async()=>{
 tempRoot=await mkdtemp(path.join(os.tmpdir(),'lumina-thumb-batch-'));const library=path.join(tempRoot,'files');await mkdir(library);for(let n=0;n<6;n++)await writeFile(path.join(library,`file-${n}.jpg`),await sharp({create:{width:64,height:48,channels:3,background:'blue'}}).jpeg().toBuffer());db=openDatabase(path.join(tempRoot,'library.db'));const service=new LibraryService(db,path.join(tempRoot,'cache'));await service.handle({type:'roots.addAndScan',absolutePath:library});const media=await service.handle({type:'media.list'}) as any[];
 const results=await Promise.all(media.map(item=>service.handle({type:'media.thumbnail',id:item.id,width:96,height:96}))) as any[];expect(new Set(results.map(item=>item.taskId)).size).toBe(1);const page=await service.handle({type:'tasks.page',limit:10}) as any;expect(page.items.filter((item:any)=>item.kind==='thumbnail')).toHaveLength(1);const detail=await service.handle({type:'jobs.result',id:results[0].taskId}) as any;expect(detail).toMatchObject({total:6,processed:6,status:'completed'});expect(detail.items.every((item:any)=>item.fileName && item.path && item.sizeBytes>0)).toBe(true);db.prepare("UPDATE job_items SET status='failed',error='simulated transient failure' WHERE task_id=? AND media_id=?").run(results[0].taskId,media[0].id);const retry=await service.handle({type:'tasks.retryThumbnail',id:results[0].taskId}) as any;expect(retry.cached).toBe(true);expect((await service.handle({type:'jobs.result',id:results[0].taskId}) as any)).toMatchObject({total:6,processed:6,status:'completed'});service.close();
});

it('keeps a cancelled thumbnail batch stopped when an active image completes and resumes only unfinished items',async()=>{
  tempRoot=await mkdtemp(path.join(os.tmpdir(),'lumina-cancel-thumb-'));const folder=path.join(tempRoot,'library');await mkdir(folder);await sharp({create:{width:1800,height:1300,channels:3,background:'#3d87d8'}}).jpeg().toFile(path.join(folder,'cancel.jpg'));db=openDatabase(':memory:');const service=new LibraryService(db,path.join(tempRoot,'thumbs'));
  const result:any=await service.handle({type:'roots.addAndScan',absolutePath:folder});const pending=service.handle({type:'media.thumbnail',id:result.media[0].id,width:480,height:320});let task:any;
  for(let i=0;i<100&&!task;i++){task=db.prepare("SELECT id FROM tasks WHERE kind='thumbnail'").get();if(!task)await new Promise(resolve=>setTimeout(resolve,1));}
  expect(task).toBeTruthy();await service.handle({type:'jobs.control',id:task.id,action:'cancel'});await pending.catch(()=>{});expect((db.prepare('SELECT status FROM tasks WHERE id=?').get(task.id) as any).status).toBe('cancelled');
  await service.handle({type:'jobs.control',id:task.id,action:'resume'});expect((db.prepare('SELECT status FROM tasks WHERE id=?').get(task.id) as any).status).toBe('completed');service.close();
});
