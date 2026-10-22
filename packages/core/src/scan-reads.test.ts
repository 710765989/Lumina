import {it,expect,vi} from 'vitest';
import {orderedScanReads,scanMetadataRead} from './scan-reads.js';
import * as geography from './geography.js';
import {scanDirectory} from './index.js';
import {openDatabase,closeDatabase} from '@lumina/storage';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

it('bounds metadata work across scans, caps video probes, and commits reads in source order',async()=>{
 let active=0,video=0,max=0,maxVideo=0;
 const run=async(prefix:string)=>{const results=[];for await(const result of orderedScanReads(Array.from({length:12},(_,i)=>`${prefix}-${i}`),file=>scanMetadataRead(Number(file.split('-')[1])%2===0,async()=>{const isVideo=Number(file.split('-')[1])%2===0;active++;if(isVideo)video++;max=Math.max(max,active);maxVideo=Math.max(maxVideo,video);try{await new Promise(resolve=>setTimeout(resolve,file.endsWith('-0')?20:2));return file;}finally{active--;if(isVideo)video--;}})))results.push(result.value);return results;};
 const results=await Promise.all([run('a'),run('b')]);
 expect(max).toBeGreaterThan(1);expect(max).toBeLessThanOrEqual(4);expect(maxVideo).toBeLessThanOrEqual(2);
 expect(results[0]).toEqual(Array.from({length:12},(_,i)=>`a-${i}`));expect(active).toBe(0);
});
it('stops read-ahead on early exit and drains failures without unhandled work',async()=>{
 let started=0,finished=0;
 for await(const result of orderedScanReads(Array.from({length:20},(_,i)=>String(i)),async file=>{started++;try{await new Promise(resolve=>setTimeout(resolve,2));if(file==='1')throw Error('bad input');return file;}finally{finished++;}})){expect(result.value).toBe('0');break;}
 expect(started).toBe(4);expect(finished).toBe(started);
});
it('cancels an in-flight metadata window without adding media, then resumes normally',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'lumina-scan-window-')),db=openDatabase(':memory:');let release!:()=>void,entered=0;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const mock=vi.spyOn(geography,'extractMetadata').mockImplementation(async()=>{entered++;await gate;return {width:40,height:30,format:'jpeg'} as any;});
 try{
  for(let i=0;i<20;i++)await writeFile(path.join(root,`${i}.jpg`),'fixture');
  const running=scanDirectory(db,root);
  for(let i=0;i<100&&entered<4;i++)await new Promise(resolve=>setTimeout(resolve,2));
  expect(entered).toBe(4);db.prepare("UPDATE tasks SET status='cancelled' WHERE kind='scan'").run();release();
  const stopped=await running;expect(stopped.task.status).toBe('cancelled');expect(stopped.task.processed).toBe(0);expect(stopped.media).toHaveLength(0);expect(entered).toBe(4);
  const resumed=await scanDirectory(db,root);expect(resumed.task.status).toBe('completed');expect(resumed.media).toHaveLength(20);
 }finally{release();mock.mockRestore();closeDatabase(db);await rm(root,{recursive:true,force:true});}
});
