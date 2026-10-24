import path from 'node:path';
import { mkdir, stat, readFile, writeFile, copyFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import sharp from 'sharp';
import { settings,tagHiddenSql,rootMediaIds,rootContainsMedia,albumMembers, rawMedia, visibleSql, mediaColumns, readMediaRows, updateMetadata, type LuminaDatabase, type OrganizedMedia } from '@lumina/storage';
import type { OrganizationCommand } from '@lumina/contracts';
import { copyExclusive, hashFile } from './file-operations.js';
import { extractMetadata, nearbyPlace,geographicKey,hasGeographicMetadata,needsGeographicOrganization } from './geography.js';
import { runFfmpeg } from './thumbnail.js';
import { imageFeature, similarityAlgorithm } from './similarity.js';
import { addTagToMedia,removeTagFromMedia,refreshMediaStats,reconcileAllCovers,reconcileCover,tagHierarchy,findTag } from '@lumina/storage';

type Start = Extract<OrganizationCommand, { type: 'jobs.start' }>;
type Item = { fingerprint?:string;id: string; status: 'pending' | 'completed' | 'failed'; error?: string; output?: string; ordinal: number };
export type FileJobContext={windowsTargets?:Record<string,boolean>;keepers?:{keep:OrganizedMedia & {contentHash?:string|null};removeIds:string[]}[]};
type Payload = { options: Start; geoRunId?: string;context?:FileJobContext;info?:{snapshotVersion:number;tagPath?:string;rootPath?:string;scopeCount:number;selectedCount:number;superseded?:boolean} };
const fileKinds=['delete','restore','purge','visibility'];
const escapeXml = (value: string) => value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!);
export class OrganizationJobs {
  private active = new Set<string>();
  private interruptedSync=new Set<string>();
  suspendWindowsSync(){for(const id of this.active){const row=this.db.prepare("SELECT payload_json AS payload FROM tasks WHERE id=? AND kind='visibility'").get(id) as {payload:string}|undefined;if(row&&JSON.parse(row.payload).options?.syncOnly){this.interruptedSync.add(id);this.db.prepare("UPDATE tasks SET status='paused' WHERE id=? AND status IN('queued','running')").run(id);this.aborts.get(id)?.abort();}}}
  isActive(id:string){return this.active.has(id);}
  private aborts=new Map<string,AbortController>();private phases=new Map<string,{phase:string;currentPath:string}>();
  constructor(private db: LuminaDatabase, private notify: () => void = () => {},private fileAction?:(id:string,options:Start,signal:AbortSignal)=>Promise<void>) {}
  start(options: Start,context?:FileJobContext) {
    if(['duplicates','similar','geo'].includes(options.kind)){
      const scope=(value:Start)=>JSON.stringify([value.kind,value.albumId??null,value.includeHidden??false,value.mediaIds?[...new Set(value.mediaIds)].sort():null]);
      const key=scope(options);
      for(const id of this.active){const row=this.db.prepare('SELECT payload_json AS payload,status FROM tasks WHERE id=?').get(id) as {payload:string;status:string}|undefined;if(row&&['running','queued'].includes(row.status)){try{if(scope(JSON.parse(row.payload).options)===key)return {id};}catch{/* Ignore legacy tasks. */}}}
    }
    if(options.rootId && options.kind!=='tags')throw new Error('目录范围只适用于标签编辑');
    if(options.rootId){const allowed=new Set(rootMediaIds(this.db,options.rootId));if(options.mediaIds?.some(id=>!allowed.has(id)))throw new Error('媒体不在该目录的标签编辑范围内，请重新选择');}
    if(options.kind==='tags' && options.tagName){const canonical=findTag(this.db,options.tagName);if(canonical)options={...options,tagName:canonical.name};}
    if(fileKinds.includes(options.kind) && !options.mediaIds?.length)throw new Error('请选择要处理的媒体');
    if (options.kind === 'export' && !options.directory) throw new Error('请选择导出目录');
    if(options.kind==='tags' && (!options.tagName || !options.mediaIds?.length)) throw new Error('请选择媒体并填写标签名称');
    const inputCandidates = options.mediaIds ? options.mediaIds.map((id) => rawMedia(this.db, id)).filter((item): item is OrganizedMedia => !!item)
      : options.albumId ? albumMembers(this.db, options.albumId) : readMediaRows(this.db.prepare(`SELECT ${mediaColumns} FROM media m WHERE ${visibleSql()}`).all());
    const candidates=[...new Map(inputCandidates.map((item)=>[item.id,item])).values()];
    if(!fileKinds.includes(options.kind) && options.mediaIds && !options.rootId){
      const visible=this.db.prepare(`SELECT m.id FROM media m WHERE m.id=? AND ${visibleSql('m',Boolean(options.includeHidden)||options.kind==='tags')}`);
      if(candidates.some((item)=>!visible.get(item.id)))throw new Error('隐藏或已删除的媒体不能直接交付');
    }
    if(options.kind==='tags' && options.tagAction==='remove') {
      const owns=this.db.prepare('SELECT 1 FROM media_tags mt JOIN tags t ON t.id=mt.tag_id WHERE mt.media_id=? AND t.name=? COLLATE NOCASE');
      if(candidates.some((item)=>!owns.get(item.id,options.tagName))) throw new Error('只能批量移除所有选中媒体共有的标签');
    }
    let selected = candidates;
    if (options.kind === 'duplicates') {
      const counts = new Map<number, number>(); for (const item of candidates) counts.set(item.sizeBytes, (counts.get(item.sizeBytes) ?? 0) + 1);
      selected = candidates.filter((item) => counts.get(item.sizeBytes)! > 1);
    }
    if (options.kind === 'geo' || options.kind === 'similar') selected = candidates.filter((item) => item.kind === 'photo');
    if(options.kind==='geo')selected=selected.filter(item=>needsGeographicOrganization(item));
    const id = randomUUID();
    let tagPath:string|undefined;
    if(options.kind==='tags' && options.tagName){const canonical=findTag(this.db,options.tagName);tagPath=canonical?tagHierarchy(this.db).find((tag)=>tag.id===canonical.id)?.path:options.tagName;}
    const payload: Payload = {options,context,info:{snapshotVersion:1,tagPath,rootPath:options.rootId?(this.db.prepare('SELECT absolute_path AS path FROM library_roots WHERE id=?').get(options.rootId) as {path:string})?.path:undefined,scopeCount:candidates.length,selectedCount:selected.length}};
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO tasks(id,kind,status,total,payload_json) VALUES(?,?,'queued',?,?)").run(id, options.kind, selected.length, JSON.stringify(payload));
      const insert = this.db.prepare("INSERT OR IGNORE INTO job_items(task_id,media_id,file_path,ordinal,size_bytes,fingerprint) VALUES(?,?,?,?,?,?)");
      selected.forEach((item,index)=>insert.run(id,item.id,item.absolutePath,index+1,item.sizeBytes,item.fingerprint));
      if (payload.geoRunId) this.db.prepare("INSERT INTO geo_runs(id,changes_json) VALUES(?,'[]')").run(payload.geoRunId);
    })();
    void this.run(id); return { id };
  }
  result(id: string,limit = 200,offset = 0) {
    const row = this.db.prepare('SELECT id,kind,status,processed,total,payload_json AS payloadJson,error_message AS error,created_at AS createdAt,updated_at AS updatedAt FROM tasks WHERE id=?').get(id) as any;
    if (!row) throw new Error('任务不存在');
    let payload:Partial<Payload>={};try{payload=JSON.parse(row.payloadJson??'{}')??{};}catch{} const { payloadJson: _, ...task } = row;
    const items=(this.db.prepare('SELECT media_id AS id,file_path AS path,size_bytes AS sizeBytes,status,error,output FROM job_items WHERE task_id=? ORDER BY ordinal,media_id LIMIT ? OFFSET ?').all(id,limit,offset) as {id:string;path:string;sizeBytes:number;status:string;error:string|null;output:string|null}[]).map((item)=>({...item,fileName:item.path.split(/[\\/]/u).pop()??'',sizeRecorded:payload.info?.snapshotVersion===1 || item.sizeBytes>0}));
    const counts = Object.fromEntries((this.db.prepare('SELECT status,COUNT(*) AS count FROM job_items WHERE task_id=? GROUP BY status').all(id) as { status: string; count: number }[]).map((row) => [row.status,row.count]));
    const bytes=this.db.prepare("SELECT COALESCE(SUM(size_bytes),0) AS totalBytes,COALESCE(SUM(CASE WHEN status='completed' THEN size_bytes ELSE 0 END),0) AS completedBytes FROM job_items WHERE task_id=?").get(id) as {totalBytes:number;completedBytes:number};
    return { ...task,...bytes,...this.phases.get(id), items,detailTotal:Object.values(counts).reduce((sum,value)=>sum+Number(value),0), counts,info:payload.info, options: payload.options??{}, geoRunId: payload.geoRunId, active: this.active.has(id) };
  }
  control(id: string, action: 'pause' | 'resume' | 'cancel' | 'retry') {
    const row = this.db.prepare('SELECT kind,payload_json AS payloadJson,status FROM tasks WHERE id=?').get(id) as any;
    if (!row || !['duplicates', 'similar', 'geo', 'export', 'tags',...fileKinds].includes(row.kind)) throw new Error('此任务不支持该操作');
    if (action === 'pause' || action === 'cancel') {
      if(!['running','queued','paused'].includes(row.status))return {ok:true,status:row.status};
      const payload:Payload=JSON.parse(row.payloadJson);
      this.db.transaction(()=>{
        this.db.prepare('UPDATE tasks SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(action==='pause'?'paused':'cancelled',id);
        if(row.kind==='visibility'&&payload.options?.syncOnly){
          // The sync scheduler feeds batches of 1000. Stop the remaining backlog
          // as part of this operation instead of silently starting another batch.
          const ordinal=(this.db.prepare('SELECT COALESCE(MAX(ordinal),0) AS n FROM job_items WHERE task_id=?').get(id) as {n:number}).n;
          this.db.prepare(`INSERT OR IGNORE INTO job_items(task_id,media_id,file_path,size_bytes,fingerprint,ordinal)
            SELECT ?,m.id,m.absolute_path,m.size_bytes,m.fingerprint,?+ROW_NUMBER() OVER(ORDER BY m.id)
            FROM windows_visibility_queue q JOIN media m ON m.id=q.media_id`).run(id,ordinal);
          const desired=settings(this.db).syncHidden?`(EXISTS(SELECT 1 FROM hidden_media h WHERE h.media_id=m.id) OR ${tagHiddenSql()})`:'0';
          payload.context??={};payload.context.windowsTargets??={};
          for(const item of this.db.prepare(`SELECT m.id,(${desired}) AS hidden FROM windows_visibility_queue q JOIN media m ON m.id=q.media_id`).all() as {id:string;hidden:number}[])payload.context.windowsTargets[item.id]=Boolean(item.hidden);
          this.db.prepare('UPDATE tasks SET payload_json=? WHERE id=?').run(JSON.stringify(payload),id);
          this.db.prepare('DELETE FROM windows_visibility_queue').run();
          this.db.prepare('UPDATE tasks SET total=(SELECT COUNT(*) FROM job_items WHERE task_id=?) WHERE id=?').run(id,id);
        }
      })();
      this.aborts.get(id)?.abort();
    }
    else {
      if (this.active.has(id)) throw new Error('任务正在结束当前文件，请稍后恢复');
      const payload: Payload = JSON.parse(row.payloadJson);
      if(payload.info?.superseded)throw new Error('此任务已由后续隐藏操作接替，无需恢复');
      if (action === 'retry') this.db.prepare("UPDATE job_items SET status='pending',error=NULL WHERE task_id=? AND status='failed'").run(id);
      this.db.prepare("UPDATE tasks SET status='queued',error_message=NULL,processed=(SELECT COUNT(*) FROM job_items WHERE task_id=? AND status<>'pending') WHERE id=?").run(id, id);
      void this.run(id);
    }
    this.notify();return {ok:true,status:(this.db.prepare('SELECT status FROM tasks WHERE id=?').get(id) as {status:string}).status,active:this.active.has(id)};
  }
  // A later visibility operation replaces only the same files. Preserve the
  // earlier record, but never let its unfinished work replay the obsolete intent.
  async supersedeWindowsSync(targets:Record<string,boolean>):Promise<Record<string,boolean>>{
    const effective={...targets};
    if(!Object.keys(targets).length)return effective;
    const tasks=this.db.prepare("SELECT id,status,payload_json AS payload FROM tasks WHERE kind='visibility' AND status IN('running','queued','paused','failed')").all() as {id:string;status:string;payload:string}[];
    for(const task of tasks){
      const payload:Payload=JSON.parse(task.payload);if(!payload.options?.syncOnly)continue;
      const overlaps=(this.db.prepare('SELECT media_id AS id,status FROM job_items WHERE task_id=? AND media_id IN(SELECT key FROM json_each(?))').all(task.id,JSON.stringify(targets)) as {id:string;status:string}[]).filter(row=>targets[row.id] !== (payload.context?.windowsTargets?.[row.id]??payload.options.hidden));
      if(!overlaps.length)continue;
      const ids=JSON.stringify(overlaps.map(row=>row.id));
      for(const row of overlaps)if(row.status!=='completed')delete effective[row.id];
      this.db.transaction(()=>{
        this.db.prepare("UPDATE job_items SET status='cancelled',error='已由后续隐藏操作接替' WHERE task_id=? AND status IN('pending','failed')").run(task.id);
        this.db.prepare("UPDATE tasks SET status='cancelled',error_message=?,payload_json=json_set(payload_json,'$.info.superseded',json('true')),updated_at=CURRENT_TIMESTAMP WHERE id=?").run('已由后续隐藏操作接替；已完成的属性由后续任务处理',task.id);
      })();
      this.aborts.get(task.id)?.abort();
      while(this.active.has(task.id))await new Promise(resolve=>setTimeout(resolve,2));
      this.notify();
    }
    return effective;
  }
  private async run(id: string) {
    if (this.active.has(id)) return; this.active.add(id);
    const row = this.db.prepare('SELECT payload_json AS payloadJson FROM tasks WHERE id=?').get(id) as any;
    const payload: Payload = JSON.parse(row.payloadJson);
    this.db.prepare("UPDATE tasks SET status='running' WHERE id=?").run(id);const abort=new AbortController();this.aborts.set(id,abort);const keepers=new Map(payload.context?.keepers?.flatMap((group)=>group.removeIds.map((id)=>[id,group.keep] as const)));const verified=new Set<string>();let lastNotify=Date.now();let tagVisibilityChanged=false;
    try {
      while (true) {
        const item = this.db.prepare("SELECT media_id AS id,status,error,output,ordinal,fingerprint FROM job_items WHERE task_id=? AND status='pending' ORDER BY ordinal LIMIT 1").get(id) as Item | undefined;
        if (!item) break;
        const state = this.db.prepare('SELECT status FROM tasks WHERE id=?').get(id) as { status: string };
        if (state.status !== 'running') break;
        try {
          const media = rawMedia(this.db, item.id); if (!media) throw new Error('媒体已不在图库中');
          if(!fileKinds.includes(payload.options.kind)){if(payload.options.kind==='tags' && payload.options.rootId){if(!rootContainsMedia(this.db,payload.options.rootId,item.id))throw new Error('媒体已离开该目录或移入回收站');}else if(!this.db.prepare(`SELECT m.id FROM media m WHERE m.id=? AND ${visibleSql('m',Boolean(payload.options.includeHidden)||payload.options.kind==='tags')}`).get(item.id))throw new Error('媒体已隐藏或移入回收站');}
          if(fileKinds.includes(payload.options.kind)){
            if(item.fingerprint && item.fingerprint!==media.fingerprint)throw new Error('文件在排队期间已变化，未处理，请重新选择');
            const keep=keepers.get(item.id);this.phases.set(id,{phase:keep?'核验保留文件':'处理文件',currentPath:keep?.absolutePath??media.absolutePath});
            if(keep){const current=rawMedia(this.db,keep.id);const before=await stat(keep.absolutePath);if(!current || current.fingerprint!==keep.fingerprint || !before.isFile() || before.size!==keep.sizeBytes || Math.abs(before.mtimeMs-keep.modifiedAtMs)>1)throw new Error('拟保留的原文件已变化，未删除本组副本');
              if(!verified.has(keep.id)){const content=keep.contentHash??(this.db.prepare('SELECT content_hash AS hash FROM media_details WHERE media_id=? AND hash_fingerprint=?').get(keep.id,keep.fingerprint) as {hash:string}|undefined)?.hash;if(!content || await hashFile(keep.absolutePath,abort.signal)!==content)throw new Error('拟保留的文件内容已变化，未删除本组副本');verified.add(keep.id);}
            }
            if(abort.signal.aborted)break;
            this.phases.set(id,{phase:payload.options.kind==='delete'?(payload.options.deleteMode==='software'?'移入软件回收站':payload.options.deleteMode==='system'?'移入Windows回收站':'永久删除'):payload.options.kind==='restore'?'还原文件':payload.options.kind==='visibility'?'更新隐藏状态':'清理回收站',currentPath:media.absolutePath});
            if(!this.fileAction)throw new Error('后台文件操作未配置');await this.fileAction(item.id,payload.options,abort.signal);if(this.interruptedSync.has(id))return;if(abort.signal.aborted)break;
          } else if(payload.options.kind==='tags') {
            this.db.transaction(()=>{if(payload.options.tagAction==='remove')removeTagFromMedia(this.db,media.id,payload.options.tagName!);else addTagToMedia(this.db,media.id,payload.options.tagName!);})();
            if(!this.db.prepare(`SELECT m.id FROM media m WHERE m.id=? AND ${visibleSql()}`).get(media.id))tagVisibilityChanged=true;
          } else if (payload.options.kind === 'duplicates') {
            const before = await stat(media.absolutePath);
            if(before.size!==media.sizeBytes||Math.abs(before.mtimeMs-media.modifiedAtMs)>1)throw new Error('文件已变化，请重新扫描后重试');
            const cached=this.db.prepare('SELECT content_hash AS hash FROM media_details WHERE media_id=? AND hash_fingerprint=? AND content_hash IS NOT NULL').get(media.id,media.fingerprint) as {hash:string}|undefined;
            if(!cached){const hash=await hashFile(media.absolutePath,abort.signal);const after=await stat(media.absolutePath);
              if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)throw new Error('文件正在修改，请稍后重试');
              if(abort.signal.aborted)break;
              this.db.prepare('INSERT INTO media_details(media_id,content_hash,hash_fingerprint) VALUES(?,?,?) ON CONFLICT(media_id) DO UPDATE SET content_hash=excluded.content_hash,hash_fingerprint=excluded.hash_fingerprint').run(media.id,hash,media.fingerprint);
            }
          } else if (payload.options.kind === 'similar') {
            const before=await stat(media.absolutePath);
            if(before.size!==media.sizeBytes || Math.abs(before.mtimeMs-media.modifiedAtMs)>1)throw new Error('文件已变化，请重新扫描后重试');
            const cached=this.db.prepare('SELECT 1 FROM similarity_features WHERE media_id=? AND fingerprint=? AND algorithm=?').get(media.id,media.fingerprint,similarityAlgorithm);
            if(!cached){
              const feature=await imageFeature(media.absolutePath);const after=await stat(media.absolutePath);
              if(before.size!==after.size || before.mtimeMs!==after.mtimeMs || before.ino!==after.ino)throw new Error('文件正在修改，请稍后重试');
              if(!this.db.prepare(`SELECT id FROM media m WHERE m.id=? AND m.fingerprint=? AND ${visibleSql('m',Boolean(payload.options.includeHidden))}`).get(media.id,media.fingerprint))throw new Error('媒体状态已变化，请刷新后重试');
              this.db.prepare(`INSERT INTO similarity_features(media_id,fingerprint,algorithm,hash,gradient,colors,width,height) VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(media_id) DO UPDATE SET fingerprint=excluded.fingerprint,algorithm=excluded.algorithm,hash=excluded.hash,gradient=excluded.gradient,colors=excluded.colors,width=excluded.width,height=excluded.height`).run(media.id,media.fingerprint,similarityAlgorithm,feature.hash,feature.gradient,feature.colors,feature.width,feature.height);
            }
            const content=this.db.prepare('SELECT 1 FROM media_details WHERE media_id=? AND hash_fingerprint=? AND content_hash IS NOT NULL').get(media.id,media.fingerprint);
            if(!content){const hash=await hashFile(media.absolutePath,abort.signal);const after=await stat(media.absolutePath);if(before.size!==after.size || before.mtimeMs!==after.mtimeMs || before.ino!==after.ino)throw new Error('文件正在修改，请稍后重试');this.db.prepare('INSERT INTO media_details(media_id,content_hash,hash_fingerprint) VALUES(?,?,?) ON CONFLICT(media_id) DO UPDATE SET content_hash=excluded.content_hash,hash_fingerprint=excluded.hash_fingerprint').run(media.id,hash,media.fingerprint);}
          } else if (payload.options.kind === 'geo') await this.geocode(media);
          else item.output = await this.export(media, payload.options,item.ordinal);
          item.status = 'completed'; delete item.error;
        } catch (error) { if(this.interruptedSync.has(id))return;if(abort.signal.aborted)break;item.status = 'failed'; item.error = error instanceof Error ? error.message : String(error); }
        this.db.transaction(() => {
          this.db.prepare('UPDATE job_items SET status=?,error=?,output=? WHERE task_id=? AND media_id=?').run(item.status,item.error ?? null,item.output ?? null,id,item.id);
          this.db.prepare('UPDATE tasks SET processed=processed+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
        })();
        if(Date.now()-lastNotify>700){lastNotify=Date.now();if(fileKinds.includes(payload.options.kind)&&payload.options.kind!=='visibility')refreshMediaStats(this.db);this.notify();}
        // A zero-delay Windows timer can cost a full timer tick per file. The
        // attribute helper already yields for I/O; setImmediate keeps controls
        // responsive without adding that artificial delay to every attribute.
        if(payload.options.kind==='geo') {if(item.ordinal%8===0)await new Promise<void>(resolve=>setImmediate(resolve));}
        else if(payload.options.kind==='visibility'&&payload.options.syncOnly)await new Promise<void>(resolve=>setImmediate(resolve));
        else await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const state = this.db.prepare('SELECT status FROM tasks WHERE id=?').get(id) as { status: string };
      if (state.status === 'running') {
        const failed = Number((this.db.prepare("SELECT COUNT(*) AS count FROM job_items WHERE task_id=? AND status='failed'").get(id) as { count: number }).count);
        this.db.prepare('UPDATE tasks SET status=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(failed ? 'failed' : 'completed', failed ? `${failed} 项失败；重试只处理失败项` : null, id);
      }
    } finally { this.aborts.delete(id);this.phases.delete(id);if(this.interruptedSync.delete(id)){this.active.delete(id);return;}if(fileKinds.includes(payload.options.kind)&&payload.options.kind!=='visibility'){refreshMediaStats(this.db);reconcileAllCovers(this.db);}else if(payload.options.kind==='tags'){if(tagVisibilityChanged)refreshMediaStats(this.db);for(const row of this.db.prepare('SELECT id FROM albums WHERE manual_cover_media_id IN(SELECT media_id FROM job_items WHERE task_id=?)').all(id) as {id:string}[])reconcileCover(this.db,row.id);} this.active.delete(id); this.notify(); }
  }
  private async geocode(media: OrganizedMedia) {
    if(!needsGeographicOrganization(media))return;
    let previous = media.metadata;
    // Scans already read EXIF, including the absence of GPS. Only legacy rows
    // without any extracted metadata need a one-time source-file fallback.
    const extracted:Record<string,any> = hasGeographicMetadata(previous) ? {} : await extractMetadata(media.absolutePath);
    const current=rawMedia(this.db,media.id);if(!current||current.fingerprint!==media.fingerprint)throw new Error('照片在处理中已变化，请刷新后重试');previous=current.metadata;
    const metadata={...previous,...extracted};
    const coordinate=Number.isFinite(metadata.latitude)&&Number.isFinite(metadata.longitude);
    const nearby=coordinate?nearbyPlace(metadata.latitude,metadata.longitude):null;
    // Preserve user corrections and all favorite/rating/name fields.
    const next = { ...extracted,geoMetadataVersion:1,geoOrganizationKey:geographicKey({...media,metadata}), ...(nearby && previous.placeSource !== 'user' ? { country: nearby.country, region: nearby.region, city: nearby.city, placeSource: nearby.placeSource, distanceKm: nearby.distanceKm } : {}) };
    updateMetadata(this.db,media.id,next);
  }

  private async export(media: OrganizedMedia, options: Start, ordinal: number) {
    const time = new Date(media.capturedAtMs ?? media.modifiedAtMs); const pad=(value:number)=>String(value).padStart(2,'0');
    const date = `${time.getFullYear()}-${pad(time.getMonth()+1)}-${pad(time.getDate())}`;
    let directory = options.folders ? path.join(options.directory!, date) : options.directory!;
    if (options.byAlbum) {
      const album = options.albumId ? this.db.prepare('SELECT name FROM albums WHERE id=?').get(options.albumId) : this.db.prepare('SELECT a.name FROM albums a JOIN album_media am ON am.album_id=a.id WHERE am.media_id=? ORDER BY a.name LIMIT 1').get(media.id);
      let name = (album as {name:string}|undefined)?.name ?? '未分类'; name = Array.from(name.replace(/[<>:"/\\|?*\x00-\x1f]/gu,'_').replace(/[. ]+$/u,'')).slice(0,150).join('') || '未分类';
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(name)) name=`_${name}`;
      directory=path.join(options.directory!,name);
    }
    const extension = path.extname(media.absolutePath);
    const name = options.naming === 'date' ? `${date.replaceAll('-','')}_${pad(time.getHours())}${pad(time.getMinutes())}${pad(time.getSeconds())}${extension}` : options.naming === 'custom' ? `${options.prefix}_${String(ordinal).padStart(3,'0')}${extension}` : path.basename(media.absolutePath);
    let output: string;
    if (options.stripGps) {
      if (!['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.avif','.mp4','.mov','.m4v','.webm','.mkv','.avi'].includes(extension.toLowerCase())) throw new Error('该格式暂不支持安全移除 GPS，未导出原件；可关闭清除 GPS 后重试');
      await mkdir(directory, { recursive: true });
      const temp = path.join(directory, `.lumina-export-${randomUUID()}${extension}`);
      try {
        if (media.kind === 'video') await runFfmpeg(['-y','-hide_banner','-loglevel','error','-i',media.absolutePath,'-map','0:v:0','-map','0:a?','-c','copy','-map_metadata','-1','-map_metadata:s:v','-1','-map_metadata:s:a','-1','-map_chapters','-1','-metadata','location=','-metadata','location-eng=','-metadata','com.apple.quicktime.location.ISO6709=',temp]);
        else await sharp(media.absolutePath).rotate().toColourspace('srgb').toFile(temp);
        output = await copyExclusive(temp, directory, name);
      } finally { await unlink(temp).catch(() => {}); }
    } else output = await copyExclusive(media.absolutePath, directory, name);
    try {
      if (options.xmp) {
        const tags = this.db.prepare('SELECT t.name FROM tags t JOIN media_tags mt ON mt.tag_id=t.id WHERE mt.media_id=? ORDER BY t.name').all(media.id) as { name: string }[];
        const xmp = `<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="${Number(media.metadata.rating ?? 0)}"><dc:subject><rdf:Bag>${tags.map((tag) => `<rdf:li>${escapeXml(tag.name)}</rdf:li>`).join('')}</rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
        await writeFile(`${output}.xmp`, xmp, { flag: 'wx' });
      }
    } catch (error) { await unlink(output).catch(() => {}); throw error; }
    return output;
  }
  undoGeo(id: string) {
    const row = this.db.prepare('SELECT changes_json,undone FROM geo_runs WHERE id=?').get(id) as { changes_json: string; undone: number } | undefined;
    if (!row || row.undone) throw new Error('该整理批次不存在或已经撤销');
    return this.db.transaction(() => {
      const changes = (this.db.prepare('SELECT change_json FROM geo_changes WHERE run_id=?').all(id) as { change_json: string }[]).map((row) => JSON.parse(row.change_json));
      for (const change of changes.reverse()) {
        const media = rawMedia(this.db, change.id); if (!media) continue;
        const restore: any = {};
        for (const key of Object.keys(change.applied)) if (JSON.stringify(media.metadata[key]) === JSON.stringify(change.applied[key])) restore[key] = change.previous[key] ?? null;
        updateMetadata(this.db, change.id, restore);
        for (const tagId of change.tagIds) this.db.prepare('DELETE FROM media_tags WHERE media_id=? AND tag_id=? AND EXISTS(SELECT 1 FROM media_tag_origins o WHERE o.media_id=? AND o.tag_id=? AND o.source=?)').run(change.id, tagId,change.id,tagId,id);
        for (const albumId of change.albumIds) this.db.prepare("DELETE FROM albums WHERE id=? AND EXISTS(SELECT 1 FROM smart_albums WHERE album_id=? AND source='geo')").run(albumId, albumId);
      }
      this.db.prepare("DELETE FROM tags WHERE id IN(SELECT tag_id FROM tag_options WHERE source='geo') AND NOT EXISTS(SELECT 1 FROM media_tags WHERE tag_id=tags.id) AND NOT EXISTS(SELECT 1 FROM smart_albums s,json_each(s.rule_json,'$.tags') j WHERE j.value=tags.id)").run();
      this.db.prepare('UPDATE geo_runs SET undone=1 WHERE id=?').run(id); return { ok: true };
    })();
  }
}
