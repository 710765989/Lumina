import {createHash,randomUUID} from 'node:crypto';
import {mkdir,stat,rename,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {rawMedia,type LuminaDatabase} from '@lumina/storage';
import {probeVideoMetadata,runFfmpeg} from './thumbnail.js';
import {registerMediaCache} from './media-cache-cleanup.js';
import {rememberCache,forgetCache} from './cache-inventory.js';

type Part={name:string;seconds:number};
type Checkpoint={duration:number;offset:number;parts:Part[]};
type Payload={mediaId:string;fingerprint:string;checkpoint:Checkpoint;phase:string};
type Active={id:string;target:string;session:string;taskId:string;abort:AbortController;work:Promise<{cachePath:string}>;busy:Set<string>};
const keyFor=(id:string,fingerprint:string)=>createHash('sha256').update(`${id}:${fingerprint}:h264-v1`).digest('hex');
export function videoCheckpointNames(db:LuminaDatabase){
 const names=new Set<string>();
 for(const row of db.prepare("SELECT t.payload_json AS payload FROM tasks t JOIN media m ON m.id=json_extract(t.payload_json,'$.mediaId') WHERE t.kind='video-preview' AND t.status<>'completed' AND m.fingerprint=json_extract(t.payload_json,'$.fingerprint')").all() as {payload:string}[]){try{for(const part of JSON.parse(row.payload).checkpoint?.parts??[])if(/^playback-[a-f0-9]{64}\.mp4$/u.test(part.name))names.add(part.name);}catch{/* Ignore old records without checkpoints. */}}
 return names;
}

// Completed short segments form a durable checkpoint. Pausing terminates only
// the current encoder; it never leaves a suspended process consuming memory.
export class CompatibilityVideos{
 private active=new Map<string,Active>();private closed=false;private stoppedSessions=new Set<string>();
 private preparing:Promise<unknown>=Promise.resolve();
 constructor(private db:LuminaDatabase,private filePath:(id:string)=>string,private notify:()=>void){}
 busy(name:string){return [...this.active.values()].some(item=>item.busy.has(name));}
 hasActive(){return this.active.size>0;}
 isActive(taskId:string){return [...this.active.values()].some(item=>item.taskId===taskId);}
 pause(id:string,session?:string,status:'paused'|'cancelled'='paused'){
  if(session){this.stoppedSessions.add(session);if(this.stoppedSessions.size>256)this.stoppedSessions.delete(this.stoppedSessions.values().next().value!);}
  const current=this.active.get(id);if(!current||session&&current.session!==session)return {ok:true};
  if(this.db.open)this.db.prepare('UPDATE tasks SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,current.taskId);
  current.abort.abort();this.notify();return {ok:true};
 }
 close(){for(const item of this.active.values())this.pause(item.id);this.closed=true;}
 async prepare(id:string,root:string,session:string=randomUUID()):Promise<{cachePath:string}>{
  const request=this.preparing.then(()=>this.begin(id,root,session));this.preparing=request.then(()=>{},()=>{});return (await request).work;
 }
 private async begin(id:string,root:string,session:string):Promise<{work:Promise<{cachePath:string}>}>{
  if(this.closed||this.stoppedSessions.has(session))throw new Error('视频准备已暂停，重新打开可继续');
  const media=rawMedia(this.db,id);if(!media||media.kind!=='video')throw new Error('视频不可用');
  const key=keyFor(id,media.fingerprint),target=path.join(root,`playback-${key}.mp4`);
  try{const file=await stat(target);if(file.isFile()&&file.size>0&&rawMedia(this.db,id)?.fingerprint===media.fingerprint)return {work:Promise.resolve({cachePath:target})};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const pending=this.active.get(id);
  if(pending){if(pending.target===target&&!pending.abort.signal.aborted){pending.session=session;return {work:pending.work};}this.pause(id);await pending.work.catch(()=>{});return this.begin(id,root,session);}
  // Foreground playback has priority; another unfinished video is checkpointed.
  for(const other of [...this.active.values()]){this.pause(other.id);await other.work.catch(()=>{});}
  if(this.closed||this.stoppedSessions.has(session))throw new Error('视频准备已暂停，重新打开可继续');
  const saved=this.db.prepare("SELECT id,payload_json AS payload FROM tasks WHERE kind='video-preview' AND json_extract(payload_json,'$.mediaId')=? AND json_extract(payload_json,'$.fingerprint')=? ORDER BY rowid DESC LIMIT 1").get(id,media.fingerprint) as {id:string;payload:string}|undefined;
  const payload:Payload=saved?JSON.parse(saved.payload):{mediaId:id,fingerprint:media.fingerprint,checkpoint:{duration:0,offset:0,parts:[]},phase:'准备兼容视频'};
  const taskId=saved?.id??randomUUID(),abort=new AbortController(),busy=new Set<string>();
  if(!saved)this.db.prepare("INSERT INTO tasks(id,kind,status,total,payload_json) VALUES(?,'video-preview','running',1,?)").run(taskId,JSON.stringify(payload));
  else this.db.prepare("UPDATE tasks SET status='running',error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(taskId);
  const item:Active={id,target,session,taskId,abort,busy,work:Promise.resolve({cachePath:target})};
  this.active.set(id,item);
  item.work=this.generate(item,media.fingerprint,root,target,payload).finally(()=>{if(this.active.get(id)===item)this.active.delete(id);if(!this.closed&&this.db.open)this.notify();});
  this.notify();return {work:item.work};
 }
 private async generate(item:Active,fingerprint:string,root:string,target:string,payload:Payload){
  const {id,abort,taskId,busy}=item,checkpoint=payload.checkpoint;const temporary=new Set<string>();
  const valid=()=>!this.closed&&this.db.open&&rawMedia(this.db,id)?.fingerprint===fingerprint;
  const save=(status='running')=>{if(!valid())return;this.db.prepare('UPDATE tasks SET status=?,processed=?,total=?,payload_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,status==='completed'?Math.ceil(checkpoint.duration):Math.floor(checkpoint.offset),Math.max(1,Math.ceil(checkpoint.duration)),JSON.stringify(payload),taskId);this.notify();};
  try{
   await mkdir(root,{recursive:true});abort.signal.throwIfAborted();
   if(!checkpoint.duration){const metadata=rawMedia(this.db,id)?.metadata??{};checkpoint.duration=Number(metadata.duration)||(await probeVideoMetadata(this.filePath(id))).duration||0;if(!Number.isFinite(checkpoint.duration)||checkpoint.duration<=0)throw new Error('无法读取视频时长，建议使用其他播放器打开');}
   // A user may have cleared caches while this task was paused.
   const retained:Part[]=[];for(const part of checkpoint.parts){if(!/^playback-[a-f0-9]{64}\.mp4$/u.test(part.name))break;try{if((await stat(path.join(root,part.name))).size<=0)break;retained.push(part);}catch{break;}}
   checkpoint.parts=retained;for(const part of retained)busy.add(part.name);checkpoint.offset=retained.reduce((total,part)=>total+part.seconds,0);save();
   while(checkpoint.offset<checkpoint.duration-.02){
    abort.signal.throwIfAborted();if(!valid())throw new Error('媒体已移除或更新');
    const seconds=Math.min(10,checkpoint.duration-checkpoint.offset),name=`playback-${createHash('sha256').update(`${keyFor(id,fingerprint)}:part:${checkpoint.parts.length}`).digest('hex')}.mp4`;
    const part=path.join(root,name),temp=`${part}.${randomUUID()}.tmp.mp4`;temporary.add(temp);busy.add(name);payload.phase=`生成兼容视频 · 已保留 ${checkpoint.parts.length} 个片段`;
    await runFfmpeg(['-y','-hide_banner','-loglevel','error','-threads','2','-ss',String(checkpoint.offset),'-i',this.filePath(id),'-t',String(seconds),'-map','0:v:0','-map','0:a?','-vf',"scale='min(1920,iw)':-2",'-c:v','libx264','-threads','2','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',temp],abort.signal);
    abort.signal.throwIfAborted();if(!valid())throw new Error('媒体已移除或更新');await rename(temp,part);temporary.delete(temp);registerMediaCache(this.db,id,part);await rememberCache(this.db,root,part);checkpoint.parts.push({name,seconds});checkpoint.offset+=seconds;save();
   }
   abort.signal.throwIfAborted();payload.phase='合并已生成片段';save();
   const list=path.join(root,`video-join-${randomUUID()}.tmp`),output=`${target}.${randomUUID()}.tmp.mp4`;temporary.add(list);temporary.add(output);busy.add(path.basename(target));
   await writeFile(list,checkpoint.parts.map(part=>`file '${part.name}'`).join('\n'),'utf8');
   await runFfmpeg(['-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',list,'-map','0:v:0','-map','0:a?','-c','copy','-movflags','+faststart',output],abort.signal);
   abort.signal.throwIfAborted();if(!valid())throw new Error('媒体已移除或更新');await rename(output,target);temporary.delete(output);registerMediaCache(this.db,id,target);await rememberCache(this.db,root,target);
   for(const part of checkpoint.parts){await unlink(path.join(root,part.name)).catch(()=>{});forgetCache(this.db,path.join(root,part.name));}checkpoint.parts=[];payload.phase='兼容视频已准备完成';save('completed');return {cachePath:target};
  }catch(error){
   if(!this.closed&&this.db.open&&!valid())this.db.prepare("UPDATE tasks SET status='cancelled',error_message='媒体已移除或更新',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(taskId);
   if(valid()){const row=this.db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId) as {status:string}|undefined;save(abort.signal.aborted?(row?.status==='cancelled'?'cancelled':'paused'):'failed');if(!abort.signal.aborted)this.db.prepare('UPDATE tasks SET error_message=? WHERE id=?').run(String(error),taskId);}
   if(abort.signal.aborted)throw new Error('视频准备已暂停，重新打开可从已完成片段继续');throw error;
  }finally{for(const file of temporary)await unlink(file).catch(()=>{});}
 }
}
