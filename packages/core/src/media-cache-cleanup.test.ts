import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile,readFile,unlink,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {openDatabase,closeDatabase,rawMedia,type LuminaDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';
let temp:string,db:LuminaDatabase,service:LibraryService,media:any[],cache:string;
const command=(input:unknown):Promise<any>=>service.handle(input);
beforeEach(async()=>{temp=await mkdtemp(path.join(os.tmpdir(),'lumina-cache-cleanup-'));const root=path.join(temp,'media');cache=path.join(temp,'cache');await mkdir(root);const bytes=await sharp({create:{width:100,height:70,channels:3,background:'blue'}}).jpeg().toBuffer();for(const name of ['a.jpg','b.jpg'])await writeFile(path.join(root,name),bytes);db=openDatabase(path.join(temp,'library.db'));service=new LibraryService(db,cache);await command({type:'roots.addAndScan',absolutePath:root});service.watcher.close();media=await command({type:'media.list',sortBy:'name',sort:'asc'});});
afterEach(async()=>{service.close();closeDatabase(db);await rm(temp,{recursive:true,force:true,maxRetries:4});});
async function cached(id:string){const thumbnail=await command({type:'media.thumbnail',id}),preview=await command({type:'media.previewPath',id}),full=await command({type:'media.previewPath',id,fullSize:true});return [thumbnail.cachePath,preview.cachePath,full.cachePath] as string[];}
async function removed(files:string[]){for(const file of files)await expect(stat(file)).rejects.toMatchObject({code:'ENOENT'});}
it('keeps index and caches while in the software recycle bin, then removes them when the stored original is already missing',async()=>{
 const files=await cached(media[0].id);await command({type:'media.addTag',id:media[0].id,tagName:'回收标签'});await command({type:'trash.put',mediaIds:[media[0].id]});await service.organization.cacheCleanup.flush();expect(rawMedia(db,media[0].id)).toBeTruthy();for(const file of files)expect((await stat(file)).size).toBeGreaterThan(0);
 const [entry]=await command({type:'trash.list'});await unlink(entry.storedPath);const result=await command({type:'trash.purge',mediaIds:[media[0].id],destination:'permanent'});expect(result[0].ok).toBe(true);expect(rawMedia(db,media[0].id)).toBeUndefined();await service.organization.cacheCleanup.flush();await removed(files);expect(await command({type:'trash.list'})).toHaveLength(0);expect(db.prepare('SELECT 1 FROM media_fts WHERE media_id=?').get(media[0].id)).toBeUndefined();
});
it.each(['software','system','permanent'])('cleans a missing file for %s deletion without affecting another media item or its cache',async(destination)=>{
 const files=await cached(media[0].id),other=await cached(media[1].id),bytes=await readFile(media[1].absolutePath);await unlink(media[0].absolutePath);
 const result=await command(destination==='software'?{type:'trash.put',mediaIds:[media[0].id]}:{type:'trash.purge',mediaIds:[media[0].id],destination});expect(result[0].ok).toBe(true);expect(rawMedia(db,media[0].id)).toBeUndefined();await service.organization.cacheCleanup.flush();await removed(files);for(const file of other)expect((await stat(file)).size).toBeGreaterThan(0);expect(await readFile(media[1].absolutePath)).toEqual(bytes);expect(await command({type:'media.list'})).toHaveLength(1);
});
it('recovers queued cleanup after restart and includes registered previews from earlier file fingerprints',async()=>{
 const files=await cached(media[0].id);await writeFile(media[0].absolutePath,await sharp({create:{width:110,height:80,channels:3,background:'red'}}).jpeg().toBuffer());await command({type:'roots.scan',id:(await command({type:'roots.list'}))[0].id});const updated=await command({type:'media.previewPath',id:media[0].id});expect(files).not.toContain(updated.cachePath);
 await command({type:'trash.purge',mediaIds:[media[0].id],destination:'permanent'});service.close();expect(db.prepare('SELECT 1 FROM settings WHERE key=?').get(`cache-cleanup:${media[0].id}`)).toBeTruthy();closeDatabase(db);db=openDatabase(path.join(temp,'library.db'));service=new LibraryService(db,cache);service.organization.cacheCleanup.start();await service.organization.cacheCleanup.flush();await removed([...files,updated.cachePath]);expect(db.prepare('SELECT 1 FROM settings WHERE key=?').get(`cache-cleanup:${media[0].id}`)).toBeUndefined();
});
it('retains indexed metadata if deletion was cancelled, even when the original has already disappeared',async()=>{
 const files=await cached(media[0].id);await unlink(media[0].absolutePath);const abort=new AbortController();abort.abort();await expect(service.organization.recycle.purge(media[0].id,'permanent',abort.signal)).rejects.toThrow('已取消');expect(rawMedia(db,media[0].id)).toBeTruthy();for(const file of files)expect((await stat(file)).size).toBeGreaterThan(0);
});
