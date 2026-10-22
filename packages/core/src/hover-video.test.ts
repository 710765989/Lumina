import {it,expect,vi} from 'vitest';
import {mkdtemp,readdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {HoverVideoPreviews} from './hover-video.js';
import {runFfmpeg} from './thumbnail.js';
vi.mock('./thumbnail.js',()=>({runFfmpeg:vi.fn()}));
it('cancels an abandoned hover without leaving an incomplete clip or running a second encoder concurrently',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'lumina-hover-test-')),clips=new HoverVideoPreviews();let running=0,max=0;
  vi.mocked(runFfmpeg).mockImplementation(async(args,signal)=>{running++;max=Math.max(max,running);try{await writeFile(args.at(-1)!,'partial');await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,40);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('任务已取消'));},{once:true});});return '';}finally{running--;}});
  try{
    const first=clips.prepare({id:'one',fingerprint:'a'},'one.avi',root,randomUUID(),()=>true).then(()=>false,()=>true);
    await new Promise(resolve=>setTimeout(resolve,15));
    const next=await clips.prepare({id:'two',fingerprint:'a'},'two.avi',root,randomUUID(),()=>true);
    expect(await first).toBe(true);expect(max).toBe(1);expect(await readdir(root)).toEqual([path.basename(next.cachePath)]);
  }finally{clips.close();await rm(root,{recursive:true,force:true});}
});
it('reuses a complete clip for unchanged content and regenerates it only after the fingerprint changes',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'lumina-hover-test-')),clips=new HoverVideoPreviews();vi.mocked(runFfmpeg).mockClear();
  vi.mocked(runFfmpeg).mockImplementation(async args=>{await writeFile(args.at(-1)!,'clip');return '';});
  try{
    const first=await clips.prepare({id:'one',fingerprint:'a'},'one.avi',root,randomUUID(),()=>true);
    expect(await clips.prepare({id:'one',fingerprint:'a'},'one.avi',root,randomUUID(),()=>true)).toEqual(first);expect(runFfmpeg).toHaveBeenCalledTimes(1);
    expect(await clips.prepare({id:'one',fingerprint:'b'},'one.avi',root,randomUUID(),()=>true)).not.toEqual(first);expect(runFfmpeg).toHaveBeenCalledTimes(2);
  }finally{clips.close();await rm(root,{recursive:true,force:true});}
});
it('rejects cancellation arriving before preparation and removes a clip when its media disappears during encoding',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'lumina-hover-test-')),clips=new HoverVideoPreviews();let valid=true;const session=randomUUID();clips.cancel(session);vi.mocked(runFfmpeg).mockClear();
  vi.mocked(runFfmpeg).mockImplementation(async args=>{await writeFile(args.at(-1)!,'clip');valid=false;return '';});
  try{
    await expect(clips.prepare({id:'one',fingerprint:'a'},'one.avi',root,session,()=>true)).rejects.toThrow('取消');expect(runFfmpeg).not.toHaveBeenCalled();
    await expect(clips.prepare({id:'one',fingerprint:'a'},'one.avi',root,randomUUID(),()=>valid)).rejects.toThrow('移除');expect(await readdir(root)).toEqual([]);
  }finally{clips.close();await rm(root,{recursive:true,force:true});}
});

it('shares an in-flight clip across range requests and transfers cancellation to the latest view without encoding twice',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'lumina-hover-shared-')),clips=new HoverVideoPreviews();let started!:()=>void,release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>started=resolve);vi.mocked(runFfmpeg).mockClear();
 vi.mocked(runFfmpeg).mockImplementation(async(args,signal)=>{started();await gate;signal?.throwIfAborted();await writeFile(args.at(-1)!,'clip');return '';});
 try{
  const first=clips.prepare({id:'one',fingerprint:'same'},'one.avi',root,'old',()=>true);await ready;
  const next=Array.from({length:12},()=>clips.prepare({id:'one',fingerprint:'same'},'one.avi',root,'new',()=>true));clips.cancel('old');release();
  const results=await Promise.all([first,...next]);expect(results.every(result=>result.cachePath===results[0]!.cachePath)).toBe(true);expect(runFfmpeg).toHaveBeenCalledTimes(1);
  expect(await clips.prepare({id:'one',fingerprint:'same'},'one.avi',root,'last',()=>true)).toEqual(results[0]);expect(runFfmpeg).toHaveBeenCalledTimes(1);
 }finally{release();clips.close();await rm(root,{recursive:true,force:true});}
});
