import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {mkdir,mkdtemp,writeFile,readFile,rename,rm,unlink,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {openDatabase,closeDatabase,type LuminaDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';
import {generateMediaThumbnail,generatePhotoThumbnail,getCachedThumbnail,thumbnailCachePath} from './thumbnail.js';
const writes=vi.hoisted(()=>({active:0,maximum:0,files:[] as string[]}));
vi.mock('sharp',async()=>{
 const actual=await vi.importActual<{default:typeof sharp}>('sharp');
 const factory=Object.assign((...args:any[])=>{
  const pipeline=(actual.default as any)(...args),save=pipeline.toFile.bind(pipeline);
  pipeline.toFile=async(file:string)=>{writes.files.push(file);writes.active++;writes.maximum=Math.max(writes.maximum,writes.active);try{await new Promise(resolve=>setTimeout(resolve,15));return await save(file);}finally{writes.active--;}};
  return pipeline;
 },actual.default);return {default:factory};
});
vi.mock('node:fs/promises',async()=>{const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');return {...actual,rename:vi.fn(actual.rename),readFile:vi.fn(actual.readFile)};});
let root:string,source:string,cache:string,db:LuminaDatabase|undefined,service:LibraryService|undefined;
const record=()=>({id:'cache-test',kind:'photo' as const,absolutePath:source,sizeBytes:100,modifiedAtMs:1,fingerprint:'one'});
beforeEach(async()=>{
 root=await mkdtemp(path.join(os.tmpdir(),'lumina-cache-reuse-'));source=path.join(root,'source.png');cache=path.join(root,'cache');
 await writeFile(source,await sharp({create:{width:900,height:600,channels:3,background:'#4678de'}}).png().toBuffer());
 writes.active=0;writes.maximum=0;writes.files=[];vi.mocked(rename).mockClear();vi.mocked(readFile).mockClear();
});
afterEach(async()=>{service?.close();if(db)closeDatabase(db);service=undefined;db=undefined;await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
async function library(){const library=path.join(root,'library');await mkdir(library);await rename(source,path.join(library,'photo.png'));source=path.join(library,'photo.png');db=openDatabase(':memory:');service=new LibraryService(db,cache);await service.handle({type:'roots.addAndScan',absolutePath:library});const media=await service.handle({type:'media.list'}) as any[];vi.mocked(rename).mockClear();return media[0];}

it('all thumbnail entry points share one writer across sizes and reuse a published file without decoding the source again',async()=>{
 const first=await generatePhotoThumbnail(record(),cache,{width:110});const stamp=await stat(first.cachePath);await unlink(source);
 const results=await Promise.all(Array.from({length:24},(_,i)=>i%2?generateMediaThumbnail(record(),cache,{width:1600}):generatePhotoThumbnail(record(),cache,{width:90})));
 expect(results.every(result=>result.cachePath===first.cachePath)).toBe(true);expect(writes.files).toHaveLength(1);expect(await stat(first.cachePath)).toMatchObject({mtimeMs:stamp.mtimeMs,ino:stamp.ino});
 expect(vi.mocked(readFile).mock.calls.filter(([file])=>String(file).endsWith('.jpg'))).toHaveLength(0);
});

it('coalesces concurrent low-level generation and service requests of different sizes into one cache and one task item',async()=>{
 const media=await library();const results=await Promise.all(Array.from({length:24},(_,i)=>service!.handle({type:'media.thumbnail',id:media.id,width:i%2?110:1200,height:i%2?110:900}))) as any[];
 expect(new Set(results.map(result=>result.taskId)).size).toBe(1);expect(writes.files).toHaveLength(1);expect(db!.prepare("SELECT COUNT(*) AS count FROM job_items WHERE task_id IN(SELECT id FROM tasks WHERE kind='thumbnail')").get()).toEqual({count:1});
 const before=await stat(results[0].cachePath);for(let i=0;i<3;i++)await service!.handle({type:'media.thumbnail',id:media.id,width:200+i*200});expect(writes.files).toHaveLength(1);expect((await stat(results[0].cachePath)).mtimeMs).toBe(before.mtimeMs);
});

it('coalesces cold disk verification and repairs a damaged cache only once',async()=>{
 await mkdir(cache);const target=thumbnailCachePath(cache,record());await writeFile(target,await sharp({create:{width:640,height:420,channels:3,background:'red'}}).jpeg().toBuffer());
 await Promise.all(Array.from({length:20},()=>getCachedThumbnail(record(),cache)));expect(vi.mocked(readFile).mock.calls.filter(([file])=>file===target)).toHaveLength(1);expect(writes.files).toHaveLength(0);
 const bytes=await readFile(target);await writeFile(target,bytes.subarray(0,Math.floor(bytes.length*.7)));await Promise.all(Array.from({length:20},()=>generateMediaThumbnail(record(),cache)));expect(writes.files).toHaveLength(1);await expect(sharp(target).raw().toBuffer()).resolves.toBeInstanceOf(Buffer);
 expect(await readdir(cache)).toEqual([path.basename(target)]);
});

it('does not overwrite a valid thumbnail with an outdated queued generation',async()=>{
 const media=record();const result=await generateMediaThumbnail(media,cache);await expect(generateMediaThumbnail({...media,fingerprint:'outdated'},cache,{isCurrent:()=>false})).rejects.toThrow('过期');
 expect(writes.files).toHaveLength(1);expect(await readdir(cache)).toEqual([path.basename(result.cachePath)]);
});

it('a changed fingerprint or explicit cache deletion rebuilds once, then all zoom sizes reuse it',async()=>{
 const first=await generateMediaThumbnail(record(),cache);const next={...record(),fingerprint:'two'};
 const results=await Promise.all(Array.from({length:12},()=>generateMediaThumbnail(next,cache)));expect(writes.files).toHaveLength(2);expect(results[0]!.cachePath).not.toBe(first.cachePath);expect(await readdir(cache)).toHaveLength(1);
 await unlink(results[0]!.cachePath);await Promise.all(Array.from({length:12},()=>generateMediaThumbnail(next,cache,{width:1600})));expect(writes.files).toHaveLength(3);expect(await readdir(cache)).toHaveLength(1);
});

it('coalesces photo preview checks before async disk access, sharing screen/full previews for a small original',async()=>{
 const media=await library();const results=await Promise.all(Array.from({length:24},(_,i)=>service!.handle({type:'media.previewPath',id:media.id,fullSize:i%2===0}))) as any[];
 expect(new Set(results.map(result=>result.cachePath)).size).toBe(1);expect(writes.files).toHaveLength(1);expect(vi.mocked(rename).mock.calls.filter(([,file])=>String(file).startsWith(cache))).toHaveLength(1);
 await unlink(source);await service!.handle({type:'media.previewPath',id:media.id});expect(writes.files).toHaveLength(1);
});

it('repeated explicit preview retries arriving together produce one complete replacement',async()=>{
 const media=await library();const first:any=await service!.handle({type:'media.previewPath',id:media.id});await writeFile(first.cachePath,'broken');
 const results=await Promise.all(Array.from({length:20},()=>service!.handle({type:'media.previewPath',id:media.id,regenerate:true}))) as any[];
 expect(writes.files).toHaveLength(2);expect(results.every(result=>result.cachePath===first.cachePath)).toBe(true);await expect(sharp(first.cachePath).raw().toBuffer()).resolves.toBeInstanceOf(Buffer);expect((await readdir(cache)).some(file=>file.includes('.tmp'))).toBe(false);
});

it('refresh and retry validate a healthy preview without regenerating it',async()=>{
 const media=await library(),first:any=await service!.handle({type:'media.previewPath',id:media.id}),stamp=await stat(first.cachePath);await unlink(source);
 await service!.handle({type:'media.previewPath',id:media.id,regenerate:true});await service!.handle({type:'media.previewPath',id:media.id,regenerate:true});
 expect(writes.files).toHaveLength(1);expect((await stat(first.cachePath)).mtimeMs).toBe(stamp.mtimeMs);
});

it('bounds photo preview generation at two without blocking unrelated cached reads',async()=>{
 const media=await library();const ids=Array.from({length:7},(_,i)=>`preview-${i}`);for(const id of ids)db!.prepare("INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,'photo',100,1,?)").run(id,path.join(root,id+'.png'),id);
 for(const id of ids)await writeFile(path.join(root,id+'.png'),await readFile(source));
 await service!.handle({type:'media.previewPath',id:media.id});writes.files=[];writes.maximum=0;
 await Promise.all(ids.map(id=>service!.handle({type:'media.previewPath',id})));expect(writes.files).toHaveLength(7);expect(writes.maximum).toBe(2);
});

it('backs off failed automatic thumbnails and allows an immediate explicit retry after source recovery',async()=>{
 const media=await library(),bytes=await readFile(source);await unlink(source);
 await Promise.allSettled(Array.from({length:20},()=>service!.handle({type:'media.thumbnail',id:media.id})));
 const failedWrites=writes.files.length;expect(failedWrites).toBe(1);
 await expect(service!.handle({type:'media.thumbnail',id:media.id})).rejects.toThrow();expect(writes.files).toHaveLength(failedWrites);
 await writeFile(source,bytes);await service!.handle({type:'media.thumbnail',id:media.id,retry:true});expect(writes.files).toHaveLength(2);
 await service!.handle({type:'media.thumbnail',id:media.id});expect(writes.files).toHaveLength(2);
});
