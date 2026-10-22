import {it,expect,vi} from 'vitest';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ThumbnailMemory} from '../apps/desktop/src/thumbnail-memory.js';
vi.mock('node:fs/promises',async()=>{const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');return {...actual,readFile:vi.fn(actual.readFile)};});
it('serves warm bytes immediately while four unrelated disk reads are blocked and coalesces each cold file',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'lumina-memory-queue-')),cache=new ThumbnailMemory(),warm=path.join(root,'warm.jpg'),files=Array.from({length:4},(_,i)=>path.join(root,`${i}.jpg`));let release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve);const actual=(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).readFile;
 try{
  for(const file of [warm,...files])await writeFile(file,'cached bytes');const bytes=await cache.read(warm);let blocked=0,started!:()=>void;const allStarted=new Promise<void>(resolve=>started=resolve);
  vi.mocked(readFile).mockImplementation((async(file:any)=>{if(files.includes(String(file))){if(++blocked===4)started();await gate;}return actual(file);}) as typeof readFile);
  const pending=files.flatMap(file=>[cache.read(file),cache.read(file)]);await allStarted;
  const result=await Promise.race([cache.read(warm),new Promise(resolve=>setTimeout(()=>resolve('blocked'),200))]);expect(result).toBe(bytes);expect(blocked).toBe(4);release();await Promise.all(pending);
 }finally{release();vi.mocked(readFile).mockImplementation(actual);await rm(root,{recursive:true,force:true});}
});
