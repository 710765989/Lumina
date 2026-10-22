import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,symlink,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {openDatabase,closeDatabase,type LuminaDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';
import {StorageCacheManager} from './storage-cache.js';
let root:string,cache:string,db:LuminaDatabase,service:LibraryService,media:any[],manager:StorageCacheManager;
const command=(input:unknown):Promise<any>=>service.handle(input);
async function finished(id:string){for(let i=0;i<500;i++){const task=db.prepare('SELECT status,processed,total FROM tasks WHERE id=?').get(id) as {status:string;processed:number;total:number};if(!manager.isActive(id)&&['completed','failed','cancelled','paused'].includes(task.status))return task;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('cleanup timeout');}
beforeEach(async()=>{
 root=await mkdtemp(path.join(os.tmpdir(),'lumina-cache-report-'));cache=path.join(root,'cache');const library=path.join(root,'photos');await mkdir(library);await mkdir(cache);
 await sharp({create:{width:80,height:60,channels:3,background:'blue'}}).jpeg().toFile(path.join(library,'photo.jpg'));await sharp({create:{width:80,height:60,channels:3,background:'green'}}).png().toFile(path.join(library,'photo.png'));
 db=openDatabase(path.join(root,'library.db'));service=new LibraryService(db,cache);await command({type:'roots.addAndScan',absolutePath:library});media=await command({type:'media.list'});manager=service.organization.storage;
});
afterEach(async()=>{manager.close();service.close();for(let i=0;i<100&&media?.some(row=>manager.isActive(row.id));i++)await new Promise(resolve=>setTimeout(resolve,5));closeDatabase(db);await rm(root,{recursive:true,force:true,maxRetries:4});});
it('attributes thumbnail/preview bytes by format/year, preserves unassigned totals and counts database WAL files',async()=>{
 const thumbs=await Promise.all(media.map(item=>command({type:'media.thumbnail',id:item.id})));const preview=await command({type:'media.previewPath',id:media[0].id});await writeFile(path.join(cache,'preview-'+'a'.repeat(64)+'.png'),Buffer.alloc(37));await writeFile(path.join(cache,'notes.txt'),'keep');
 const report=await command({type:'storage.report'}),sum=thumbs.reduce((total,row)=>total+row.bytes,0)+(await stat(preview.cachePath)).size;
 expect(report.cacheBytes).toBe(sum+37+4);expect(report.formats.reduce((total:number,row:any)=>total+row.cacheBytes,0)).toBe(sum);expect(report.years.reduce((total:number,row:any)=>total+row.cacheBytes,0)).toBe(sum);expect(report.unassignedCacheBytes).toBe(41);expect(report.otherCacheBytes).toBe(4);expect(report.originalBytes).toBe(media.reduce((total,row)=>total+row.sizeBytes,0));expect(report.indexBytes).toBeGreaterThan(0);
});
it('scoped cleanup runs once in the background and leaves original files, tags, albums, other formats and database intact',async()=>{
 const photo=media.find(item=>item.absolutePath.endsWith('.jpg')),other=media.find(item=>item.id!==photo.id);await command({type:'media.addTag',id:photo.id,tagName:'保留标签'});const album=await command({type:'albums.create',name:'保留相册'});await command({type:'albums.addMedia',id:album.id,mediaIds:[photo.id]});
 const one=await command({type:'media.thumbnail',id:photo.id}),two=await command({type:'media.thumbnail',id:other.id});const before=await readFile(photo.absolutePath),plan=await manager.preview({scope:'format',value:'jpg'});expect(plan.count).toBe(1);expect(plan.bytes).toBe(one.bytes);
 const first=manager.start(plan.token);expect(manager.start(plan.token)).toEqual(first);const task=await finished(first.id);expect(task.status).toBe('completed');expect(task.processed).toBe(task.total);await expect(stat(one.cachePath)).rejects.toThrow();expect((await stat(two.cachePath)).size).toBeGreaterThan(0);expect(await readFile(photo.absolutePath)).toEqual(before);expect((await command({type:'media.tags',id:photo.id}))[0].name).toBe('保留标签');expect(await command({type:'albums.media',id:album.id})).toHaveLength(1);expect((await command({type:'media.thumbnail',id:photo.id})).bytes).toBeGreaterThan(0);
});
it('skips files regenerated after confirmation and files that are being written',async()=>{
 const thumbnail=await command({type:'media.thumbnail',id:media[0].id}),plan=await manager.preview({scope:'all'});await writeFile(thumbnail.cachePath,Buffer.alloc(thumbnail.bytes+5));const job=manager.start(plan.token);expect((await finished(job.id)).status).toBe('failed');expect((await stat(thumbnail.cachePath)).size).toBe(thumbnail.bytes+5);
 const blocked=new StorageCacheManager(db,cache,()=>{},()=>true),again=await blocked.preview({scope:'all'});const second=blocked.start(again.token);while(blocked.isActive(second.id))await new Promise(resolve=>setTimeout(resolve,5));expect((await stat(thumbnail.cachePath)).size).toBe(thumbnail.bytes+5);blocked.close();
});
it('preserves unrelated files and indexed originals even if they are named like generated cache files',async()=>{
 const original=media[0],target=path.join(cache,'original-'+'b'.repeat(16)+'.jpg');await writeFile(target,await readFile(original.absolutePath));db.prepare('UPDATE media SET absolute_path=? WHERE id=?').run(process.platform==='win32'?target.toLowerCase():target,original.id);await writeFile(path.join(cache,'notes.txt'),'keep');const plan=await manager.preview({scope:'all'});expect(plan.count).toBe(0);const job=manager.start(plan.token);expect((await finished(job.id)).status).toBe('completed');expect((await stat(target)).size).toBeGreaterThan(0);expect(await readFile(path.join(cache,'notes.txt'),'utf8')).toBe('keep');
});
it('does not follow cache directory junctions and supports cancelling and resuming a cleanup',async()=>{
 const outside=path.join(root,'outside');await mkdir(outside);const external=path.join(outside,'external-'+'c'.repeat(16)+'.jpg');await writeFile(external,'outside');await symlink(outside,path.join(cache,'external'),'junction');await command({type:'media.thumbnail',id:media[0].id});const plan=await manager.preview({scope:'all'});expect(plan.count).toBe(1);const job=manager.start(plan.token);manager.control(job.id,'cancel');expect((await finished(job.id)).status).toBe('cancelled');expect((await stat(external)).size).toBe(7);manager.control(job.id,'resume');expect((await finished(job.id)).status).toBe('completed');expect((await stat(external)).size).toBe(7);
});
it('does not count a cache that disappeared after confirmation as newly freed space',async()=>{
 const thumbnail=await command({type:'media.thumbnail',id:media[0].id}),plan=await manager.preview({scope:'all'});await rm(thumbnail.cachePath);const job=manager.start(plan.token);expect((await finished(job.id)).status).toBe('failed');const result=await command({type:'jobs.result',id:job.id});expect(result.completedBytes).toBe(0);expect(result.counts.failed).toBe(1);expect((await stat(media[0].absolutePath)).size).toBeGreaterThan(0);
});
it('resumes a paused cleanup from persisted file snapshots after the database is reopened',async()=>{
 const thumbnail=await command({type:'media.thumbnail',id:media[0].id}),plan=await manager.preview({scope:'all'}),job=manager.start(plan.token);manager.control(job.id,'pause');expect((await finished(job.id)).status).toBe('paused');service.close();closeDatabase(db);db=openDatabase(path.join(root,'library.db'));service=new LibraryService(db,cache);manager=service.organization.storage;manager.control(job.id,'resume');expect((await finished(job.id)).status).toBe('completed');await expect(stat(thumbnail.cachePath)).rejects.toThrow();expect((await stat(media[0].absolutePath)).size).toBeGreaterThan(0);
});
it('persists cache inventory, updates generated files incrementally and only discovers outside changes on manual calibration',async()=>{
 expect((await command({type:'storage.report'})).cacheBytes).toBe(0);
 const thumbnail=await command({type:'media.thumbnail',id:media[0].id});expect((await command({type:'storage.report'})).cacheBytes).toBe(thumbnail.bytes);
 const orphan=path.join(cache,`preview-${'e'.repeat(64)}.png`);await writeFile(orphan,Buffer.alloc(37));expect((await command({type:'storage.report'})).cacheBytes).toBe(thumbnail.bytes);
 const calibrated=await command({type:'storage.report',refresh:true});expect(calibrated.unusedCacheBytes).toBe(37);expect(calibrated.unusedCacheCount).toBe(1);
 const moved=cache+'-offline';await rename(cache,moved);
 try{service.close();closeDatabase(db);db=openDatabase(path.join(root,'library.db'));service=new LibraryService(db,cache);manager=service.organization.storage;expect((await command({type:'storage.report'})).cacheBytes).toBe(calibrated.cacheBytes);}finally{await rename(moved,cache);}
 const plan=await command({type:'storage.cachePreview',scope:'unused'});expect(plan.count).toBe(1);const job=manager.start(plan.token);expect((await finished(job.id)).status).toBe('completed');expect((await command({type:'storage.report'})).unusedCacheCount).toBe(0);expect((await stat(thumbnail.cachePath)).size).toBe(thumbnail.bytes);
});
it('finds obsolete and scan-confirmed missing caches while retaining hidden, disabled-directory and trash caches',async()=>{
 const first=media[0],second=media[1],thumb=await command({type:'media.thumbnail',id:first.id});await command({type:'media.thumbnail',id:second.id});await command({type:'storage.report'});
 await command({type:'media.hide',id:first.id});expect((await command({type:'storage.report'})).unusedCacheCount).toBe(0);const [library]=await command({type:'roots.list'});await command({type:'roots.setEnabled',id:library.id,enabled:false});expect((await command({type:'storage.report'})).unusedCacheCount).toBe(0);await command({type:'roots.setEnabled',id:library.id,enabled:true});
 await command({type:'trash.put',mediaIds:[second.id]});expect((await command({type:'storage.report'})).unusedCacheCount).toBe(0);
 await unlink(first.absolutePath);await command({type:'roots.scan',id:library.id});const report=await command({type:'storage.report'});expect(report.unusedCacheCount).toBe(1);expect(report.unusedCacheBytes).toBe(thumb.bytes);
 const plan=await command({type:'storage.cachePreview',scope:'unused'});db.prepare('UPDATE media_details SET missing=0 WHERE media_id=?').run(first.id);const job=manager.start(plan.token);expect((await finished(job.id)).status).toBe('failed');expect((await stat(thumb.cachePath)).size).toBe(thumb.bytes);
});
