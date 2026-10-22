import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,unlink,symlink,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {it,expect} from 'vitest';
import {openDatabase,closeDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';
async function setup(){const root=await mkdtemp(path.join(os.tmpdir(),'lumina-cache-location-')),cache=path.join(root,'legacy-cache'),preferred=path.join(root,'installation','cache','media');await mkdir(cache);const db=openDatabase(path.join(root,'test.db'));let service=new LibraryService(db,cache,{defaultCacheRoot:preferred});return {root,cache,preferred,db,get service(){return service;},reopen:()=>{service.close();service=new LibraryService(db,cache,{defaultCacheRoot:preferred});},close:async()=>{service.close();closeDatabase(db);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}};}
async function finish(service:LibraryService,id:string){for(let n=0;n<1000;n++){const job:any=await service.handle({type:'jobs.result',id});if(!job.active&&!['running','queued'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('migration did not finish');}
async function photo(t:Awaited<ReturnType<typeof setup>>){const folder=path.join(t.root,'photos');await mkdir(folder);const source=path.join(folder,'one.jpg');await sharp({create:{width:120,height:80,channels:3,background:'blue'}}).jpeg().toFile(source);await t.service.handle({type:'roots.addAndScan',absolutePath:folder});const [media]=await t.service.handle({type:'media.list'}) as any[];const thumb:any=await t.service.handle({type:'media.thumbnail',id:media.id});return {source,media,thumb};}
it('preserves an existing cache location while new installations default to the software directory',async()=>{
 const t=await setup();try{expect(await t.service.handle({type:'cache.settings'})).toMatchObject({directory:t.cache,defaultDirectory:t.preferred});expect(await readdir(t.cache)).toEqual([]);t.reopen();expect((await t.service.handle({type:'cache.settings'}) as any).directory).toBe(t.cache);
  const separate=openDatabase(path.join(t.root,'fresh.db')),fresh=new LibraryService(separate,path.join(t.root,'missing-old'),{defaultCacheRoot:t.preferred});expect((await fresh.handle({type:'cache.settings'}) as any).directory).toBe(t.preferred);fresh.close();closeDatabase(separate);
 }finally{await t.close();}
});
it('moves cached thumbnails, previews and videos after validation, switches live requests and persists the new path',async()=>{
 const t=await setup();try{const {source,media,thumb}=await photo(t),original=await readFile(source);const preview:any=await t.service.handle({type:'media.previewPath',id:media.id});const video=path.join(t.cache,`playback-${'a'.repeat(64)}.mp4`);await writeFile(video,'cached video fixture');await writeFile(path.join(t.cache,'notes.txt'),'keep unknown');
  const target=path.join(t.root,'new-cache'),plan:any=await t.service.handle({type:'cache.movePreview',directory:target});expect(plan.count).toBe(3);expect(plan.skipped).toBe(1);const task:any=await t.service.handle({type:'cache.move',token:plan.token});expect((await finish(t.service,task.id)).status).toBe('completed');
  for(const file of [thumb.cachePath,preview.cachePath,video]){await expect(stat(file)).rejects.toThrow();expect((await stat(path.join(target,path.basename(file)))).size).toBeGreaterThan(0);}
  expect(await readFile(source)).toEqual(original);expect(await readFile(path.join(t.cache,'notes.txt'),'utf8')).toBe('keep unknown');const next:any=await t.service.handle({type:'media.thumbnail',id:media.id});expect(next.cachePath).toBe(path.join(target,path.basename(thumb.cachePath)));expect(next.cached).toBe(true);expect((await t.service.handle({type:'media.previewPath',id:media.id}) as any).cachePath).toBe(path.join(target,path.basename(preview.cachePath)));
  t.reopen();expect((await t.service.handle({type:'cache.settings'}) as any).directory).toBe(target);expect((await t.service.handle({type:'storage.report'}) as any).cacheBytes).toBeGreaterThan(0);
 }finally{await t.close();}
});
it('cancels before switching and releases queued cache requests without deleting old cache files',async()=>{
 const t=await setup();try{const {media,thumb}=await photo(t),plan:any=await t.service.handle({type:'cache.movePreview',directory:path.join(t.root,'cancelled-target')});const task:any=await t.service.handle({type:'cache.move',token:plan.token});const queued=t.service.handle({type:'media.thumbnail',id:media.id});await t.service.handle({type:'jobs.control',id:task.id,action:'cancel'});expect((await finish(t.service,task.id)).status).toBe('cancelled');expect((await queued as any).cachePath).toBe(thumb.cachePath);expect((await stat(thumb.cachePath)).size).toBeGreaterThan(0);expect((await t.service.handle({type:'cache.settings'}) as any).directory).toBe(t.cache);
 }finally{await t.close();}
});
it('rejects overlapping, linked, gallery and occupied target paths, and blocks double submit',async()=>{
 const t=await setup();try{await photo(t);await expect(t.service.handle({type:'cache.movePreview',directory:path.join(t.cache,'nested')})).rejects.toThrow('互相包含');await expect(t.service.handle({type:'cache.movePreview',directory:path.join(t.root,'photos','cache')})).rejects.toThrow('图库');const linked=path.join(t.root,'linked');await symlink(t.cache,linked,process.platform==='win32'?'junction':'dir');await expect(t.service.handle({type:'cache.movePreview',directory:linked})).rejects.toThrow('链接');const occupied=path.join(t.root,'occupied');await mkdir(occupied);await writeFile(path.join(occupied,'private.txt'),'preserve');await expect(t.service.handle({type:'cache.movePreview',directory:occupied})).rejects.toThrow('空目录');
  const plan:any=await t.service.handle({type:'cache.movePreview',directory:path.join(t.root,'target')});const task:any=await t.service.handle({type:'cache.move',token:plan.token});await expect(t.service.handle({type:'cache.move',token:plan.token})).rejects.toThrow();await finish(t.service,task.id);expect(await readFile(path.join(occupied,'private.txt'),'utf8')).toBe('preserve');
 }finally{await t.close();}
});
it('keeps the original location on a stale preview and permits a verified retry',async()=>{
 const t=await setup();try{const {thumb}=await photo(t),target=path.join(t.root,'target');const plan:any=await t.service.handle({type:'cache.movePreview',directory:target});await writeFile(thumb.cachePath,'cache changed');const task:any=await t.service.handle({type:'cache.move',token:plan.token});expect((await finish(t.service,task.id)).status).toBe('failed');expect((await t.service.handle({type:'cache.settings'}) as any).directory).toBe(t.cache);expect(await readFile(thumb.cachePath,'utf8')).toBe('cache changed');
  const retry:any=await t.service.handle({type:'cache.movePreview',directory:target}),next:any=await t.service.handle({type:'cache.move',token:retry.token});expect((await finish(t.service,next.id)).status).toBe('completed');expect(await readFile(path.join(target,path.basename(thumb.cachePath)),'utf8')).toBe('cache changed');
 }finally{await t.close();}
});
it('rebases paused cache-cleanup jobs to the new path and file identity',async()=>{
 const t=await setup();try{const {thumb}=await photo(t);const cleanup:any=await t.service.handle({type:'storage.cachePreview',scope:'all'}),job:any=await t.service.handle({type:'storage.clearCache',token:cleanup.token});await t.service.handle({type:'jobs.control',id:job.id,action:'pause'});expect((await finish(t.service,job.id)).status).toBe('paused');
  const target=path.join(t.root,'target'),plan:any=await t.service.handle({type:'cache.movePreview',directory:target}),move:any=await t.service.handle({type:'cache.move',token:plan.token});expect((await finish(t.service,move.id)).status).toBe('completed');const copied=path.join(target,path.basename(thumb.cachePath));expect((await stat(copied)).isFile()).toBe(true);
  await t.service.handle({type:'jobs.control',id:job.id,action:'resume'});expect((await finish(t.service,job.id)).status).toBe('completed');await expect(stat(copied)).rejects.toThrow();
 }finally{await t.close();}
});
it('preserves indexed originals even if their names look like generated cache files',async()=>{
 const t=await setup();try{await photo(t);const protectedFile=path.join(t.cache,`protected-${'a'.repeat(16)}.jpg`);const bytes=await sharp({create:{width:20,height:20,channels:3,background:'red'}}).jpeg().toBuffer();await writeFile(protectedFile,bytes);const info=await stat(protectedFile);t.db.prepare('INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,fingerprint,file_name) VALUES(?,?,?,?,?,?,?)').run('protected-original',protectedFile,'photo',info.size,info.mtimeMs,'original',path.basename(protectedFile));
  const target=path.join(t.root,'target'),plan:any=await t.service.handle({type:'cache.movePreview',directory:target});expect(plan.skipped).toBe(1);const move:any=await t.service.handle({type:'cache.move',token:plan.token});expect((await finish(t.service,move.id)).status).toBe('completed');expect(await readFile(protectedFile)).toEqual(bytes);expect(t.db.prepare('SELECT id FROM media WHERE id=?').get('protected-original')).toBeTruthy();
 }finally{await t.close();}
});
it('keeps the original and target paths visible in active and historical task details',async()=>{
 const t=await setup();try{await photo(t);const target=path.join(t.root,'target'),plan:any=await t.service.handle({type:'cache.movePreview',directory:target}),move:any=await t.service.handle({type:'cache.move',token:plan.token});
  const active:any=await t.service.handle({type:'jobs.result',id:move.id});expect(JSON.parse(active.payloadJson)).toMatchObject({source:t.cache,target});
  const completed:any=await finish(t.service,move.id);expect(completed.committed).toBe(true);t.reopen();const history:any=await t.service.handle({type:'jobs.result',id:move.id});expect(JSON.parse(history.payloadJson)).toMatchObject({source:t.cache,target});
 }finally{await t.close();}
});
it('moves many small files with batched progress and releases new preview generation only after switching',async()=>{
 const t=await setup();try{const {source,media}=await photo(t),original=await readFile(source);const files=Array.from({length:96},(_,index)=>({name:`fixture-${index}-${'b'.repeat(16)}.jpg`,bytes:Buffer.from(`cache-fixture-${index}`)}));for(const file of files)await writeFile(path.join(t.cache,file.name),file.bytes);
  const target=path.join(t.root,'target'),plan:any=await t.service.handle({type:'cache.movePreview',directory:target}),move:any=await t.service.handle({type:'cache.move',token:plan.token});let resolved=false;const queued=t.service.handle({type:'media.previewPath',id:media.id}).then(result=>{resolved=true;return result as any;});await new Promise(resolve=>setTimeout(resolve,1));expect(resolved).toBe(false);
  const cleanupProgress:number[]=[];let result:any;
  for(let n=0;n<1000;n++){result=await t.service.handle({type:'jobs.result',id:move.id});if(result.active&&result.committed&&result.phaseProcessed!==undefined){expect(result.phaseTotal).toBe(97);cleanupProgress.push(result.phaseProcessed);}if(!result.active)break;await new Promise(resolve=>setTimeout(resolve,1));}
  expect(cleanupProgress.length).toBeGreaterThan(0);expect(cleanupProgress.every((value,index)=>index===0||value>=cleanupProgress[index-1]!)).toBe(true);
  expect(result.status).toBe('completed');expect(result.processed).toBe(97);expect(result.counts.completed).toBe(97);expect(JSON.parse(result.payloadJson)).toMatchObject({phase:'done',cleanupProcessed:97,cleanupTotal:97});expect((await queued).cachePath.startsWith(target)).toBe(true);
  for(const file of files){expect(await readFile(path.join(target,file.name))).toEqual(file.bytes);await expect(stat(path.join(t.cache,file.name))).rejects.toThrow();}expect(await readFile(source)).toEqual(original);
 }finally{await t.close();}
});
