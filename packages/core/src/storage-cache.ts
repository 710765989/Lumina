import {videoCheckpointNames} from './compatibility-video.js';
import {inventoryReady,inventoryEntries,inventoryCheckpoint,saveInventory,forgetCache} from './cache-inventory.js';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,readdir,realpath,unlink} from 'node:fs/promises';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import type {LuminaDatabase} from '@lumina/storage';

type Scope={scope:'all'|'format'|'year'|'unused';value?:string};
type Owner={id:string;format:string;year:string;bytes:number;fingerprint:string;missing:number;stored:number};
type File={name:string;file:string;bytes:number;stamp:string;owner?:Owner;generated:boolean;unused?:boolean};
type Group={count:number;bytes:number;cacheBytes:number;thumbnailBytes:number;previewBytes:number;playbackBytes:number};
const blank=():Group=>({count:0,bytes:0,cacheBytes:0,thumbnailBytes:0,previewBytes:0,playbackBytes:0});
const generated=(name:string)=>/^(?:[\w-]+-[a-f0-9]{16}\.jpg|preview-[a-f0-9]{64}\.png|playback-[a-f0-9]{64}\.mp4)$/u.test(name);
const cacheNames=(row:{id:string;fingerprint:string})=>[`${row.id}-${createHash('sha256').update(`${row.id}\0${row.fingerprint}\0${640}x${640}\0${82}`).digest('hex').slice(0,16)}.jpg`,...['full','screen'].map(full=>`preview-${createHash('sha256').update(`${row.id}:${row.fingerprint}:preview-v1:${full}`).digest('hex')}.png`),...['h264-v1','hover-v1'].map(version=>`playback-${createHash('sha256').update(`${row.id}:${row.fingerprint}:${version}`).digest('hex')}.mp4`)];
export function cacheInventoryChanged(db:LuminaDatabase){db.prepare("INSERT OR REPLACE INTO settings(key,value_json) VALUES('cache-inventory-revision',?)").run(JSON.stringify(randomUUID()));}
const fingerprint=(info:{size:number;mtimeMs:number;ino:number})=>`${info.size}:${info.mtimeMs}:${info.ino}`;
export class StorageCacheManager{
 private plans=new Map<string,{files:File[];scope:Scope;created:number}>();
 private starts=new Map<string,{id:string;kind:'cache-cleanup'}>();
 private active=new Map<string,Promise<void>>();private closed=false;private snapshotRequest?:Promise<{files:File[];owners:Owner[]}>;
 constructor(private db:LuminaDatabase,private root?:string,private notify:()=>void=()=>{},private busy:(file:File)=>boolean=()=>false){
  db.prepare("UPDATE tasks SET status='paused' WHERE kind='cache-cleanup' AND status IN('running','queued')").run();
 }
 setRoot(root:string){this.root=root;this.plans.clear();this.starts.clear();this.snapshotRequest=undefined;}
 hasActive(){return this.active.size>0;}
 close(){this.closed=true;}
 isActive(id:string){return this.active.has(id);}
 private snapshot(refresh=false){
  if(this.snapshotRequest)return this.snapshotRequest;
  const request=this.readSnapshot(refresh);this.snapshotRequest=request;
  void request.then(()=>{this.snapshotRequest=undefined;},()=>{this.snapshotRequest=undefined;});return request;
 }
 private async readSnapshot(refresh=false){
  const checkpoint=inventoryCheckpoint(this.db);
  const owners=(this.db.prepare("SELECT m.id,m.absolute_path AS path,m.size_bytes AS bytes,m.fingerprint,m.captured_at_ms AS captured,m.modified_at_ms AS modified,COALESCE(d.missing,0) AS missing,EXISTS(SELECT 1 FROM trash_entries t WHERE t.media_id=m.id AND t.state='stored') AS stored FROM media m LEFT JOIN media_details d ON d.media_id=m.id").all() as {id:string;path:string;bytes:number;fingerprint:string;captured:number|null;modified:number;missing:number;stored:number}[]).map(row=>({...row,format:path.extname(row.path).slice(1).toLowerCase()||'无后缀',year:String(new Date(row.captured??row.modified).getFullYear())}));
  const byId=new Map(owners.map(row=>[row.id,row])),names=new Map<string,Owner>(),needed=new Set<string>();
  const normalize=(file:string)=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);const protectedPaths=new Set([...owners.map(row=>normalize(row.path)),...(this.db.prepare("SELECT stored_path AS path FROM trash_entries WHERE stored_path IS NOT NULL").all() as {path:string}[]).map(row=>normalize(row.path))]);
  for(const row of owners){
   for(const name of cacheNames(row)){names.set(name,row);if(!row.missing||row.stored)needed.add(name);}
  }
  for(const row of this.db.prepare("SELECT key,value_json AS value FROM settings WHERE key LIKE 'media-cache:%'").all() as {key:string;value:string}[]){const owner=byId.get(row.key.slice('media-cache:'.length));if(!owner)continue;try{for(const name of JSON.parse(row.value))if(typeof name==='string'&&generated(name))names.set(name,owner);}catch{/* An old unrecognized registry remains unassigned. */}}
  for(const name of videoCheckpointNames(this.db))needed.add(name);
  const files:File[]=[];if(!this.root)return {files,owners};
  const classify=(entry:{name:string;file:string;bytes:number;stamp:string})=>{const thumb=/^(.+)-[a-f0-9]{16}\.jpg$/u.exec(entry.name),owner=names.get(entry.name)??(thumb?byId.get(thumb[1]!):undefined);return {...entry,owner,generated:generated(entry.name)&&!protectedPaths.has(normalize(entry.file)),unused:generated(entry.name)&&!needed.has(entry.name)&&!protectedPaths.has(normalize(entry.file))};};
  if(!refresh&&inventoryReady(this.db,this.root))return {files:inventoryEntries(this.db,this.root).map(classify),owners};
  const root=await realpath(this.root).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!root)return {files,owners};
  const walk=async(directory:string)=>{
   const entries=await readdir(directory,{withFileTypes:true});
   for(let start=0;start<entries.length;start+=24)await Promise.all(entries.slice(start,start+24).map(async entry=>{
    if(entry.isSymbolicLink()||entry.name==='.lumina-cache.json')return;const file=path.join(directory,entry.name);
    if(entry.isDirectory()){const resolved=await realpath(file);const relative=path.relative(root,resolved);if(!relative.startsWith('..')&&!path.isAbsolute(relative))await walk(file);return;}
    if(!entry.isFile())return;const info=await lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!info?.isFile()||info.isSymbolicLink())return;
    const thumb=/^(.+)-[a-f0-9]{16}\.jpg$/u.exec(entry.name),owner=names.get(entry.name)??(thumb?byId.get(thumb[1]!):undefined);
    files.push({name:entry.name,file,bytes:info.size,stamp:fingerprint(info),owner,generated:generated(entry.name)&&!protectedPaths.has(normalize(file)),unused:generated(entry.name)&&!needed.has(entry.name)&&!protectedPaths.has(normalize(file))});
   }));
  };await walk(root);saveInventory(this.db,this.root,files,checkpoint);return {files:inventoryEntries(this.db,this.root).map(classify),owners};
 }
 revision(){return (this.db.prepare("SELECT value_json AS value FROM settings WHERE key='cache-inventory-revision'").get() as {value:string}|undefined)?.value??null;}
 private neededNow(){const needed=videoCheckpointNames(this.db);for(const row of this.db.prepare("SELECT m.id,m.fingerprint FROM media m LEFT JOIN media_details d ON d.media_id=m.id WHERE COALESCE(d.missing,0)=0 OR EXISTS(SELECT 1 FROM trash_entries t WHERE t.media_id=m.id AND t.state='stored')").all() as {id:string;fingerprint:string}[])for(const name of cacheNames(row))needed.add(name);return needed;}
 async report(refresh=false){
  const scanRevision=this.revision();
  const {files,owners}=await this.snapshot(refresh),formats=new Map<string,Group>(),years=new Map<string,Group>();
  for(const row of owners)for(const [map,key] of [[formats,row.format],[years,row.year]] as const){const group=map.get(key)??blank();group.count++;group.bytes+=row.bytes;map.set(key,group);}
  const totals=blank();let unassignedCacheBytes=0,otherCacheBytes=0,clearableBytes=0,clearableCount=0,unusedCacheBytes=0,unusedCacheCount=0;
  for(const file of files){
   totals.cacheBytes+=file.bytes;const kind=file.name.startsWith('preview-')?'previewBytes':file.name.startsWith('playback-')?'playbackBytes':/\.jpg$/u.test(file.name)?'thumbnailBytes':null;
   if(kind)totals[kind]+=file.bytes;else otherCacheBytes+=file.bytes;
   if(file.generated){clearableBytes+=file.bytes;clearableCount++;}if(file.unused){unusedCacheBytes+=file.bytes;unusedCacheCount++;}
   if(!file.owner){unassignedCacheBytes+=file.bytes;continue;}
   for(const [map,key] of [[formats,file.owner.format],[years,file.owner.year]] as const){const group=map.get(key)!;group.cacheBytes+=file.bytes;if(kind)group[kind]+=file.bytes;}
  }
  const database=(this.db.pragma('database_list') as {file:string}[])[0]?.file;
  const indexBytes=database?(await Promise.all(['','-wal','-shm'].map(suffix=>lstat(database+suffix).then(info=>info.size,error=>{if(error.code==='ENOENT')return 0;throw error;})))).reduce((a,b)=>a+b,0):0;
  return {...totals,indexBytes,originalBytes:owners.reduce((sum,row)=>sum+row.bytes,0),unassignedCacheBytes,otherCacheBytes,clearableBytes,clearableCount,unusedCacheBytes,unusedCacheCount,scanRevision,
   formats:[...formats].sort(([a],[b])=>a.localeCompare(b)).map(([format,row])=>({format,...row})),years:[...years].sort(([a],[b])=>b.localeCompare(a)).map(([year,row])=>({year,...row})),
   trend:this.db.prepare("SELECT date(created_at) AS day,COUNT(*) AS count FROM media WHERE created_at>=datetime('now','-30 days') GROUP BY day ORDER BY day").all()};
 }
 async preview(scope:Scope){
  const {files}=await this.snapshot(),selected=files.filter(file=>file.generated&&(scope.scope==='all'||scope.scope==='unused'&&file.unused||scope.scope==='format'&&file.owner?.format===scope.value||scope.scope==='year'&&file.owner?.year===scope.value));
  const token=randomUUID(),now=Date.now();for(const [key,plan] of this.plans)if(now-plan.created>600000)this.plans.delete(key);if(this.plans.size>=20)this.plans.delete(this.plans.keys().next().value!);
  this.plans.set(token,{files:selected,scope,created:now});return {token,count:selected.length,bytes:selected.reduce((sum,row)=>sum+row.bytes,0)};
 }
 start(token:string){
  this.closed=false;const started=this.starts.get(token);if(started)return started;
  if([...this.active.keys()].length)throw new Error('已有缓存清理正在执行，请等待完成');
  const plan=this.plans.get(token);if(!plan||Date.now()-plan.created>600000)throw new Error('清理预览已过期，请重新计算');
  const id=randomUUID(),label=plan.scope.scope==='all'?'全部缓存':plan.scope.scope==='unused'?'无用缓存':`${plan.scope.scope==='format'?'格式':'年份'}：${plan.scope.value}`;
  this.db.transaction(()=>{
   this.db.prepare("INSERT INTO tasks(id,kind,status,total,payload_json) VALUES(?,'cache-cleanup','running',?,?)").run(id,plan.files.length,JSON.stringify({options:plan.scope,info:{snapshotVersion:1,scopeLabel:label}}));
   const insert=this.db.prepare('INSERT INTO job_items(task_id,media_id,file_path,size_bytes,fingerprint,ordinal) VALUES(?,?,?,?,?,?)');
   plan.files.forEach((file,index)=>insert.run(id,file.file,file.file,file.bytes,plan.scope.scope==='unused'?JSON.stringify({stamp:file.stamp,ownerId:file.owner?.id??null}):file.stamp,index));
  })();const job={id,kind:'cache-cleanup' as const};this.starts.set(token,job);this.plans.delete(token);if(this.starts.size>50)this.starts.delete(this.starts.keys().next().value!);
  this.launch(id);return job;
 }
 control(id:string,action:'pause'|'resume'|'cancel'|'retry'){
  this.closed=false;if(action==='pause'||action==='cancel'){this.db.prepare('UPDATE tasks SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(action==='pause'?'paused':'cancelled',id);this.notify();return {ok:true};}
  if([...this.active.keys()].some(key=>key!==id))throw new Error('已有缓存清理正在执行，请等待完成');
  if(this.active.has(id))throw new Error('任务正在停止，请稍后再试');
  if(action==='retry')this.db.prepare("UPDATE job_items SET status='pending',error=NULL WHERE task_id=? AND status='failed'").run(id);
  this.db.prepare("UPDATE tasks SET status='running',error_message=NULL WHERE id=?").run(id);this.db.prepare("UPDATE tasks SET processed=(SELECT COUNT(*) FROM job_items WHERE task_id=? AND status!='pending') WHERE id=?").run(id,id);this.launch(id);return {ok:true};
 }
 private launch(id:string){
  const work=this.run(id).catch(error=>{if(!this.closed&&this.db.open)this.db.prepare("UPDATE tasks SET status='failed',error_message=? WHERE id=?").run(String(error),id);}).finally(()=>{this.active.delete(id);if(!this.closed&&this.db.open)this.notify();});this.active.set(id,work);this.notify();
 }
 private async run(id:string){
  await yieldTurn();const root=this.root?await realpath(this.root).catch(()=>null):null;if(!root)throw new Error('缓存目录不可用');let lastNotify=0,usageRevision=this.revision();const unusedOnly=JSON.parse((this.db.prepare('SELECT payload_json AS payload FROM tasks WHERE id=?').get(id) as {payload:string}).payload).options?.scope==='unused';let needed=unusedOnly?this.neededNow():new Set<string>();
  const normalized=(file:string)=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);const protectedTrash=new Set((this.db.prepare('SELECT stored_path AS file FROM trash_entries WHERE stored_path IS NOT NULL').all() as {file:string}[]).map(row=>normalized(row.file)));
  while(!this.closed&&this.db.open){
   const task=this.db.prepare('SELECT status FROM tasks WHERE id=?').get(id) as {status:string};if(task.status!=='running')return;
   const rows=this.db.prepare("SELECT media_id AS id,file_path AS file,size_bytes AS bytes,fingerprint AS stamp FROM job_items WHERE task_id=? AND status='pending' ORDER BY ordinal LIMIT 24").all(id) as {id:string;file:string;bytes:number;stamp:string}[];
   if(!rows.length){const failed=(this.db.prepare("SELECT COUNT(*) AS count FROM job_items WHERE task_id=? AND status='failed'").get(id) as {count:number}).count;this.db.prepare("UPDATE tasks SET status=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(failed?'failed':'completed',failed?`${failed} 个缓存已跳过或清理失败，请查看详情`:null,id);return;}
   for(const row of rows){
    if(this.closed||!this.db.open)return;if((this.db.prepare('SELECT status FROM tasks WHERE id=?').get(id) as {status:string}).status!=='running')return;
    let error:string|null=null;try{
     const name=path.basename(row.file),relative=path.relative(root,row.file);let plannedStamp=row.stamp;if(row.stamp.startsWith('{')){const planned=JSON.parse(row.stamp);plannedStamp=planned.stamp;if(this.revision()!==usageRevision){needed=this.neededNow();usageRevision=this.revision();}if(needed.has(name))throw new Error('缓存已重新使用，已保留');const id=planned.ownerId??/^(.+)-[a-f0-9]{16}\.jpg$/u.exec(name)?.[1];if(id){const owner=this.db.prepare("SELECT m.id,m.fingerprint,COALESCE(d.missing,0) AS missing,EXISTS(SELECT 1 FROM trash_entries t WHERE t.media_id=m.id AND t.state='stored') AS stored FROM media m LEFT JOIN media_details d ON d.media_id=m.id WHERE m.id=?").get(id) as Owner|undefined;if(owner&&(!owner.missing||owner.stored)&&cacheNames(owner).includes(name))throw new Error('缓存已重新使用，已保留');}}if(!generated(name)||!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('缓存路径无效，已跳过');
     const resolved=await realpath(row.file).catch(reason=>{if(reason.code==='ENOENT')return null;throw reason;});
     if(!resolved){forgetCache(this.db,row.file);throw new Error('缓存已不存在，已跳过');}
     if(resolved){if(protectedTrash.has(normalized(resolved))||this.db.prepare('SELECT 1 FROM media WHERE absolute_path=? COLLATE NOCASE LIMIT 1').get(resolved))throw new Error('此路径是媒体原文件，已保留');if(resolved!==row.file)throw new Error('缓存路径已变化，已跳过');const info=await lstat(row.file);if(!info.isFile()||info.isSymbolicLink()||fingerprint(info)!==plannedStamp)throw new Error('缓存已更新，已跳过；可重新计算后清理');if(this.busy({name,file:row.file,bytes:row.bytes,stamp:row.stamp,generated:true}))throw new Error('缓存正在生成，已跳过');await unlink(row.file);forgetCache(this.db,row.file);}
    }catch(reason){const failure=reason as NodeJS.ErrnoException;error=['EBUSY','EPERM','EACCES'].includes(failure.code??'')?'缓存正在使用或没有删除权限，已跳过':failure.message;}
    if(this.closed||!this.db.open)return;
    this.db.prepare('UPDATE job_items SET status=?,error=? WHERE task_id=? AND media_id=?').run(error?'failed':'completed',error,id,row.id);
    this.db.prepare("UPDATE tasks SET processed=processed+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
   }
   if(Date.now()-lastNotify>500){this.notify();lastNotify=Date.now();}await yieldTurn();
  }
 }
}
