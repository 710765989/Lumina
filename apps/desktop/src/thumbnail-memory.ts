import {readFile,stat} from 'node:fs/promises';

// Encoded JPEGs only. Authorization and current cache-path resolution remain
// with the core before each call. Stat checks invalidate moved/changed/deleted files.
export class ThumbnailMemory {
 private entries=new Map<string,{stamp:string;bytes:Buffer<ArrayBuffer>}>();private used=0;
 private pending=new Map<string,Promise<Buffer<ArrayBuffer>>>();private active=0;private waiting:Array<()=>void>=[];
 constructor(private budget=32*1024*1024){}
 get byteLength(){return this.used;}
 async read(file:string):Promise<Buffer<ArrayBuffer>>{
  const pending=this.pending.get(file);if(pending)return pending;
  const work=this.load(file);this.pending.set(file,work);
  try{return await work;}finally{this.pending.delete(file);}
 }
 private forget(file:string){const previous=this.entries.get(file);if(previous){this.used-=previous.bytes.length;this.entries.delete(file);}}
 private async load(file:string){
  // Warm memory hits must not wait behind unrelated disk reads.
  let info;try{info=await stat(file);}catch(error){this.forget(file);throw error;}
  const initialStamp=`${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`,known=this.entries.get(file);
  if(known?.stamp===initialStamp){this.entries.delete(file);this.entries.set(file,known);return known.bytes;}
  let waited=false;if(this.active<4)this.active++;else {waited=true;await new Promise<void>(resolve=>this.waiting.push(resolve));}
  try{
   const current=waited?await stat(file):info,stamp=`${current.size}:${current.mtimeMs}:${current.ctimeMs}:${current.ino}`,cached=this.entries.get(file);
   if(cached?.stamp===stamp){this.entries.delete(file);this.entries.set(file,cached);return cached.bytes;}
   this.forget(file);const bytes=await readFile(file),after=await stat(file);
   if(`${after.size}:${after.mtimeMs}:${after.ctimeMs}:${after.ino}`!==stamp)throw new Error('缩略图正在更新，请稍后重试');
   if(bytes.length<=this.budget){while(this.used+bytes.length>this.budget&&this.entries.size)this.forget(this.entries.keys().next().value!);this.entries.set(file,{stamp,bytes});this.used+=bytes.length;}
   return bytes;
  }catch(error){this.forget(file);throw error;}
  finally{const next=this.waiting.shift();if(next)next();else this.active--;}
 }
}
