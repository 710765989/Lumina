import {JapaneseReadings} from './japanese-readings.js';
import {hiddenReasons,tagHiddenSql} from '@lumina/storage';
import {rememberCache,forgetCache} from './cache-inventory.js';
import {CacheLocation,configuredCacheRoot} from './cache-location.js';
import {MediaImports} from './media-import.js';
import {DirectoryImports} from './directory-import.js';
import {rm} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  libraryCommandSchema,
  organizationCommandSchema,
  type LibraryCommand,
} from '@lumina/contracts';
import {
  addLibraryRoot,
  addTagToMedia,
  addMediaToAlbum,
  createAlbum,
  createTag,
  deleteAlbum,
  deleteTag,
  getAlbum,
  getMediaById,
  hideMedia,
  listAlbumMedia,
  listAlbums,
  listLibraryRoots,rootMediaIds,directoryConfiguration,mediaCardTags,
  listMedia,
  getMediaStats,
  removeLibraryRoot,
  removeTagFromMedia,
  removeMediaFromAlbum,removeAlbumItems,
  removeMediaFromIndex,
  searchMedia,
  libraryFormats,
  searchMediaStats,mediaTimeline,
  searchMediaIds,
  albumMemberIds,
  tagMediaIds,
  setAlbumCover,
  setLibraryRootEnabled,
  setMediaTags,
  listTags,
  renameTag,
  reparentTag, setTagParents, addTagReference, removeTagReference, refreshMediaStats,
  listTagMedia,
  listMediaTags,
  listTasks,
  albumRule,
  reconcileCover, reconcileAllCovers, findTag,
  tagDetails,
  albumSummary,
  rawMedia,
  settings,
  updateMetadata,
  type LuminaDatabase,
  unhideMedia,
  updateAlbum,
} from '@lumina/storage';
import { addAndScanLibraryRoot, generateMediaThumbnail, getCachedThumbnail, getHealth, scanDirectory,scanIsActive } from './index.js';
import { OrganizationService } from './organization-service.js';
import { RootWatcher } from './root-watcher.js';
import {WindowsHiddenAttributes} from './windows-hidden-worker.js';
import path from 'node:path';

export class LibraryService {
  readonly organization: OrganizationService;
  private japanese=new JapaneseReadings();
  readonly watcher: RootWatcher;readonly directories:DirectoryImports;readonly imports:MediaImports;readonly cacheLocation:CacheLocation;private cacheOperations=0;
  private notify: () => void;
  private windowsAttributes=new WindowsHiddenAttributes();private windowsTimer?:ReturnType<typeof setTimeout>;private windowsJob?:string;private closed=false;
  private scheduleWindowsSync(){if(this.closed||!this.db.open||this.windowsTimer)return;this.windowsTimer=setTimeout(()=>{this.windowsTimer=undefined;void this.flushWindowsSync().catch(()=>{});},150);this.windowsTimer.unref();}
  private windowsFlush?:Promise<string|undefined>;
  private flushWindowsSync():Promise<string|undefined>{
    if(this.windowsFlush)return this.windowsFlush;
    const work=this.flushWindowsSyncNow();this.windowsFlush=work;
    return work.finally(()=>{if(this.windowsFlush===work)this.windowsFlush=undefined;});
  }
  private async flushWindowsSyncNow(){
    if(this.closed||!this.db.open)return undefined;
    if(!this.db.prepare('SELECT 1 FROM windows_visibility_queue LIMIT 1').get())return undefined;
    // Tag bookkeeping may enqueue a file whose effective hidden state did not
    // change. Do not create a file-processing task for these no-op candidates.
    const desired=settings(this.db).syncHidden?`(EXISTS(SELECT 1 FROM hidden_media h WHERE h.media_id=m.id) OR ${tagHiddenSql()})`:'0';
    const tracked=`EXISTS(SELECT 1 FROM media_details d WHERE d.media_id=m.id AND json_type(d.metadata_json,'$.windowsHiddenOriginal') IN('true','false'))`;
    const targets=Object.fromEntries((this.db.prepare(`SELECT m.id,(${desired}) AS hidden FROM windows_visibility_queue q JOIN media m ON m.id=q.media_id`).all() as {id:string;hidden:number}[]).map(row=>[row.id,Boolean(row.hidden)]));
    const effectiveTargets=await this.organization.jobs.supersedeWindowsSync(targets);
    if(Object.keys(effectiveTargets).length!==Object.keys(targets).length)
      this.db.prepare("DELETE FROM windows_visibility_queue WHERE media_id NOT IN (SELECT key FROM json_each(?))").run(JSON.stringify(effectiveTargets));
    if(this.closed||!this.db.open)return undefined;
    if(this.windowsJob){if(this.organization.jobs.isActive(this.windowsJob))return this.windowsJob;this.windowsJob=undefined;}

    this.db.prepare(`DELETE FROM windows_visibility_queue WHERE EXISTS(SELECT 1 FROM media m WHERE m.id=windows_visibility_queue.media_id AND (${desired})=(${tracked}))`).run();
    const rows=this.db.prepare('SELECT media_id AS id FROM windows_visibility_queue LIMIT 1000').all() as {id:string}[];if(!rows.length)return undefined;
    const ids=rows.map(row=>row.id);const task=this.organization.jobs.start(organizationCommandSchema.parse({type:'jobs.start',kind:'visibility',syncOnly:true,includeHidden:true,mediaIds:ids,hidden:effectiveTargets[ids[0]!]??true}) as any,{windowsTargets:Object.fromEntries(ids.map(id=>[id,effectiveTargets[id]!]))});this.windowsJob=task.id;
    this.db.prepare('DELETE FROM windows_visibility_queue WHERE media_id IN(SELECT value FROM json_each(?))').run(JSON.stringify(ids));return task.id;
  }
  private async syncWindowsVisibility(id:string,signal?:AbortSignal){
    signal?.throwIfAborted();
    const media=rawMedia(this.db,id);if(!media)return;if(this.db.prepare('SELECT 1 FROM trash_entries WHERE media_id=?').get(id))return;
    const hidden=Boolean(settings(this.db).syncHidden&&this.db.prepare(`SELECT m.id FROM media m WHERE m.id=? AND (EXISTS(SELECT 1 FROM hidden_media h WHERE h.media_id=m.id) OR ${tagHiddenSql()})`).get(id));
    const original=media.metadata.windowsHiddenOriginal;
    if(hidden){if(typeof original!=='boolean'){const attributes=await this.windowsAttributes.request(media.absolutePath,undefined,signal);signal?.throwIfAborted();updateMetadata(this.db,id,{windowsHiddenOriginal:Boolean(attributes&2)});if(attributes&2)return;}signal?.throwIfAborted();await this.windowsAttributes.request(media.absolutePath,true,signal);}
    else if(typeof original==='boolean'){await this.windowsAttributes.request(media.absolutePath,original,signal);signal?.throwIfAborted();updateMetadata(this.db,id,{windowsHiddenOriginal:null});}
  }
  private thumbnailBatch?:{id:string;lastAt:number;width?:number;height?:number};
  private thumbnailRequests=new Map<string,Promise<any>>();
  private thumbnailLookups=new Map<string,Promise<any>>();
  private thumbnailFailures=new Map<string,{at:number;error:unknown}>();
  private thumbnailTaskIds=new Map<string,string>();
  constructor(private readonly db: LuminaDatabase, private thumbnailCacheRoot?: string, options: { defaultCacheRoot?:string;notify?: () => void; systemTrash?: (file: string) => Promise<void> } = {}) {
    thumbnailCacheRoot=configuredCacheRoot(db,thumbnailCacheRoot,options.defaultCacheRoot);this.thumbnailCacheRoot=thumbnailCacheRoot;
    this.organization = new OrganizationService(db, thumbnailCacheRoot, ()=>this.notify?.(), options.systemTrash,(id,hidden,tagIds,syncOnly,signal)=>syncOnly?this.syncWindowsVisibility(id,signal):this.handle({type:hidden?'media.hide':'media.unhide',id,tagIds}),id=>[...this.thumbnailRequests.keys()].some(key=>key.startsWith(id+'/')));
    this.notify=()=>{options.notify?.();this.scheduleWindowsSync();}; this.watcher = new RootWatcher(db, this.notify,thumbnailCacheRoot?[thumbnailCacheRoot]:[]);this.directories=new DirectoryImports(db,this.notify,()=>this.watcher.sync());this.imports=new MediaImports(db,this.notify,()=>this.watcher.sync(),thumbnailCacheRoot);this.watcher.ignoreChanges(file=>this.imports.isWriting(file));
    this.cacheLocation=new CacheLocation(db,thumbnailCacheRoot,options.defaultCacheRoot??thumbnailCacheRoot,this.notify,async(signal)=>{
      await this.organization.cacheCleanup.suspend();
      try{while(this.cacheOperations || this.thumbnailRequests.size || this.organization.storage.hasActive() || this.organization.compatibility.hasActive()){signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,25));}signal.throwIfAborted();}catch(error){this.organization.cacheCleanup.resume();throw error;}
    },root=>{this.thumbnailCacheRoot=root;this.thumbnailBatch=undefined;this.organization.setCacheRoot(root);this.imports.setCacheRoot(root);this.watcher.setIgnored([root]);},()=>this.organization.cacheCleanup.resume());
    this.scheduleWindowsSync();

  }
  start() { this.cacheLocation.recover();this.watcher.start();this.organization.cacheCleanup.start();void this.organization.recycle.recover().then(this.notify); }
  close() { this.japanese.close();this.closed=true;clearTimeout(this.windowsTimer);this.organization.jobs.suspendWindowsSync();this.windowsAttributes.close();this.cacheLocation.close();this.imports.close();this.watcher.close();this.organization.compatibility.close();this.organization.hoverVideo.close();this.organization.cacheCleanup.close();this.organization.storage.close(); }
  private thumbnailMedia(id: string) {
    const record = rawMedia(this.db, id); if (!record) throw new Error(`Media not found: ${id}`);
    return { ...record, kind: record.kind as 'photo' | 'video', absolutePath: this.organization.filePath(id) };
  }

  private thumbnailKey(mediaId:string,width?:number,height?:number){return `${mediaId}/${rawMedia(this.db,mediaId)?.fingerprint??''}`;}
  private updateThumbnailBatch(taskId:string){
    const counts=this.db.prepare("SELECT COUNT(*) AS total,SUM(status='completed') AS completed,SUM(status='failed') AS failed,SUM(status='pending') AS pending FROM job_items WHERE task_id=?").get(taskId) as {total:number;completed:number;failed:number;pending:number};
    const state=this.db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId) as {status:string};
    this.db.prepare('UPDATE tasks SET status=?,processed=?,total=?,error_code=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(['paused','cancelled'].includes(state.status)?state.status:counts.pending?'running':counts.failed?'failed':'completed',counts.completed+counts.failed,counts.total,counts.failed?'thumbnail_failed':null,counts.failed?`${counts.failed} 项缩略图失败，可仅重试失败项`:null,taskId);
  }
  private enqueueThumbnail(media:ReturnType<LibraryService['thumbnailMedia']>,width?:number,height?:number){
    const previous=this.thumbnailBatch,now=Date.now();let taskId=previous?.id;
    const prior=previous?this.db.prepare('SELECT fingerprint FROM job_items WHERE task_id=? AND media_id=?').get(previous.id,media.id) as {fingerprint:string}|undefined:undefined;
    const state=previous?this.db.prepare('SELECT status FROM tasks WHERE id=?').get(previous.id) as {status:string}|undefined:undefined;
    if(!previous || !state || ['paused','cancelled'].includes(state.status) || now-previous.lastAt>1000 || previous.width!==width || previous.height!==height || prior && prior.fingerprint!==media.fingerprint){taskId=randomUUID();this.db.prepare("INSERT INTO tasks(id,kind,status,total,payload_json) VALUES(?,'thumbnail','running',0,?)").run(taskId,JSON.stringify({batch:true,width,height,info:{snapshotVersion:1}}));}
    this.thumbnailBatch={id:taskId!,lastAt:now,width,height};
    this.db.prepare("INSERT INTO job_items(task_id,media_id,file_path,size_bytes,fingerprint,ordinal) VALUES(?,?,?,?,?,(SELECT total+1 FROM tasks WHERE id=?)) ON CONFLICT(task_id,media_id) DO UPDATE SET status='pending',error=NULL").run(taskId,media.id,media.absolutePath,media.sizeBytes,media.fingerprint,taskId);
    this.updateThumbnailBatch(taskId!);return taskId!;
  }
  private async runThumbnail(mediaId:string,width:number|undefined,height:number|undefined,taskId:string):Promise<any>{
    if(!this.thumbnailCacheRoot)throw new Error('Thumbnail cache is not configured');const cacheRoot=this.thumbnailCacheRoot,key=this.thumbnailKey(mediaId,width,height);const existing=this.thumbnailRequests.get(key);if(existing)return existing;
    this.thumbnailTaskIds.set(key,taskId);
    const work=(async()=>{await Promise.resolve();try{
      const status=this.db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId) as {status:string};if(['paused','cancelled'].includes(status.status))throw new Error('任务已停止，未生成缩略图');
      const media=this.thumbnailMedia(mediaId);const cached=await getCachedThumbnail(media,cacheRoot,{width,height,onPruned:file=>forgetCache(this.db,file),isCurrent:()=>this.thumbnailMediaExists(media)});const result=cached??await generateMediaThumbnail(media,cacheRoot,{width,height,onPruned:file=>forgetCache(this.db,file),isCurrent:()=>this.thumbnailMediaExists(media)});
      if(!this.thumbnailMediaExists(media)){await rm(result.cachePath,{force:true});throw new Error('媒体已移除或更新，未保留过期缩略图');}
      this.db.prepare("UPDATE job_items SET status='completed',error=NULL,output=? WHERE task_id=? AND media_id=?").run(result.cachePath,taskId,mediaId);this.updateThumbnailBatch(taskId);this.thumbnailFailures.delete(key);return {taskId,...(cached?{cached:true}:{}),...result};
    }catch(error){this.db.prepare("UPDATE job_items SET status='failed',error=? WHERE task_id=? AND media_id=? AND EXISTS(SELECT 1 FROM tasks WHERE id=job_items.task_id AND status NOT IN('paused','cancelled'))").run(String(error),taskId,mediaId);this.updateThumbnailBatch(taskId);throw error;}finally{this.thumbnailRequests.delete(key);this.thumbnailTaskIds.delete(key);}})();this.thumbnailRequests.set(key,work);return work;
  }

  private thumbnailMediaExists(media:{id:string;fingerprint:string}){return rawMedia(this.db,media.id)?.fingerprint===media.fingerprint;}

  private historyCandidates(){
    const thumbnails=new Set(this.thumbnailTaskIds.values());
    return (this.db.prepare("SELECT id,kind,status,payload_json AS payload FROM tasks WHERE status IN('completed','cancelled','failed')").all() as {id:string;kind:string;status:string;payload:string}[]).filter(task=>{
      if(this.cacheLocation.isActive(task.id) || this.imports.isActive(task.id) || thumbnails.has(task.id) || this.directories.isActive(task.id) || this.organization.isTaskActive(task.id))return false;
      if(task.kind==='scan'){let root:string|undefined;try{root=JSON.parse(task.payload).root;}catch{}if(root && scanIsActive(this.db,root))return false;}
      return true;
    });
  }

  async handle(input:unknown):Promise<unknown>{
    const kind=(input as any)?.type;
    if(kind==='text.japaneseReadings'){const command=organizationCommandSchema.parse(input);if(command.type==='text.japaneseReadings')return this.japanese.read(command.texts);}
    const search=(kind==='media.playlist'?(input as any).source:input) as any;
    if(search?.searchLanguage==='ja' && (search.query?.trim() || search.fileNames?.length || search.excludeFileNames?.length)){
      // Read names from the index, never from media files. The worker coalesces
      // requests and reuses previously computed readings across all search scopes.
      const texts=(this.db.prepare("SELECT name AS text FROM tags UNION SELECT english_name AS text FROM tags WHERE english_name<>'' UNION SELECT value AS text FROM tag_options,json_each(aliases_json)").all() as {text:string}[]).map(row=>row.text);
      if(search.query || search.fileNames?.length || search.excludeFileNames?.length)texts.push(...(this.db.prepare("SELECT DISTINCT COALESCE(NULLIF(file_name,''),absolute_path) AS text FROM media").all() as {text:string}[]).map(row=>row.text));
      await this.japanese.read(texts);
    }
    const cacheAccess=['media.thumbnail','media.previewPath','media.compatibilityPath','media.hoverPreview','tasks.retryThumbnail','tasks.retryThumbnails','storage.report','storage.cachePreview','storage.clearCache'].includes(kind) || kind==='jobs.control' && ['resume','retry'].includes((input as any)?.action) && Boolean(this.db.prepare("SELECT 1 FROM tasks WHERE id=? AND kind IN('cache-cleanup','thumbnail','video-preview')").get((input as any).id));
    if(!cacheAccess)return this.dispatch(input);
    await this.cacheLocation.wait();this.cacheOperations++;try{const result=await this.dispatch(input);if(result&&typeof result==='object'&&'cachePath' in result&&typeof result.cachePath==='string'&&this.thumbnailCacheRoot)await rememberCache(this.db,this.thumbnailCacheRoot,result.cachePath);return result;}finally{this.cacheOperations--;}
  }
  private async dispatch(input:unknown):Promise<unknown>{
    if(String((input as any)?.type??'').startsWith('cache.')){
      const command=organizationCommandSchema.parse(input);
      if(command.type==='cache.settings')return this.cacheLocation.settings();
      if(command.type==='cache.setupPreview')return this.cacheLocation.initialPreview(command.directory,command.libraryPath);
      if(command.type==='cache.setup')return this.cacheLocation.configureInitial(command.directory,command.libraryPath);
      if(command.type==='cache.movePreview')return this.cacheLocation.preview(command.directory);
      if(command.type==='cache.move')return this.cacheLocation.start(command.token);
    }
    if((input as any)?.type==='jobs.control' || (input as any)?.type==='jobs.result'){
      const parsed=organizationCommandSchema.parse(input);
      const cacheTask=(parsed.type==='jobs.control'||parsed.type==='jobs.result')?this.db.prepare("SELECT payload_json AS payloadJson FROM tasks WHERE id=? AND kind='cache-move'").get(parsed.id) as {payloadJson:string}|undefined:undefined;
      if(cacheTask&&(parsed.type==='jobs.control'||parsed.type==='jobs.result')){
        if(parsed.type==='jobs.control')return this.cacheLocation.control(parsed.id,parsed.action);
        return {...this.organization.jobs.result(parsed.id,parsed.limit,parsed.offset),payloadJson:cacheTask.payloadJson,committed:['cleanup','done'].includes(JSON.parse(cacheTask.payloadJson).phase),active:this.cacheLocation.isActive(parsed.id),...this.cacheLocation.progress(parsed.id)};
      }
    }

    if(String((input as any)?.type??'').startsWith('imports.')){
      const command=organizationCommandSchema.parse(input);
      if(command.type==='imports.discard')return this.imports.discard(command.token);
      if(command.type==='imports.settings')return this.imports.settings();
      if(command.type==='imports.configure')return this.imports.configure(command.directory,command.skipPrompt);
      if(command.type==='imports.preview')return this.imports.preview(command.sources);
      if(command.type==='imports.conflicts')return this.imports.conflicts(command.token,command.directory);
      if(command.type==='imports.start')return this.imports.start(command.token,command.directory,command.remember,command.conflictPolicy,command.conflictToken);
    }
    if((input as any)?.type==='jobs.control'){
      const parsed=organizationCommandSchema.parse(input);
      if(parsed.type==='jobs.control' && this.db.prepare("SELECT 1 FROM tasks WHERE id=? AND kind='import'").get(parsed.id))return this.imports.control(parsed.id,parsed.action);
    }
    if((input as any)?.type==='jobs.result'){
      const parsed=organizationCommandSchema.parse(input);
      if(parsed.type==='jobs.result' && this.db.prepare("SELECT 1 FROM tasks WHERE id=? AND kind='import'").get(parsed.id))return {...this.organization.jobs.result(parsed.id,parsed.limit,parsed.offset),active:this.imports.isActive(parsed.id),...this.imports.progress(parsed.id)};
    }

    if(['tasks.historyPreview','tasks.clearHistory'].includes((input as any)?.type)){
      const command=organizationCommandSchema.parse(input),candidates=this.historyCandidates();
      if(command.type==='tasks.historyPreview')return {completed:candidates.filter(task=>task.status==='completed').length,cancelled:candidates.filter(task=>task.status==='cancelled').length,failed:candidates.filter(task=>task.status==='failed').length,items:candidates.map(({id,status})=>({id,status}))};
      if(command.type==='tasks.clearHistory'){
        const selected=command.taskIds?new Set(command.taskIds):null;
        const ids=candidates.filter(task=>(command.includeFailed || task.status!=='failed') && (!selected || selected.has(task.id))).map(task=>task.id);
        const removed=this.db.transaction(()=>this.db.prepare('DELETE FROM tasks WHERE id IN(SELECT value FROM json_each(?)) AND status IN(\'completed\',\'cancelled\',\'failed\')').run(JSON.stringify(ids)).changes)();
        if(this.thumbnailBatch && ids.includes(this.thumbnailBatch.id))this.thumbnailBatch=undefined;
        this.notify();return {removed};
      }
    }
    if((input as any)?.type==='jobs.control'){
      const command=organizationCommandSchema.parse(input);
      if(command.type==='jobs.control' && this.db.prepare("SELECT 1 FROM tasks WHERE id=? AND kind='thumbnail'").get(command.id)){
        if(command.action==='pause'||command.action==='cancel'){this.db.prepare('UPDATE tasks SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(command.action==='pause'?'paused':'cancelled',command.id);this.notify();return {ok:true};}
        return this.handle({type:'tasks.retryThumbnail',id:command.id});
      }
    }
    if((input as any)?.type==='jobs.control'){const parsed=organizationCommandSchema.parse(input);if(parsed.type==='jobs.control' && this.db.prepare("SELECT 1 FROM tasks WHERE id=? AND kind='directory-rules'").get(parsed.id))return this.directories.control(parsed.id,parsed.action);}
    if((input as any)?.type==='jobs.result'){const parsed=organizationCommandSchema.parse(input);if(parsed.type==='jobs.result'){const row=this.db.prepare("SELECT payload_json AS payload FROM tasks WHERE id=? AND kind='directory-rules'").get(parsed.id) as {payload:string}|undefined;if(row){const result=this.organization.jobs.result(parsed.id,parsed.limit,parsed.offset);const payload=JSON.parse(row.payload);const scan=payload.phase==='scan'?this.db.prepare('SELECT processed,total FROM tasks WHERE id=?').get(parsed.id+'-scan') as {processed:number;total:number}|undefined:undefined;return {...result,...(scan && result.status==='running'?scan:{}),active:this.directories.isActive(parsed.id),phase:payload.phase==='scan'?'扫描并应用目录规则':'整理已索引媒体'};}}}
    const organization = organizationCommandSchema.safeParse(input);
    if (organization.success) { const result = await this.organization.handle(organization.data); if (organization.data.type === 'organization.configure') this.watcher.sync(); const taskId=await this.flushWindowsSync();return taskId&&result&&!Array.isArray(result)&&['tags.setHidden','tags.options','organization.configure'].includes(organization.data.type)?{...result,visibilityTaskId:taskId}:result; }
    const command: LibraryCommand = libraryCommandSchema.parse(input);
    switch (command.type) {
      case 'health': return getHealth(this.db);
      case 'media.formats':return libraryFormats(this.db,command.hiddenOnly);
      case 'roots.list': return listLibraryRoots(this.db);
      case 'roots.mediaIds':return rootMediaIds(this.db,command.id);
      case 'roots.preview':return this.directories.preview(command.absolutePath,command.id,command.refresh);
      case 'roots.configuration':return directoryConfiguration(this.db,command.id);
      case 'roots.configure':return this.directories.configure(command);
      case 'media.cardTags':return mediaCardTags(this.db,command.mediaIds);
      case 'roots.addAndScan': {
        if(listLibraryRoots(this.db).some(root=>path.resolve(root.absolutePath).toLowerCase()===path.resolve(command.absolutePath).toLowerCase()))throw new Error('该目录已添加，请在目录设置中编辑');
        const root = addLibraryRoot(this.db, command.absolutePath, command.label);
        const result = await scanDirectory(this.db, root.absolutePath, { rootId: root.id, notify: this.notify }); this.watcher.sync(); return { root, ...result };
      }
      case 'roots.scan': {
        const root = listLibraryRoots(this.db).find((item) => item.id === command.id);
        if (!root) throw new Error(`Library root not found: ${command.id}`);
        if (!root.enabled) throw new Error('图库目录已停用，请先启用目录再扫描');
        return { root, ...(await scanDirectory(this.db, root.absolutePath, { rootId: root.id, notify: this.notify })) };
      }
      case 'roots.setEnabled': {
        if (!listLibraryRoots(this.db).some((root) => root.id === command.id)) throw new Error(`Library root not found: ${command.id}`);
        setLibraryRootEnabled(this.db, command.id, command.enabled);
        const root=listLibraryRoots(this.db).find((item)=>item.id===command.id)!;
        if(!command.enabled)this.db.prepare("UPDATE tasks SET status='paused',payload_json=json_set(payload_json,'$.pausedByRoot',1) WHERE kind='scan' AND status='running' AND json_extract(payload_json,'$.root')=?").run(root.absolutePath);
        else for(const task of this.db.prepare("SELECT id FROM tasks WHERE kind='scan' AND status='paused' AND json_extract(payload_json,'$.root')=? AND json_extract(payload_json,'$.pausedByRoot')=1").all(root.absolutePath) as {id:string}[]) void scanDirectory(this.db,root.absolutePath,{rootId:root.id,taskId:task.id,notify:this.notify}).catch(()=>{});
        this.watcher.sync(); this.notify();
        return { ok: true, enabled: command.enabled };
      }
      case 'roots.remove': {
        const root=listLibraryRoots(this.db).find((item)=>item.id===command.id);
        if(root)this.db.prepare("UPDATE tasks SET status='cancelled' WHERE kind IN('scan','directory-rules') AND status IN('running','paused','queued') AND json_extract(payload_json,'$.root')=?").run(root.absolutePath);
        const removedMedia = removeLibraryRoot(this.db, command.id);
        this.watcher.sync(); this.notify();
        return { ok: true, removedMedia };
      }
      case 'media.list': return listMedia(this.db, command);
      case 'media.timeline': return mediaTimeline(this.db,command.query,command);
      case 'media.search': return searchMedia(this.db, command.query, command);
      case 'media.hiddenReasons': return hiddenReasons(this.db,command.mediaIds);
      case 'media.hide': {
        if(!rawMedia(this.db,command.id))throw new Error('媒体不存在');
        if(this.db.prepare('SELECT 1 FROM trash_entries WHERE media_id=?').get(command.id))throw new Error('请先还原回收站中的媒体');
        hideMedia(this.db,command.id);this.notify();return {ok:true,taskId:await this.flushWindowsSync()};
      }
      case 'media.unhide': {
        if(!rawMedia(this.db,command.id))throw new Error('媒体不存在');
        unhideMedia(this.db,command.id,command.tagIds);this.notify();return {ok:true,taskId:await this.flushWindowsSync(),remaining:hiddenReasons(this.db,[command.id])};
      }
      case 'media.removeFromIndex': removeMediaFromIndex(this.db, command.id); return { ok: true };
      case 'media.stats': return getMediaStats(this.db);
      case 'media.filteredStats': return searchMediaStats(this.db,command.query,command);
      case 'media.playlist': {
        const source=command.source;
        return source.scope==='album' ? searchMediaIds(this.db,source.query,{...source,albumId:source.id,sortBy:source.sortBy??'capturedAt'}) : source.scope==='tag' ? searchMediaIds(this.db,source.query,{...source,tagId:source.id}) : searchMediaIds(this.db,source.query,source);
      }
      case 'media.playbackItems': return command.mediaIds.map((id)=>getMediaById(this.db,id,Boolean(command.includeHidden))).filter((item)=>item && (command.includeHidden || !item.hidden));
      case 'albums.list': return listAlbums(this.db).map((album) => { const cover = reconcileCover(this.db, album.id); return { ...getAlbum(this.db,album.id)!, kind: album.isFolder?'folder':albumRule(this.db, album.id) ? 'smart' : 'ordinary', rule: albumRule(this.db, album.id), cover, ...albumSummary(this.db,album.id), tagIds: (this.db.prepare('SELECT tag_id AS id FROM album_tags WHERE album_id=?').all(album.id) as { id: string }[]).map((tag) => tag.id) }; });
      case 'albums.create': return createAlbum(this.db, command.name, command.description);
      case 'albums.update': updateAlbum(this.db, command.id, command); return getAlbum(this.db, command.id);
      case 'albums.delete': deleteAlbum(this.db, command.id); return { ok: true };
      case 'albums.filteredStats': return searchMediaStats(this.db,command.query,{...command,albumId:command.id});
      case 'tags.filteredStats': return searchMediaStats(this.db,command.query,{...command,tagId:command.id});
      case 'albums.media': return listAlbumMedia(this.db, command.id, command);
      case 'albums.addMedia': return { added: addMediaToAlbum(this.db, command.id, command.mediaIds) };
      case 'albums.removeMedia': {const result=removeAlbumItems(this.db,command.id,command.mediaIds);this.notify();return result;}
      case 'albums.setCover': setAlbumCover(this.db, command.id, command.mediaId); return getAlbum(this.db, command.id);
      case 'media.setTags': setMediaTags(this.db, command.id, command.tagNames);this.notify(); return { ok: true };
      case 'media.tags': return listMediaTags(this.db, command.id);
      case 'media.addTag': addTagToMedia(this.db, command.id, command.tagName);this.notify(); return { ok: true };
      case 'media.removeTag': removeTagFromMedia(this.db, command.id, command.tagName);this.notify(); return { ok: true };
      case 'media.thumbnail': {
        if (!this.thumbnailCacheRoot) throw new Error('缩略图缓存目录未设置');
        const media=this.thumbnailMedia(command.id),key=this.thumbnailKey(command.id);
        const existing=this.thumbnailLookups.get(key);if(existing)return existing;
        const failure=this.thumbnailFailures.get(key);if(!command.retry&&failure&&Date.now()-failure.at<30000)throw failure.error;
        this.thumbnailFailures.delete(key);
        // Lock before the first asynchronous disk check, across every UI size.
        const work=(async()=>{
          const cached=await getCachedThumbnail(media,this.thumbnailCacheRoot!,{onPruned:file=>forgetCache(this.db,file),isCurrent:()=>this.thumbnailMediaExists(media)});
          if(!this.thumbnailMediaExists(media))throw new Error('媒体已移除或更新，请刷新后重试');
          if(cached)return {taskId:null,cached:true,...cached};
          const running=this.thumbnailRequests.get(key);if(running)return running;
          const taskId=this.enqueueThumbnail(media);return this.runThumbnail(command.id,undefined,undefined,taskId);
        })();this.thumbnailLookups.set(key,work);
        try{return await work;}catch(error){this.thumbnailFailures.set(key,{at:Date.now(),error});if(this.thumbnailFailures.size>512)this.thumbnailFailures.delete(this.thumbnailFailures.keys().next().value!);throw error;}finally{if(this.thumbnailLookups.get(key)===work)this.thumbnailLookups.delete(key);}
      }
      case 'media.filePath': {
        const media = this.thumbnailMedia(command.id);
        if (!media) throw new Error(`Media not found: ${command.id}`);
        return { absolutePath: media.absolutePath, kind: media.kind,contentType:media.kind==='photo'?({gif:'image/gif',png:'image/png',webp:'image/webp',jpeg:'image/jpeg',avif:'image/avif'} as Record<string,string>)[media.metadata?.format??'']:undefined };
      }
      case 'tags.list': return tagDetails(this.db);
      case 'tags.create': return this.db.transaction(()=>{
        const existing=findTag(this.db,command.name);const parents=command.parentIds??(command.parentId?[command.parentId]:[]);
        if(existing && !parents.length)throw new Error('标签名称已存在');
        const id=createTag(this.db,command.name);for(const parent of parents)addTagReference(this.db,id,parent);
        if(!existing && command.englishName!==undefined)this.db.prepare('UPDATE tags SET english_name=? WHERE id=?').run(command.englishName,id);
        reconcileAllCovers(this.db);refreshMediaStats(this.db);this.notify();return {id,name:command.name,reused:Boolean(existing)};
      })();
      case 'tags.rename': renameTag(this.db, command.id, command.name); return { ok: true };
      case 'tags.delete': {
        if(command.mode==='reference'){if(command.parentId===undefined)throw new Error('请选择要删除的父标签引用');removeTagReference(this.db,command.id,command.parentId);reconcileAllCovers(this.db);}else deleteTag(this.db,command.id,command.deleteChildren);
        refreshMediaStats(this.db);this.notify();return {ok:true};
      }
      case 'tags.media': return listTagMedia(this.db, command.id, command);
      case 'tasks.list': return listTasks(this.db, command.limit);
      case 'tasks.retryThumbnail': {
        const task = this.db.prepare("SELECT kind, payload_json as payloadJson FROM tasks WHERE id=?").get(command.id) as { kind: string; payloadJson: string | null } | undefined;
        if (!task || task.kind !== 'thumbnail' || !task.payloadJson) throw new Error(`Thumbnail task not found: ${command.id}`);
        const payload=JSON.parse(task.payloadJson) as {batch?:boolean;mediaId?:string;width?:number;height?:number};
        let targets=this.db.prepare("SELECT media_id AS id FROM job_items WHERE task_id=? AND status<>'completed' ORDER BY ordinal").all(command.id) as {id:string}[];
        if(!targets.length){const completed=this.db.prepare('SELECT media_id AS id FROM job_items WHERE task_id=? ORDER BY ordinal').all(command.id) as {id:string}[];if(completed.length){this.db.prepare("UPDATE tasks SET status='completed',error_code=NULL,error_message=NULL WHERE id=?").run(command.id);let cached=null;if(completed.length===1 && this.thumbnailCacheRoot){try{cached=await getCachedThumbnail(this.thumbnailMedia(completed[0]!.id),this.thumbnailCacheRoot,{width:payload.width,height:payload.height});}catch{/* A completed historical task may outlive its media. */}}return {taskId:command.id,mediaIds:[],cached:true,...cached};}}
        if(!targets.length && payload.mediaId){const media=this.thumbnailMedia(payload.mediaId);this.db.prepare('INSERT OR IGNORE INTO job_items(task_id,media_id,file_path,size_bytes,fingerprint,ordinal) VALUES(?,?,?,?,?,1)').run(command.id,media.id,media.absolutePath,media.sizeBytes,media.fingerprint);targets=[{id:media.id}];}
        if(!targets.length)throw new Error('旧任务缺少媒体明细，无法恢复');
        this.db.prepare("UPDATE tasks SET status='running' WHERE id=?").run(command.id);
        const reset=this.db.prepare("UPDATE job_items SET status='pending',error=NULL WHERE task_id=? AND media_id=?");for(const target of targets)reset.run(command.id,target.id);this.updateThumbnailBatch(command.id);
        const promises=targets.map((target)=>this.runThumbnail(target.id,payload.width,payload.height,command.id));if(promises.length===1)return {...await promises[0],mediaIds:targets.map(target=>target.id)};void Promise.allSettled(promises);return {taskId:command.id,queued:true,mediaIds:targets.map(target=>target.id)};
      }
      default: return command satisfies never;
    }
  }
}

export { createTag, deleteTag };
