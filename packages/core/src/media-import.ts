import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream,constants} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {lstat,readdir,mkdir,stat,link,copyFile,unlink,utimes,rm,rename} from 'node:fs/promises';
import {addLibraryRoot,listLibraryRoots,type LuminaDatabase} from '@lumina/storage';
import {mediaKindFromPath,scanDirectory} from './index.js';
import {hashFile} from './file-operations.js';

type Entry={source:string;relative:string;size:number;mtime:number};
type ConflictPolicy='rename'|'skip'|'overwrite';
type ExistingFile={size:number;mtime:number;ino:number};
type Plan={entries:Entry[];directories:string[];expires:number;skipped:number;conflicts?:{token:string;directory:string;files:Record<string,ExistingFile>}};
type Payload={options:{directory:string;sources:string[];conflictPolicy?:ConflictPolicy};info:{snapshotVersion:number;scopeCount:number};stage:string;conflicts?:Record<string,ExistingFile>};
export const inside=(parent:string,child:string)=>{const rel=path.relative(parent,child);return !rel || rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
export class MediaImports {
 private plans=new Map<string,Plan>();private starting=new Set<string>();private active=new Map<string,{abort:AbortController;directory:string;paths:Set<string>;stage:string;phase:string;currentPath:string}>();private closed=false;
 constructor(private db:LuminaDatabase,private notify:()=>void,private sync:()=>void,private cacheRoot?:string){}
 setCacheRoot(root:string){this.cacheRoot=root;}
 isActive(id:string){return this.active.has(id);}
 isWriting(file:string){return [...this.active.values()].some(item=>inside(item.stage,file)||item.paths.has(file));}
 progress(id:string){const item=this.active.get(id);return item?{phase:item.phase,currentPath:item.currentPath}:{};}
 settings(){const row=this.db.prepare("SELECT value_json AS value FROM settings WHERE key='media-import'").get() as {value:string}|undefined;return {directory:'',skipPrompt:false,...(row?JSON.parse(row.value):{})} as {directory:string;skipPrompt:boolean};}
 async configure(directory:string,skipPrompt:boolean){if(directory.trim()){await this.validateDestination(directory);directory=path.resolve(directory.trim());}else if(skipPrompt)throw new Error('请先填写默认导入路径');this.db.prepare("INSERT INTO settings(key,value_json) VALUES('media-import',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").run(JSON.stringify({directory,skipPrompt}));this.notify();return this.settings();}
 private async validateDestination(directory:string){
  if(!path.isAbsolute(directory.trim()))throw new Error('请填写完整的导入目录路径');const resolved=path.resolve(directory.trim());if(process.env.LUMINA_IMPORT_INBOX && inside(process.env.LUMINA_IMPORT_INBOX,resolved))throw new Error('不能导入到剪贴板暂存目录');
  if(this.cacheRoot && inside(path.resolve(this.cacheRoot),resolved))throw new Error('不能导入到缓存目录');
  for(let current=resolved;;current=path.dirname(current)){try{const info=await lstat(current);if(info.isSymbolicLink() || !info.isDirectory())throw new Error('导入路径必须是实际文件夹，不能经过目录链接');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(path.dirname(current)===current)break;}
  if(listLibraryRoots(this.db).some(root=>!root.enabled&&inside(root.absolutePath,resolved)))throw new Error('目标目录所在图库已停用，请先启用或更换路径');
  return resolved;
 }
 async discard(token:string){const plan=this.plans.get(token);this.plans.delete(token);if(!plan||!process.env.LUMINA_IMPORT_INBOX)return {ok:true};for(const {source} of plan.entries){if(path.dirname(source)!==process.env.LUMINA_IMPORT_INBOX || !/^lumina-clipboard-[a-f0-9-]{36}\.png$/u.test(path.basename(source)))continue;if([...this.plans.values()].some(plan=>plan.entries.some(item=>item.source===source)))continue;if(this.db.prepare("SELECT 1 FROM tasks t,json_each(t.payload_json,'$.options.sources') s WHERE t.kind='import' AND t.status<>'completed' AND s.value=? LIMIT 1").get(source))continue;await unlink(source).catch(()=>{});}return {ok:true};}
 async preview(sources:string[]){
  const entries:Entry[]=[],directories:string[]=[],seen=new Set<string>();let skipped=0;
  const add=async(file:string,relative:string)=>{const info=await lstat(file);if(info.isSymbolicLink()){skipped++;return;}if(info.isDirectory()){if(/^(?:\.lumina-trash|\.lumina-(?:import|export)-)/u.test(path.basename(file))){skipped++;return;}for(const child of await readdir(file))await add(path.join(file,child),path.join(relative,child));}else if(info.isFile()){if(mediaKindFromPath(file)==='unknown'){skipped++;return;}const key=path.resolve(file).toLowerCase();if(seen.has(key))return;seen.add(key);entries.push({source:file,relative,size:info.size,mtime:info.mtimeMs});if(entries.length>100000)throw new Error('一次最多导入100000个媒体文件，请分批导入');if(entries.length%100===0)await new Promise(resolve=>setTimeout(resolve,0));}};
  for(const value of [...new Set(sources)]){if(!path.isAbsolute(value))throw new Error('来源文件路径无效');const source=path.resolve(value),info=await lstat(source);if(info.isDirectory())directories.push(source);await add(source,path.basename(source));}
  if(!entries.length)throw new Error('所选内容没有可导入的照片或视频');
  for(const [id,plan] of this.plans)if(plan.expires<Date.now())await this.discard(id);while(this.plans.size>=8)await this.discard(this.plans.keys().next().value!);
  const token=randomUUID();this.plans.set(token,{entries,directories,expires:Date.now()+600000,skipped});
  return {token,total:entries.length,sizeBytes:entries.reduce((sum,item)=>sum+item.size,0),skipped,sources: [...new Set(sources)],samples:entries.slice(0,5).map(item=>({name:path.basename(item.source),path:item.source}))};
 }
 async conflicts(token:string,directory:string){
  const plan=this.plans.get(token);if(!plan||plan.expires<Date.now())throw new Error('导入预览已过期，请重新选择文件');const target=await this.validateDestination(directory);
  if(plan.directories.some(source=>inside(source,target)) || plan.entries.some(item=>path.resolve(item.source).toLowerCase()===path.join(target,item.relative).toLowerCase()))throw new Error('导入目标不能与来源相同或位于来源文件夹内部');
  const files:Record<string,ExistingFile>={},samples:string[]=[],parents=new Set<string>();let count=0;
  for(const item of plan.entries){const output=path.join(target,item.relative),parent=path.dirname(output);if(!parents.has(parent)){await this.validateDestination(parent);parents.add(parent);}try{const current=await lstat(output);if(current.isSymbolicLink()||!current.isFile())throw new Error(`同名位置不是普通文件，无法覆盖：${output}`);files[output]={size:current.size,mtime:current.mtimeMs,ino:current.ino};count++;if(samples.length<5)samples.push(item.relative);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  const snapshot={token:randomUUID(),directory:target,files};plan.conflicts=snapshot;return {token:snapshot.token,count,samples};
 }
 async start(token:string,directory:string,remember:boolean,conflictPolicy:ConflictPolicy='rename',conflictToken?:string){
  const plan=this.plans.get(token);if(!plan || plan.expires<Date.now())throw new Error('导入预览已过期，请重新选择文件');
  const target=await this.validateDestination(directory);
  const confirmation=plan.conflicts;if(conflictPolicy==='overwrite'&&(!conflictToken||confirmation?.token!==conflictToken||confirmation.directory!==target))throw new Error('覆盖前请重新检查同名文件并确认');
  if(plan.directories.some(source=>inside(source,target)) || plan.entries.some(item=>path.resolve(item.source).toLowerCase()===path.join(target,item.relative).toLowerCase()))throw new Error('导入目标不能与来源相同或位于来源文件夹内部');
  if([...this.active.values()].some(item=>inside(item.directory,target)||inside(target,item.directory)) || [...this.starting].some(item=>inside(item,target)||inside(target,item)))throw new Error('该路径已有导入任务，请等待完成后再导入');
  if(this.plans.get(token)!==plan)throw new Error('该导入已经提交，请勿重复确认');
  this.starting.add(target);try{await mkdir(target,{recursive:true});await this.validateDestination(target);if(this.plans.get(token)!==plan)throw new Error('该导入已经提交，请勿重复确认');this.plans.delete(token);
  const id=randomUUID(),stage=path.join(target,'.lumina-import-'+id),payload:Payload={options:{directory:target,sources:plan.entries.map(item=>item.source),conflictPolicy},info:{snapshotVersion:1,scopeCount:plan.entries.length},stage,...(conflictPolicy==='overwrite'?{conflicts:confirmation!.files}:{})};
  this.db.transaction(()=>{this.db.prepare("INSERT INTO tasks(id,kind,status,total,payload_json) VALUES(?,'import','queued',?,?)").run(id,plan.entries.length,JSON.stringify(payload));const insert=this.db.prepare('INSERT INTO job_items(task_id,media_id,file_path,size_bytes,fingerprint,ordinal,output) VALUES(?,?,?,?,?,?,?)');plan.entries.forEach((item,index)=>insert.run(id,String(index),item.source,item.size,String(item.mtime),index+1,path.join(target,item.relative)));})();
  this.db.prepare("INSERT INTO settings(key,value_json) VALUES('media-import',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").run(JSON.stringify({directory:target,skipPrompt:remember}));this.notify();void this.run(id);return {id,total:plan.entries.length};}finally{this.starting.delete(target);}
 }
 control(id:string,action:string){const row=this.db.prepare("SELECT status FROM tasks WHERE id=? AND kind='import'").get(id) as {status:string}|undefined;if(!row)throw new Error('导入任务不存在');if(action==='pause'||action==='cancel'){if(['running','queued','paused'].includes(row.status)){this.db.prepare('UPDATE tasks SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(action==='pause'?'paused':'cancelled',id);this.active.get(id)?.abort.abort();this.notify();}return {ok:true};}if(this.active.has(id))throw new Error('正在结束当前文件，请稍后恢复');if(action==='retry')this.db.prepare("UPDATE job_items SET status='pending',error=NULL WHERE task_id=? AND status='failed'").run(id);this.db.prepare("UPDATE tasks SET status='queued',error_message=NULL WHERE id=?").run(id);void this.run(id);return {ok:true};}
 close(){this.closed=true;for(const [id,item] of this.active){this.db.prepare("UPDATE tasks SET status='paused' WHERE id=? AND status='running'").run(id);item.abort.abort();}}
 private async run(id:string){
  if(this.closed||this.active.has(id))return;const payload=JSON.parse((this.db.prepare('SELECT payload_json AS value FROM tasks WHERE id=?').get(id) as {value:string}).value) as Payload;
  const abort=new AbortController();this.active.set(id,{abort,directory:payload.options.directory,paths:new Set((this.db.prepare('SELECT output FROM job_items WHERE task_id=?').all(id) as {output:string}[]).map(item=>item.output)),stage:payload.stage,phase:'复制并校验文件',currentPath:''});this.db.prepare("UPDATE tasks SET status='running' WHERE id=?").run(id);this.notify();let lastNotify=0;this.db.prepare("UPDATE tasks SET processed=(SELECT COUNT(*) FROM job_items WHERE task_id=? AND status<>'pending') WHERE id=?").run(id,id);
  const running=()=>!this.closed&&!abort.signal.aborted&&Boolean(this.db.prepare("SELECT 1 FROM tasks WHERE id=? AND status='running'").get(id));
  try{
   await this.validateDestination(payload.options.directory);await this.validateDestination(payload.stage);await mkdir(payload.stage,{recursive:true});
   const rows=this.db.prepare("SELECT media_id AS id,file_path AS source,size_bytes AS size,fingerprint AS mtime,output FROM job_items WHERE task_id=? AND status='pending' ORDER BY ordinal").all(id) as {id:string;source:string;size:number;mtime:string;output:string}[];
   for(const row of rows){if(!running())break;this.active.get(id)!.currentPath=row.source;const temporary=path.join(payload.stage,row.id+'.part');try{
    const before=await lstat(row.source);if(!before.isFile()||before.isSymbolicLink()||before.size!==row.size||String(before.mtimeMs)!==row.mtime)throw new Error('来源文件已变化或不可读取，请重新选择导入');
    await this.validateDestination(path.dirname(row.output));await mkdir(path.dirname(row.output),{recursive:true});
    let skipExisting=false,output=row.output;if(payload.options.conflictPolicy==='skip')try{const existing=await lstat(output);if(existing.isSymbolicLink()||!existing.isFile())throw new Error('同名位置不是普通文件');skipExisting=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(!skipExisting){
    // Exclusive publication from a staging file prevents readers seeing a
    // partial media file. Interrupted tasks verify any published result on resume.
    await pipeline(createReadStream(row.source),createWriteStream(temporary),{signal:abort.signal});
    const hash=await hashFile(temporary,abort.signal);if(hash!==await hashFile(row.source,abort.signal))throw new Error('来源文件在复制期间发生变化');await utimes(temporary,before.atime,before.mtime);
    const parsed=path.parse(row.output);
    for(let suffix=0;;suffix++){
     if(!running())throw new Error('任务已停止');
     try{if(suffix)output=path.join(parsed.dir,`${parsed.name} (${suffix})${parsed.ext}`);this.active.get(id)!.paths.add(output);this.db.prepare('UPDATE job_items SET output=? WHERE task_id=? AND media_id=?').run(output,id,row.id);try{await link(temporary,output);}catch(error){if(!['ENOTSUP','EPERM','EXDEV'].includes((error as NodeJS.ErrnoException).code??''))throw error;await copyFile(temporary,output,constants.COPYFILE_EXCL);}break;}
     catch(error){const code=(error as NodeJS.ErrnoException).code;if(code==='EEXIST'){
      const existing=await lstat(output);if(existing.isSymbolicLink()||!existing.isFile())throw new Error('同名位置不是普通文件，无法覆盖');
      if(payload.options.conflictPolicy==='skip'){skipExisting=true;break;}
      if(await hashFile(output,abort.signal)===hash)break;
      if(payload.options.conflictPolicy==='overwrite'){const confirmed=payload.conflicts?.[output],current=await lstat(output);if(!confirmed||current.isSymbolicLink()||!current.isFile()||confirmed.size!==current.size||confirmed.mtime!==current.mtimeMs||confirmed.ino!==current.ino)throw new Error('同名文件在确认后发生变化，已保留原文件，请重新导入');if(!running())throw new Error('任务已停止');await rename(temporary,output);break;}
      if(suffix>=9999)throw new Error('同名文件过多');continue;
     }throw error;}
    }
    }
    this.db.prepare('UPDATE job_items SET status=?,error=NULL,output=? WHERE task_id=? AND media_id=?').run(skipExisting?'skipped':'completed',output,id,row.id);
   }catch(error){if(!running())break;this.db.prepare("UPDATE job_items SET status='failed',error=? WHERE task_id=? AND media_id=?").run(message(error),id,row.id);}finally{await unlink(temporary).catch(()=>{});}
    this.db.prepare('UPDATE tasks SET processed=processed+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);if(Date.now()-lastNotify>250){lastNotify=Date.now();this.notify();}await new Promise(resolve=>setTimeout(resolve,0));
   }
   // Index only the imported files, even when the destination already contains
   // a large library. Completed copies are retained on cancellation and retry.
   const outputs=(this.db.prepare("SELECT output FROM job_items WHERE task_id=? AND status='completed'").all(id) as {output:string}[]).map(item=>item.output);
   if(outputs.length && !this.closed){this.active.get(id)!.phase='建立导入媒体索引';this.active.get(id)!.currentPath=payload.options.directory;this.notify();let root=listLibraryRoots(this.db).filter(root=>root.enabled&&inside(root.absolutePath,payload.options.directory)).sort((a,b)=>b.absolutePath.length-a.absolutePath.length)[0];if(!root)root=addLibraryRoot(this.db,payload.options.directory);const scan=await scanDirectory(this.db,root.absolutePath,{rootId:root.id,changedPaths:outputs,notify:this.notify});if(scan.task.status==='failed')throw new Error('副本已保留，部分文件索引失败，请查看扫描任务');this.sync();}
   if(running()){const failed=(this.db.prepare("SELECT COUNT(*) AS n FROM job_items WHERE task_id=? AND status='failed'").get(id) as {n:number}).n;this.db.prepare("UPDATE tasks SET status=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(failed?'failed':'completed',failed?`${failed} 项未能导入，可查看明细并重试`:null,id);}
  if(!this.closed && (this.db.prepare('SELECT status FROM tasks WHERE id=?').get(id) as {status:string}).status==='completed' && process.env.LUMINA_IMPORT_INBOX)for(const file of payload.options.sources)if(path.dirname(file)===process.env.LUMINA_IMPORT_INBOX && /^lumina-clipboard-[a-f0-9-]{36}\.png$/u.test(path.basename(file)))await unlink(file).catch(()=>{});
  }catch(error){if(running())this.db.prepare("UPDATE tasks SET status='failed',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(message(error),id);}finally{await rm(payload.stage,{recursive:true,force:true}).catch(()=>{});this.active.delete(id);if(!this.closed)this.notify();}
 }
}
