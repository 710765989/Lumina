import {ActionButton} from './ActionControls';
import {usePageLocation} from './useAppNavigation';
import {CollectionMediaView,useCollectionView,type CollectionSort} from './CollectionMediaView';
import {userErrorMessage} from './user-error';
import {TagEditor,TagDeleteDialog} from './TagEditor';
import { matchesSearch,describeTagGraph,tagParents,tagOccurrences,tagDescendants,tagLabel } from '@lumina/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [pendingMove,setPendingMove]=useState<{id:string;fromParentId:string|null;parentId:string|null;saved?:boolean}|null>(null);const savingMove=useRef(false);
  const tags=useMemo(()=>{
    if(!pendingMove)return savedTags;
    return describeTagGraph(savedTags.map(tag=>tag.id===pendingMove.id?{...tag,parentIds:[...new Set([...tagParents(tag).filter(id=>id!==pendingMove.fromParentId),...(pendingMove.parentId?[pendingMove.parentId]:[])])]}:tag));
  },[savedTags,pendingMove]);
  useEffect(()=>{if(!pendingMove?.saved)return;const saved=savedTags.find(tag=>tag.id===pendingMove.id);if(saved && (!pendingMove.fromParentId || !tagParents(saved).includes(pendingMove.fromParentId)) && (!pendingMove.parentId || tagParents(saved).includes(pendingMove.parentId)))setPendingMove(null);},[savedTags,pendingMove]);
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
  const [draggingTag,setDraggingTag]=useState<string|null>(null);const [dragOverTag,setDragOverTag]=useState<string|null>(null);
  function canDrop(parentId:string|null){if(savingMove.current)return false;const source=occurrences.find(row=>row.key===draggingTag);if(!source)return false;try{describeTagGraph(tags.map(row=>row.id===source.id?{...row,parentIds:[...tagParents(row).filter(id=>id!==source.parentId),...(parentId?[parentId]:[])]}:row));return true;}catch{return false;}}
  async function dropTag(parentId:string|null){
    if(savingMove.current)return;
    const source=occurrences.find(row=>row.key===draggingTag);if(!source || !canDrop(parentId)){setError('不能拖到自身或后代标签下，且最多支持5级层级');return;}
    setDraggingTag(null);setDragOverTag(null);if(source.parentId===parentId)return;
    savingMove.current=true;setError('');setPendingMove({id:source.id,fromParentId:source.parentId,parentId});setCollapsed(new Set());let saved=false;
    try{await window.lumina.command({type:'tags.moveReference',id:source.id,fromParentId:source.parentId,parentId});saved=true;await onChanged();setPendingMove(null);}
    catch(reason){if(!saved)setPendingMove(null);else setPendingMove(current=>current?{...current,saved:true}:null);setError(saved?`层级已保存，刷新失败：${userErrorMessage(reason)}`:`保存失败，已恢复原层级：${userErrorMessage(reason)}`);}
    finally{savingMove.current=false;}
  }
  const visibleTags=occurrences.filter(tag=>query?[tag.path,tag.englishName??'',...(tag.aliases??[])].some(value=>matchesSearch(value,query)):![...collapsed].some(key=>tag.key.startsWith(key+'/')));
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
  return <section className="content tags-content">
    <div className="section-head"><div><h2>{activeTag ? `#${tagLabel(activeTag)}` : '标签'}</h2>{activeTag && <span className="tag-breadcrumb">{activeTag.path??activeTag.name}</span>}<p>{activeTag ? '查看关联的照片与视频' : '使用标签整理照片与视频。'}</p></div><div className="section-actions">{activeTag && <><ActionButton className="ghost" onClick={() => openTag(parentKey)}>返回上一级</ActionButton></>}<ActionButton className="primary" onClick={() => {setNewParent(null);setEditor('create');}}>＋ 新建标签</ActionButton></div></div>
    {!activeTag && <><p className="tag-merge-notice">合并标签不可撤销：照片会归入目标标签，并改变引用它们的智能相册结果。执行前会核对影响数量和包含/排除冲突。</p><div className="tag-search-toolbar"><input className="organization-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标签..." /><label className="tag-search-order">标签搜索顺序<select aria-label="标签搜索顺序" value={searchOrder} disabled={savingOrder} onChange={async event=>{const previous=searchOrder,order=event.target.value as 'recent'|'name';setSearchOrder(order);setSavingOrder(true);try{await window.lumina.command({type:'tags.configureSearch',order});await onChanged();}catch(reason){setSearchOrder(previous);setError(userErrorMessage(reason));}finally{setSavingOrder(false);}}}><option value="recent">最近选择</option><option value="name">按名称（子标签跟随父标签）</option></select></label></div></>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {activeTag ? <>
      {childTags.length>0 && <div className="tag-child-list"><span>全部子标签 · {childTags.length}</span>{childTags.map((tag)=><ActionButton className="ghost" key={tag.key} onClick={()=>openTag(tag.key)}>{tag.path} · {tag.count??0} 项</ActionButton>)}</div>}
      <CollectionMediaView selectionSource={{scope:'tag',id:activeId,...settings.filters,sortBy:settings.sortBy,sort:settings.sort}} tagRevision={savedTags} settings={settings} tags={savedTags} summary={stats} onClear={onClear} onSelectMany={onSelectMany} windowKey={`${activeId}:${settings.sortBy}:${settings.sort}:${settings.filterKey}`} items={items} thumbnails={thumbnails} selected={selected} onToggle={onSelect} onOpen={onOpen} onVisible={onVisible} onContextMenu={onContextMenu} hasMore={more} loadingMore={loading} onEndReached={()=>void loadMore()} empty={<div className="empty compact"><h3>{loading?'正在加载关联媒体…':'暂无关联媒体'}</h3>{!loading && <p>可在图库中选择媒体并添加此标签。</p>}</div>}/>

    </> : tags.length ? <div className="tag-management-list">{<div className="tag-root-drop" onDragOver={(event)=>{if(canDrop(null)){event.preventDefault();setDragOverTag(null);}}} onDrop={(event)=>{event.preventDefault();void dropTag(null);}}>{pendingMove?pendingMove.saved?'层级已保存':'正在保存标签层级…':draggingTag?'拖到此处解除当前父标签引用':'拖动可移动当前引用；编辑标签可添加多个父标签'}</div>}{[{key:'directory',label:'目录标签',directory:true},{key:'ordinary',label:'普通标签',directory:false}].map(group=>{const rows=visibleTags.filter(tag=>Boolean(tag.directory)===group.directory);return <section key={group.key} className="tag-type-section" aria-label={group.label}><h3>{group.label}<small>{new Set(rows.map(tag=>tag.id)).size} 个</small></h3>{!rows.length && <p className="tag-type-empty">{query?'没有匹配的标签':'暂无'+group.label}</p>}{rows.map((tag) => <article className={`tag-management-row${dragOverTag===tag.key?' tag-drop-target':''}`} onDragOver={(event)=>{if(canDrop(tag.id)){event.preventDefault();event.dataTransfer.dropEffect='move';setDragOverTag(tag.key);}}} onDragLeave={()=>setDragOverTag(null)} onDrop={(event)=>{event.preventDefault();void dropTag(tag.id);}} key={tag.key} style={{marginLeft:Math.max(0,(tag.depth??1)-1)*14}} data-tag-id={tag.id} data-tag-key={tag.key} data-depth={tag.depth??1}><span className="tag-drag-handle" draggable={!tag.directory && (!pendingMove || pendingMove.saved)} title={`拖动标签 ${tag.name}`} onDragStart={(event)=>{event.dataTransfer.setData('application/x-lumina-tag',tag.id);event.dataTransfer.effectAllowed='move';setDraggingTag(tag.key);}} onDragEnd={()=>{setDraggingTag(null);setDragOverTag(null);}}>⠿</span>{(tag.childCount??0)>0?<ActionButton className="tag-tree-toggle" aria-label={`${collapsed.has(tag.key)?'展开':'折叠'}子标签 ${tag.name}`} onClick={()=>setCollapsed((current)=>{const next=new Set(current);if(next.has(tag.key))next.delete(tag.key);else next.add(tag.key);return next;})}>{collapsed.has(tag.key)?'›':'⌄'}</ActionButton>:<span className="tag-tree-leaf">{tag.parentId?'└':''}</span>}{!tag.directory && <span className="tag-color-dot" style={{ color: tag.color }}>●</span>}<span className={tag.directory?"directory-tag-badge":"ordinary-tag-badge"}>{tag.directory?'▱ 目录':'标签'}</span><ActionButton className="tag-browse" title={tag.path} onClick={() => openTag(tag.key)}>#{tagLabel(tag)}</ActionButton><span className="tag-detail-summary">{tag.count ?? 0} 项{(tag.parentIds?.length??0)>1?` · 共享于 ${tag.parentIds!.length} 个父标签`:''}{tag.blocked ? ' · 关联媒体已隐藏' : ''}</span><div className="section-actions"><ActionButton className="ghost" disabled={(tags.find(row=>row.id===tag.id)?.depth??1)>=5} aria-label={`新增子标签 ${tag.name}`} onClick={()=>{setNewParent(tag.id);setEditor('create');}}>新增子标签</ActionButton><ActionButton className="ghost" aria-label={`编辑标签 ${tag.name}`} onClick={() => setEditor(tag)}>编辑</ActionButton><ActionButton className="ghost" onClick={() => setOptions(tag)}>属性</ActionButton><ActionButton className="ghost" onClick={() => setMerging(tag)}>合并</ActionButton><ActionButton className="ghost" aria-label={`删除标签 ${tag.name}`} onClick={() => setDeleting(tag)}>删除</ActionButton></div></article>)}</section>;})}</div> : <div className="empty compact"><h3>还没有标签</h3><p>点击“新建标签”，或在图库中为媒体添加标签。</p></div>}
    {visibility && <LibraryConfirmDialog confirmLabel={visibility.tag.blocked?'恢复显示':'确认隐藏'} title={visibility.tag.blocked?'恢复标签关联媒体':'隐藏标签关联媒体'} description={visibility.tag.blocked?`取消「${visibility.tag.name}」的标签隐藏，共关联 ${visibility.total} 项；单独隐藏或命中其他隐藏标签的媒体仍保持隐藏。`:`通过「${visibility.tag.name}」隐藏目前 ${visibility.visible} 项可见媒体。之后关联该标签的媒体也会隐藏；标签与原文件保留，可随时恢复显示。`} onClose={()=>setVisibility(null)} onConfirm={async()=>{await window.lumina.command({type:'tags.setHidden',id:visibility.tag.id,hidden:!visibility.tag.blocked});onClear?.();await onChanged();}}/>}
    {options && <TagOptionsDialog tag={options} onClose={() => setOptions(null)} onChanged={onChanged} />}
    {merging && <TagMergeDialog source={merging} tags={tags} onClose={() => setMerging(null)} onChanged={onChanged} />}
    {editor && <TagEditor tag={editor} tags={tags} parentId={newParent} onClose={()=>setEditor(null)} onSaved={onChanged}/>}
    {deleting && <TagDeleteDialog tag={deleting} onClose={()=>setDeleting(null)} onDeleted={async(cascade,referenceOnly)=>{if(activeId===deleting.id || cascade && activeTag && isDescendant(activeTag,deleting.id))openTag(null);await onChanged();}}/>}

  </section>;
}
