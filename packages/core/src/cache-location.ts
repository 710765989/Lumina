import {moveInventory} from './cache-inventory.js';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {lstat,readdir,mkdir,readFile,writeFile,copyFile,unlink,statfs,rmdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import type {LuminaDatabase} from '@lumina/storage';
import {hashFile} from './file-operations.js';
import {inside} from './media-import.js';
const marker='.lumina-cache.json';
const generated=(name:string)=>/^(?:[\w-]+-[a-f0-9]{16}\.jpg|preview-[a-f0-9]{64}\.png|playback-[a-f0-9]{64}\.mp4)$/u.test(name);
const stamp=(info:{size:number;mtimeMs:number;ino:number})=>`${info.size}:${info.mtimeMs}:${info.ino}`;
type Entry={name:string;source:string;relative:string;bytes:number;stamp:string};
type Plan={target:string;entries:Entry[];skipped:number;created:number};
type Payload={source:string;target:string;phase:'copy'|'cleanup'|'done';retained?:number;cleanupProcessed?:number;cleanupTotal?:number;options:{directory:string;sourceDirectory?:string};info:{snapshotVersion:1}};
export function configuredCacheRoot(db:LuminaDatabase,legacy:string|undefined,preferred:string|undefined){
 const saved=db.prepare("SELECT value_json AS value FROM settings WHERE key='media-cache-directory'").get() as {value:string}|undefined;
 if(saved){const value=JSON.parse(saved.value);if(typeof value==='string'&&path.isAbsolute(value))return value;}
 const selected=legacy&&existsSync(legacy)?legacy:preferred??legacy;
 if(selected)db.prepare("INSERT OR REPLACE INTO settings(key,value_json) VALUES('media-cache-directory',?)").run(JSON.stringify(selected));
 return selected;
}
export class CacheLocation {
 private initializing=false;
 private plans=new Map<string,Plan>();private current?:{id:string;abort:AbortController;committed:boolean;phase:string;began?:number;copiedBytes?:number;totalBytes?:number};private gate?:Promise<void>;private unlock?:()=>void;private closed=false;
 private recovering=new Set<string>();private cleaning=new Map<string,{processed:number;total:number;currentPath:string}>();
 private owner:string;
 constructor(private db:LuminaDatabase,private root:string|undefined,private preferred:string|undefined,private notify:()=>void,private freeze:(signal:AbortSignal)=>Promise<void>,private switchRoot:(root:string)=>void,private thaw:()=>void){
  const row=db.prepare("SELECT value_json AS value FROM settings WHERE key='cache-owner'").get() as {value:string}|undefined;this.owner=row?JSON.parse(row.value):randomUUID();if(!row)db.prepare("INSERT INTO settings(key,value_json) VALUES('cache-owner',?)").run(JSON.stringify(this.owner));
  db.prepare("UPDATE tasks SET status='failed',error_message='上次迁移中断，保留原缓存位置；请重新选择目标继续迁移' WHERE kind='cache-move' AND status='paused' AND json_extract(payload_json,'$.phase')='copy'").run();
 }
 private confirmInitial(){this.db.prepare("INSERT OR REPLACE INTO settings(key,value_json) VALUES('cache-setup-confirmed','true')").run();}
 private needsInitialSetup(){
  if(this.db.prepare("SELECT 1 FROM settings WHERE key='cache-setup-confirmed'").get())return false;
  // Legacy libraries keep their actual configured location, including when
  // their roots are disabled or have subsequently been removed.
  if(this.db.prepare('SELECT 1 FROM library_roots UNION ALL SELECT 1 FROM media UNION ALL SELECT 1 FROM tasks UNION ALL SELECT 1 FROM cache_inventory LIMIT 1').get()){this.confirmInitial();return false;}
  return true;
 }
 settings(){const file=(this.db.pragma('database_list') as {file:string}[])[0]?.file??'';return {directory:this.root??'',defaultDirectory:this.preferred??this.root??'',databasePath:file,setupRequired:this.needsInitialSetup(),moving:this.initializing||Boolean(this.current)||this.recovering.size>0,taskId:this.current?.id??[...this.recovering][0]??null};}
 async initialPreview(target:string,libraryPath:string){
  if(!this.needsInitialSetup())throw new Error('缓存目录已经确认，后续请在缓存设置中更改');
  if(!path.isAbsolute(target.trim()))throw new Error('请选择完整的缓存目录路径');target=path.resolve(target.trim());
  if(!path.isAbsolute(libraryPath))throw new Error('请选择完整的图库目录路径');libraryPath=path.resolve(libraryPath);
  if(inside(target,libraryPath)||inside(libraryPath,target))throw new Error('缓存目录不能放在图库目录内或包含图库目录');
  const checked=await this.validate(target,true);
  await mkdir(checked.target,{recursive:true});await this.validate(checked.target,true);
  const probe=path.join(checked.target,`.lumina-write-check-${randomUUID()}`);
  try{await writeFile(probe,'',{flag:'wx'});}catch{throw new Error('缓存目录不可写，请选择其他位置');}finally{await unlink(probe).catch(()=>{});}
  const space=await statfs(checked.target),freeBytes=space.bavail*space.bsize;
  if(freeBytes<=0)throw new Error('缓存磁盘空间不足，请选择其他位置');
  return {directory:checked.target,freeBytes};
 }
 async configureInitial(target:string,libraryPath:string){
  if(this.initializing||this.current||this.recovering.size)throw new Error('缓存位置正在处理，请稍后再试');
  this.initializing=true;let frozen=false;
  try{
   const checked=await this.initialPreview(target,libraryPath);await this.freeze(new AbortController().signal);frozen=true;
   if(!this.needsInitialSetup())throw new Error('图库状态已经变化，请重新打开目录设置');
   await this.validate(checked.directory,true);
   await writeFile(path.join(checked.directory,marker),JSON.stringify({kind:'lumina-media-cache',owner:this.owner}),{flag:'wx'}).catch(async error=>{if(error.code!=='EEXIST')throw error;const value=JSON.parse(await readFile(path.join(checked.directory,marker),'utf8'));if(value.owner!==this.owner)throw new Error('目标缓存属于其他图库');});
   this.db.transaction(()=>{this.db.prepare("INSERT OR REPLACE INTO settings(key,value_json) VALUES('media-cache-directory',?)").run(JSON.stringify(checked.directory));this.confirmInitial();})();
   this.root=checked.directory;this.switchRoot(checked.directory);this.notify();return {...checked,confirmed:true};
  }finally{if(frozen)this.thaw();this.initializing=false;}
 }
 async wait(){if(this.gate)await this.gate;}
 isActive(id:string){return this.current?.id===id||this.recovering.has(id);}
 progress(id:string){const cleanup=this.cleaning.get(id);if(cleanup)return {phase:this.recovering.has(id)?'清理上次迁移残留':'清理已迁移的旧缓存',committed:true,phaseProcessed:cleanup.processed,phaseTotal:cleanup.total,currentPath:cleanup.currentPath};if(this.recovering.has(id))return {phase:'清理上次迁移残留',committed:true};if(this.current?.id!==id)return {};const task=this.current,elapsed=task.began?(Date.now()-task.began)/1000:0,speed=elapsed>=1?(task.copiedBytes??0)/elapsed:0;return {phase:task.phase,committed:task.committed,speedBytesPerSecond:speed,remainingSeconds:speed>0?Math.ceil(((task.totalBytes??0)-(task.copiedBytes??0))/speed):null};}
 private async validate(target:string,initial=false){
  if(!path.isAbsolute(target.trim()))throw new Error('请填写完整缓存目录路径');target=path.resolve(target.trim());
  if(!initial && this.root && (inside(this.root,target)||inside(target,this.root)))throw new Error('新旧缓存目录不能相同或互相包含');
  const dbFile=(this.db.pragma('database_list') as {file:string}[])[0]?.file;
  if(dbFile && inside(target,dbFile))throw new Error('缓存目录不能包含数据库或用户数据目录');
  for(const row of this.db.prepare('SELECT absolute_path AS path FROM library_roots').all() as {path:string}[])if(inside(row.path,target)||inside(target,row.path))throw new Error('缓存目录不能放在图库目录内或包含图库目录');
  let ancestor=target;
  for(let current=target;;current=path.dirname(current)){try{const info=await lstat(current);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('缓存路径必须是实际文件夹，不能经过目录链接');ancestor=current;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(path.dirname(current)===current)break;}
  try{const names=await readdir(target);if(names.length){const owner=await readFile(path.join(target,marker),'utf8').then(JSON.parse).catch(()=>null);if(owner?.owner!==this.owner && (initial||path.resolve(target)!==path.resolve(this.preferred??'')))throw new Error('请选择空目录，或此前属于此图库的缓存目录');}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return {target,ancestor};
 }
 private protectedFile(file:string){return Boolean(this.db.prepare('SELECT 1 FROM media WHERE absolute_path=? COLLATE NOCASE UNION ALL SELECT 1 FROM trash_entries WHERE stored_path=? COLLATE NOCASE LIMIT 1').get(file,file));}
 async preview(target:string){
  if(this.current||this.recovering.size)throw new Error('已有缓存迁移正在执行');const checked=await this.validate(target),entries:Entry[]=[];let skipped=0;
  const walk=async(directory:string)=>{for(const item of await readdir(directory,{withFileTypes:true})){const source=path.join(directory,item.name);if(item.isSymbolicLink()){skipped++;continue;}if(item.isDirectory())await walk(source);else if(item.isFile()&&item.name!==marker){if(!generated(item.name)||this.protectedFile(source)){skipped++;continue;}const info=await lstat(source);if(info.isSymbolicLink())throw new Error('缓存文件路径已变化，请重试');entries.push({name:item.name,source,relative:path.relative(this.root!,source),bytes:info.size,stamp:stamp(info)});}if(entries.length%100===0)await new Promise(resolve=>setTimeout(resolve,0));}};
  if(this.root)try{const info=await lstat(this.root);if(info.isSymbolicLink())throw new Error('当前缓存目录是链接，不能自动移动');await walk(this.root);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const bytes=entries.reduce((sum,row)=>sum+row.bytes,0),space=await statfs(checked.ancestor);if(space.bavail*space.bsize<bytes)throw new Error('目标磁盘空间不足，请更换缓存目录');
  const token=randomUUID();for(const [key,value] of this.plans)if(Date.now()-value.created>600000)this.plans.delete(key);this.plans.set(token,{target:checked.target,entries,skipped,created:Date.now()});return {token,source:this.root??'',target:checked.target,count:entries.length,bytes,skipped};
 }
 start(token:string){
  if(this.current||this.recovering.size)throw new Error('已有缓存迁移正在执行');const plan=this.plans.get(token);if(!plan||Date.now()-plan.created>600000)throw new Error('迁移预览已过期，请重新确认');this.plans.delete(token);
  const id=randomUUID(),payload:Payload={source:this.root??'',target:plan.target,phase:'copy',options:{directory:plan.target,sourceDirectory:this.root??''},info:{snapshotVersion:1}};
  this.db.transaction(()=>{this.db.prepare("INSERT INTO tasks(id,kind,status,total,payload_json) VALUES(?,'cache-move','running',?,?)").run(id,plan.entries.length,JSON.stringify(payload));const insert=this.db.prepare('INSERT INTO job_items(task_id,media_id,file_path,size_bytes,fingerprint,ordinal,output) VALUES(?,?,?,?,?,?,?)');plan.entries.forEach((row,index)=>insert.run(id,row.relative,row.source,row.bytes,row.stamp,index,path.join(plan.target,row.relative)));})();
  this.current={id,abort:new AbortController(),committed:false,phase:'等待正在使用的缓存任务结束'};this.gate=new Promise(resolve=>{this.unlock=resolve;});this.notify();void this.run(id,plan,payload);return {id};
 }
 control(id:string,action:string){if(!this.current||this.current.id!==id)throw new Error('迁移已结束；需要重试时请重新选择缓存位置');if(action!=='cancel')throw new Error('缓存迁移只支持在切换前取消');if(this.current.committed)throw new Error('已切换到新缓存目录，正在完成旧缓存清理');this.current.abort.abort();return {ok:true};}
 private async run(id:string,plan:Plan,payload:Payload){const operation=this.current!,signal=operation.abort.signal;let frozen=false;
  try{
   await this.freeze(signal);frozen=true;signal.throwIfAborted();await this.validate(plan.target);if(payload.source)await writeFile(path.join(payload.source,marker),JSON.stringify({kind:'lumina-media-cache',owner:this.owner}),{flag:'wx'}).catch(error=>{if(!['EEXIST','ENOENT','EACCES','EPERM'].includes(error.code))throw error;});await mkdir(plan.target,{recursive:true});await this.validate(plan.target);
   await writeFile(path.join(plan.target,marker),JSON.stringify({kind:'lumina-media-cache',owner:this.owner}),{flag:'wx'}).catch(async error=>{if(error.code!=='EEXIST')throw error;const value=JSON.parse(await readFile(path.join(plan.target,marker),'utf8'));if(value.owner!==this.owner)throw new Error('目标缓存属于其他图库');});
   operation.phase='复制并校验媒体缓存';operation.began=Date.now();operation.copiedBytes=0;operation.totalBytes=plan.entries.reduce((sum,row)=>sum+row.bytes,0);
   let cursor=0,failure:unknown,lastFlush=Date.now();
   const completed:{relative:string;fingerprint:string}[]=[];
   const save=this.db.prepare("UPDATE job_items SET status='completed',fingerprint=? WHERE task_id=? AND media_id=?");
   const flush=()=>{if(!completed.length||!this.db.open)return;const rows=completed.splice(0);this.db.transaction(()=>{for(const row of rows)save.run(row.fingerprint,id,row.relative);this.db.prepare('UPDATE tasks SET processed=processed+?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(rows.length,id);})();lastFlush=Date.now();};
   const worker=async()=>{while(!failure&&!signal.aborted&&cursor<plan.entries.length){const entry=plan.entries[cursor++]!;try{
    signal.throwIfAborted();const before=await lstat(entry.source);if(stamp(before)!==entry.stamp||this.protectedFile(entry.source))throw new Error('缓存在迁移前发生变化，请重新迁移');const output=path.join(plan.target,entry.relative);await mkdir(path.dirname(output),{recursive:true});for(let current=path.dirname(output);inside(plan.target,current);current=path.dirname(current)){if((await lstat(current)).isSymbolicLink())throw new Error('目标目录出现链接，请重新选择目录');if(current===plan.target)break;}const hash=await hashFile(entry.source,signal);
    try{await copyFile(entry.source,output,constants.COPYFILE_EXCL);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    const targetInfo=await lstat(output);if(targetInfo.isSymbolicLink()||!targetInfo.isFile())throw new Error('目标缓存不是普通文件，请重新选择目录');
    if(hash!==await hashFile(output,signal)||stamp(await lstat(entry.source))!==entry.stamp)throw new Error('缓存内容校验未通过，继续使用原目录');
    completed.push({relative:entry.relative,fingerprint:JSON.stringify({source:entry.stamp,target:stamp(targetInfo),hash})});operation.copiedBytes!+=entry.bytes;
    if(completed.length>=32||Date.now()-lastFlush>=200)flush();
   }catch(error){failure??=error;}}};
   // Bound I/O concurrency; job progress is polled, not broadcast per file.
   await Promise.all(Array.from({length:Math.min(4,plan.entries.length)},worker));flush();if(failure)throw failure;
   signal.throwIfAborted();payload.phase='cleanup';payload.cleanupProcessed=0;payload.cleanupTotal=plan.entries.length;this.db.transaction(()=>{
    this.db.prepare("INSERT OR REPLACE INTO settings(key,value_json) VALUES('media-cache-directory',?)").run(JSON.stringify(plan.target));
    for(const row of this.db.prepare('SELECT file_path AS source,output,fingerprint FROM job_items WHERE task_id=?').all(id) as {source:string;output:string;fingerprint:string}[]){const info=JSON.parse(row.fingerprint);this.db.prepare("UPDATE job_items SET file_path=?,fingerprint=? WHERE file_path=? AND fingerprint=? AND task_id IN(SELECT id FROM tasks WHERE kind='cache-cleanup')").run(row.output,info.target,row.source,info.source);this.db.prepare("UPDATE job_items SET file_path=?,fingerprint=json_set(fingerprint,'$.stamp',?) WHERE file_path=? AND json_valid(fingerprint) AND json_extract(fingerprint,'$.stamp')=? AND task_id IN(SELECT id FROM tasks WHERE kind='cache-cleanup')").run(row.output,info.target,row.source,info.source);}
    moveInventory(this.db,id,payload.source,plan.target);
    this.db.prepare('UPDATE tasks SET payload_json=? WHERE id=?').run(JSON.stringify(payload),id);
   })();operation.committed=true;this.root=plan.target;this.switchRoot(plan.target);this.thaw();frozen=false;this.unlock?.();this.gate=undefined;operation.phase='清理已迁移的旧缓存';
   await this.cleanup(id,payload);this.db.prepare("UPDATE tasks SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  }catch(error){if(!this.closed&&this.db.open)this.db.prepare("UPDATE tasks SET status=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(signal.aborted?'cancelled':'failed',signal.aborted?'已取消，继续使用原缓存目录':(error as Error).message,id);}
  finally{if(frozen)this.thaw();this.unlock?.();this.unlock=undefined;this.gate=undefined;this.current=undefined;if(!this.closed)this.notify();}
 }
 private async cleanup(id:string,payload:Payload){let retained=0;
  const rows=this.db.prepare("SELECT file_path AS source,fingerprint FROM job_items WHERE task_id=? AND status='completed'").all(id) as {source:string;fingerprint:string}[];let cursor=0,lastFlush=Date.now();const progress={processed:0,total:rows.length,currentPath:''};this.cleaning.set(id,progress);
  const flush=()=>{if(this.closed||!this.db.open)return;payload.cleanupProcessed=progress.processed;payload.cleanupTotal=progress.total;this.db.prepare('UPDATE tasks SET payload_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(JSON.stringify(payload),id);lastFlush=Date.now();};flush();
  const worker=async()=>{while(!this.closed&&cursor<rows.length){const row=rows[cursor++]!,info=JSON.parse(row.fingerprint);progress.currentPath=row.source;try{const actual=await lstat(row.source).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(this.closed||!this.db.open)return;if(!actual)continue;if(actual.isSymbolicLink()||stamp(actual)!==info.source||this.protectedFile(row.source)||await hashFile(row.source)!==info.hash){retained++;continue;}if(this.closed||!this.db.open)return;if(this.protectedFile(row.source)){retained++;continue;}await unlink(row.source);}catch{retained++;}finally{progress.processed++;if(progress.processed%32===0||Date.now()-lastFlush>=200)flush();}}};
  try{await Promise.all(Array.from({length:Math.min(2,rows.length)},worker));flush();}finally{this.cleaning.delete(id);}
  if(this.closed||!this.db.open)return;payload.phase=retained?'cleanup':'done';payload.retained=retained;this.db.prepare('UPDATE tasks SET payload_json=?,error_message=? WHERE id=?').run(JSON.stringify(payload),retained?`${retained} 个旧缓存正在使用或已变化，暂时保留；下次启动会再次尝试清理`:null,id);
  if(payload.source)await rmdir(payload.source).catch(()=>{});
 }
 recover(){for(const row of this.db.prepare("SELECT id,payload_json AS payload FROM tasks WHERE kind='cache-move' AND json_extract(payload_json,'$.phase')='cleanup'").all() as {id:string;payload:string}[]){const payload=JSON.parse(row.payload) as Payload;if(payload.target===this.root){this.recovering.add(row.id);void this.cleanup(row.id,payload).then(()=>{if(!this.closed&&this.db.open)this.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(row.id);}).catch(()=>{}).finally(()=>{this.recovering.delete(row.id);if(!this.closed&&this.db.open)this.notify();});}}}
 close(){this.closed=true;this.current?.abort.abort();}
}
