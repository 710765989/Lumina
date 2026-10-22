import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile,readdir,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {openDatabase,closeDatabase,updateMetadata} from '@lumina/storage';
import {LibraryService} from './service.js';
import {CompatibilityVideos,videoCheckpointNames} from './compatibility-video.js';
import {runFfmpeg} from './thumbnail.js';
vi.mock('./thumbnail.js',async()=>({...await vi.importActual('./thumbnail.js'),runFfmpeg:vi.fn(),probeVideoMetadata:vi.fn(async()=>({duration:25}))}));
async function setup(){const temp=await mkdtemp(path.join(os.tmpdir(),'lumina-video-resume-')),root=path.join(temp,'root'),cache=path.join(temp,'cache');await mkdir(root);await sharp({create:{width:32,height:24,channels:3,background:'blue'}}).jpeg().toFile(path.join(root,'fixture.jpg'));const db=openDatabase(path.join(temp,'index.db')),service=new LibraryService(db,cache);await service.handle({type:'roots.addAndScan',absolutePath:root});const media=(await service.handle({type:'media.list'}) as any[])[0];db.prepare("UPDATE media SET kind='video' WHERE id=?").run(media.id);updateMetadata(db,media.id,{duration:25});return {temp,cache,db,service,media,close:async()=>{service.close();closeDatabase(db);await rm(temp,{recursive:true,force:true,maxRetries:4,retryDelay:100});}};}
function interruptSecond(){let ready!:()=>void;const started=new Promise<void>(resolve=>ready=resolve),offsets:number[]=[];let block=true;
 vi.mocked(runFfmpeg).mockImplementation(async(args,signal)=>{if(args.includes('-ss')){offsets.push(Number(args[args.indexOf('-ss')+1]));if(offsets.length===2&&block){ready();await new Promise<void>((resolve,reject)=>{if(signal?.aborted)return reject(Error('paused'));signal?.addEventListener('abort',()=>reject(Error('paused')),{once:true});});}}await writeFile(args.at(-1)!,'encoded video fixture');return '';});
 return {started,offsets,release:()=>{block=false;}};
}
it('persists completed segments, releases the encoder on close, and resumes from the checkpoint in a new manager',async()=>{
 const t=await setup(),fake=interruptSecond();try{
  const session=randomUUID(),first=t.service.organization.compatibility.prepare(t.media.id,t.cache,session).catch(error=>error);await fake.started;t.service.organization.compatibility.pause(t.media.id,session);expect(String(await first)).toContain('暂停');const row=t.db.prepare("SELECT id,status,payload_json AS payload FROM tasks WHERE kind='video-preview'").get() as any;expect(row.status).toBe('paused');expect(JSON.parse(row.payload).checkpoint.offset).toBe(10);expect(videoCheckpointNames(t.db).size).toBe(1);expect(t.service.organization.compatibility.hasActive()).toBe(false);
  fake.release();const resumed=new CompatibilityVideos(t.db,()=>t.media.absolutePath,()=>{}),result=await resumed.prepare(t.media.id,t.cache);expect(fake.offsets).toEqual([0,10,10,20]);expect(await readdir(t.cache)).toEqual([path.basename(result.cachePath)]);expect(t.db.prepare('SELECT status,processed,total FROM tasks WHERE id=?').get(row.id)).toEqual({status:'completed',processed:25,total:25});const count=vi.mocked(runFfmpeg).mock.calls.length;expect(await resumed.prepare(t.media.id,t.cache)).toEqual(result);expect(runFfmpeg).toHaveBeenCalledTimes(count);resumed.close();
 }finally{await t.close();}
});
it('continues a paused checkpoint after its canonical cache files are moved to another cache directory',async()=>{
 const t=await setup(),fake=interruptSecond();try{
  const first=t.service.organization.compatibility.prepare(t.media.id,t.cache).catch(()=>{});await fake.started;t.service.organization.compatibility.pause(t.media.id);await first;const target=path.join(t.temp,'new-cache');await rename(t.cache,target);fake.release();const manager=new CompatibilityVideos(t.db,()=>t.media.absolutePath,()=>{});await manager.prepare(t.media.id,target);expect(fake.offsets).toEqual([0,10,10,20]);manager.close();
 }finally{await t.close();}
});
it('recovers safely if paused checkpoint files were explicitly cleared',async()=>{
 const t=await setup(),fake=interruptSecond();try{
  const first=t.service.organization.compatibility.prepare(t.media.id,t.cache).catch(()=>{});await fake.started;t.service.organization.compatibility.pause(t.media.id);await first;for(const name of await readdir(t.cache))await rm(path.join(t.cache,name));fake.release();await t.service.organization.compatibility.prepare(t.media.id,t.cache);expect(fake.offsets).toEqual([0,10,0,10,20]);
 }finally{await t.close();}
});

it('multiple concurrent range requests share one compatibility conversion and reuse its completed output',async()=>{
 const t=await setup();vi.mocked(runFfmpeg).mockClear();vi.mocked(runFfmpeg).mockImplementation(async args=>{await new Promise(resolve=>setTimeout(resolve,5));await writeFile(args.at(-1)!,'encoded');return '';});
 try{const results=await Promise.all(Array.from({length:20},()=>t.service.organization.compatibility.prepare(t.media.id,t.cache,'same')));expect(new Set(results.map(result=>result.cachePath)).size).toBe(1);expect(vi.mocked(runFfmpeg).mock.calls.filter(([args])=>args.includes('-ss'))).toHaveLength(3);expect(t.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE kind='video-preview'").get()).toEqual({count:1});const count=vi.mocked(runFfmpeg).mock.calls.length;await t.service.organization.compatibility.prepare(t.media.id,t.cache,'new-view');expect(runFfmpeg).toHaveBeenCalledTimes(count);}finally{await t.close();}
});
