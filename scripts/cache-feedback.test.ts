import {it,expect} from 'vitest';
import {cacheMoveProgress} from '../apps/desktop/renderer/src/cache-move-progress.js';
import {ThumbnailMemory} from '../apps/desktop/src/thumbnail-memory.js';
import {mkdtemp,writeFile,unlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {albumTrail} from '../apps/desktop/renderer/src/AlbumBreadcrumbs.js';

it('builds a complete album ancestor chain and guards against missing parents or cycles',()=>{
 const albums=['a','b','c','d','e'].map((id,index)=>({id,name:id,parentId:index?String.fromCharCode(96+index):null}));
 expect(albumTrail(albums,'e').map(item=>item.id)).toEqual(['a','b','c','d','e']);expect(albumTrail(albums,'c').map(item=>item.id)).toEqual(['a','b','c']);
 expect(albumTrail([{id:'a',name:'a',parentId:'b'},{id:'b',name:'b',parentId:'a'}],'a')).toHaveLength(2);
 expect(albumTrail([{id:'a',name:'a',parentId:'missing'}],'a')).toHaveLength(1);
});

it('reserves 100% for completion and shows separate cleanup counters including recovered tasks',()=>{
 const copied={status:'running',active:true,processed:100,total:100};
 expect(cacheMoveProgress(copied).percent).toBe(50);
 const cleanup={...copied,committed:true,phaseProcessed:20,phaseTotal:100};
 expect(cacheMoveProgress(cleanup).text).toContain('第 2/2 步 · 清理旧缓存 · 20/100');expect(cacheMoveProgress(cleanup).percent).toBe(59);
 expect(cacheMoveProgress({...cleanup,phaseProcessed:100}).percent).toBe(99);
 expect(cacheMoveProgress({...cleanup,status:'completed',active:true,phaseProcessed:100}).percent).toBe(99);
 expect(cacheMoveProgress({...cleanup,status:'completed',active:false}).percent).toBe(100);
 expect(cacheMoveProgress({...copied,payloadJson:JSON.stringify({phase:'cleanup',cleanupProcessed:40,cleanupTotal:100})}).text).toContain('40/100');
 expect(cacheMoveProgress({...copied,total:0,processed:0}).percent).toBe(0);
});
it('reuses JPEG bytes within a hard memory budget and invalidates changed or deleted disk entries',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'lumina-thumb-memory-')),cache=new ThumbnailMemory(12),a=path.join(root,'a.jpg'),b=path.join(root,'b.jpg');
 try{await writeFile(a,'first');await writeFile(b,'second');const first=await cache.read(a);expect(await cache.read(a)).toBe(first);expect(await Promise.all([cache.read(a),cache.read(a)])).toEqual([first,first]);
  await cache.read(b);expect(cache.byteLength).toBe(11);await writeFile(a,'changed-file');expect((await cache.read(a)).toString()).toBe('changed-file');expect(cache.byteLength).toBeLessThanOrEqual(12);
  await unlink(a);await expect(cache.read(a)).rejects.toThrow();expect(cache.byteLength).toBe(0);await writeFile(a,'too-large-for-cache');await cache.read(a);expect(cache.byteLength).toBe(0);
 }finally{await rm(root,{recursive:true,force:true});}
});
