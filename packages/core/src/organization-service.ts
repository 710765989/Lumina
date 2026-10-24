import {CompatibilityVideos} from './compatibility-video.js';
import {HoverVideoPreviews} from './hover-video.js';
import {saveAlbumFolder,removeAlbumItems,undoAlbumRemoval} from '@lumina/storage';
import {changeTagVisibility,tagHiddenSql} from '@lumina/storage';
import {taskPage} from '@lumina/storage';
import {MediaCacheCleanup,registerMediaCache} from './media-cache-cleanup.js';
import path from 'node:path';
import { stat, access, mkdir, rename, unlink, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { OrganizationCommand } from '@lumina/contracts';
import { matchesSearch } from '@lumina/contracts';
import {searchMedia,searchMediaStats,searchMediaIds,mediaTimeline,mediaSortValue,mediaOrder} from '@lumina/storage';
import { albumRule, albumMembers, rawMedia, mediaColumns, visibleSql, readMediaRows, rulePreview, ruleMembers, saveSmartAlbum, saveOrdinaryAlbum, mergePreview, mergeTags, tagDetails, settings, saveSettings, logOrganization, reconcileAllCovers, reconcileCover, updateMetadata, listMediaTags, refreshMediaStats, type LuminaDatabase } from '@lumina/storage';
import { RecycleBin } from './recycle-bin.js';
import { OrganizationJobs } from './organization-jobs.js';
import {StorageCacheManager} from './storage-cache.js';
import { extractMetadata,needsGeographicOrganization } from './geography.js';
import {geographyCleanupPreview,geographyCleanupSummary,cleanupGeographicCollections} from './geography-cleanup.js';
import { scanDirectory, scanIsActive } from './index.js';
import { runFfmpeg } from './thumbnail.js';
import { albumCandidates } from '@lumina/storage';
import { similarGroups } from './similarity.js';
import { duplicateGroups, duplicateCleanup, validateDuplicateCleanup, similarCleanup, validateSimilarCleanup } from './duplicates.js';
import { reparentTag, setTagParents, moveTagReference, renameTag, tagDeletionPreview, tagFamilySql, tagHierarchy } from '@lumina/storage';

export class OrganizationService {
  readonly recycle: RecycleBin;
  readonly storage:StorageCacheManager;
  readonly cacheCleanup:MediaCacheCleanup;
  readonly jobs: OrganizationJobs;
  readonly hoverVideo=new HoverVideoPreviews();
  private cleanupAbort?:AbortController;
  private async validateWithAbort(action:(signal:AbortSignal)=>Promise<unknown>){const abort=new AbortController();this.cleanupAbort=abort;try{return await action(abort.signal);}finally{if(this.cleanupAbort===abort)this.cleanupAbort=undefined;}}
  readonly compatibility:CompatibilityVideos;
  private previews = new Map<string, Promise<{ cachePath: string }>>();
  private previewActive=0;private previewWaiters:Array<()=>void>=[];
  private async previewSlot(){if(this.previewActive<2){this.previewActive++;return;}await new Promise<void>(resolve=>this.previewWaiters.push(resolve));}
  private releasePreviewSlot(){const next=this.previewWaiters.shift();if(next)next();else this.previewActive--;}

  isTaskActive(id:string){return this.jobs.isActive(id) || this.compatibility.isActive(id) || this.storage.isActive(id);}
  constructor(private db: LuminaDatabase, private cacheRoot?: string, private notify: () => void = () => {}, systemTrash?: (file: string) => Promise<void>,private visibilityAction?:(id:string,hidden:boolean,tagIds?:string[],syncOnly?:boolean,signal?:AbortSignal)=>Promise<unknown>,thumbnailBusy:(id:string)=>boolean=()=>false) {
    this.compatibility=new CompatibilityVideos(db,id=>this.filePath(id),notify);
    this.storage=new StorageCacheManager(db,cacheRoot,notify,file=>{const thumb=/^(.+)-[a-f0-9]{16}\.jpg$/u.exec(file.name);return Boolean(thumb&&thumbnailBusy(thumb[1]!)) || file.name.startsWith('preview-')&&this.previews.has(file.name.slice(8,-4)) || this.compatibility.busy(file.name);});
    this.cacheCleanup=new MediaCacheCleanup(db,cacheRoot);
    this.recycle = new RecycleBin(db, systemTrash,media=>this.cacheCleanup.enqueue(media)); this.jobs = new OrganizationJobs(db, notify,async(id,options,signal)=>{
      const outcomes=await this.recycle.batch([id],async()=>{if(options.kind==='delete'){if(options.deleteMode==='software')await this.recycle.put(id,signal);else await this.recycle.purge(id,options.deleteMode,signal);}else if(options.kind==='restore')await this.recycle.restore(id,options.directory,signal);else if(options.kind==='purge')await this.recycle.purge(id,'permanent',signal);else {if(!this.visibilityAction)throw new Error('隐藏操作未配置');signal.throwIfAborted();await this.visibilityAction(id,options.hidden,options.unhideTags?.[id],options.syncOnly,signal);}},false);
      if(!outcomes[0]?.ok)throw new Error(outcomes[0]?.error??'文件处理失败');
    });
  }
  setCacheRoot(root:string){this.cacheRoot=root;this.storage.setRoot(root);this.cacheCleanup.setRoot(root);}
  async handle(command: OrganizationCommand): Promise<unknown> {
    switch (command.type) {
      case 'smart.preview': return rulePreview(this.db, command.id, command.rule);
      case 'smart.save': { const saved = saveSmartAlbum(this.db, command); this.notify(); return saved; }
      case 'albums.folder': {const result=saveAlbumFolder(this.db,command);this.notify();return result;}
      case 'albums.undoRemoval': {const result=undoAlbumRemoval(this.db,command.token);this.notify();return result;}
      case 'smart.exclude': {if(!albumRule(this.db,command.id))throw new Error('智能相册不存在');const result=removeAlbumItems(this.db,command.id,command.mediaIds);this.notify();return result;}
      case 'smart.excluded': {
        const rule=albumRule(this.db,command.id);if(!rule)throw new Error('智能相册不存在');const visible=this.db.prepare(`SELECT 1 FROM media m WHERE m.id=? AND ${visibleSql()}`);
        return {total:rule.excludedMediaIds.length,items:rule.excludedMediaIds.slice(command.offset,command.offset+command.limit).map((id)=>({id,media:rawMedia(this.db,id)??null,available:Boolean(visible.get(id))}))};
      }
      case 'smart.restoreExcluded': {
        const rule=albumRule(this.db,command.id);if(!rule)throw new Error('智能相册不存在');const ids=new Set(command.mediaIds);const before=rule.excludedMediaIds.length;
        rule.excludedMediaIds=command.all?[]:rule.excludedMediaIds.filter((id)=>!ids.has(id));this.db.prepare('UPDATE smart_albums SET rule_json=? WHERE album_id=?').run(JSON.stringify(rule),command.id);reconcileCover(this.db,command.id);this.notify();return {restored:before-rule.excludedMediaIds.length,remaining:rule.excludedMediaIds.length};
      }
      case 'albums.cover': return reconcileCover(this.db, command.id);
      case 'albums.defaultCover': return (command.rule ? ruleMembers(this.db,command.rule,1,0,true) : albumMembers(this.db,command.id,1,0,true))[0] ?? null;
      case 'albums.edit': { const result = saveOrdinaryAlbum(this.db,command); this.notify(); return result; }
      case 'albums.candidates': {
        return albumCandidates(this.db,command.id,command.query,command.limit,command.offset,command.rule);
      }
      case 'tags.options': {
        if (!this.db.prepare('SELECT id FROM tags WHERE id=?').get(command.id)) throw new Error('标签不存在');
        const aliases = [...new Set(command.aliases.map((alias) => alias.trim()).filter(Boolean))];
        const all = tagDetails(this.db);
        if (aliases.some((alias) => all.some((tag) => tag.id !== command.id && (tag.name.toLocaleLowerCase() === alias.toLocaleLowerCase() || tag.aliases.some((name: string) => name.toLocaleLowerCase() === alias.toLocaleLowerCase()))))) throw new Error('别名与其他标签或别名重复');
        changeTagVisibility(this.db,command.id,()=>{this.db.prepare(`INSERT INTO tag_options(tag_id,color,group_name,aliases_json,blocked) VALUES(?,?,?,?,?)
          ON CONFLICT(tag_id) DO UPDATE SET color=excluded.color,group_name=excluded.group_name,aliases_json=excluded.aliases_json,blocked=excluded.blocked`).run(command.id, command.color, command.group, JSON.stringify(aliases), command.blocked ? 1 : 0);
        if(!command.blocked)this.db.prepare('DELETE FROM tag_visibility_exceptions WHERE tag_id=?').run(command.id);
        });this.notify();return {ok:true};
      }
      case 'tags.visibilityPreview': {
        const tag=tagDetails(this.db).find((tag)=>tag.id===command.id);if(!tag)throw new Error('标签不存在');
        const total=(this.db.prepare(`SELECT COUNT(DISTINCT m.id) AS count FROM media m JOIN media_tags mt ON mt.media_id=m.id JOIN (${tagFamilySql}) family ON family.id=mt.tag_id WHERE family.ancestor=? AND ${visibleSql('m',true)}`).get(command.id) as {count:number}).count;
        const visible=(this.db.prepare(`SELECT COUNT(DISTINCT m.id) AS count FROM media m JOIN media_tags mt ON mt.media_id=m.id JOIN (${tagFamilySql}) family ON family.id=mt.tag_id WHERE family.ancestor=? AND ${visibleSql()}`).get(command.id) as {count:number}).count;
        return {name:tag.name,total,visible,hidden:tag.blocked};
      }
      case 'tags.setHidden': {
        if(!this.db.prepare('SELECT 1 FROM tags WHERE id=?').get(command.id))throw new Error('标签不存在');
        changeTagVisibility(this.db,command.id,()=>{this.db.prepare(`INSERT INTO tag_options(tag_id,blocked) VALUES(?,?) ON CONFLICT(tag_id) DO UPDATE SET blocked=excluded.blocked`).run(command.id,command.hidden?1:0);
        if(!command.hidden)this.db.prepare('DELETE FROM tag_visibility_exceptions WHERE tag_id=?').run(command.id);
        });this.notify();return {ok:true};
      }
      case 'media.nameSuggestions': {
        if (command.searchLanguage!=='en' && (command.searchLanguage==='ja' || /^[a-z]+$/iu.test(command.query))) {
          const names = this.db.prepare(`SELECT COALESCE(NULLIF(m.file_name,''),m.absolute_path) AS name,COUNT(*) AS count FROM media m WHERE ${visibleSql()} GROUP BY name COLLATE NOCASE ORDER BY name COLLATE NOCASE`).all() as {name:string;count:number}[];
          return names.filter((row)=>matchesSearch(row.name,command.query,command.searchLanguage)).sort((a,b)=>Number(b.name.toLowerCase()===command.query.toLowerCase())-Number(a.name.toLowerCase()===command.query.toLowerCase()) || Number(b.name.toLowerCase().startsWith(command.query.toLowerCase()))-Number(a.name.toLowerCase().startsWith(command.query.toLowerCase()))).slice(0,command.limit);
        }
        const like=`%${command.query.replace(/[\\%_]/gu,'\\$&')}%`;
        return this.db.prepare(`SELECT COALESCE(NULLIF(m.file_name,''),m.absolute_path) AS name,COUNT(*) AS count FROM media m WHERE ${visibleSql()}
          AND COALESCE(NULLIF(m.file_name,''),m.absolute_path) LIKE ? ESCAPE '\\'
          GROUP BY name COLLATE NOCASE ORDER BY (name=? COLLATE NOCASE) DESC,(name LIKE ? ESCAPE '\\') DESC,name COLLATE NOCASE LIMIT ?`).all(like,command.query,`${command.query.replace(/[\\%_]/gu,'\\$&')}%`,command.limit);
      }
      case 'tags.mergePreview': return mergePreview(this.db, command.sourceId, command.targetId);
      case 'tags.searchPreferences': {
        const preference=this.db.prepare("SELECT value_json FROM settings WHERE key='tag-search-order'").get() as {value_json:string}|undefined;
        const recent=this.db.prepare("SELECT value_json FROM settings WHERE key='recent-tags'").get() as {value_json:string}|undefined;
        return {order:preference?JSON.parse(preference.value_json):'recent',recentIds:recent?JSON.parse(recent.value_json):[]};
      }
      case 'tags.configureSearch': this.db.prepare("INSERT INTO settings(key,value_json) VALUES('tag-search-order',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").run(JSON.stringify(command.order));this.notify();return {ok:true};
      case 'tags.recent': {
        const row=this.db.prepare("SELECT value_json FROM settings WHERE key='recent-tags'").get() as {value_json:string}|undefined;
        const recent:string[]=row?JSON.parse(row.value_json):[];const all=tagDetails(this.db).filter(tag=>!tag.directory);const byId=new Map(all.map((tag)=>[tag.id,tag]));
        const selected=recent.flatMap((id)=>byId.has(id)?[byId.get(id)!]:[]).slice(0,10);if(selected.length>=10)return selected;
        const used=this.db.prepare('SELECT 1 FROM media_tags WHERE tag_id=? LIMIT 1');return [...selected,...all.filter((tag)=>!recent.includes(tag.id) && used.get(tag.id))].slice(0,10);
      }
      case 'tags.edit': return this.db.transaction(()=>{const locked=this.db.prepare('SELECT 1 FROM directory_rules WHERE tag_id=?').get(command.id);if(locked && (command.parentIds!==undefined || command.parentId!==undefined)){const current=tagHierarchy(this.db).find(row=>row.id===command.id)?.parentIds??[];const next=command.parentIds??(command.parentId?[command.parentId]:[]);if(JSON.stringify([...current].sort())!==JSON.stringify([...next].sort()))throw new Error('目录标签的层级由目录规则管理，请在目录设置中修改');}renameTag(this.db,command.id,command.name);if(command.englishName!==undefined)this.db.prepare('UPDATE tags SET english_name=? WHERE id=?').run(command.englishName,command.id);if(command.parentIds!==undefined)setTagParents(this.db,command.id,command.parentIds);else if(command.parentId!==undefined)reparentTag(this.db,command.id,command.parentId);reconcileAllCovers(this.db);refreshMediaStats(this.db);this.notify();return {ok:true};})();
      case 'tags.moveReference': return this.db.transaction(()=>{moveTagReference(this.db,command.id,command.fromParentId,command.parentId,command.copy);reconcileAllCovers(this.db);refreshMediaStats(this.db);this.notify();return {ok:true};})();
      case 'tags.deletePreview': return tagDeletionPreview(this.db,command.id);
      case 'tasks.activity': return {active:(this.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status IN('running','queued')").get() as {count:number}).count};
      case 'tasks.page': return taskPage(this.db,command.limit,command.offset,command.filter);
      case 'tags.merge': { const result = mergeTags(this.db, command.sourceId, command.targetId, command.revision); refreshMediaStats(this.db); this.notify(); return result; }
      case 'hidden.list': return readMediaRows(this.db.prepare(`SELECT ${mediaColumns} FROM media m WHERE ${visibleSql('m', true)}
        AND (EXISTS(SELECT 1 FROM hidden_media h WHERE h.media_id=m.id) OR ${tagHiddenSql()}) ORDER BY m.modified_at_ms DESC,m.id LIMIT ? OFFSET ?`).all(command.limit, command.offset));
      case 'media.details': {
        const media = rawMedia(this.db, command.id); if (!media) throw new Error('媒体不存在');
        let detail = media.metadata;
        if (media.kind === 'photo' && !detail.width) {
          try { const extracted = await extractMetadata(this.filePath(command.id)); updateMetadata(this.db, media.id, extracted); detail = { ...detail, ...extracted }; } catch { /* Offline media retains saved metadata. */ }
        }
        return { ...media, metadata: detail, tags: listMediaTags(this.db, command.id), albums: this.db.prepare('SELECT a.id,a.name FROM albums a JOIN album_media am ON am.album_id=a.id WHERE am.media_id=?').all(command.id) };
      }
      case 'media.animation': {
        const media=rawMedia(this.db,command.id);if(!media || media.kind!=='photo')return {animated:false};
        if(media.metadata.animationVersion===3)return {animated:media.metadata.animated,format:media.metadata.format,frames:media.metadata.frames,width:media.metadata.width,height:media.metadata.height};
        const bytes=await readFile(this.filePath(command.id));const metadata=await sharp(bytes,{failOn:'none'}).metadata();let frames=metadata.pages??1;
        if(metadata.format==='png' && bytes.subarray(1,4).toString()==='PNG')for(let offset=8;offset+12<=bytes.length;){const length=bytes.readUInt32BE(offset);if(offset+length+12>bytes.length)break;if(bytes.toString('ascii',offset+4,offset+8)==='acTL' && length>=8){frames=bytes.readUInt32BE(offset+8);break;}offset+=length+12;}
        const result={animated:frames>1 && ['gif','webp','png'].includes(metadata.format??''),format:metadata.format,frames,width:metadata.width,height:metadata.pageHeight??metadata.height};updateMetadata(this.db,command.id,{...result,animationVersion:3});return result;
      }
      case 'media.tagSummary': {
        const ids=[...new Set(command.mediaIds)];
        return this.db.prepare(`SELECT t.id,t.name,t.english_name AS englishName,COUNT(DISTINCT mt.media_id) AS count FROM tags t JOIN media_tags mt ON mt.tag_id=t.id WHERE mt.media_id IN (${ids.map(()=>'?').join(',')}) GROUP BY t.id ORDER BY t.name`).all(...ids);
      }
      case 'media.delivery': {
        const media = [...new Set(command.mediaIds)].map((id) => {
          const row = this.db.prepare(`SELECT m.id FROM media m WHERE m.id=? AND ${visibleSql('m',command.includeHidden)}`).get(id);
          if (!row) throw new Error('媒体已隐藏、停用或删除，请刷新后重试');
          return rawMedia(this.db, id)!;
        });
        for (const item of media) {
          try {if(!(await stat(item.absolutePath)).isFile())throw new Error('非文件');await access(item.absolutePath,constants.R_OK);}
          catch {throw new Error(`无法读取“${path.basename(item.absolutePath)}”，请确认原文件和所在目录可用`);}
        }
        return media.map((item) => ({ id: item.id, kind: item.kind, absolutePath: item.absolutePath }));
      }
      case 'media.previewPath': {
        const media=rawMedia(this.db,command.id);if(!media||media.kind!=='photo'||!this.cacheRoot)throw new Error('无法生成照片预览');
        // Small originals already fit the screen preview; full view reuses it.
        const width=Number(media.metadata.width),height=Number(media.metadata.height);
        const fullSize=command.fullSize&&!(width>0&&height>0&&Math.max(width,height)<=4096);
        const key=createHash('sha256').update(`${media.id}:${media.fingerprint}:preview-v1:${fullSize?'full':'screen'}`).digest('hex');
        const root=this.cacheRoot,target=path.join(root,`preview-${key}.png`);
        const valid=()=>this.db.open&&rawMedia(this.db,media.id)?.fingerprint===media.fingerprint;
        registerMediaCache(this.db,media.id,target);
        const pending=this.previews.get(key);if(pending)return pending;
        // Register the request before stat/unlink/mkdir, not after them.
        const request=(async()=>{
          if(!command.regenerate)try{const info=await stat(target);if(info.isFile()&&info.size>0&&valid())return {cachePath:target};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
          await this.previewSlot();const temporary=`${target}.${randomUUID()}.tmp`;
          try{
            if(!valid())throw new Error('媒体已移除或更新，未生成过期预览');
            await mkdir(root,{recursive:true});
            // Recheck after the queue in case a completed producer populated it.
            try{
              const info=await stat(target);
              if(info.isFile()&&info.size>0){
                // Retry/refresh validates an existing preview instead of blindly
                // discarding a complete file. Corrupt output is atomically replaced.
                if(command.regenerate)await sharp(target,{failOn:'warning'}).stats();
                if(!valid())throw new Error('媒体已移除或更新，未读取过期预览');
                return {cachePath:target};
              }
            }catch(error){if(['EACCES','EPERM','EBUSY'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
            let pipeline=sharp(this.filePath(media.id)).rotate();if(!fullSize)pipeline=pipeline.resize({width:4096,height:4096,fit:'inside',withoutEnlargement:true});
            await pipeline.toColourspace('srgb').png().toFile(temporary);
            if(!valid())throw new Error('媒体已移除或更新，未保留过期预览');
            await rename(temporary,target);
            if(!valid()){await unlink(target).catch(()=>{});throw new Error('媒体已移除或更新，未保留过期预览');}
            return {cachePath:target};
          }finally{try{await unlink(temporary).catch(()=>{});}finally{this.releasePreviewSlot();}}
        })();this.previews.set(key,request);
        try{return await request;}finally{if(this.previews.get(key)===request)this.previews.delete(key);}
      }
      case 'media.cancelHover': this.hoverVideo.cancel(command.session);return {ok:true};
      case 'media.hoverPreview': {
        const media=rawMedia(this.db,command.id);if(!media||media.kind!=='video'||!this.cacheRoot)throw new Error('视频不可用');
        const result=await this.hoverVideo.prepare(media,this.filePath(media.id),this.cacheRoot,command.session,()=>this.db.open&&rawMedia(this.db,media.id)?.fingerprint===media.fingerprint);
        registerMediaCache(this.db,media.id,result.cachePath);return result;
      }
      case 'media.pauseCompatibility': return this.compatibility.pause(command.id,command.session);
      case 'media.compatibilityPath': {
        if(!this.cacheRoot)throw new Error('视频缓存目录不可用');return this.compatibility.prepare(command.id,this.cacheRoot,command.session);
      }
      case 'media.attributes': {
        const { type: _, id, ...attributes } = command;
        const media = rawMedia(this.db,id); if (!media) throw new Error('媒体不存在');
        const locationChanged = (['country','region','city'] as const).some((key) => attributes[key] !== undefined && attributes[key] !== (media.metadata[key] ?? ''));
        updateMetadata(this.db, id, { ...attributes, ...(locationChanged ? { placeSource: 'user' } : {}) });
        this.notify(); return { ok: true };
      }
      case 'trash.list': return this.recycle.list(command.limit, command.offset,command.sortBy,command.sort);
      case 'trash.stats': return this.recycle.stats();
      case 'trash.ids': return this.recycle.ids(command);
      case 'trash.timeline':return this.recycle.timeline(command.capturedTime);
      case 'trash.cancel': this.recycle.cancel();this.cleanupAbort?.abort(); return { ok: true };
      case 'trash.preview': return this.recycle.preview(command.mediaIds);
      case 'trash.put': { const result = await this.recycle.batch(command.mediaIds, (id) => this.recycle.put(id)); this.notify(); return result; }
      case 'trash.restore': { const result = await this.recycle.batch(command.mediaIds, (id) => this.recycle.restore(id, command.directory)); this.notify(); return result; }
      case 'trash.purge': { const result = await this.recycle.batch(command.mediaIds, (id) => this.recycle.purge(id, command.destination)); this.notify(); return result; }
      case 'trash.expired': { const result = await this.recycle.expired(command.protectedIds); if (result.some((item)=>item.ok)) this.notify(); return result; }
      case 'organization.settings': return settings(this.db);
      case 'organization.configure': { const { type: _, ...value } = command; saveSettings(this.db, value); this.notify(); return value; }
      case 'jobs.start': {
        if(command.kind==='delete' && command.cleanup){const cleanup=command.cleanup;const plan=cleanup.kind==='duplicates'?duplicateCleanup(this.db,cleanup.keepIds,cleanup.hash,cleanup.removeIds):await similarCleanup(this.db,cleanup.level,cleanup.keepLargest,cleanup.removeIds);
          const actual=new Set(plan.mediaIds);if(plan.revision!==cleanup.revision || command.mediaIds?.length!==actual.size || command.mediaIds.some((id)=>!actual.has(id)))throw new Error('删除计划已变化，请重新预览');
          if(plan.emptyGroups && !cleanup.allowDeleteAll)throw new Error('包含整组删除，请先确认这些组将不保留任何文件');
          return this.jobs.start(command,{keepers:plan.groups.flatMap(group=>group.keep?[{keep:group.keep,removeIds:group.remove.map(row=>row.id)}]:[])});}
        return this.jobs.start(command);
      }
      case 'jobs.control': {
        const task = this.db.prepare('SELECT kind,payload_json AS payload FROM tasks WHERE id=?').get(command.id) as { kind: string; payload: string } | undefined;
        if(task?.kind==='cache-cleanup')return this.storage.control(command.id,command.action);
        if(task?.kind==='video-preview') {
          const payload=JSON.parse(task.payload);
          if(['pause','cancel'].includes(command.action)){
            this.compatibility.pause(payload.mediaId,undefined,command.action==='cancel'?'cancelled':'paused');
            this.db.prepare('UPDATE tasks SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(command.action==='cancel'?'cancelled':'paused',command.id);this.notify();return {ok:true};
          }
          if(!this.cacheRoot)throw new Error('视频缓存目录不可用');
          void this.compatibility.prepare(payload.mediaId,this.cacheRoot).catch(()=>{});return {ok:true};
        }
        if (task?.kind !== 'scan') return this.jobs.control(command.id, command.action);
        if (command.action === 'pause' || command.action === 'cancel') this.db.prepare('UPDATE tasks SET status=? WHERE id=?').run(command.action === 'pause' ? 'paused' : 'cancelled', command.id);
        else {
          const payload = JSON.parse(task.payload);
          if(typeof payload?.root!=='string')throw new Error('旧扫描任务没有目录信息，请在图库目录点击“重新扫描”');
          const root = this.db.prepare('SELECT id,enabled FROM library_roots WHERE absolute_path=?').get(payload.root) as {id:string;enabled:number}|undefined;
          if (!root || payload.rootId && payload.rootId !== root.id) throw new Error('图库目录已移除，不能恢复旧扫描任务；请在目录管理中重新添加');
          if (!root.enabled) throw new Error('图库目录已停用，请先启用目录再恢复扫描');
          const retryFiles=command.action==='retry' ? (this.db.prepare("SELECT file_path AS path FROM job_items WHERE task_id=? AND status='failed'").all(command.id) as {path:string}[]).map((row)=>row.path) : undefined;
          void scanDirectory(this.db, payload.root, { rootId: root.id, taskId: command.id, notify: this.notify, ...(retryFiles?.length ? {retryFiles} : {}) }).catch((error) => {this.db.prepare("UPDATE tasks SET status='failed',error_message=? WHERE id=? AND status NOT IN('paused','cancelled')").run(String(error), command.id);this.notify();});
        }
        this.notify(); return { ok: true };
      }
      case 'jobs.result': {
        const task=this.db.prepare('SELECT id,kind,status,processed,total,payload_json AS payloadJson,created_at AS createdAt,updated_at AS updatedAt FROM tasks WHERE id=?').get(command.id) as any;
        if(task?.kind!=='scan'){const result=this.jobs.result(command.id,command.limit,command.offset);return task?.kind==='cache-cleanup'?{...result,active:this.storage.isActive(command.id)}:task?.kind==='video-preview'?{...result,active:this.compatibility.isActive(command.id)}:result;}
        const failures=Number((this.db.prepare('SELECT COUNT(*) AS count FROM job_items WHERE task_id=?').get(command.id) as {count:number}).count);
        const items=this.db.prepare('SELECT media_id AS id,file_path AS path,size_bytes AS sizeBytes,status,error FROM job_items WHERE task_id=? ORDER BY ordinal LIMIT ? OFFSET ?').all(command.id,command.limit,command.offset);
        return {...task,items,detailTotal:failures,counts:{completed:Math.max(0,task.processed-failures),failed:failures,pending:task.total-task.processed},active:scanIsActive(this.db,JSON.parse(task.payloadJson).root)};
      }
      case 'duplicates.list': return duplicateGroups(this.db);
      case 'duplicates.cleanupPreview': return duplicateCleanup(this.db,command.keepIds,command.hash,command.removeIds);
      case 'duplicates.validateCleanup': return this.validateWithAbort((signal)=>validateDuplicateCleanup(this.db,command.keepIds,command.revision,command.hash,signal,command.removeIds,command.allowDeleteAll));
      case 'similar.list': return similarGroups(this.db,command.level);
      case 'similar.cleanupPreview': return similarCleanup(this.db,command.level,command.keepLargest,command.removeIds);
      case 'similar.validateCleanup': return this.validateWithAbort((signal)=>validateSimilarCleanup(this.db,command.level,command.keepLargest,command.revision,command.removeIds,signal,command.allowDeleteAll));
      case 'geo.places': {
        const rows = readMediaRows(this.db.prepare(`SELECT ${mediaColumns},${mediaSortValue(command.sortBy)} AS coverSortValue FROM media m WHERE ${visibleSql()} ORDER BY ${mediaOrder(command.sortBy,command.sort)}`).all());
        const located = rows.filter((item) => item.metadata.city);
        const coverHashes=new Map<string,ReturnType<typeof createHash>>();
        const places = new Map<string, { country: string; region: string; city: string; count: number; samples: typeof rows; years: Record<string, number> }>();
        for (const item of located) {
          const { country = '', region = '', city = '' } = item.metadata; const key = JSON.stringify([country, region, city]);
          const place: { country: string; region: string; city: string; count: number; samples: typeof rows; years: Record<string, number> } = places.get(key) ?? { country, region, city, count: 0, samples: [], years: {} };
          place.count++; if (place.samples.length < 12) place.samples.push(item);
          const hash=coverHashes.get(key)??createHash('sha256');hash.update(JSON.stringify([item.id,item.fingerprint,item.capturedAtMs??item.modifiedAtMs]));coverHashes.set(key,hash);
          const year = String(new Date(item.capturedAtMs ?? item.modifiedAtMs).getFullYear()); place.years[year] = (place.years[year] ?? 0) + 1;
          places.set(key, place);
        }
        return { places: [...places.entries()].map(([key,value])=>({...value,coverRevision:coverHashes.get(key)!.digest('hex')})).sort((a, b) => b.count - a.count), countries: new Set(located.map((item) => item.metadata.country)).size, cities: places.size, noLocation: rows.filter((item) => !item.metadata.city && !Number.isFinite(item.metadata.latitude)).length, pendingLocation: rows.filter((item) => !item.metadata.city && Number.isFinite(item.metadata.latitude)).length,
          pendingOrganization:rows.filter(item=>item.kind==='photo'&&needsGeographicOrganization(item)).length,legacy:geographyCleanupSummary(this.db),
          runs: this.db.prepare("SELECT r.id,r.created_at AS createdAt,r.undone,(SELECT t.status FROM tasks t WHERE t.kind='geo' AND json_extract(t.payload_json,'$.geoRunId')=r.id LIMIT 1) AS status FROM geo_runs r ORDER BY r.created_at DESC LIMIT 10").all() };
      }
      case 'geo.coverCandidates':{
        const value=mediaSortValue(command.sortBy),cursor=command.cursor,comparison=command.sort==='asc'?'>':'<';
        const rows=readMediaRows(this.db.prepare(`SELECT ${mediaColumns},${value} AS coverSortValue FROM media m JOIN media_details gd ON gd.media_id=m.id WHERE ${visibleSql()} AND COALESCE(json_extract(gd.metadata_json,'$.country'),'')=? AND COALESCE(json_extract(gd.metadata_json,'$.region'),'')=? AND COALESCE(json_extract(gd.metadata_json,'$.city'),'')=? ${cursor?`AND (${value}${comparison}? OR (${value}=? AND m.id>?))`:''} ORDER BY ${mediaOrder(command.sortBy,command.sort)} LIMIT ?`).all(command.country,command.region,command.city,...(cursor?[cursor.value,cursor.value,cursor.id]:[]),command.limit+1));
        return {items:rows.slice(0,command.limit),hasMore:rows.length>command.limit};
      }
      case 'geo.cleanupPreview':return geographyCleanupPreview(this.db);
      case 'geo.cleanup':{const result=cleanupGeographicCollections(this.db,command.revision);this.notify();return result;}
      case 'geo.media':case 'geo.stats':case 'geo.ids':case 'geo.timeline': {
        const options={...command,place:{country:command.country,region:command.region,city:command.city,noLocation:command.noLocation}};
        if(command.type==='geo.stats')return searchMediaStats(this.db,command.query,options);
        if(command.type==='geo.ids')return searchMediaIds(this.db,command.query,options);
        if(command.type==='geo.timeline')return mediaTimeline(this.db,command.query,options);
        return searchMedia(this.db,command.query,options);
      }
      case 'geo.undo': { const result = this.jobs.undoGeo(command.id); this.notify(); return result; }
      case 'storage.revision': return this.storage.revision();
      case 'storage.report': return this.storage.report(command.refresh);
      case 'storage.cachePreview': return this.storage.preview(command);
      case 'storage.clearCache': return this.storage.start(command.token);
    }
  }
  filePath(id: string) {
    const media = rawMedia(this.db, id); if (!media) throw new Error('媒体不存在');
    const entry = this.db.prepare('SELECT stored_path,state FROM trash_entries WHERE media_id=?').get(id) as { stored_path: string; state: string } | undefined;
    return entry?.state === 'stored' ? entry.stored_path : media.absolutePath;
  }
}
