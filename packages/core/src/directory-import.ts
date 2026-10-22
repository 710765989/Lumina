import {readdir,stat,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {addLibraryRoot,listLibraryRoots,saveDirectoryConfiguration,directoryConfiguration,directoryRuleContext,applyDirectoryRules,rootMediaIds,ensureDirectoryAlbums,refreshMediaStats,reconcileAllCovers,knownDirectoryPaths,rememberDirectoryPaths,relativeDirectory,type LuminaDatabase,type DirectoryOptions} from '@lumina/storage';
import {mediaKindFromPath,scanDirectory} from './index.js';
export async function previewDirectory(absolutePath:string){
 const root=path.resolve(absolutePath);if(!(await stat(root)).isDirectory())throw new Error('请选择文件目录');
 const directories:{relativePath:string;fileCount:number;mediaCount:number;photo:number;video:number;directMedia:number}[]=[];const samples:{name:string;relativePath:string;kind:string;preview?:string}[]=[];const errors:string[]=[];
 async function walk(current:string){const row={relativePath:path.relative(root,current).split(path.sep).join('/'),fileCount:0,mediaCount:0,photo:0,video:0,directMedia:0};directories.push(row);let entries;try{entries=await readdir(current,{withFileTypes:true});}catch(error){errors.push(`${row.relativePath||'.'}：${(error as Error).message}`);return row;}
  entries.sort((a,b)=>a.name.localeCompare(b.name));for(const entry of entries){if(entry.isSymbolicLink())continue;const file=path.join(current,entry.name);if(entry.isDirectory() && entry.name!=='.lumina-trash' && !entry.name.startsWith('.lumina-export-')){const child=await walk(file);row.fileCount+=child.fileCount;row.mediaCount+=child.mediaCount;row.photo+=child.photo;row.video+=child.video;}else if(entry.isFile()){row.fileCount++;const kind=mediaKindFromPath(file);if(kind==='unknown')continue;row.mediaCount++;row.directMedia++;if(kind==='photo')row.photo++;else row.video++;if(samples.length<12)samples.push({name:entry.name,relativePath:path.relative(root,file),kind});}}
  return row;
 }const totals=await walk(root);
 for(const sample of samples)if(sample.kind==='photo')try{sample.preview='data:image/jpeg;base64,'+(await sharp(path.join(root,sample.relativePath),{failOn:'none'}).rotate().resize(180,120,{fit:'inside',withoutEnlargement:true}).jpeg({quality:65}).toBuffer()).toString('base64');}catch{}
 return {absolutePath:root,...totals,directories,samples,errors};
}
export class DirectoryImports{
 private active=new Set<string>();isActive(id:string){return this.active.has(id);}
 constructor(private db:LuminaDatabase,private notify:()=>void,private sync:()=>void){}
 private root(absolutePath:string,id:string){const root=listLibraryRoots(this.db).find(row=>row.id===id);if(!root || path.resolve(root.absolutePath).toLowerCase()!==path.resolve(absolutePath).toLowerCase())throw new Error('目录已变化，请重新打开编辑页');return root;}
 private indexedPreview(root:ReturnType<typeof listLibraryRoots>[number]){
  const ids=rootMediaIds(this.db,root.id);
  const media=this.db.prepare('SELECT id,absolute_path AS file,kind FROM media WHERE id IN(SELECT value FROM json_each(?)) ORDER BY absolute_path').all(JSON.stringify(ids)) as {id:string;file:string;kind:'photo'|'video'}[];
  const rows=new Map<string,{relativePath:string;fileCount:number;mediaCount:number;photo:number;video:number;directMedia:number}>();
  function directory(relativePath:string){let row=rows.get(relativePath);if(!row){row={relativePath,fileCount:0,mediaCount:0,photo:0,video:0,directMedia:0};rows.set(relativePath,row);}return row;}
  function ancestors(relative:string){const result:string[]=[];while(true){directory(relative);result.push(relative);if(!relative)break;relative=path.posix.dirname(relative);if(relative==='.')relative='';}return result;}
  for(const relative of knownDirectoryPaths(this.db,root.id))ancestors(relative);
  for(const item of media){const relative=path.relative(root.absolutePath,path.dirname(item.file)).split(path.sep).join('/');directory(relative).directMedia++;for(const parent of ancestors(relative)){const row=directory(parent);row.fileCount++;row.mediaCount++;row[item.kind]++;}}
  const directories=[...rows.values()].sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
  return {absolutePath:root.absolutePath,...directory(''),directories,samples:media.slice(0,12).map(item=>({id:item.id,name:path.basename(item.file),relativePath:path.relative(root.absolutePath,item.file),kind:item.kind})),errors:[] as string[],source:'index' as const};
 }
 async preview(absolutePath:string,id?:string,refresh=false){
  if(!id&&listLibraryRoots(this.db).some(row=>path.resolve(row.absolutePath).toLowerCase()===path.resolve(absolutePath).toLowerCase()))throw new Error('该目录已添加，请在目录设置中编辑');
  const root=id?this.root(absolutePath,id):undefined;
  if(root && !refresh)return this.indexedPreview(root);
  const preview=await previewDirectory(absolutePath);
  if(root)rememberDirectoryPaths(this.db,root.id,preview.directories.map(row=>row.relativePath));
  return {...preview,source:'disk' as const};
 }
 async configure(input:DirectoryOptions & {absolutePath:string;id?:string;label:string}){
  const absolutePath=path.resolve(input.absolutePath);
  const existing=listLibraryRoots(this.db).find(row=>row.id===input.id || path.resolve(row.absolutePath).toLowerCase()===absolutePath.toLowerCase());if(input.id && (!existing || path.resolve(existing.absolutePath).toLowerCase()!==absolutePath.toLowerCase()))throw new Error('目录已变化，请重新打开编辑页');
  if(existing&&!input.id)throw new Error('该目录已添加，请在目录设置中编辑');
  const active=this.db.prepare("SELECT 1 FROM tasks WHERE kind='directory-rules' AND status IN('running','queued','paused') AND json_extract(payload_json,'$.root')=?").get(absolutePath);if(active)throw new Error('该目录仍有整理任务，请先完成或取消任务');
  const options={autoAlbums:input.autoAlbums,hierarchy:input.autoAlbums && input.hierarchy,rules:input.rules.map(rule=>({relativePath:relativeDirectory(rule.relativePath),name:rule.name.trim()}))};
  const normalized=(value:DirectoryOptions)=>JSON.stringify({autoAlbums:value.autoAlbums,hierarchy:value.autoAlbums && value.hierarchy,rules:value.rules.map(({relativePath,name})=>({relativePath,name})).sort((a,b)=>a.relativePath.localeCompare(b.relativePath) || a.name.localeCompare(b.name))});
  const previous=existing?directoryConfiguration(this.db,existing.id) as DirectoryOptions:undefined;
  let changed=!previous || normalized(previous)!==normalized(options);
  const rulesChanged=!previous || JSON.parse(normalized(previous)).rules.map((row:any)=>JSON.stringify(row)).join()!==JSON.parse(normalized(options)).rules.map((row:any)=>JSON.stringify(row)).join();
  if(existing && !changed){changed=Boolean(ensureDirectoryAlbums(this.db,existing.id,[...knownDirectoryPaths(this.db,existing.id)]));if(!changed){if(existing.label!==input.label){this.db.prepare('UPDATE library_roots SET label=? WHERE id=?').run(input.label,existing.id);this.notify();}return {root:{...existing,label:input.label}};}}
  // Existing settings use indexed paths, including disabled/offline libraries. Only
  // a newly introduced rule path needs a targeted directory check, never a walk.
  const preview=existing?this.indexedPreview(existing):await this.preview(absolutePath);
  const known=new Set(preview.directories.map(row=>row.relativePath));
  for(const rule of options.rules)if(!known.has(rule.relativePath)){
   if(!existing)throw new Error('所选子目录不在本次预览中，请重新预览');
   let current=absolutePath;
   for(const part of rule.relativePath.split('/').filter(Boolean)){current=path.join(current,part);const info=await lstat(current);if(!info.isDirectory() || info.isSymbolicLink())throw new Error('规则中的子目录不存在或不是实际目录');}
   known.add(rule.relativePath);
  }
  const root=this.db.transaction(()=>{const root=existing??addLibraryRoot(this.db,absolutePath,input.label);this.db.prepare('UPDATE library_roots SET label=? WHERE id=?').run(input.label,root.id);if(changed){saveDirectoryConfiguration(this.db,root.id,options);rememberDirectoryPaths(this.db,root.id,[...known]);ensureDirectoryAlbums(this.db,root.id,[...known]);}return {...root,label:input.label};})();
  if(!changed){this.notify();return {root};}
  const id=randomUUID();this.db.prepare("INSERT INTO tasks(id,kind,status,total,payload_json) VALUES(?,'directory-rules','queued',0,?)").run(id,JSON.stringify({root:absolutePath,rootId:root.id,phase:existing?'apply':'scan',applyTags:rulesChanged,options:{...options,absolutePath,label:input.label},info:{snapshotVersion:1}}));this.sync();this.notify();void this.run(id);return {root,taskId:id};
 }
 control(id:string,action:string){const task=this.db.prepare("SELECT status FROM tasks WHERE id=? AND kind='directory-rules'").get(id) as {status:string}|undefined;if(!task)throw new Error('任务不存在');
  if(action==='pause' || action==='cancel'){if(!['running','queued','paused'].includes(task.status))return {ok:true,status:task.status};this.db.prepare('UPDATE tasks SET status=? WHERE id=?').run(action==='pause'?'paused':'cancelled',id);this.db.prepare("UPDATE tasks SET status=? WHERE id=? AND status IN('running','queued','paused')").run(action==='pause'?'paused':'cancelled',id+'-scan');this.notify();return {ok:true};}
  if(this.active.has(id))throw new Error('正在停止任务，请稍后恢复');this.db.prepare("UPDATE tasks SET status='queued',error_message=NULL WHERE id=?").run(id);void this.run(id);return {ok:true};
 }
 private async run(id:string){if(this.active.has(id))return;this.active.add(id);this.db.prepare("UPDATE tasks SET status='running' WHERE id=?").run(id);this.notify();try{
  const payload=JSON.parse((this.db.prepare('SELECT payload_json AS value FROM tasks WHERE id=?').get(id) as {value:string}).value);const root=listLibraryRoots(this.db).find(row=>row.id===payload.rootId);if(!root)throw new Error('图库目录已移除');
  const running=()=>Boolean(this.db.prepare("SELECT 1 FROM tasks WHERE id=? AND status='running'").get(id));
  if(root.enabled && payload.phase!=='apply')await scanDirectory(this.db,root.absolutePath,{rootId:root.id,taskId:id+'-scan',notify:this.notify,continueIf:running});if(!running())return;
  const ids=rootMediaIds(this.db,root.id);this.db.prepare("UPDATE tasks SET payload_json=json_set(payload_json,'$.phase','apply') WHERE id=?").run(id);
  const record=this.db.prepare("INSERT OR IGNORE INTO job_items(task_id,media_id,file_path,size_bytes,ordinal,status) SELECT ?,m.id,m.absolute_path,m.size_bytes,?,'pending' FROM media m WHERE m.id=?");this.db.transaction(()=>{ids.forEach((mediaId,index)=>record.run(id,index+1,mediaId));})();
  const completed=new Set((this.db.prepare("SELECT media_id AS id FROM job_items WHERE task_id=? AND status='completed'").all(id) as {id:string}[]).map(row=>row.id));
  let processed=completed.size,lastNotify=Date.now();const pending=ids.filter(mediaId=>!completed.has(mediaId));
  this.db.prepare('UPDATE tasks SET total=?,processed=? WHERE id=?').run(ids.length,processed,id);const context=directoryRuleContext(this.db);
  const read=this.db.prepare('SELECT absolute_path AS file FROM media WHERE id=?'),complete=this.db.prepare("UPDATE job_items SET status='completed',error=NULL WHERE task_id=? AND media_id=?"),progress=this.db.prepare('UPDATE tasks SET processed=?,updated_at=CURRENT_TIMESTAMP WHERE id=?');
  for(let offset=0;offset<pending.length;offset+=50){if(!running())return;const batch=pending.slice(offset,offset+50);this.db.transaction(()=>{for(const mediaId of batch){const row=read.get(mediaId) as {file:string}|undefined;if(row)applyDirectoryRules(this.db,mediaId,row.file,context,{tags:payload.applyTags!==false});complete.run(id,mediaId);}processed+=batch.length;progress.run(processed,id);})();
   if(Date.now()-lastNotify>=700){lastNotify=Date.now();this.notify();}await new Promise<void>(resolve=>setImmediate(resolve));}
  refreshMediaStats(this.db);reconcileAllCovers(this.db);this.db.prepare("UPDATE tasks SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
 }catch(error){this.db.prepare("UPDATE tasks SET status='failed',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running'").run((error as Error).message,id);}finally{this.active.delete(id);this.notify();}}
}
