import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,readFile,writeFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {openDatabase,closeDatabase,type LuminaDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';
import {organizationCommandSchema} from '@lumina/contracts';
import {OrganizationJobs} from './organization-jobs.js';
import {hashFile,moveExclusive} from './file-operations.js';
let temp:string,db:LuminaDatabase,service:LibraryService,media:any[];
function visibilityOptions(){const parsed=organizationCommandSchema.parse({type:'jobs.start',kind:'visibility',mediaIds:media.map(item=>item.id),hidden:true});if(parsed.type!=='jobs.start')throw new Error('unexpected command');return parsed;}
const command=(input:unknown):Promise<any>=>service.handle(input);
async function until(check:()=>boolean|Promise<boolean>){const end=Date.now()+10000;while(!await check()){if(Date.now()>end)throw new Error('background job timeout');await new Promise(resolve=>setTimeout(resolve,10));}}
async function done(id:string){await until(async()=>{const job=await command({type:'jobs.result',id});return !job.active && ['completed','failed','cancelled','paused'].includes(job.status);});return command({type:'jobs.result',id});}
beforeEach(async()=>{temp=await mkdtemp(path.join(os.tmpdir(),'lumina-background-'));const fixtures=path.join(temp,'fixtures');await mkdir(fixtures);const bytes=await sharp({create:{width:64,height:48,channels:3,background:'blue'}}).jpeg().toBuffer();for(const name of ['a.jpg','b.jpg','c.jpg'])await writeFile(path.join(fixtures,name),bytes);db=openDatabase(path.join(temp,'library.db'));service=new LibraryService(db,path.join(temp,'cache'));await command({type:'roots.addAndScan',absolutePath:fixtures});service.close();media=await command({type:'media.list',sortBy:'name',sort:'asc'});});
afterEach(async()=>{service.close();closeDatabase(db);await rm(temp,{recursive:true,force:true,maxRetries:4});});
it('clears only confirmed terminal task history and cascades its details without touching media or cached thumbnails',async()=>{
 await command({type:'media.addTag',id:media[0].id,tagName:'清理历史保留标签'});const album=await command({type:'albums.create',name:'清理历史保留相册'});await command({type:'albums.addMedia',id:album.id,mediaIds:[media[0].id]});
 const thumbnail=await command({type:'media.thumbnail',id:media[0].id});const before=await readFile(thumbnail.cachePath);
 for(const status of ['completed','cancelled','failed','running','queued','paused']){db.prepare("INSERT INTO tasks(id,kind,status,total,payload_json) VALUES(?,'tags',?,1,'{}')").run('history-'+status,status);db.prepare('INSERT INTO job_items(task_id,media_id) VALUES(?,?)').run('history-'+status,media[0].id);}
 const preview=await command({type:'tasks.historyPreview'});expect(preview.completed).toBeGreaterThan(0);expect(preview.failed).toBe(1);expect(preview.items.some((row:any)=>row.id==='history-paused')).toBe(false);
 db.prepare("INSERT INTO tasks(id,kind,status,payload_json) VALUES('finished-after-preview','tags','completed','{}')").run();
 db.prepare("UPDATE tasks SET status='running' WHERE id='history-cancelled'").run();
 await command({type:'tasks.clearHistory',taskIds:preview.items.map((row:any)=>row.id)});
 expect(db.prepare("SELECT 1 FROM tasks WHERE id='history-completed'").get()).toBeUndefined();expect(db.prepare("SELECT 1 FROM job_items WHERE task_id='history-completed'").get()).toBeUndefined();
 for(const id of ['history-cancelled','history-failed','history-running','history-queued','history-paused','finished-after-preview'])expect(db.prepare('SELECT 1 FROM tasks WHERE id=?').get(id)).toBeTruthy();
 await command({type:'tasks.clearHistory',includeFailed:true});expect(db.prepare("SELECT 1 FROM tasks WHERE id='history-failed'").get()).toBeUndefined();
 expect(await readFile(thumbnail.cachePath)).toEqual(before);expect(await command({type:'media.list'})).toHaveLength(3);expect((await command({type:'media.tags',id:media[0].id}))[0].name).toBe('清理历史保留标签');expect(await command({type:'albums.media',id:album.id})).toHaveLength(1);
 expect((await command({type:'media.thumbnail',id:media[0].id})).cachePath).toBe(thumbnail.cachePath);
});
it('retains cancelled tasks while a worker is still finishing its current file, then permits clearing once stopped',async()=>{
 const job=await command({type:'jobs.start',kind:'duplicates'});await command({type:'jobs.control',id:job.id,action:'cancel'});expect((await command({type:'jobs.result',id:job.id})).active).toBe(true);
 const preview=await command({type:'tasks.historyPreview'});expect(preview.items.some((row:any)=>row.id===job.id)).toBe(false);await command({type:'tasks.clearHistory',includeFailed:true});expect(db.prepare('SELECT 1 FROM tasks WHERE id=?').get(job.id)).toBeTruthy();
 await done(job.id);await command({type:'tasks.clearHistory'});expect(db.prepare('SELECT 1 FROM tasks WHERE id=?').get(job.id)).toBeUndefined();
});
it('moves a duplicate cleanup to background with persistent byte progress and restores all deleted copies',async()=>{
 const detection=await command({type:'jobs.start',kind:'duplicates'});expect((await done(detection.id)).status).toBe('completed');const plan=await command({type:'duplicates.cleanupPreview'});const job=await command({type:'jobs.start',kind:'delete',deleteMode:'software',mediaIds:plan.mediaIds,cleanup:{kind:'duplicates',revision:plan.revision,keepIds:plan.keepIds}});const result=await done(job.id);expect(result).toMatchObject({status:'completed',processed:2,total:2,completedBytes:plan.sizeBytes,totalBytes:plan.sizeBytes});expect((await stat(plan.groups[0].keep.absolutePath)).isFile()).toBe(true);expect(await command({type:'trash.list'})).toHaveLength(2);
 const restore=await command({type:'jobs.start',kind:'restore',mediaIds:plan.mediaIds});expect((await done(restore.id)).status).toBe('completed');for(const item of media)expect(await readFile(item.absolutePath)).toEqual(await readFile(plan.groups[0].keep.absolutePath));expect(await command({type:'trash.list'})).toHaveLength(0);
});
it('rejects a changed retained original before deleting any copy in its group',async()=>{
 const detection=await command({type:'jobs.start',kind:'duplicates'});await done(detection.id);const plan=await command({type:'duplicates.cleanupPreview'});await writeFile(plan.groups[0].keep.absolutePath,'changed original');const job=await command({type:'jobs.start',kind:'delete',deleteMode:'software',mediaIds:plan.mediaIds,cleanup:{kind:'duplicates',revision:plan.revision,keepIds:plan.keepIds}});const result=await done(job.id);expect(result.status).toBe('failed');expect(result.counts.failed).toBe(2);expect(await command({type:'trash.list'})).toHaveLength(0);for(const id of plan.mediaIds)expect((await stat(media.find(item=>item.id===id).absolutePath)).isFile()).toBe(true);
});
it('interrupts in-flight work quickly, persists pending items across reopening, and resumes each item once',async()=>{
 let entered=false;const applied:string[]=[];const jobs=new OrganizationJobs(db,()=>{},async(id,options,signal)=>{entered=true;await new Promise<void>((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});applied.push(id);});const job=jobs.start(visibilityOptions());await until(()=>entered);const start=Date.now();jobs.control(job.id,'pause');await until(()=>!jobs.result(job.id).active);expect(Date.now()-start).toBeLessThan(1000);expect(jobs.result(job.id)).toMatchObject({status:'paused',processed:0,counts:{pending:3}});expect(applied).toHaveLength(0);
 closeDatabase(db);db=openDatabase(path.join(temp,'library.db'));service=new LibraryService(db,path.join(temp,'cache'));service.close();const resumed=new OrganizationJobs(db,()=>{},async id=>{applied.push(id);});resumed.control(job.id,'resume');await until(()=>!resumed.result(job.id).active);expect(resumed.result(job.id)).toMatchObject({status:'completed',processed:3,total:3});expect(new Set(applied).size).toBe(3);
});
it('retries only failures and rejects queued files whose indexed fingerprint has changed',async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let entered=false,fail=true;const applied:string[]=[];const jobs=new OrganizationJobs(db,()=>{},async id=>{if(id===media[0].id){entered=true;await gate;}if(id===media[2].id && fail)throw new Error('temporary failure');applied.push(id);});const job=jobs.start(visibilityOptions());await until(()=>entered);db.prepare('UPDATE media SET fingerprint=? WHERE id=?').run('changed',media[1].id);release();await until(()=>!jobs.result(job.id).active);expect(jobs.result(job.id)).toMatchObject({status:'failed',processed:3,counts:{completed:1,failed:2}});expect(applied).toEqual([media[0].id]);expect(jobs.result(job.id).items.find((item:any)=>item.id===media[1].id)?.error).toContain('变化');
 db.prepare('UPDATE media SET fingerprint=? WHERE id=?').run(media[1].fingerprint,media[1].id);fail=false;jobs.control(job.id,'retry');await until(()=>!jobs.result(job.id).active);expect(jobs.result(job.id).status).toBe('completed');expect(applied.filter(id=>id===media[0].id)).toHaveLength(1);expect(new Set(applied).size).toBe(3);
});
it('aborts hashing without moving source bytes or leaving an incomplete destination',async()=>{
 const source=path.join(temp,'large.dat'),target=path.join(temp,'target','large.dat');await writeFile(source,Buffer.alloc(32*1024*1024,45));const expected=await hashFile(source);const abort=new AbortController();const operation=moveExclusive(source,target,expected,abort.signal);abort.abort();await expect(operation).rejects.toThrow('取消');expect((await stat(source)).size).toBe(32*1024*1024);await expect(stat(target)).rejects.toMatchObject({code:'ENOENT'});
 const hashing=new AbortController();const pending=hashFile(source,hashing.signal);hashing.abort();await expect(pending).rejects.toThrow('取消');
});

it('edits one media without decoding unrelated full-library metadata',async()=>{
 db.prepare("UPDATE media_details SET metadata_json='unrelated invalid JSON' WHERE media_id=?").run(media[1].id);
 const job=await command({type:'jobs.start',kind:'tags',mediaIds:[media[0].id],tagName:'单张局部编辑'});expect((await done(job.id)).status).toBe('completed');expect((await command({type:'media.tags',id:media[0].id})).some((tag:any)=>tag.name==='单张局部编辑')).toBe(true);
});
it('retains frozen tag action, hierarchy path and file size/path across rename, purge and database reopen',async()=>{
 const parent=await command({type:'tags.create',name:'历史父'}),child=await command({type:'tags.create',name:'历史子',parentId:parent.id});
 const job=await command({type:'jobs.start',kind:'tags',mediaIds:[media[0].id],tagName:'历史子'});const completed=await done(job.id);expect(completed.info).toMatchObject({tagPath:'历史父 / 历史子',scopeCount:1,selectedCount:1});expect(completed.options).toMatchObject({tagAction:'add',tagName:'历史子'});expect(completed.createdAt).toBeTruthy();expect(completed.items[0]).toMatchObject({fileName:path.basename(media[0].absolutePath),path:media[0].absolutePath,sizeBytes:media[0].sizeBytes,status:'completed'});
 await command({type:'tags.edit',id:child.id,name:'后来改名',parentId:null});const removal=await command({type:'jobs.start',kind:'tags',mediaIds:[media[0].id],tagName:'后来改名',tagAction:'remove'});expect((await done(removal.id)).options.tagAction).toBe('remove');
 const purge=await command({type:'jobs.start',kind:'delete',deleteMode:'permanent',mediaIds:[media[0].id]});expect((await done(purge.id)).status).toBe('completed');await expect(stat(media[0].absolutePath)).rejects.toMatchObject({code:'ENOENT'});closeDatabase(db);db=openDatabase(path.join(temp,'library.db'));service=new LibraryService(db,path.join(temp,'cache'));service.close();const history=await command({type:'jobs.result',id:job.id});expect(history.info.tagPath).toBe('历史父 / 历史子');expect(history.items[0]).toMatchObject({fileName:path.basename(media[0].absolutePath),path:media[0].absolutePath,sizeBytes:media[0].sizeBytes,status:'completed'});
});
it('records full duplicate prefilter scope separately from same-size hash candidates',async()=>{
 db.prepare('UPDATE media SET size_bytes=size_bytes+1 WHERE id=?').run(media[2].id);const detection=await command({type:'jobs.start',kind:'duplicates'});const result=await done(detection.id);expect(result.total).toBe(2);expect(result.info).toMatchObject({scopeCount:3,selectedCount:2});
});
