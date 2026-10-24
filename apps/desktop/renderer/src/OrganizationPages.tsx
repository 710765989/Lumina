import {t,translateMessage} from './i18n';
import {cacheMoveProgress} from './cache-move-progress';
import {ActionButton,ActionForm} from './ActionControls';
import {CollectionMediaView,MediaViewToolbar,useCollectionView,useCollectionZoom} from './CollectionMediaView';
import {TimelineGrid} from './TimelineGrid';
import {usePageLocation} from './useAppNavigation';
import {userErrorMessage} from './user-error';
import {taskInformation,taskDate} from './task-information';
import {startBackgroundJob} from './BackgroundTaskNotice';
import { useEffect, useRef, useState } from 'react';
import { VirtualMediaGrid } from './VirtualMediaGrid';
import { MediaThumbnail } from './MediaThumbnail';
import { LibraryConfirmDialog } from './LibraryDialogs';
import { type Media,type Tag, mediaName, bytesText, countryName } from './media-types';
import { useModalEscape } from './useModalEscape';
import { DuplicatePage } from './DuplicatePage';
import {GeographyCards} from './GeographyParts';

type GridProps = Omit<React.ComponentProps<typeof VirtualMediaGrid>, 'items' | 'onEndReached'>;
type Props = GridProps & {onSelectMany?:(ids:Set<string>)=>void;active?:boolean; page: 'trash' | 'hidden' | 'geo' | 'duplicates'; revision: number; onMediaChange: (items: Media[]) => void; onChanged: () => Promise<void>; onClear: () => void };
type Result = { id: string; ok: boolean; error?: string; path?: string };
export function OrganizationPage(props:Props){return props.page==='duplicates'?<DuplicatePage {...props}/>:<OtherOrganizationPage {...props}/>;}
function OtherOrganizationPage({ active=true,page, revision, onMediaChange, onChanged, onClear, ...grid }: Props) {
  const [items, setItems] = useState<Media[]>([]); const [more, setMore] = useState(false); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const [results, setResults] = useState<Result[]>([]); 
  const [geoCleanup,setGeoCleanup]=useState<{revision:string;albums:number;tags:number;links:number}|null>(null);
  const [starting,setStarting]=useState(false),startingRef=useRef(false);const [geoNotice,setGeoNotice]=useState('');
  const recycleView=useCollectionView(page==='trash'?'trash':`organization-${page}`,null,'list');
 const recycleBrowser=useRef<HTMLDivElement>(null);useCollectionZoom(recycleBrowser,recycleView,page==='trash' && active);
 const [trashMonths,setTrashMonths]=useState<{month:string;count:number}[]>([]);
 const [trashStats,setTrashStats]=useState<{total:number;sizeBytes:number}|null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null); const [jobId, setJobId] = useState<string | null>(null);
  useEffect(()=>{const home=(event:Event)=>{if((event as CustomEvent).detail===page)setPlace(null);};window.addEventListener('lumina-page-home',home);window.addEventListener('lumina-page-back',home);return()=>{window.removeEventListener('lumina-page-home',home);window.removeEventListener('lumina-page-back',home);};},[page]);
  const [places, setPlaces] = useState<any>(null); const [place, setPlace] = useState<any>(null); const [groups, setGroups] = useState<Media[][]>([]);
  const geoView=useCollectionView('geo',JSON.stringify(place));const [geoTags,setGeoTags]=useState<Tag[]>([]),[geoStats,setGeoStats]=useState<{total:number;photo:number;video:number}>(),[geoMonths,setGeoMonths]=useState<{month:string;count:number}[]>([]);
  const request=useRef(0);const pending=useRef(false);const queued=useRef(false);const refreshTimer=useRef<number>();
  const currentItems=useRef(items);currentItems.current=items;const actingRef=useRef(false);const [acting,setActing]=useState(false);
  const seenRevision=useRef(revision);
  const lastAction = useRef<{ type: 'trash.restore' | 'trash.purge'; directory?: string } | null>(null);
  async function load(reset=true,quiet=false,preserve=false) {
    if(pending.current || actingRef.current && quiet){if(reset)queued.current=true;return;}
    const token=++request.current;pending.current=true;if(!quiet)setLoading(true);setError('');
    try {
      if(page==='geo' && !place){const next=await window.lumina.command({type:'geo.places',sortBy:geoView.sortBy,sort:geoView.sort});if(token!==request.current)return;setPlaces({...next,coverSortBy:geoView.sortBy,coverSort:geoView.sort});setItems([]);onMediaChange([]);return;}
      const target=reset && preserve?Math.max(200,currentItems.current.length):200;
      const offset=reset?0:currentItems.current.length;const rows:Media[]=[];let lastSize=0,lastLimit=200;
      do {
        lastLimit=Math.min(1000,target-rows.length);
        const batch:Media[]=await window.lumina.command({type:page==='trash'?'trash.list':page==='hidden'?'hidden.list':'geo.media',limit:lastLimit,offset:offset+rows.length,...(page==='geo'?{...place,...geoView.filters,sortBy:geoView.sortBy,sort:geoView.sort}:page==='trash'?{sortBy:recycleView.sortBy,sort:recycleView.sort}:{})});
        if(token!==request.current)return;rows.push(...batch);lastSize=batch.length;if(lastSize<lastLimit)break;
      }while(rows.length<target);
      const all=reset?rows:[...currentItems.current,...rows];
      let hasMore=lastSize===lastLimit;
      if(hasMore){const peek=await window.lumina.command({type:page==='trash'?'trash.list':page==='hidden'?'hidden.list':'geo.media',limit:1,offset:offset+rows.length,...(page==='geo'?{...place,...geoView.filters,sortBy:geoView.sortBy,sort:geoView.sort}:page==='trash'?{sortBy:recycleView.sortBy,sort:recycleView.sort}:{})});if(token!==request.current)return;hasMore=peek.length>0;}
      if(JSON.stringify(all)!==JSON.stringify(currentItems.current)){currentItems.current=all;setItems(all);onMediaChange(all);}
      if(page==='trash' && reset){const stats=await window.lumina.command({type:'trash.stats'});if(token!==request.current)return;setTrashStats(stats);const months=await window.lumina.command({type:'trash.timeline',capturedTime:recycleView.sortBy==='capturedAt'});if(token!==request.current)return;setTrashMonths(months);}
      if(page==='geo'&&reset){const [stats,months,tags]=await Promise.all([window.lumina.command({type:'geo.stats',...place,...geoView.filters}),window.lumina.command({type:'geo.timeline',...place,...geoView.filters,sortBy:geoView.sortBy}),window.lumina.command({type:'tags.list'})]);if(token!==request.current)return;setGeoStats(stats);setGeoMonths(months);setGeoTags(tags);}
      setMore(hasMore);
    }catch(reason){if(token===request.current)setError(userErrorMessage(reason));}
    finally{if(token===request.current){pending.current=false;if(!actingRef.current)setLoading(false);if(queued.current){queued.current=false;refreshTimer.current=window.setTimeout(()=>void latestLoad.current(true,true,true),150);}}}
  }
  const latestLoad=useRef(load);latestLoad.current=load;
  useEffect(()=>{onClear();setItems([]);currentItems.current=[];onMediaChange([]);void load();return()=>{request.current++;pending.current=false;queued.current=false;window.clearTimeout(refreshTimer.current);};},[page,place,recycleView.sortBy,recycleView.sort,geoView.sortBy,geoView.sort,geoView.filterKey]);
  useEffect(()=>{if(!active || seenRevision.current===revision)return;seenRevision.current=revision;void load(true,true,true);},[revision,active]);
  async function act(type: 'trash.restore' | 'trash.purge', ids: string[], directory?: string) {
    if(ids.length>1){const job=await startBackgroundJob({type:'jobs.start',kind:type==='trash.restore'?'restore':'purge',mediaIds:ids,directory});setJobId(job.id);onClear();return;}
    if(actingRef.current)return;actingRef.current=true;setActing(true);setLoading(true); setError(''); lastAction.current = { type, directory };
    try {
      const outcome: Result[] = [];
      for (let offset = 0; offset < ids.length; offset += 1000) {
        const batch: Result[] = await window.lumina.command({ type, mediaIds: ids.slice(offset,offset+1000), directory, destination: 'permanent' }); outcome.push(...batch);
        if (batch.some((item) => item.error === '已取消，未执行')) { outcome.push(...ids.slice(offset+1000).map((id) => ({ id, ok: false, error: "已取消，未执行" }))); break; }
      }
      setResults(outcome); onClear(); await onChanged(); await load();
    }
    catch (reason) { setError(userErrorMessage(reason)); } finally { actingRef.current=false;setActing(false);setLoading(false);if(queued.current){queued.current=false;void load(true,true,true);} }
  }
  async function start(kind: 'duplicates' | 'geo') { if(startingRef.current)return;startingRef.current=true;setStarting(true);setError('');setGeoNotice('');try { const result = await startBackgroundJob({type:'jobs.start', kind });const job=await window.lumina.command({type:'jobs.result',id:result.id});if(kind==='geo'&&job.total===0){setGeoNotice(t("位置信息已是最新，无需重新读取照片。"));void load();}else setJobId(result.id); } catch (reason) { setError(userErrorMessage(reason)); }finally{startingRef.current=false;setStarting(false);} }
  const titles = { trash: t("回收站"), hidden: t("已隐藏内容"), geo: t("足迹"), duplicates: t("重复文件检测") };
  usePageLocation(page,{place},location=>setPlace(location?.place??null),()=>load(true,false,true));
  const selected = [...grid.selected];
  return <><section className={`content organization-page${page==='trash'?' recycle-page':page==='geo'?' geo-page':''}`}>
    <div className="section-head"><div><h2>{page==='geo'&&place?(place.city||t("无位置信息")):titles[page]}</h2>{page==='trash' && <p className="trash-summary" aria-live="polite">{t("总项目")}{trashStats?.total??'…'}{t("项 · 总大小")}{trashStats?bytesText(trashStats.sizeBytes):'…'}</p>}<p>{page === 'trash' ? t("文件保留整理信息；到期按入站时的策略处理。") : page === 'hidden' ? t("隐藏项目和命中黑名单标签的项目，可在此找回。") : page === 'duplicates' ? t("按文件内容核验，检测结果不会自动删除任何文件。") : t("离线整理地点 · 只展示城市，不展示精确坐标。")}</p></div><div className="section-actions">
      <ActionButton className="ghost" disabled={loading} onClick={() => load()}>{t("刷新")}</ActionButton>
      {page === 'trash' && <><ActionButton className="ghost" disabled={!items.length || loading} onClick={async () => { try { await act('trash.restore', await window.lumina.command({ type: 'trash.ids' })); } catch (reason) { setError(userErrorMessage(reason)); } }}>{t("全部还原")}</ActionButton><ActionButton className="ghost" disabled={!items.length || loading} onClick={async () => { try { setConfirm(await window.lumina.command({ type: 'trash.ids' })); } catch (reason) { setError(userErrorMessage(reason)); } }}>{t("立即清空")}</ActionButton></>}
      {page === 'geo' && <><ActionButton className="ghost" onClick={() => setPlace(place ? null : { noLocation: true })}>{place ? t("返回") : t("查看无位置照片")}</ActionButton><ActionButton className="primary" title={t("检查并更新地点信息，优先使用已保存的 GPS，不重新扫描整个图库")} disabled={starting||loading} onClick={() => start('geo')}>{starting?t("正在准备…"):t("更新足迹")}</ActionButton></>}
      {page === 'duplicates' && <ActionButton className="primary" onClick={() => start('duplicates')}>{t("开始检测")}</ActionButton>}
    </div></div>
    {error && <p className="form-error" role="alert">{translateMessage(error)}</p>}
    {page==='geo'&&<p className="dialog-hint" role="status">{geoNotice||t("地点仅在足迹展示，不创建标签或相册；优先使用扫描时保存的位置{0}，已有元数据不重复读取原文件。", [places?t("（待补全 {0} 张）", [places.pendingOrganization??0]):''])}</p>}
    {acting && page === 'trash' && <ActionButton className="ghost" onClick={() => window.lumina.command({ type: 'trash.cancel' })}>{t("取消未执行项")}</ActionButton>}

    {page === 'hidden' && selected.length > 0 && <div className="organization-batch"><span>{t("已选")}{selected.length}{t("项")}</span><ActionButton className="ghost" onClick={async () => { try { await Promise.all(selected.map((id) => window.lumina.command({ type: 'media.unhide', id }))); await onChanged(); await load(); onClear(); } catch (reason) { setError(userErrorMessage(reason)); } }}>{t("取消单项隐藏")}</ActionButton><span className="dialog-hint">{t("通过标签隐藏的媒体，可在标签页恢复关联媒体。")}</span></div>}
    {page === 'geo' && !place && places && <>
      <div className="summary"><div><span>{t("去过的国家")}</span><strong>{places.countries}</strong></div><div><span>{t("去过的城市")}</span><strong>{places.cities}</strong></div><div><span>{t("无位置信息")}</span><strong>{places.noLocation}</strong></div></div>
      <GeographyCards places={places.places} sortBy={places.coverSortBy??geoView.sortBy} sort={places.coverSort??geoView.sort} onOpen={setPlace}/><p className="dialog-hint">{t("地名数据来自 GeoNames（CC BY 4.0）；匹配为附近城市，可在媒体信息中修正地点。")}</p>
      {Boolean(places.legacy?.albums||places.legacy?.tags||places.legacy?.links)&&<div className="geo-legacy-cleanup"><span>{t("旧版曾生成地点标签或相册，可清理这些自动分类，保留足迹。")}</span><ActionButton className="ghost" onClick={async()=>{try{setGeoCleanup(await window.lumina.command({type:'geo.cleanupPreview'}));}catch(reason){setError(userErrorMessage(reason));}}}>{t("清理旧地点分类")}</ActionButton></div>}
    </>}
    {page === 'duplicates' && <div className="duplicate-groups">{groups.map((group, index) => <section key={group[0]?.id}><h3>{t("重复组")}{index + 1} · {group.length}{t("个文件 · 可节省")}{bytesText(group.slice(1).reduce((sum, item) => sum + item.sizeBytes, 0))}</h3>{group.map((item) => <div key={item.id} className={grid.selected.has(item.id) ? 'media-row selected' : 'media-row'} onClick={(event) => grid.onToggle(item.id, event)} onDoubleClick={() => grid.onOpen(item)} onContextMenu={(event) => grid.onContextMenu(item, event)}><img src={window.lumina.mediaUrl('thumbnail', item.id)} alt="" /><div><strong>{mediaName(item)}</strong><small>{item.absolutePath}</small></div><span>{bytesText(item.sizeBytes)}</span></div>)}</section>)}{!groups.length && <div className="empty compact"><h3>{t("暂无内容相同的文件")}</h3><p>{t("运行检测后会在这里显示结果。")}</p></div>}</div>}
    {items.length > 0 && page === 'hidden' && <VirtualMediaGrid {...grid} items={items} onEndReached={() => { if (more) void load(false); }} />}
    {page==='geo'&&place&&<CollectionMediaView {...grid} settings={geoView} tags={geoTags} summary={geoStats} onClear={onClear} onSelectMany={grid.onSelectMany} windowKey={`geo:${JSON.stringify(place)}:${geoView.sortBy}:${geoView.sort}:${geoView.filterKey}`} items={items} hasMore={more} loadingMore={loading} onEndReached={()=>{if(more)void load(false);}} onMonthIds={(timeFromMs,timeBeforeMs)=>window.lumina.command({type:'geo.ids',...place,...geoView.filters,sortBy:geoView.sortBy,sort:geoView.sort,timeFromMs,timeBeforeMs})} monthCounts={Object.fromEntries(geoMonths.map(row=>[`${row.month.slice(0,4)}年${Number(row.month.slice(5))}月`,row.count]))} empty={<div className="empty compact"><h3>{loading?t("正在加载…"):t("暂无媒体")}</h3></div>}/>}
    {geoCleanup&&<LibraryConfirmDialog title={t("清理旧地点分类")} confirmLabel={t("清理")} description={t("移除旧版自动生成的 {0} 个地点相册，检查 {1} 条自动标签关联并清理未被手动使用的关联及地点标签（检查 {2} 个）。原媒体、足迹位置及普通标签/相册保留；已被手动使用或被其他规则引用的标签会保留。", [geoCleanup.albums, geoCleanup.links, geoCleanup.tags])} onClose={()=>setGeoCleanup(null)} onConfirm={async()=>{await window.lumina.command({type:'geo.cleanup',revision:geoCleanup.revision});await onChanged();await load();setGeoNotice(t("旧地点分类已清理，足迹和原媒体保留。"));}}/>}
    {page==='trash' && <div ref={recycleBrowser} className="recycle-media-browser"><MediaViewToolbar settings={recycleView}/>{items.length?<TimelineGrid {...grid} items={items} view={recycleView.view} cardSize={recycleView.size} capturedTime={recycleView.sortBy==='capturedAt'} groupByMonth={recycleView.view==='time' && ['fileTime','capturedAt'].includes(recycleView.sortBy)} onSelectMany={grid.onSelectMany} selectionSource={{scope:'trash',sortBy:recycleView.sortBy,sort:recycleView.sort}} windowKey={`trash:${recycleView.sortBy}:${recycleView.sort}`} onMonthIds={(timeFromMs,timeBeforeMs)=>window.lumina.command({type:'trash.ids',sortBy:recycleView.sortBy,sort:recycleView.sort,timeFromMs,timeBeforeMs})} monthCounts={Object.fromEntries(trashMonths.map(row=>[`${row.month.slice(0,4)}年${Number(row.month.slice(5))}月`,row.count]))} hasMore={more} loadingMore={loading} onEndReached={()=>{if(more)void load(false);}} renderBadge={item=><span className="media-expiry">{expiryText(item)}</span>} renderRowActions={item=><div className="recycle-row-actions"><ActionButton className="ghost" disabled={loading} onClick={event=>{event.stopPropagation();return act('trash.restore',[item.id]);}}>{t("还原")}</ActionButton><ActionButton className="ghost" disabled={loading} onClick={event=>{event.stopPropagation();setConfirm([item.id]);}}>{t("彻底删除")}</ActionButton></div>}/>:<div className="empty compact"><h3>{loading?t("正在加载…"):t("暂无媒体")}</h3></div>}</div>}
    {items.length === 0 && !loading && page === 'hidden' && <div className="empty compact"><h3>{t("暂无媒体")}</h3></div>}
    {page==='hidden' && (loading || more) && <p className="load-more-hint">{loading?t("处理中…"):t("继续下滑自动加载")}</p>}
    {results.some((result) => !result.ok) && <div className="batch-results" role="status"><p>{t("成功")}{results.filter((result) => result.ok).length}{t("项 · 失败")}{results.filter((result) => !result.ok).length}{t("项")}</p>{results.filter((result) => !result.ok).map((result) => <p key={result.id}>{userErrorMessage(result.error)}</p>)}<ActionButton className="ghost" onClick={async () => { if (lastAction.current) await act(lastAction.current.type, results.filter((result) => !result.ok).map((result) => result.id), lastAction.current.directory); }}>{t("仅重试失败项")}</ActionButton></div>}
    {confirm && <LibraryConfirmDialog title={t("永久删除")} description={t("永久删除 {0} 项文件？这会从磁盘彻底删除，无法还原。", [confirm.length])} onClose={() => setConfirm(null)} onConfirm={() => act('trash.purge', confirm)} />}
    {jobId && <JobDialog id={jobId} onClose={() => { setJobId(null); void load(); void onChanged(); }} />}
  </section>
    {page === 'trash' && <footer className="organization-footer recycle-footer" aria-label={t("回收站操作")}><span>{t("已选 {0} 项 · Ctrl 点选 / Shift 连选",[selected.length])}</span><ActionButton className="ghost" disabled={!selected.length || loading} onClick={() => act('trash.restore', selected)}>{t("还原所选")}</ActionButton><ActionButton className="ghost" disabled={!selected.length || loading} onClick={async () => { const directory = await window.lumina.pickFolder(); if (directory) await act('trash.restore', selected, directory); }}>{t("还原到其他目录")}</ActionButton><ActionButton className="ghost" disabled={!selected.length || loading} onClick={() => setConfirm(selected)}>{t("彻底删除所选")}</ActionButton></footer>}
  </>;
}

export function JobDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const dialogRef=useModalEscape<HTMLElement>(onClose);
  const [job,setJob]=useState<any>(null),[error,setError]=useState(''),[detailPage,setDetailPage]=useState(0),[refresh,setRefresh]=useState(0);
  const [controlling,setControlling]=useState('');const controlLock=useRef(false),readEpoch=useRef(0);
  const pageSize=20;useEffect(()=>{setDetailPage(0);},[id]);
  useEffect(()=>{const epoch=++readEpoch.current;let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;const load=async()=>{try{const next=await window.lumina.command({type:'jobs.result',id,offset:detailPage*pageSize,limit:pageSize});if(disposed||epoch!==readEpoch.current)return;setJob(next);setError('');if(next.active || ['running','queued'].includes(next.status))timer=setTimeout(()=>void load(),700);}catch(reason){if(!disposed)setError(userErrorMessage(reason));}};void load();return()=>{disposed=true;clearTimeout(timer);};},[id,detailPage,refresh]);
  async function control(action:string){if(controlLock.current)return;controlLock.current=true;readEpoch.current++;setControlling(action);setError('');try{const result=await window.lumina.command({type:'jobs.control',id,action});setJob((current:any)=>current?{...current,status:result.status??(action==='pause'?'paused':action==='cancel'?'cancelled':'running')}:current);setRefresh(value=>value+1);}catch(reason){setError(userErrorMessage(reason));setRefresh(value=>value+1);}finally{controlLock.current=false;setControlling('');}}
  const summary=job?taskInformation(job):null,detailTotal=job?.detailTotal??job?.total??0;
  const canControl=job && job.kind!=='cache-move' && ['import','cache-cleanup','directory-rules','scan','tags','export','duplicates','similar','geo','delete','restore','purge','visibility','thumbnail','video-preview'].includes(job.kind);
  const statuses:Record<string,string>={running:t("处理中"),paused:t("已暂停"),completed:t("已完成"),failed:t("失败"),cancelled:t("已取消"),queued:t("等待中"),pending:t("未执行"),skipped:t("已跳过")};
  return <div className="dialog-backdrop"><section ref={dialogRef} className="tag-dialog task-detail-dialog" role="dialog" aria-label={t("任务进度")}><div className="dialog-head"><strong>{summary?.title??t("任务")}{t("· 任务详情")}</strong></div><div className="library-fields">{job && <>
    <p className="dialog-hint">{job.kind==='cache-move'?(job.committed?(job.active?t("已切换到新缓存目录，正在清理已验证的旧副本。"):t("缓存已迁移，当前使用新缓存目录。")):job.status==='cancelled'?t("已取消迁移，继续使用原缓存目录。目标目录中的已复制副本可在下次迁移时复用。"):t("切换前取消会继续使用原缓存目录。迁移时新的预览缓存请求等待，切换后继续。")):t("取消只停止未完成部分，保留已完成结果，不自动回退。")}</p><p className="task-operation-description">{summary?.description}</p><div className="task-record-meta"><span>{t("任务编号：")}{job.id}</span><span>{t("创建：")}{taskDate(job.createdAt)}</span><span>{t("更新：")}{taskDate(job.updatedAt)}</span></div>
    {job.kind==='directory-rules' && <details className="task-directory-rules"><summary>{t("目录标签规则")}{(job.options?.rules??[]).length}{t("条")}</summary><div>{(job.options?.rules??[]).map((rule:any)=><p key={rule.relativePath}><strong>{rule.relativePath||t("根目录")}</strong> → {rule.name}</p>)}</div><p className="dialog-hint">{t("取消或暂停只停止当前整理，已保存的规则仍对新增媒体生效。")}</p></details>}
    {job.kind==='cache-move'?<><p>{translateMessage(cacheMoveProgress(job).text)} · {statuses[job.status]??job.status}</p><progress aria-label={t("缓存迁移总进度")} value={cacheMoveProgress(job).percent} max={100}/></>:<><p>{job.processed} / {job.total} · {Math.round(job.processed/Math.max(1,job.total)*100)}% · {statuses[job.status]??job.status}</p><progress value={job.processed} max={Math.max(job.total,1)}/></>}
    {!['tags','directory-rules'].includes(job.kind) && job.totalBytes>0 && <p>{job.kind==='cache-move'?t("已复制并校验"):t("完成大小")} {bytesText(job.completedBytes)} / {bytesText(job.totalBytes)}</p>}{job.kind==='cache-move'&&!job.committed&&job.speedBytesPerSecond>0&&<p className="dialog-hint">{t("校验后速度")}{bytesText(job.speedBytesPerSecond)}/s{job.remainingSeconds!=null?t(" · 预计还需 {0}", [job.remainingSeconds>=3600?Math.ceil(job.remainingSeconds/3600)+t(" 小时"):job.remainingSeconds>=60?Math.ceil(job.remainingSeconds/60)+t(" 分钟"):job.remainingSeconds+t(" 秒")]):''}</p>}{job.phase && <p className="task-current-file">{job.phase}<br/>{job.currentPath}</p>}{job.active && ['paused','cancelled'].includes(job.status) && <p>{t("正在安全结束当前文件，未执行项已停止排队…")}</p>}
    <p>{t("成功")}{job.counts?.completed??0}{job.counts?.skipped>0&&<>{t("· 已跳过")}{job.counts.skipped}</>}{t("· 失败")}{job.counts?.failed??0}{t("· 未执行")}{job.counts?.pending??0}</p>
    <div className="task-file-list" aria-label={t("处理文件明细")}>{(job.items??[]).map((item:any)=><article className="task-file-record" key={item.id}><div><strong title={item.fileName??item.path}>{item.fileName || item.path?.split(/[\\/]/u).pop() || item.id}</strong><span>{item.sizeRecorded===false || item.sizeBytes===undefined?t("旧记录未保存大小"):bytesText(item.sizeBytes)}</span><small>{statuses[item.status]??item.status}</small></div><p title={item.path}>{t("文件路径：")}{item.path || t("旧记录未保存路径")}</p>{item.output && <p title={item.output}>{t("输出位置：")}{item.output}</p>}{item.error && <p className="form-error">{userErrorMessage(item.error)}</p>}</article>)}{!detailTotal && <p className="dialog-hint">{t("该任务没有保存逐文件明细；旧记录无法补录当时的文件信息。")}</p>}</div>
    {detailTotal>0 && <div className="task-detail-pagination"><span>{t("共")}{detailTotal}{t("项 · 每页")}{pageSize}{t("项")}</span><ActionButton className="ghost" disabled={!detailPage} onClick={()=>setDetailPage(value=>value-1)}>{t("上一页明细")}</ActionButton><span>{detailPage+1}/{Math.max(1,Math.ceil(detailTotal/pageSize))}</span><ActionButton className="ghost" disabled={(detailPage+1)*pageSize>=detailTotal} onClick={()=>setDetailPage(value=>value+1)}>{t("下一页明细")}</ActionButton></div>}
  </>}{error && <p className="form-error">{translateMessage(error)}</p>}</div><div className="dialog-footer library-dialog-actions">{job?.kind==='cache-move' && job.active && !job.committed && <ActionButton className="ghost" disabled={Boolean(controlling)} onClick={()=>control('cancel')}>{t("取消迁移")}</ActionButton>}{canControl && ['running','queued'].includes(job.status) && <><ActionButton className="ghost" disabled={Boolean(controlling)} onClick={()=>control('pause')}>{controlling==='pause'?t("正在暂停…"):t("暂停")}</ActionButton><ActionButton className="ghost" disabled={Boolean(controlling)} onClick={()=>control('cancel')}>{controlling==='cancel'?t("正在取消…"):t("取消任务")}</ActionButton></>}{canControl && job.status==='paused' && <ActionButton className="ghost" disabled={Boolean(controlling)} onClick={()=>control('cancel')}>{controlling==='cancel'?t("正在取消…"):t("取消任务")}</ActionButton>}{canControl && ['paused','cancelled'].includes(job.status) && !job.info?.superseded && <ActionButton className="ghost" disabled={job.active||Boolean(controlling)} onClick={()=>control('resume')}>{job.kind==='directory-rules'?t("继续整理"):t("继续未执行项")}</ActionButton>}{canControl && job.status==='failed' && <ActionButton className="ghost" disabled={Boolean(controlling)} onClick={()=>control('retry')}>{job.kind==='directory-rules'?t("重新整理"):t("仅重试失败项")}</ActionButton>}<ActionButton className="primary" onClick={onClose}>{['running','queued'].includes(job?.status)?t("后台运行"):t("关闭")}</ActionButton></div></section></div>;
}

export function ExportDialog({ mediaIds, albumId, onClose,onStarted,includeHidden=false }: { mediaIds?: string[]; albumId?: string;includeHidden?:boolean; onClose: () => void;onStarted?:()=>void }) {
  const dialogRef=useModalEscape<HTMLFormElement>(onClose);
  const [directory, setDirectory] = useState(localStorage.getItem('lumina-export-directory') ?? '');
  const [naming, setNaming] = useState('original'); const [prefix,setPrefix]=useState('Lumina'); const [grouping,setGrouping]=useState('none'); const [stripGps, setStripGps] = useState(false);
  const [xmp, setXmp] = useState(false); const [openAfter, setOpenAfter] = useState(true); const [id, setId] = useState<string | null>(null); const [error, setError] = useState('');
  if (id) return <JobDialog id={id} onClose={() => { if (openAfter) void window.lumina.native({ action: 'open-export', directory }); onClose(); }} />;
  return <div className="dialog-backdrop"><ActionForm ref={dialogRef} className="tag-dialog" role="dialog" aria-label={t("导出")} onSubmit={async (event) => {
    event.preventDefault(); try { const job = await startBackgroundJob({type:'jobs.start', kind: 'export', includeHidden, mediaIds, albumId, directory, naming, prefix, folders:grouping==='date', byAlbum:grouping==='album', stripGps, xmp }); localStorage.setItem('lumina-export-directory', directory);onStarted?.(); setId(job.id); } catch (reason) { setError(userErrorMessage(reason)); }
  }}><div className="dialog-head"><div><strong>{t("导出")}{mediaIds ? t(" {0} 个项目", [mediaIds.length]) : t("相册")}</strong><p>{t("写入新副本，不修改图库原文件。")}</p></div></div><div className="library-fields"><label>{t("导出到")}<input value={directory} readOnly /></label><ActionButton type="button" className="ghost" onClick={async () => { const folder = await window.lumina.pickFolder(); if (folder) setDirectory(folder); }}>{t("浏览…")}</ActionButton><label>{t("文件命名")}<select value={naming} onChange={(event) => setNaming(event.target.value)}><option value="original">{t("保留原文件名")}</option><option value="date">{t("按拍摄时间重命名")}</option><option value="custom">{t("自定义前缀 + 序号")}</option></select></label>{naming==='custom' && <label>{t("文件名前缀")}<input value={prefix} maxLength={80} required onChange={(event)=>setPrefix(event.target.value)} /></label>}<label>{t("子文件夹")}<select value={grouping} onChange={(event)=>setGrouping(event.target.value)}><option value="none">{t("不分子文件夹")}</option><option value="date">{t("按日期")}</option><option value="album">{t("按相册")}</option></select></label>{grouping==='album' && <p className="dialog-hint">{t("整册导出使用相册名；多选媒体使用关联的首个普通相册，未加入相册的项目放入“未分类”。")}</p>}<label className="check-label"><input type="checkbox" checked={stripGps} onChange={(event) => setStripGps(event.target.checked)} />{t("导出脱敏副本，清除 GPS")}</label><label className="check-label"><input type="checkbox" checked={xmp} onChange={(event) => setXmp(event.target.checked)} />{t("同时导出 XMP 侧车（标签和评分）")}</label><label className="check-label"><input type="checkbox" checked={openAfter} onChange={(event) => setOpenAfter(event.target.checked)} />{t("关闭任务面板后打开目标文件夹")}</label><p className="dialog-hint">{t("复制原文件或拖出可能保留 EXIF。暂不支持安全脱敏的格式会报告失败，不会交付含 GPS 的原件。")}</p>{error && <p className="form-error">{translateMessage(error)}</p>}</div><div className="dialog-footer library-dialog-actions"><ActionButton type="button" className="ghost" onClick={onClose}>{t("取消")}</ActionButton><ActionButton type="submit" className="primary" disabled={!directory}>{t("导出")}</ActionButton></div></ActionForm></div>;
}

export function DeleteDialog({ ids, onClose, onDone, forcePermanent = false, introduction, beforeDelete, blocked=false,cleanup,onJobStarted }: { ids: string[]; onClose: () => void; onDone: (results: Result[],mode:string) => Promise<void>; forcePermanent?: boolean; introduction?:React.ReactNode|((busy:boolean)=>React.ReactNode); blocked?:boolean; cleanup?:unknown;onJobStarted?:(id:string,mode:string)=>void;beforeDelete?:()=>Promise<unknown> }) {
  const cancelled=useRef(false);
  const [outcomes,setOutcomes] = useState<Result[]>([]);
  const [mode, setMode] = useState(forcePermanent ? 'permanent' : 'software'); const [preview, setPreview] = useState<any>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [second, setSecond] = useState(false);
  const dialogRef=useModalEscape<HTMLElement>(onClose,busy);
  useEffect(()=>{let valid=true;setPreview(null);setOutcomes([]);setSecond(false);void window.lumina.command({type:'trash.preview',mediaIds:ids}).then((value)=>{if(valid)setPreview(value);}).catch((reason)=>{if(valid)setError(userErrorMessage(reason));});return()=>{valid=false;};},[ids]);
  useEffect(()=>{if(!forcePermanent)void window.lumina.command({type:'organization.settings'}).then((settings)=>setMode(settings.deleteMode)).catch((reason)=>setError(userErrorMessage(reason)));},[]);
  async function perform() {
    cancelled.current=false;setBusy(true); setError('');
    const pendingIds = outcomes.length ? outcomes.filter((item) => !item.ok).map((item) => item.id) : ids;
    try {
      if(ids.length>1 || cleanup){const job=await startBackgroundJob({type:'jobs.start',kind:'delete',mediaIds:pendingIds,deleteMode:mode,cleanup});onJobStarted?.(job.id,mode);onClose();return;}
      await beforeDelete?.();
      if(cancelled.current){setError(t("已取消，未执行删除"));return;}
      const results: Result[] = [];
      for (let offset=0;offset<pendingIds.length;offset+=1000) {
        if(cancelled.current){results.push(...pendingIds.slice(offset).map((id)=>({id,ok:false,error:"已取消，未执行"})));break;}
        const mediaIds=pendingIds.slice(offset,offset+1000);
        const batch: Result[] = await window.lumina.command(mode === 'software' ? { type: 'trash.put', mediaIds } : { type: 'trash.purge', mediaIds, destination: mode }); results.push(...batch);
        if (batch.some((item)=>item.error==='已取消，未执行')) { results.push(...pendingIds.slice(offset+1000).map((id)=>({id,ok:false,error:"已取消，未执行"}))); break; }
      }
      const merged = new Map(outcomes.map((item)=>[item.id,item])); for (const item of results) merged.set(item.id,item); setOutcomes([...merged.values()]);
      if(results.every(item=>item.ok)){onClose();void onDone(results,mode).catch(error=>window.dispatchEvent(new CustomEvent('lumina-action-error',{detail:userErrorMessage(error)})));return;}await onDone(results,mode);
    } catch (reason) { setError(userErrorMessage(reason)); } finally { setBusy(false); }
  }
  return <div className="dialog-backdrop"><section ref={dialogRef} className="tag-dialog" role="dialog" aria-label={t("从图库删除")}><div className="dialog-head"><strong>{t("从图库删除")}</strong></div><div className="library-fields">{typeof introduction==='function'?introduction(busy):introduction}<p>{preview ? t("{0} 项 · {1} · 涉及 {2} 个相册", [preview.count, bytesText(preview.sizeBytes), preview.albumCount]) : t("正在核对影响范围…")}</p><label>{t("删除目的地")}<select value={mode} disabled={busy} onChange={(event) => { setMode(event.target.value); setSecond(false); }}><option value="software">{t("软件回收站 · 可恢复")}</option><option value="system">{t("Windows 回收站")}</option><option value="permanent">{t("永久删除 · 无法还原")}</option></select></label><p>{mode === 'software' ? t("文件移入软件回收站，并保留标签、评分和相册信息。") : mode === 'system' ? t("文件交给 Windows 回收站；系统不支持时会保留原文件。") : t("文件将从磁盘彻底删除，不经过回收站。")}</p>{second && <p className="form-error">{t("请再次确认：永久删除无法还原。")}</p>}<BatchOutcomeReport results={outcomes} />{error && <p className="form-error">{translateMessage(error)}</p>}</div><div className="dialog-footer library-dialog-actions"><ActionButton className="ghost" disabled={busy} onClick={onClose}>{t("取消")}</ActionButton>{busy && <ActionButton className="ghost" onClick={()=>{cancelled.current=true;setError(t("正在取消，当前文件处理完成后停止"));return window.lumina.command({type:'trash.cancel'});}}>{t("取消未执行项")}</ActionButton>}<ActionButton className="ghost" disabled={busy || blocked || !preview} onClick={async () => { if (mode === 'permanent' && !second) setSecond(true); else await perform(); }}>{busy ? t("处理中…") : outcomes.length ? t("仅重试失败项") : second ? t("确认永久删除") : t("确认删除")}</ActionButton></div></section></div>;
}

export function BatchOutcomeReport({ results }: { results: Result[] }) {
  const [limit,setLimit]=useState(50); const failures=results.filter((item)=>!item.ok); if (!results.length) return null;
  return <div className="batch-results" role="status"><p>{t("成功")}{results.filter((item)=>item.ok).length}{t("项 · 失败/未执行")}{failures.length}{t("项")}</p>{failures.slice(0,limit).map((item)=><p key={item.id}><strong>{item.path || item.id}</strong><br />{userErrorMessage(item.error)}</p>)}{failures.length>limit && <ActionButton className="ghost" type="button" onClick={()=>setLimit((count)=>count+50)}>{t("显示更多失败明细")}</ActionButton>}</div>;
}

function expiryText(item:Media){const expires=(item as Media & {expiresAt?:string|null}).expiresAt;if(!expires)return t("不过期");const days=Math.ceil((Date.parse(expires)-Date.now())/86400000);return days>0?t("剩余 {0} 天", [days]):t("已到期");}
