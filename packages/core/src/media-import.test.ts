import {mkdtemp,mkdir,writeFile,readFile,rm,unlink,symlink,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {it,expect} from 'vitest';
import {openDatabase,closeDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';
import {randomUUID} from 'node:crypto';
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'lumina-import-test-'));const db=openDatabase(path.join(root,'test.db'));const service=new LibraryService(db,path.join(root,'cache'));const photo=await sharp({create:{width:40,height:30,channels:3,background:'#719ad5'}}).jpeg().toBuffer();return {root,db,service,photo,close:async()=>{service.close();closeDatabase(db);await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100});}};}
async function ended(service:LibraryService,id:string){for(let i=0;i<1000;i++){const job:any=await service.handle({type:'jobs.result',id});if(!job.active&&!['queued','running'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('import did not settle');}
it('remembers the last accepted import directory independently of whether prompts are skipped',async()=>{
 const t=await fixture();try{const source=path.join(t.root,'photo.jpg');await writeFile(source,t.photo);const first=path.join(t.root,'first'),second=path.join(t.root,'second');
  await t.service.handle({type:'imports.configure',directory:first,skipPrompt:true});
  let preview:any=await t.service.handle({type:'imports.preview',sources:[source]});const job:any=await t.service.handle({type:'imports.start',token:preview.token,directory:second,remember:false});await ended(t.service,job.id);
  expect(await t.service.handle({type:'imports.settings'})).toEqual({directory:second,skipPrompt:false});expect(JSON.parse((t.db.prepare("SELECT value_json FROM settings WHERE key='media-import'").get() as any).value_json)).toEqual({directory:second,skipPrompt:false});
  preview=await t.service.handle({type:'imports.preview',sources:[source]});await expect(t.service.handle({type:'imports.start',token:preview.token,directory:'relative',remember:false})).rejects.toThrow();await t.service.handle({type:'imports.discard',token:preview.token});expect(await t.service.handle({type:'imports.settings'})).toEqual({directory:second,skipPrompt:false});
 }finally{await t.close();}
});
it.each(['rename','skip','overwrite'] as const)('handles confirmed name collisions with policy %s without changing the source',async conflictPolicy=>{
 const t=await fixture();try{const source=path.join(t.root,'source','photo.jpg'),target=path.join(t.root,'target'),output=path.join(target,'photo.jpg');await mkdir(path.dirname(source));await mkdir(target);await writeFile(source,t.photo);const old=await sharp({create:{width:50,height:35,channels:3,background:'red'}}).jpeg().toBuffer();await writeFile(output,old);
  const preview:any=await t.service.handle({type:'imports.preview',sources:[source]}),conflicts:any=await t.service.handle({type:'imports.conflicts',token:preview.token,directory:target});expect(conflicts).toMatchObject({count:1,samples:['photo.jpg']});
  if(conflictPolicy==='overwrite')await expect(t.service.handle({type:'imports.start',token:preview.token,directory:target,remember:false,conflictPolicy})).rejects.toThrow('确认');
  const task:any=await t.service.handle({type:'imports.start',token:preview.token,directory:target,remember:false,conflictPolicy,conflictToken:conflicts.token}),result=await ended(t.service,task.id);expect(result.status).toBe('completed');expect(await readFile(source)).toEqual(t.photo);expect(await readFile(output)).toEqual(conflictPolicy==='overwrite'?t.photo:old);
  if(conflictPolicy==='rename')expect(await readFile(path.join(target,'photo (1).jpg'))).toEqual(t.photo);else expect(await readdir(target)).toEqual(['photo.jpg']);if(conflictPolicy==='skip'){expect(result.counts.skipped).toBe(1);expect((await t.service.handle({type:'media.list'}) as any[])).toHaveLength(0);}
 }finally{await t.close();}
});
it('preserves a destination edited after overwrite confirmation and rejects a confirmation for another directory',async()=>{
 const t=await fixture();try{const source=path.join(t.root,'photo.jpg'),target=path.join(t.root,'target'),output=path.join(target,'photo.jpg');await writeFile(source,t.photo);await mkdir(target);await writeFile(output,'original');const preview:any=await t.service.handle({type:'imports.preview',sources:[source]}),confirmation:any=await t.service.handle({type:'imports.conflicts',token:preview.token,directory:target});
  await expect(t.service.handle({type:'imports.start',token:preview.token,directory:path.join(t.root,'other'),remember:false,conflictPolicy:'overwrite',conflictToken:confirmation.token})).rejects.toThrow('确认');
  await writeFile(output,'new content edited after confirmation');const task:any=await t.service.handle({type:'imports.start',token:preview.token,directory:target,remember:false,conflictPolicy:'overwrite',conflictToken:confirmation.token}),result=await ended(t.service,task.id);expect(result.status).toBe('failed');expect(result.items[0].error).toContain('确认后发生变化');expect(await readFile(output,'utf8')).toBe('new content edited after confirmation');expect(await readFile(source)).toEqual(t.photo);
 }finally{await t.close();}
});
it('copies multiple folders recursively, skips non-media, preserves originals, avoids overwrites and indexes only new paths',async()=>{
 const t=await fixture();try{
  const source=path.join(t.root,'旅行'),second=path.join(t.root,'家庭'),target=path.join(t.root,'library');await mkdir(path.join(source,'child'),{recursive:true});await mkdir(second);await mkdir(path.join(target,'旅行','child'),{recursive:true});
  await writeFile(path.join(source,'中文 空格.jpg'),t.photo);await writeFile(path.join(source,'child','b.jpg'),t.photo);await writeFile(path.join(source,'note.txt'),'not media');await writeFile(path.join(second,'c.jpg'),t.photo);
  await writeFile(path.join(target,'旅行','child','b.jpg'),'keep different existing file');
  const preview:any=await t.service.handle({type:'imports.preview',sources:[source,second,path.join(source,'中文 空格.jpg')]});expect(preview.total).toBe(3);expect(preview.skipped).toBe(1);
  const started:any=await t.service.handle({type:'imports.start',token:preview.token,directory:target,remember:true});const job=await ended(t.service,started.id);expect(job.status).toBe('completed');expect(job.items).toHaveLength(3);expect(job.processed).toBe(3);expect(job.items.every((item:any)=>item.sizeRecorded&&item.path&&item.output)).toBe(true);
  expect(await readFile(path.join(target,'旅行','child','b.jpg'),'utf8')).toBe('keep different existing file');expect(await readFile(path.join(target,'旅行','child','b (1).jpg'))).toEqual(t.photo);expect(await readFile(path.join(source,'child','b.jpg'))).toEqual(t.photo);
  expect((await t.service.handle({type:'media.list'}) as any[])).toHaveLength(3);expect((await t.service.handle({type:'imports.settings'}) as any)).toEqual({directory:target,skipPrompt:true});expect((await readdir(target)).some(name=>name.startsWith('.lumina-import-'))).toBe(false);
  const scans:any[]=await t.service.handle({type:'tasks.list',limit:100}) as any[];expect(scans.filter(row=>row.kind==='scan').every(row=>JSON.parse(row.payloadJson).incremental)).toBe(true);
 }finally{await t.close();}
});
it('rejects self imports, invalid destinations, expired previews and duplicate submissions',async()=>{
 const t=await fixture();try{const source=path.join(t.root,'source');await mkdir(source);await writeFile(path.join(source,'a.jpg'),t.photo);const preview:any=await t.service.handle({type:'imports.preview',sources:[source]});
  await expect(t.service.handle({type:'imports.start',token:preview.token,directory:path.join(source,'nested'),remember:false})).rejects.toThrow('内部');
  await expect(t.service.handle({type:'imports.configure',directory:'relative',skipPrompt:true})).rejects.toThrow('完整');await expect(t.service.handle({type:'imports.configure',directory:'',skipPrompt:true})).rejects.toThrow('默认');
  const target=path.join(t.root,'target'),request={type:'imports.start',token:preview.token,directory:target,remember:false};const results=await Promise.allSettled([t.service.handle(request),t.service.handle(request)]);expect(results.filter(item=>item.status==='fulfilled')).toHaveLength(1);const started=(results.find(item=>item.status==='fulfilled') as PromiseFulfilledResult<any>).value;expect((await ended(t.service,started.id)).status).toBe('completed');
  await expect(t.service.handle(request)).rejects.toThrow('预览已过期');expect((await readdir(path.join(target,'source')))).toEqual(['a.jpg']);
 }finally{await t.close();}
});
it('persists pause/cancel/resume and imports completed copies exactly once',async()=>{
 const t=await fixture();try{const source=path.join(t.root,'source');await mkdir(source);for(let i=0;i<5;i++)await writeFile(path.join(source,`${i}.jpg`),t.photo);const preview:any=await t.service.handle({type:'imports.preview',sources:[source]}),target=path.join(t.root,'target');const task:any=await t.service.handle({type:'imports.start',token:preview.token,directory:target,remember:false});await t.service.handle({type:'jobs.control',id:task.id,action:'cancel'});expect((await ended(t.service,task.id)).status).toBe('cancelled');await t.service.handle({type:'jobs.control',id:task.id,action:'resume'});expect((await ended(t.service,task.id)).status).toBe('completed');
  expect(await readdir(path.join(target,'source'))).toHaveLength(5);expect((await t.service.handle({type:'media.list'}) as any[])).toHaveLength(5);
 }finally{await t.close();}
});
it('reports missing or changed sources per file and retries without recopying successes',async()=>{
 const t=await fixture();try{const source=path.join(t.root,'source');await mkdir(source);const good=path.join(source,'good.jpg'),bad=path.join(source,'bad.jpg');await writeFile(good,t.photo);await writeFile(bad,t.photo);const {utimes}=await import('node:fs/promises');const timestamp=new Date('2026-01-01T00:00:00Z');await utimes(bad,timestamp,timestamp);const preview:any=await t.service.handle({type:'imports.preview',sources:[good,bad]});await unlink(bad);const target=path.join(t.root,'target');const task:any=await t.service.handle({type:'imports.start',token:preview.token,directory:target,remember:false});const failed=await ended(t.service,task.id);expect(failed.status).toBe('failed');expect(failed.counts.completed).toBe(1);expect(failed.items.find((item:any)=>item.path===bad).error).toBeTruthy();
  // Restore the original timestamp from the frozen plan for a safe retry.
  await writeFile(bad,t.photo);await utimes(bad,timestamp,timestamp);
  await t.service.handle({type:'jobs.control',id:task.id,action:'retry'});expect((await ended(t.service,task.id)).status).toBe('completed');expect((await readdir(target)).sort()).toEqual(['bad.jpg','good.jpg']);
 }finally{await t.close();}
});
it('reuses identical existing files, protects disabled roots and rejects linked destinations',async()=>{
 const t=await fixture();try{const source=path.join(t.root,'a.jpg');await writeFile(source,t.photo);const target=path.join(t.root,'target');await mkdir(target);await writeFile(path.join(target,'a.jpg'),t.photo);
  const preview:any=await t.service.handle({type:'imports.preview',sources:[source]});const task:any=await t.service.handle({type:'imports.start',token:preview.token,directory:target,remember:false});expect((await ended(t.service,task.id)).status).toBe('completed');expect(await readdir(target)).toEqual(['a.jpg']);
  const roots:any[]=await t.service.handle({type:'roots.list'}) as any[];await t.service.handle({type:'roots.setEnabled',id:roots[0].id,enabled:false});await expect(t.service.handle({type:'imports.configure',directory:target,skipPrompt:true})).rejects.toThrow('停用');
  const linked=path.join(t.root,'linked');await symlink(target,linked,process.platform==='win32'?'junction':'dir');await expect(t.service.handle({type:'imports.configure',directory:linked,skipPrompt:true})).rejects.toThrow('目录链接');
 }finally{await t.close();}
});
it('resumes a persisted import after reopening its database without copying successful files again',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'lumina-import-restart-')),database=path.join(root,'test.db');let db=openDatabase(database),service=new LibraryService(db,path.join(root,'cache'));
 try{const source=path.join(root,'a.jpg');await sharp({create:{width:40,height:30,channels:3,background:'blue'}}).jpeg().toFile(source);const preview:any=await service.handle({type:'imports.preview',sources:[source]});const task:any=await service.handle({type:'imports.start',token:preview.token,directory:path.join(root,'target'),remember:false});await service.handle({type:'jobs.control',id:task.id,action:'pause'});expect((await ended(service,task.id)).status).toBe('paused');service.close();closeDatabase(db);
  db=openDatabase(database);service=new LibraryService(db,path.join(root,'cache'));await service.handle({type:'jobs.control',id:task.id,action:'resume'});expect((await ended(service,task.id)).status).toBe('completed');expect(await readdir(path.join(root,'target'))).toEqual(['a.jpg']);
 }finally{service.close();closeDatabase(db);await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
});
it('cleans only generated clipboard images on discarded previews or successful imports',async()=>{
 const t=await fixture(),previous=process.env.LUMINA_IMPORT_INBOX;try{const inbox=path.join(t.root,'inbox');await mkdir(inbox);process.env.LUMINA_IMPORT_INBOX=inbox;
  const generated=path.join(inbox,`lumina-clipboard-${randomUUID()}.png`),user=path.join(inbox,'user.png');const png=await sharp(t.photo).png().toBuffer();await writeFile(generated,png);await writeFile(user,png);
  const preview:any=await t.service.handle({type:'imports.preview',sources:[generated,user]});await t.service.handle({type:'imports.discard',token:preview.token});await expect(stat(generated)).rejects.toThrow();expect(await readFile(user)).toEqual(png);
  await writeFile(generated,png);const next:any=await t.service.handle({type:'imports.preview',sources:[generated]});const job:any=await t.service.handle({type:'imports.start',token:next.token,directory:path.join(t.root,'target'),remember:false});expect((await ended(t.service,job.id)).status).toBe('completed');await expect(stat(generated)).rejects.toThrow();expect(await readFile(user)).toEqual(png);
 }finally{if(previous===undefined)delete process.env.LUMINA_IMPORT_INBOX;else process.env.LUMINA_IMPORT_INBOX=previous;await t.close();}
});
