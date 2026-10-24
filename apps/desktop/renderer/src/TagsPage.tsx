import {matchesSearch,useTagSearch} from './localized-search';
import {t,translateMessage} from './i18n';
import {ActionButton} from './ActionControls';
import {usePageLocation} from './useAppNavigation';
import {CollectionMediaView,useCollectionView,type CollectionSort} from './CollectionMediaView';
import {userErrorMessage} from './user-error';
import {TagEditor,TagDeleteDialog} from './TagEditor';
import { describeTagGraph,tagParents,tagOccurrences,tagDescendants,tagLabel } from '@lumina/contracts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {GridLayoutMotion,layoutMotionDuration} from './grid-layout-motion';
import {useTagTreeDrag} from './useTagTreeDrag';
import {applyTagDrop,tagDropRenderKey,type TagDropPlan} from './tag-drop-plan';
import {useMediaActivity} from './MediaActivity';
import { LibraryConfirmDialog, LibraryFormDialog } from './LibraryDialogs';
import { VirtualMediaGrid } from './VirtualMediaGrid';
import { TagOptionsDialog, TagMergeDialog } from './TagManagement';

import type {Tag} from './media-types';
type Media = { id: string; absolutePath: string; kind: string; hidden: boolean; sizeBytes: number; modifiedAtMs: number };
type Props = {
  onClear?:()=>void;onSelectMany?:(ids:Set<string>)=>void;onSortChange?:(sort:CollectionSort)=>void;
  onTagChange?:(id:string|null)=>void;
  onLoadMoreReady?:(load:()=>void)=>void;
  tags: Tag[]; thumbnails: Record<string, string>; selected: Set<string>;
  onChanged: () => Promise<void>; onMediaChange: (items: Media[]) => void;
  onSelect: (id: string, event: React.MouseEvent<HTMLElement>) => void;
  onOpen: (item: Media) => void; onVisible: (items: Media[]) => void;
  onContextMenu: (item: Media, event: React.MouseEvent<HTMLElement>) => void;
};

export function TagsPage({ tags:savedTags, thumbnails, selected, onChanged, onMediaChange, onSelect, onOpen, onVisible, onContextMenu,onLoadMoreReady,onTagChange,onClear,onSelectMany,onSortChange }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const settings=useCollectionView('tags',activeId);
  const [stats,setStats]=useState<{total:number;photo:number;video:number}>();
  useEffect(()=>{onSortChange?.({...settings.filters,sortBy:settings.sortBy,sort:settings.sort});},[settings.sortBy,settings.sort,settings.filterKey,onSortChange]);
  useEffect(()=>{onClear?.();},[activeId,settings.filterKey]);
  const [activeKey,setActiveKey]=useState<string|null>(null);
  const active=useMediaActivity(),listRef=useRef<HTMLDivElement>(null),[layoutMotion]=useState(()=>new GridLayoutMotion());
  const [pendingMove,setPendingMove]=useState<(TagDropPlan&{saved?:boolean})|null>(null),[settledTransfer,setSettledTransfer]=useState<TagDropPlan|null>(null);const savingMove=useRef(false),settleTimer=useRef<number>();
  const baseTags=useMemo(()=>applyTagDrop(savedTags,pendingMove),[savedTags,pendingMove]);
  const {drag,landingKey,start:startDrag}=useTagTreeDrag({tags:baseTags,list:listRef,blocked:savingMove.current,active,onCommit:plan=>void dropTag(plan)});
  const tags=useMemo(()=>applyTagDrop(baseTags,drag?.plan??null),[baseTags,drag?.plan]);
  const motionTransfer=drag?.plan??pendingMove??settledTransfer;
  useEffect(()=>{const stop=()=>layoutMotion.stop();window.addEventListener('lumina-motion-changed',stop);return()=>{window.clearTimeout(settleTimer.current);layoutMotion.clear();window.removeEventListener('lumina-motion-changed',stop);};},[layoutMotion]);
  useEffect(()=>{if(!pendingMove?.saved)return;const saved=savedTags.find(tag=>tag.id===pendingMove.id);if(saved&&JSON.stringify([...tagParents(saved)].sort())===JSON.stringify(pendingMove.parentIds)&&Boolean(saved.rootReference)===pendingMove.rootReference)setPendingMove(null);},[savedTags,pendingMove]);
  const searchRevision=useTagSearch(tags);
  const occurrences=useMemo(()=>tagOccurrences(tags),[tags]);
  function openTag(key:string|null){const row=occurrences.find(tag=>tag.key===key);setActiveId(row?.id??null);setActiveKey(row?.key??null);}


  useEffect(()=>{const home=(event:Event)=>{if((event as CustomEvent).detail==='tags'){setActiveId(null);setActiveKey(null);setQuery('');}};window.addEventListener('lumina-page-home',home);return()=>window.removeEventListener('lumina-page-home',home);},[]);
  const [items, setItems] = useState<Media[]>([]);
  const [editor, setEditor] = useState<Tag | 'create' | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [options, setOptions] = useState<Tag | null>(null);
  const [merging, setMerging] = useState<Tag | null>(null);
  const [visibility,setVisibility]=useState<{tag:Tag;total:number;visible:number}|null>(null);
  async function editVisibility(tag:Tag){try{const preview=await window.lumina.command({type:'tags.visibilityPreview',id:tag.id});setVisibility({tag,total:preview.total,visible:preview.visible});}catch(reason){setError(userErrorMessage(reason));}}
  const [searchOrder,setSearchOrder]=useState<'recent'|'name'>('recent');const [savingOrder,setSavingOrder]=useState(false);useEffect(()=>{void window.lumina.command({type:'tags.searchPreferences'}).then(preference=>setSearchOrder(preference.order)).catch(reason=>setError(userErrorMessage(reason)));},[]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);const [refreshEpoch,setRefreshEpoch]=useState(0);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const loadingRef = useRef(false);
  useEffect(()=>{onTagChange?.(activeId);return()=>onTagChange?.(null);},[activeId,onTagChange]);
  const activeTag = occurrences.find(tag=>tag.id===activeId && tag.key===activeKey)??occurrences.find(tag=>tag.id===activeId);
  const [newParent,setNewParent]=useState<string|null>(null);const [collapsed,setCollapsed]=useState(new Set<string>());
  function isDescendant(tag:Tag,parent:string){return tag.id!==parent && tagDescendants(tags,parent).has(tag.id);}
  const childTags=activeTag?occurrences.filter(row=>row.key.startsWith(activeTag.key+'/')):[];
  const draggingTag=drag?.sourceKey??null,dragOverTag=drag?.plan?.targetKey??null;
  async function dropTag(plan:TagDropPlan){
    if(savingMove.current)return;
    savingMove.current=true;setError('');setPendingMove(plan);setSettledTransfer(plan);window.clearTimeout(settleTimer.current);settleTimer.current=window.setTimeout(()=>setSettledTransfer(null),layoutMotionDuration+80);
    setCollapsed(current=>new Set([...current].filter(key=>plan.targetKey!==key&&!plan.targetKey?.startsWith(key+'/'))));let saved=false;
    try{await window.lumina.command({type:'tags.moveReference',id:plan.id,fromParentId:plan.fromParentId,parentId:plan.parentId,copy:plan.copy});saved=true;await onChanged();setPendingMove(null);}
    catch(reason){if(!saved)setPendingMove(null);else setPendingMove(current=>current?{...current,saved:true}:null);setError(saved?t("引用已保存，刷新失败：{0}", [userErrorMessage(reason)]):t("保存失败，已恢复原层级：{0}", [userErrorMessage(reason)]));}
    finally{savingMove.current=false;}
  }
  const openPath=drag?.plan?.targetKey??pendingMove?.targetKey;
  const visibleTags=useMemo(()=>occurrences.filter(tag=>query?[tag.path,tag.englishName??'',...(tag.aliases??[])].some(value=>matchesSearch(value,query))||Boolean(drag?.plan&&tag.key===drag.plan.newKey):![...collapsed].some(key=>tag.key.startsWith(key+'/')&&openPath!==key&&!openPath?.startsWith(key+'/'))),[occurrences,query,collapsed,openPath,drag?.plan,searchRevision]);
  useLayoutEffect(()=>{const node=listRef.current;if(!node||!active){layoutMotion.clear();return;}layoutMotion.update(node,{top:node.scrollTop,left:node.scrollLeft});},[visibleTags,motionTransfer,active]);
  const parentKey=activeTag?.pathIds.slice(0,-1).join('/')??null;
  useEffect(()=>{const back=(event:Event)=>{if((event as CustomEvent).detail==='tags')openTag(parentKey);};window.addEventListener('lumina-page-back',back);return()=>window.removeEventListener('lumina-page-back',back);},[parentKey,occurrences]);



  useEffect(() => {
    const version = ++requestVersion.current;
    setItems([]); onMediaChange([]); setMore(false); setError('');
    if (!activeId) { setLoading(false); return; }
    setLoading(true);
    void Promise.all([window.lumina.command({ type: 'tags.media',...settings.filters,sortBy:settings.sortBy,sort:settings.sort, id: activeId, limit: 200 }),window.lumina.command({type:'tags.filteredStats',id:activeId,...settings.filters})]).then(([result,summary]:[Media[],any]) => {
      if (version !== requestVersion.current) return;
      setStats(summary);setItems(result); onMediaChange(result); setMore(result.length === 200);
    }).catch((reason: Error) => { if (version === requestVersion.current) setError(userErrorMessage(reason)); })
      .finally(() => { if (version === requestVersion.current) setLoading(false); });
    return () => { requestVersion.current += 1; };
  }, [activeId, onMediaChange,activeTag?.blocked,settings.sortBy,settings.sort,settings.filterKey,refreshEpoch]);

  async function loadMore() {
    if (!more || loading || loadingRef.current || !activeId) return;
    const version = requestVersion.current;
    loadingRef.current = true; setLoading(true);
    try {
      const next = await window.lumina.command({ type: 'tags.media',...settings.filters,sortBy:settings.sortBy,sort:settings.sort, id: activeId, limit: 200, offset: items.length }) as Media[];
      if (version !== requestVersion.current) return;
      const all = [...items, ...next]; setItems(all); onMediaChange(all); setMore(next.length === 200);
    } catch (reason) { if (version === requestVersion.current) setError(userErrorMessage(reason)); }
    finally { loadingRef.current = false; if (version === requestVersion.current) setLoading(false); }
  }

  useEffect(()=>{onLoadMoreReady?.(()=>void loadMore());return()=>onLoadMoreReady?.(()=>{});},[onLoadMoreReady,more,items,activeId,loading,settings.sortBy,settings.sort,settings.filterKey]);
  usePageLocation('tags',{key:activeKey},location=>openTag(location?.key??null),async()=>{await onChanged();setRefreshEpoch(value=>value+1);});
  return <><section className="content tags-content">
    <div className="section-head"><div><h2>{activeTag ? `#${tagLabel(activeTag)}` : t("标签")}</h2>{activeTag && <span className="tag-breadcrumb">{activeTag.path??activeTag.name}</span>}<p>{activeTag ? t("查看关联的照片与视频") : t("使用标签整理照片与视频。")}</p></div><div className="section-actions">{activeTag && <><ActionButton className="ghost" onClick={() => openTag(parentKey)}>{t("返回上一级")}</ActionButton></>}<ActionButton className="primary" onClick={() => {setNewParent(null);setEditor('create');}}>{t("＋ 新建标签")}</ActionButton></div></div>
    {!activeTag && <><div className="tag-search-toolbar"><input className="organization-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("搜索标签...")} /><label className="tag-search-order">{t("标签搜索顺序")}<select aria-label={t("标签搜索顺序")} value={searchOrder} disabled={savingOrder} onChange={async event=>{const previous=searchOrder,order=event.target.value as 'recent'|'name';setSearchOrder(order);setSavingOrder(true);try{await window.lumina.command({type:'tags.configureSearch',order});await onChanged();}catch(reason){setSearchOrder(previous);setError(userErrorMessage(reason));}finally{setSavingOrder(false);}}}><option value="recent">{t("最近选择")}</option><option value="name">{t("按名称（子标签跟随父标签）")}</option></select></label></div></>}
    {error && <p className="form-error" role="alert">{translateMessage(error)}</p>}
    {activeTag ? <>
      {childTags.length>0 && <div className="tag-child-list"><span>{t("全部子标签 ·")}{childTags.length}</span>{childTags.map((tag)=><ActionButton className="ghost" key={tag.key} onClick={()=>openTag(tag.key)}>{tag.path} · {tag.count??0}{t("项")}</ActionButton>)}</div>}
      <CollectionMediaView selectionSource={{scope:'tag',id:activeId,...settings.filters,sortBy:settings.sortBy,sort:settings.sort}} tagRevision={savedTags} settings={settings} tags={savedTags} summary={stats} onClear={onClear} onSelectMany={onSelectMany} windowKey={`${activeId}:${settings.sortBy}:${settings.sort}:${settings.filterKey}`} items={items} thumbnails={thumbnails} selected={selected} onToggle={onSelect} onOpen={onOpen} onVisible={onVisible} onContextMenu={onContextMenu} hasMore={more} loadingMore={loading} onEndReached={()=>void loadMore()} empty={<div className="empty compact"><h3>{loading?t("正在加载关联媒体…"):t("暂无关联媒体")}</h3>{!loading && <p>{t("可在图库中选择媒体并添加此标签。")}</p>}</div>}/>

    </> : tags.length ? <div ref={listRef} className="tag-management-list">{[{key:'directory',label:t("目录标签"),directory:true},{key:'ordinary',label:t("普通标签"),directory:false}].map(group=>{const rows=visibleTags.filter(tag=>Boolean(tag.directory)===group.directory);return <section key={group.key} className="tag-type-section" aria-label={t(group.label)}><h3 data-layout-key={`tag-group:${group.key}`}>{t(group.label)}<small>{new Set(rows.map(tag=>tag.id)).size}{t("个")}</small></h3>{!rows.length && <p className="tag-type-empty">{query?t("没有匹配的标签"):t("暂无")+group.label}</p>}{rows.map((tag) => <article className={`tag-management-row${dragOverTag===tag.key?' tag-drop-target':''}${drag?.plan?.newKey===tag.key||landingKey===tag.key?' tag-drop-placeholder':''}${draggingTag===tag.key&&!drag?.copy?' tag-drag-origin':''}`} data-copy={drag?.copy?'true':undefined} data-layout-key={`tag:${tagDropRenderKey(tag.key,motionTransfer)}`} key={tagDropRenderKey(tag.key,motionTransfer)} style={{marginLeft:Math.max(0,(tag.depth??1)-1)*14}} data-tag-id={tag.id} data-tag-key={tag.key} data-depth={tag.depth??1}><span className="tag-drag-handle" draggable={false} aria-disabled={Boolean(tag.directory)||Boolean(pendingMove)} aria-label={t("拖动标签 {0}", [tag.name])} title={tag.directory?t("目录标签的层级请在目录设置中修改"):t("拖动移动引用；Ctrl＋拖动复制引用")} onPointerDown={event=>{if(!tag.directory)startDrag(event,tag.key);}}>⠿</span>{(tag.childCount??0)>0?<ActionButton className="tag-tree-toggle" aria-label={t("{0}子标签 {1}", [collapsed.has(tag.key)?t("展开"):t("折叠"), tag.name])} onClick={()=>setCollapsed((current)=>{const next=new Set(current);if(next.has(tag.key))next.delete(tag.key);else next.add(tag.key);return next;})}>{collapsed.has(tag.key)?'›':'⌄'}</ActionButton>:<span className="tag-tree-leaf">{tag.parentId?'└':''}</span>}{!tag.directory && <span className="tag-color-dot" style={{ color: tag.color }}>●</span>}<span className={tag.directory?"directory-tag-badge":"ordinary-tag-badge"}>{tag.directory?t("▱ 目录"):t("标签")}</span><ActionButton className="tag-browse" title={tag.path} onClick={() => openTag(tag.key)}>#{tagLabel(tag)}</ActionButton><span className="tag-detail-summary">{tag.count ?? 0}{t("项")}{tag.rootReference&&(tag.parentIds?.length??0)>0?t(" · 顶级及 {0} 个父标签", [tag.parentIds!.length]):(tag.parentIds?.length??0)>1?t(" · 共享于 {0} 个父标签", [tag.parentIds!.length]):''}{tag.blocked ? t(" · 关联媒体已隐藏") : ''}</span><div className="section-actions"><ActionButton className="ghost" title={tag.directory?t("目录标签的层级请在目录设置中修改"):undefined} disabled={Boolean(tag.directory) || (tags.find(row=>row.id===tag.id)?.depth??1)>=5} aria-label={t("新增子标签 {0}", [tag.name])} onClick={()=>{setNewParent(tag.id);setEditor('create');}}>{t("新增子标签")}</ActionButton><ActionButton className="ghost" aria-label={t("编辑标签 {0}", [tag.name])} onClick={() => setEditor(tag)}>{t("编辑")}</ActionButton><ActionButton className="ghost" onClick={() => setOptions(tag)}>{t("属性")}</ActionButton><ActionButton className="ghost" onClick={() => setMerging(tag)}>{t("合并")}</ActionButton><ActionButton className="ghost" aria-label={t("删除标签 {0}", [tag.name])} onClick={() => setDeleting(tag)}>{t("删除")}</ActionButton></div></article>)}</section>;})}</div> : <div className="empty compact"><h3>{t("还没有标签")}</h3><p>{t("点击“新建标签”，或在图库中为媒体添加标签。")}</p></div>}
    {visibility && <LibraryConfirmDialog confirmLabel={visibility.tag.blocked?t("恢复显示"):t("确认隐藏")} title={visibility.tag.blocked?t("恢复标签关联媒体"):t("隐藏标签关联媒体")} description={visibility.tag.blocked?t("取消「{0}」的标签隐藏，共关联 {1} 项；单独隐藏或命中其他隐藏标签的媒体仍保持隐藏。", [visibility.tag.name, visibility.total]):t("通过「{0}」隐藏目前 {1} 项可见媒体。之后关联该标签的媒体也会隐藏；标签与原文件保留，可随时恢复显示。", [visibility.tag.name, visibility.visible])} onClose={()=>setVisibility(null)} onConfirm={async()=>{await window.lumina.command({type:'tags.setHidden',id:visibility.tag.id,hidden:!visibility.tag.blocked});onClear?.();await onChanged();}}/>}
    {options && <TagOptionsDialog tag={options} onClose={() => setOptions(null)} onChanged={onChanged} />}
    {merging && <TagMergeDialog source={merging} tags={tags} onClose={() => setMerging(null)} onChanged={onChanged} />}
    {editor && <TagEditor tag={editor} tags={tags} parentId={newParent} onClose={()=>setEditor(null)} onSaved={onChanged}/>}
    {deleting && <TagDeleteDialog tag={deleting} onClose={()=>setDeleting(null)} onDeleted={async(cascade,referenceOnly)=>{if(activeId===deleting.id || cascade && activeTag && isDescendant(activeTag,deleting.id))openTag(null);await onChanged();}}/>}

  </section>{!activeTag && <footer aria-label={t("标签拖动提示")} className={`organization-footer tag-management-footer tag-root-drop${draggingTag?' is-dragging':''}`}><span role="status">{pendingMove?pendingMove.saved?t("引用已保存"):pendingMove.copy?t("正在添加标签引用…"):t("正在保存标签层级…"):drag?.message|| (draggingTag?drag?.copy?t("复制引用：保留原位置，松手添加到目标位置"):t("移动引用：松手放置；按住 Ctrl 可复制引用"):t("拖动移动引用 · Ctrl＋拖动复制引用；拖到底栏可显示为顶级标签"))}</span></footer>}</>;
}
