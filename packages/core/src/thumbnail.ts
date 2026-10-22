import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, stat, readFile, rename, rm,readdir } from 'node:fs/promises';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';
import type { MediaRecord } from '@lumina/contracts';

// ffmpeg-static exposes a string from its CommonJS runtime, while NodeNext can
// resolve its declaration as a module namespace. Normalize both forms here.
const ffmpegPath = (ffmpegStatic as unknown as string | null);

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  quality?: number;
  onPruned?:(file:string)=>void;
  isCurrent?:()=>boolean;
}

export interface ThumbnailResult {
  cachePath: string;
  width: number;
  height: number;
  bytes: number;
}

// Include replacement identity as well as size/time: restoring an old timestamp
// must not make changed cache contents look verified.
const thumbnailStamp=(file:{size:number;mtimeMs:number;ctimeMs:number;ino:number})=>`${file.size}:${file.mtimeMs}:${file.ctimeMs}:${file.ino}`;
function rememberVerified(result:ThumbnailResult,file:Parameters<typeof thumbnailStamp>[0]){
  verifiedThumbnails.delete(result.cachePath);verifiedThumbnails.set(result.cachePath,{stamp:thumbnailStamp(file),result});
  if(verifiedThumbnails.size>4096)verifiedThumbnails.delete(verifiedThumbnails.keys().next().value!);
}
async function readCachedThumbnail(record:MediaRecord,cacheRoot:string,options:ThumbnailOptions,ownsSlot=false):Promise<ThumbnailResult|null>{
 const cachePath=thumbnailCachePath(cacheRoot,record,options);
 try{
  const file=await stat(cachePath);if(!file.isFile()||!file.size)return null;
  const stamp=thumbnailStamp(file),known=verifiedThumbnails.get(cachePath);
  if(known?.stamp===stamp){verifiedThumbnails.delete(cachePath);verifiedThumbnails.set(cachePath,known);return known.result;}
  if(!ownsSlot)await thumbnailSlot();
  try{
   const current=await stat(cachePath),currentStamp=thumbnailStamp(current),verified=verifiedThumbnails.get(cachePath);
   if(verified?.stamp===currentStamp)return verified.result;
   // Only previously unverified disk files need a full decode. Fresh output is
   // marked verified by the writer, so opening it does not decode it a second time.
   const bytes=await readFile(cachePath),{info}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
   const after=await stat(cachePath);if(thumbnailStamp(after)!==currentStamp)return null;
   const result={cachePath,width:info.width,height:info.height,bytes:after.size};rememberVerified(result,after);
   if(options.isCurrent&&!options.isCurrent())return null;
   await pruneThumbnailVariants(cacheRoot,record,cachePath,options.onPruned,options.isCurrent);return result;
  }finally{if(!ownsSlot)releaseThumbnailSlot();}
 }catch(error){
  if(['EACCES','EPERM','EBUSY'].includes((error as NodeJS.ErrnoException).code??''))throw error;
  verifiedThumbnails.delete(cachePath);return null;
 }
}
export async function getCachedThumbnail(record:MediaRecord,cacheRoot:string,options:ThumbnailOptions={}):Promise<ThumbnailResult|null>{
 const cachePath=thumbnailCachePath(cacheRoot,record,options),existing=validatingThumbnails.get(cachePath);if(existing)return existing;
 const request=readCachedThumbnail(record,cacheRoot,options);validatingThumbnails.set(cachePath,request);
 try{return await request;}finally{if(validatingThumbnails.get(cachePath)===request)validatingThumbnails.delete(cachePath);}
}

// All UI sizes share one canonical thumbnail; viewport zoom only scales it.
function dimensions(_options:ThumbnailOptions){return {width:640,height:640,quality:82};}
const validatingThumbnails=new Map<string,Promise<ThumbnailResult|null>>();
const verifiedThumbnails=new Map<string,{stamp:string;result:ThumbnailResult}>();
const cacheIndexes=new Map<string,Promise<Map<string,Set<string>>>>();
async function thumbnailIndex(root:string){
  let pending=cacheIndexes.get(root);
  if(!pending){pending=(async()=>{const index=new Map<string,Set<string>>();for(const name of await readdir(root).catch(()=>[])){const match=/^(.+)-[a-f0-9]{16}\.jpg$/u.exec(name);if(!match)continue;const names=index.get(match[1]!)??new Set<string>();names.add(name);index.set(match[1]!,names);}return index;})();cacheIndexes.set(root,pending);}
  return pending;
}
export async function removeMediaThumbnails(root:string,id:string,onPruned?:(file:string)=>void){
  const index=await thumbnailIndex(root),names=index.get(id);if(!names)return;
  for(const name of names){await rm(path.join(root,name),{force:true});verifiedThumbnails.delete(path.join(root,name));onPruned?.(path.join(root,name));names.delete(name);}index.delete(id);
}
async function pruneThumbnailVariants(root:string,record:MediaRecord,keep:string,onPruned?:(file:string)=>void,isCurrent?:()=>boolean){
  const index=await thumbnailIndex(root);if(isCurrent&&!isCurrent())return;const names=index.get(record.id)??new Set<string>(),basename=path.basename(keep);names.add(basename);
  for(const name of names)if(name!==basename){if(isCurrent&&!isCurrent())break;try{await rm(path.join(root,name),{force:true});names.delete(name);verifiedThumbnails.delete(path.join(root,name));onPruned?.(path.join(root,name));}catch{/* Keep locked variants indexed so later cleanup can retry. */}}
  index.set(record.id,names);
}

export function thumbnailCachePath(cacheRoot: string, record: Pick<MediaRecord,'id'|'fingerprint'>, options: ThumbnailOptions = {}): string {
  const size = dimensions(options);
  const variant = createHash('sha256').update(`${record.id}\0${record.fingerprint}\0${size.width}x${size.height}\0${size.quality}`).digest('hex').slice(0, 16);
  return path.join(cacheRoot, `${record.id}-${variant}.jpg`);
}

async function writePhotoThumbnail(
  record: MediaRecord,
  cacheRoot: string,
  options: ThumbnailOptions = {},
): Promise<ThumbnailResult> {
  if (record.kind !== 'photo') throw new Error(`Thumbnail is only supported for photos: ${record.id}`);
  const size = dimensions(options);
  const cachePath = thumbnailCachePath(cacheRoot, record, size);
  await mkdir(cacheRoot, { recursive: true });
  const temporaryPath = `${cachePath}.${randomUUID()}.tmp`;
  try {
    const result = await sharp(record.absolutePath, { failOn: 'error' })
      .rotate()
      .resize({ width: size.width, height: size.height, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: size.quality, progressive: true })
      .toFile(temporaryPath);
    if(options.isCurrent&&!options.isCurrent())throw new Error('媒体已移除或更新，未保留过期缩略图');
    await rename(temporaryPath, cachePath);await pruneThumbnailVariants(cacheRoot,record,cachePath,options.onPruned,options.isCurrent);
    const output={ cachePath, width: result.width, height: result.height, bytes: result.size };rememberVerified(output,await stat(cachePath));return output;
  } finally { await rm(temporaryPath, { force: true }); }
}

export async function runFfmpeg(args: string[],signal?:AbortSignal): Promise<string> {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates: string[] = [];
  if (process.env.LUMINA_FFMPEG_PATH) candidates.push(process.env.LUMINA_FFMPEG_PATH);
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  if (ffmpegPath) candidates.push(ffmpegPath);
  const binary = candidates.find((candidate) => existsSync(candidate));
  if (!binary) throw new Error('ffmpeg binary is unavailable');
  return new Promise<string>((resolve, reject) => {
    signal?.throwIfAborted();const process = spawn(binary, args, { windowsHide: true });
    const cancel=()=>process.kill();signal?.addEventListener('abort',cancel,{once:true});
    let stderr = '';
    process.stderr.on('data', (chunk) => { stderr += String(chunk);if(stderr.length>65536)stderr=stderr.slice(0,32768)+stderr.slice(-32768); });
    process.on('error', reject);
    process.on('close', (code) => {signal?.removeEventListener('abort',cancel);if(signal?.aborted)reject(new Error('任务已取消'));else if(code===0)resolve(stderr);else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));});
  });
}
export async function probeVideoMetadata(file:string) {
  const report=await runFfmpeg(['-hide_banner','-i',file,'-t','0','-map','0:v:0','-an','-sn','-f','null','-']);
  const stream=report.split('\n').find((line)=>line.includes('Video:')) ?? '';
  const dimensions=stream.match(/(?:,|\s)(\d{2,6})x(\d{2,6})(?:[,\s])/u);if(!dimensions)throw new Error('无法识别视频画面');
  const duration=report.match(/Duration:\s*(\d+):(\d+):([\d.]+)/u);
  const captured=report.match(/creation_time\s*:\s*(\S+)/u)?.[1];const capturedAtMs=captured?Date.parse(captured):NaN;
  return {width:Number(dimensions[1]),height:Number(dimensions[2]),duration:duration?Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3]):null,videoCodec:stream.match(/Video:\s*([^,\s]+)/u)?.[1] ?? '',format:path.extname(file).slice(1),capturedAtMs:Number.isFinite(capturedAtMs)?capturedAtMs:null};
}

async function writeVideoThumbnail(
  record: MediaRecord,
  cacheRoot: string,
  options: ThumbnailOptions = {},
): Promise<ThumbnailResult> {
  if (record.kind !== 'video') throw new Error(`Thumbnail is only supported for videos: ${record.id}`);
  const size = dimensions(options);
  const cachePath = thumbnailCachePath(cacheRoot, record, size);
  await mkdir(cacheRoot, { recursive: true });
  const temporaryPath=`${cachePath}.${randomUUID()}.tmp`;
  try {
    // Some DJI MP4s cannot seek to timestamp zero. Decode the first frame
    // sequentially instead; ffmpeg can exit successfully without any output.
    await runFfmpeg([
      '-y','-hide_banner','-loglevel','error','-i',record.absolutePath,
      '-map','0:v:0','-an','-sn','-dn','-frames:v','1',
      '-vf',`scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`,
      '-q:v','4','-update','1','-f','image2',temporaryPath,
    ]);
    const file=await stat(temporaryPath).catch(error=>{if(error.code==='ENOENT')throw new Error('视频未能输出可用画面，无法生成缩略图；请检查视频是否完整或可播放');throw error;});
    if(!file.size)throw new Error('视频未能输出可用画面，无法生成缩略图；请检查视频是否完整或可播放');
    const metadata=await sharp(temporaryPath).metadata();
    if(options.isCurrent&&!options.isCurrent())throw new Error('媒体已移除或更新，未保留过期缩略图');
    await rename(temporaryPath,cachePath);await pruneThumbnailVariants(cacheRoot,record,cachePath,options.onPruned,options.isCurrent);
    const output={cachePath,width:metadata.width??size.width,height:metadata.height??size.height,bytes:file.size};rememberVerified(output,await stat(cachePath));return output;
  } finally {await rm(temporaryPath,{force:true});}
}

const pendingThumbnails = new Map<string, Promise<ThumbnailResult>>();
let activeThumbnailWorkers = 0;
const thumbnailWaiters: Array<() => void> = [];
async function thumbnailSlot() {
  if (activeThumbnailWorkers < 3) { activeThumbnailWorkers++; return; }
  await new Promise<void>((resolve) => thumbnailWaiters.push(resolve));
}
function releaseThumbnailSlot() { const next = thumbnailWaiters.shift(); if (next) next(); else activeThumbnailWorkers--; }

export async function generateMediaThumbnail(
  record: MediaRecord,
  cacheRoot: string,
  options: ThumbnailOptions = {},
): Promise<ThumbnailResult> {
  const key = thumbnailCachePath(cacheRoot, record, options);
  const pending = pendingThumbnails.get(key);
  if (pending) return pending;
  const request = (async () => {
    const cached=await getCachedThumbnail(record,cacheRoot,options);if(cached)return cached;
    await thumbnailSlot();
    try {
      // Another producer may have published while this request waited for a slot.
      const ready=await readCachedThumbnail(record,cacheRoot,options,true);if(ready)return ready;
      if(options.isCurrent&&!options.isCurrent())throw new Error('媒体已移除或更新，未生成过期缩略图');
      if (record.kind === 'photo') return await writePhotoThumbnail(record, cacheRoot, options);
      if (record.kind === 'video') return await writeVideoThumbnail(record, cacheRoot, options);
      throw new Error(`Thumbnail is not supported for media kind: ${record.kind}`);
    } finally { releaseThumbnailSlot(); }
  })();
  pendingThumbnails.set(key, request);
  try { return await request; } finally { pendingThumbnails.delete(key); }
}

// Every public generation entry uses the same canonical file and in-flight lock.
export async function generatePhotoThumbnail(record:MediaRecord,cacheRoot:string,options:ThumbnailOptions={}){
 if(record.kind!=='photo')throw new Error('此媒体不是照片，无法生成照片缩略图');
 return generateMediaThumbnail(record,cacheRoot,options);
}
export async function generateVideoThumbnail(record:MediaRecord,cacheRoot:string,options:ThumbnailOptions={}){
 if(record.kind!=='video')throw new Error('此媒体不是视频，无法生成视频缩略图');
 return generateMediaThumbnail(record,cacheRoot,options);
}
