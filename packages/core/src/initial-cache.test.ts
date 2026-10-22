import {mkdtemp,mkdir,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {it,expect,vi} from 'vitest';
import {openDatabase,closeDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';
vi.mock('node:fs/promises',async()=>{const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');return {...actual,writeFile:vi.fn(actual.writeFile)};});
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'lumina-initial-cache-')),cache=path.join(root,'cache'),photos=path.join(root,'photos');await mkdir(cache);await mkdir(photos);await mkdir(path.join(root,'database'));
 const db=openDatabase(path.join(root,'database','lumina.db'));let service=new LibraryService(db,cache,{defaultCacheRoot:cache});
 return {root,cache,photos,db,get service(){return service;},reopen(){service.close();service=new LibraryService(db,cache,{defaultCacheRoot:cache});},async close(){service.close();closeDatabase(db);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}};
}
it('previews a fresh location without saving it or scanning, then persists it before the first thumbnail is generated',async()=>{
 const t=await fixture();try{
  expect(await t.service.handle({type:'cache.settings'})).toMatchObject({setupRequired:true,directory:t.cache});
  const directory=path.join(t.root,'selected-ssd-cache'),preview:any=await t.service.handle({type:'cache.setupPreview',directory,libraryPath:t.photos});expect(preview.freeBytes).toBeGreaterThan(0);
  expect(await readdir(directory)).toEqual([]);expect(await t.service.handle({type:'cache.settings'})).toMatchObject({setupRequired:true,directory:t.cache});expect(await t.service.handle({type:'roots.list'})).toEqual([]);expect(await t.service.handle({type:'tasks.list'})).toEqual([]);
  await t.service.handle({type:'cache.setup',directory,libraryPath:t.photos});t.reopen();expect(await t.service.handle({type:'cache.settings'})).toMatchObject({setupRequired:false,directory});
  const photo=path.join(t.photos,'first.jpg');await sharp({create:{width:80,height:60,channels:3,background:'blue'}}).jpeg().toFile(photo);
  await t.service.handle({type:'roots.addAndScan',absolutePath:t.photos});const [media]=await t.service.handle({type:'media.list'}) as any[];const thumbnail:any=await t.service.handle({type:'media.thumbnail',id:media.id});expect(path.dirname(thumbnail.cachePath)).toBe(directory);expect(await readdir(t.cache)).toEqual([]);
 }finally{await t.close();}
});
it('confirms the existing default without starting a cache migration task',async()=>{
 const t=await fixture();try{await t.service.handle({type:'cache.setup',directory:t.cache,libraryPath:t.photos});expect(await t.service.handle({type:'cache.settings'})).toMatchObject({setupRequired:false,directory:t.cache});expect(await t.service.handle({type:'tasks.list'})).toEqual([]);}finally{await t.close();}
});
it('rejects overlapping gallery paths, database ancestors and occupied or foreign cache folders without changing the selection',async()=>{
 const t=await fixture();try{
  for(const directory of [t.photos,path.join(t.photos,'cache'),path.join(t.root,'database'),t.root])await expect(t.service.handle({type:'cache.setup',directory,libraryPath:t.photos})).rejects.toThrow('缓存目录');
  const occupied=path.join(t.root,'occupied');await mkdir(occupied);await writeFile(path.join(occupied,'original.jpg'),'keep');await expect(t.service.handle({type:'cache.setup',directory:occupied,libraryPath:t.photos})).rejects.toThrow('空目录');expect(await readFile(path.join(occupied,'original.jpg'),'utf8')).toBe('keep');
  const foreign=path.join(t.root,'foreign');await mkdir(foreign);await writeFile(path.join(foreign,'.lumina-cache.json'),JSON.stringify({owner:'another-library'}));await expect(t.service.handle({type:'cache.setup',directory:foreign,libraryPath:t.photos})).rejects.toThrow('空目录');
  expect(await t.service.handle({type:'cache.settings'})).toMatchObject({setupRequired:true,directory:t.cache});
 }finally{await t.close();}
});
it('does not select a folder when its write probe fails and permits a corrected choice',async()=>{
 const t=await fixture(),actual=(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).writeFile;
 try{vi.mocked(writeFile).mockImplementation((async(file:any,...args:any[])=>{if(path.basename(String(file)).startsWith('.lumina-write-check-'))throw Object.assign(new Error('denied'),{code:'EACCES'});return (actual as any)(file,...args);}) as typeof writeFile);
  await expect(t.service.handle({type:'cache.setup',directory:path.join(t.root,'not-writable'),libraryPath:t.photos})).rejects.toThrow('不可写');expect(await t.service.handle({type:'cache.settings'})).toMatchObject({setupRequired:true,directory:t.cache});
  vi.mocked(writeFile).mockImplementation(actual);await t.service.handle({type:'cache.setup',directory:t.cache,libraryPath:t.photos});expect(await t.service.handle({type:'cache.settings'})).toMatchObject({setupRequired:false});
 }finally{vi.mocked(writeFile).mockImplementation(actual);await t.close();}
});
it('keeps legacy locations and remembers that existing users should not be prompted after removing all roots',async()=>{
 const t=await fixture();try{
  const root:any=await t.service.handle({type:'roots.addAndScan',absolutePath:t.photos});expect(await t.service.handle({type:'cache.settings'})).toMatchObject({setupRequired:false,directory:t.cache});
  await t.service.handle({type:'roots.remove',id:root.root.id});t.db.prepare('DELETE FROM tasks').run();t.reopen();expect(await t.service.handle({type:'cache.settings'})).toMatchObject({setupRequired:false,directory:t.cache});
  await expect(t.service.handle({type:'cache.setup',directory:path.join(t.root,'other'),libraryPath:t.photos})).rejects.toThrow('已经确认');
 }finally{await t.close();}
});
it('serializes initial confirmation so repeated submissions cannot select two different directories',async()=>{
 const t=await fixture();try{const results=await Promise.allSettled(['first','second'].map(name=>t.service.handle({type:'cache.setup',directory:path.join(t.root,name),libraryPath:t.photos})));expect(results.map(row=>row.status)).toEqual(['fulfilled','rejected']);expect(await t.service.handle({type:'cache.settings'})).toMatchObject({directory:path.join(t.root,'first'),setupRequired:false});}finally{await t.close();}
});
