import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile,utimes,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {openDatabase,closeDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';
import {hashFile} from './file-operations.js';
vi.mock('./file-operations.js',async()=>{const actual=await vi.importActual<typeof import('./file-operations.js')>('./file-operations.js');return {...actual,hashFile:vi.fn(actual.hashFile)};});
async function setup(){const temp=await mkdtemp(path.join(os.tmpdir(),'lumina-scan-efficiency-')),root=path.join(temp,'root');await mkdir(root);const bytes=await sharp({create:{width:32,height:24,channels:3,background:'blue'}}).jpeg().toBuffer();for(let i=0;i<3;i++)await writeFile(path.join(root,`${i}.jpg`),bytes);const db=openDatabase(path.join(temp,'index.db')),service=new LibraryService(db,path.join(temp,'cache')),command=(input:unknown):Promise<any>=>service.handle(input);await command({type:'roots.addAndScan',absolutePath:root});const media=await command({type:'media.list'});return {temp,root,db,service,command,media,close:async()=>{service.close();closeDatabase(db);await rm(temp,{recursive:true,force:true,maxRetries:4,retryDelay:100});}};}
async function wait(check:()=>boolean){for(let at=0;at<300;at++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('task did not settle');}
it('coalesces identical detection requests and reuses valid hashes until a file fingerprint changes',async()=>{
 const t=await setup();try{
  vi.mocked(hashFile).mockClear();const ids=t.media.map((item:any)=>item.id);const first=await t.command({type:'jobs.start',kind:'duplicates',mediaIds:ids}),again=await t.command({type:'jobs.start',kind:'duplicates',mediaIds:[...ids].reverse()});expect(again.id).toBe(first.id);await wait(()=>!t.service.organization.jobs.isActive(first.id));expect(hashFile).toHaveBeenCalledTimes(3);
  const second=await t.command({type:'jobs.start',kind:'duplicates',mediaIds:ids});await wait(()=>!t.service.organization.jobs.isActive(second.id));expect(hashFile).toHaveBeenCalledTimes(3);
  const file=t.media[0].absolutePath,info=await stat(file),next=new Date(info.mtimeMs+5000);await utimes(file,next,next);await t.command({type:'roots.scan',id:(await t.command({type:'roots.list'}))[0].id});const third=await t.command({type:'jobs.start',kind:'duplicates',mediaIds:ids});await wait(()=>!t.service.organization.jobs.isActive(third.id));expect(hashFile).toHaveBeenCalledTimes(4);
 }finally{await t.close();}
});
it('interrupts the active hash read when a detection task is paused',async()=>{
 const t=await setup();try{
  let began!:()=>void;const started=new Promise<void>(resolve=>began=resolve);
  vi.mocked(hashFile).mockImplementationOnce(async(_file,signal)=>{began();await new Promise<void>((resolve,reject)=>{signal?.addEventListener('abort',()=>reject(Error('已取消')),{once:true});});return 'unused';});
  const job=await t.command({type:'jobs.start',kind:'duplicates'});await started;await t.command({type:'jobs.control',id:job.id,action:'pause'});await wait(()=>!t.service.organization.jobs.isActive(job.id));expect(t.db.prepare('SELECT status,processed FROM tasks WHERE id=?').get(job.id)).toEqual({status:'paused',processed:0});
 }finally{await t.close();}
});
