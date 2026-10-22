import {AlbumBreadcrumbs} from './AlbumBreadcrumbs';
import {ActionButton,ActionForm} from './ActionControls';
import {usePageLocation} from './useAppNavigation';
import {CollectionMediaView,useCollectionView,type CollectionSort} from './CollectionMediaView';
import {tagLabel} from '@lumina/contracts';
import {userErrorMessage} from './user-error';
import {SmartExclusionsDialog} from './SmartExclusionsDialog';
import { useEffect, useLayoutEffect,useRef,useState } from 'react';
import {createPortal} from 'react-dom';
import { VirtualMediaGrid } from './VirtualMediaGrid';
import { MediaThumbnail } from './MediaThumbnail';
import { mediaAnimationProps } from './media-animation';
import {LibraryFormDialog} from './LibraryDialogs';
import { LibraryConfirmDialog } from './LibraryDialogs';
import { type Media, type Album, type Tag, type Rule } from './media-types';
import {useDismissableLayer} from './useDismissableLayer';
import { useModalEscape } from './useModalEscape';
import {filterAlbums} from './album-search';

type GridProps = Omit<React.ComponentProps<typeof VirtualMediaGrid>, 'items' | 'onEndReached'>;
type Props = GridProps & { onClear?:()=>void;onSelectMany?:(ids:Set<string>)=>void;onSortChange?:(sort:CollectionSort)=>void; albums: Album[]; tags: Tag[]; onChanged: () => Promise<void>; onMediaChange: (items: Media[]) => void; onAlbumChange: (album: Album | null) => void; onExportAlbum: (id: string) => void; onLoadMoreReady?:(load:()=>void)=>void };
const emptyRule = (): Rule => ({ relation: 'AND', tags: [], notTags: [], excludedMediaIds: [] });

export function AlbumsPage({ onClear,onSelectMany,onSortChange,albums, tags, onChanged, onMediaChange, onAlbumChange, onExportAlbum, onLoadMoreReady, ...grid }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const settings=useCollectionView('albums',activeId);
  const [stats,setStats]=useState<{total:number;photo:number;video:number}>();
  useEffect(()=>{onSortChange?.({...settings.filters,sortBy:settings.sortBy,sort:settings.sort});},[settings.sortBy,settings.sort,settings.filterKey,onSortChange]);
  useEffect(()=>{onClear?.();},[activeId,settings.filterKey]);
  const [items, setItems] = useState<Media[]>([]);
  const [editor, setEditor] = useState<Album | 'smart' | null>(null);
  const [folderEditor,setFolderEditor]=useState<Album|'create'|null>(null);
  const [deleting, setDeleting] = useState<Album | null>(null);

  const [actionMenu,setActionMenu]=useState<{album:Album;x:number;y:number}|null>(null);
  const [exclusions,setExclusions]=useState<Album|null>(null);

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0); const pending = useRef(false);const loadedScope=useRef('');
  useEffect(()=>{const home=(event:Event)=>{if((event as CustomEvent).detail==='albums'){setActiveId(null);setQuery('');setActionMenu(null);}};window.addEventListener('lumina-page-home',home);return()=>{window.removeEventListener('lumina-page-home',home);};},[]);
  const active = albums.find((album) => album.id === activeId) ?? null;
  useEffect(()=>{const back=(event:Event)=>{if((event as CustomEvent).detail==='albums')setActiveId(active?.parentId??null);};window.addEventListener('lumina-page-back',back);return()=>window.removeEventListener('lumina-page-back',back);},[active]);
  useEffect(() => { onAlbumChange(active); }, [activeId, albums, onAlbumChange]);
  async function load(reset: boolean, quiet=false) {
    if (!activeId || active?.kind==='folder' || pending.current && !reset) return;
    const version = reset ? ++request.current : request.current;
    pending.current = true; if(!quiet)setLoading(true); setError('');
    try {
      const scope=`${activeId}:${settings.sortBy}:${settings.sort}:${settings.filterKey}`;const target=reset && loadedScope.current===scope?Math.max(200,items.length):200;
      const rows: Media[] = []; let lastSize = 0; let limit = 200;
      do { limit = Math.min(1000,target-rows.length); const batch: Media[] = await window.lumina.command({ type: 'albums.media',...settings.filters,sortBy:settings.sortBy,sort:settings.sort, id: activeId, limit, offset: (reset ? 0 : items.length)+rows.length }); rows.push(...batch); lastSize = batch.length; if (batch.length < limit) break; } while (rows.length < target);
      const summary=reset?await window.lumina.command({type:'albums.filteredStats',id:activeId,...settings.filters}):null;
      if (request.current !== version) return;
      if(summary)setStats(summary);
      loadedScope.current=scope;const next = reset ? rows : [...items, ...rows]; if(JSON.stringify(next)!==JSON.stringify(items)){setItems(next);onMediaChange(next);} setMore(lastSize === limit);
    } catch (reason) { setError(userErrorMessage(reason)); } finally { if (request.current === version) { pending.current = false; setLoading(false); } }
  }
  useEffect(() => { if (!activeId || active?.kind==='folder') { setItems([]); onMediaChange([]); return; } void load(true,items.length===0 && activeId!==null); return () => { request.current++; pending.current = false; }; }, [activeId, albums,settings.sortBy,settings.sort,settings.filterKey]);
  useEffect(()=>{onLoadMoreReady?.(()=>{if(more)void load(false);});return()=>onLoadMoreReady?.(()=>{});},[onLoadMoreReady,more,items,activeId,settings.sortBy,settings.sort,settings.filterKey]);

  const refresh = async () => { await onChanged(); };
  const visibleAlbums=albums.filter(album=>!album.hiddenByVisibility);
  useEffect(()=>{if(active?.hiddenByVisibility)setActiveId(null);},[active?.hiddenByVisibility]);
  usePageLocation('albums',{id:activeId},location=>{setActiveId(location?.id&&albums.some(album=>album.id===location.id)?location.id:null);setActionMenu(null);},async()=>{await onChanged();if(activeId)await load(true);});
  const filtered = filterAlbums(visibleAlbums,query,activeId);
  return <section className={`content organization-page${active&&active.kind!=='folder'?' album-media-page':''}`}>
    <div className="section-head"><div className="album-page-heading">{active?.kind === 'smart' && <span className="smart-badge">智能相册</span>}<h2>{active?.name ?? '相册'}</h2>{active?.parentId && <AlbumBreadcrumbs albums={albums} activeId={active.id} onNavigate={setActiveId}/>}<p title={active?.description}>{active?.description || (active ? '暂无描述' : `${visibleAlbums.length} 个相册`)}</p></div><div className="section-actions">
      {active ? <><ActionButton className="ghost" onClick={() => setActiveId(active.parentId??null)}>返回</ActionButton>{active.kind==='smart' && <ActionButton className="ghost" onClick={()=>setExclusions(active)}>管理排除项 · {active.rule?.excludedMediaIds.length??0}</ActionButton>}<ActionButton className="ghost album-more-trigger" aria-label="相册更多操作" onClick={event=>{event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();setActionMenu({album:active,x:rect.right,y:rect.bottom+6});}}>···</ActionButton></>
      : null}{(!active||active.kind!=='smart') && <><ActionButton className="ghost" onClick={()=>setFolderEditor('create')}>+新建文件夹</ActionButton><ActionButton className="primary" onClick={()=>setEditor('smart')}>+新建智能相册</ActionButton></>}
    </div></div>
    {active?.kind==='smart' && <div className="smart-album-rule-summary" aria-label="当前管理标签"><div><span className="smart-rule-label">管理标签</span>{active.rule?.tags.length?<><small className="smart-rule-relation">{active.rule.relation==='AND'?'同时满足':'满足任一'}</small>{active.rule.tags.map(id=>{const tag=tags.find(tag=>tag.id===id);return <span className="smart-rule-pill" key={id} title={tag?.path}>#{tag?tagLabel(tag):'已删除标签'}</span>;})}</>:<span className="dialog-hint">暂无管理标签</span>}</div>{Boolean(active.rule?.notTags.length) && <div><span className="smart-rule-label">排除标签</span>{active.rule!.notTags.map(id=>{const tag=tags.find(tag=>tag.id===id);return <span className="smart-rule-pill excluded" key={id} title={tag?.path}>#{tag?tagLabel(tag):'已删除标签'}</span>;})}</div>}</div>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {(!active || filtered.length>0 || active.kind==='folder') && <div className={`album-browser${active&&active.kind!=='folder'?' album-children-browser':''}`}>
      {!active && <input className="organization-search" aria-label="搜索相册" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索相册名称或描述…"/>}
      {active && filtered.length>0 && <p className="album-children-heading">下级相册 · {filtered.length}</p>}
      <div className="album-card-grid" aria-label={active?'子相册':'相册搜索结果'}>{!filtered.length && <p className="dialog-hint" role="status">{query.trim()?'没有匹配的相册':'文件夹暂无相册，可在右上角新建。'}</p>}{filtered.map(album=><article data-album-id={album.id} key={album.id} className="album-cover-card list-card clickable" onClick={()=>setActiveId(album.id)}>
        <div className="album-cover">{album.kind==='folder'?<span className="album-folder-icon" aria-label="相册文件夹">▱</span>:album.cover?<MediaThumbnail key={album.cover.id} id={album.cover.id} kind={album.cover.kind} source={window.lumina.mediaUrl('thumbnail',album.cover.id)} {...mediaAnimationProps(album.cover)}/>:<span>▱</span>}</div>
        <div className="album-caption"><div className="album-card-heading"><div className="album-card-title"><strong title={album.name}>{album.name}</strong>{album.kind==='smart'&&<span className="smart-badge">智能</span>}{album.kind==='folder'&&<span className="smart-badge">文件夹</span>}</div><ActionButton className="icon-button album-card-more" aria-label={`相册操作 ${album.name}`} onClick={event=>{event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();setActionMenu({album,x:rect.right,y:rect.bottom+6});}}>···</ActionButton></div><p title={album.description||'暂无描述'}>{album.description||'暂无描述'}</p>
        {album.kind==='smart'&&<div className="album-card-tags" aria-label="相册管理标签">{(album.rule?.tags??[]).map(id=>{const tag=tags.find(tag=>tag.id===id);return <span className="smart-rule-pill" key={id} title={tag?.path}>#{tag?tagLabel(tag):'已删除标签'}</span>;})}{(album.rule?.notTags??[]).map(id=>{const tag=tags.find(tag=>tag.id===id);return <span className="smart-rule-pill excluded" key={id}>排除 #{tag?tagLabel(tag):'已删除标签'}</span>;})}</div>}
        <small>{album.kind==='folder'?`${albums.filter(child=>child.parentId===album.id).length} 个下级相册`:`${album.mediaCount??0} 项`}</small></div>
      </article>)}</div>
    </div>}
    {active && active.kind!=='folder' && <CollectionMediaView selectionSource={{scope:'album',id:activeId,...settings.filters,sortBy:settings.sortBy,sort:settings.sort}} tagRevision={tags} {...grid} settings={settings} tags={tags} summary={stats} onClear={onClear} onSelectMany={onSelectMany} windowKey={`${activeId}:${settings.sortBy}:${settings.sort}:${settings.filterKey}`} items={items} hasMore={more} loadingMore={loading} onEndReached={()=>{if(more)void load(false);}} empty={<div className="empty compact"><h3>{loading?'正在加载…':'相册暂无媒体'}</h3><p>{active.kind==='smart'?'编辑标签规则以匹配媒体。':'在图库选择照片或视频后，点击“加入相册”。'}</p></div>}/>}
    {actionMenu && <AlbumActionMenu folder={actionMenu.album.kind==='folder'} x={actionMenu.x} y={actionMenu.y} onClose={()=>setActionMenu(null)} onExport={()=>{const id=actionMenu.album.id;setActionMenu(null);onExportAlbum(id);}} onEdit={()=>{if(actionMenu.album.kind==='folder')setFolderEditor(actionMenu.album);else setEditor(actionMenu.album);setActionMenu(null);}} onDelete={()=>{setDeleting(actionMenu.album);setActionMenu(null);}}/>}
    {exclusions && <SmartExclusionsDialog album={exclusions} onClose={()=>setExclusions(null)} onChanged={refresh}/>}
    {editor && <AlbumEditor key={typeof editor==='object'?editor.id:'new'} album={editor} albums={albums} parentId={activeId} tags={tags} onClose={() => setEditor(null)} onSaved={refresh} />}
    {folderEditor && <AlbumFolderDialog folder={folderEditor} albums={albums} parentId={activeId} onClose={()=>setFolderEditor(null)} onSaved={refresh}/>}
    {deleting && <LibraryConfirmDialog title="删除相册" description={`删除「${deleting.name}」？${deleting.kind==='folder'?'文件夹中的下级相册将保留并移到上一层。':'仅删除相册和引用，不删除照片与视频。'}`} onClose={() => setDeleting(null)} onConfirm={async () => { await window.lumina.command({ type: 'albums.delete', id: deleting.id }); if (activeId === deleting.id) setActiveId(null); await refresh(); }} />}
  </section>;
}

function AlbumActionMenu({folder=false,x,y,onClose,onExport,onEdit,onDelete}:{folder?:boolean;x:number;y:number;onClose:()=>void;onExport:()=>void;onEdit:()=>void;onDelete:()=>void}){
  const ref=useRef<HTMLDivElement>(null);useDismissableLayer(true,onClose,[ref]);
  useLayoutEffect(()=>{const node=ref.current;if(!node)return;const rect=node.getBoundingClientRect();node.style.left=`${Math.max(8,Math.min(x-rect.width,innerWidth-rect.width-8))}px`;node.style.top=`${Math.max(8,Math.min(y,innerHeight-rect.height-8))}px`;node.querySelector<HTMLButtonElement>('button')?.focus();},[x,y]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();onClose();}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[onClose]);
  return createPortal(<div ref={ref} className="album-action-menu" role="menu" aria-label="相册操作" style={{left:x,top:y}} onClick={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const buttons=Array.from(ref.current!.querySelectorAll('button'));buttons[(buttons.indexOf(event.target as HTMLButtonElement)+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus();}}}>{!folder && <ActionButton type="button" role="menuitem" onClick={onExport}>导出相册</ActionButton>}<ActionButton type="button" role="menuitem" onClick={onEdit}>{folder?'编辑文件夹':'编辑相册'}</ActionButton><ActionButton type="button" role="menuitem" onClick={onDelete}>{folder?'删除文件夹':'删除相册'}</ActionButton></div>,document.body);
}

function AlbumEditor({ album, albums,parentId:initialParentId,tags, onClose, onSaved }: { album: Album | 'smart';albums:Album[];parentId:string|null; tags: Tag[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const existing = typeof album === 'object' ? album : null;
  const [parentId,setParentId]=useState<string|null>(existing?(existing.parentId??null):initialParentId);
  const managed=Boolean(existing?.description.startsWith('目录相册 · '));
  const [smart,setSmart]=useState(existing?existing.kind==='smart':true);
  const [name, setName] = useState(existing?.name ?? ''); const [description, setDescription] = useState(existing?.description ?? '');
  const [rule, setRule] = useState<Rule>(existing?.rule ?? emptyRule());
  const [tagIds, setTagIds] = useState<string[]>(existing?.tagIds ?? []);
  const [coverId, setCoverId] = useState<string | null>(existing?.manualCoverMediaId ?? null);
  const [coverEdited, setCoverEdited] = useState(false); const [coverImage, setCoverImage] = useState(existing?.cover);
  const [defaultCover,setDefaultCover]=useState<Media|null>(null);
  useEffect(()=>{let valid=true;if(existing)void window.lumina.command({type:'albums.defaultCover',id:existing.id,...(smart?{rule}:{})}).then((item)=>{if(valid)setDefaultCover(item);}).catch(()=>{if(valid)setDefaultCover(null);});return()=>{valid=false;};},[existing?.id,smart,rule]);
  const shownCover=coverEdited && coverId===null ? defaultCover : coverImage;
  const [preview, setPreview] = useState<any>(null); const [calculating, setCalculating] = useState(false);
  const [previewEpoch,setPreviewEpoch]=useState(0);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [picker, setPicker] = useState(false);
  const dialogRef=useModalEscape<HTMLFormElement>(onClose,busy);
  const revision = useRef(0);
  useEffect(() => {
    if (!smart) return; const version = ++revision.current; setPreview(null); setCalculating(true);
    const timer = setTimeout(() => {
      if (!rule.tags.length) { setCalculating(false); return; }
      void window.lumina.command({ type: 'smart.preview', id: existing?.id, rule }).then((result) => { if (revision.current === version) { setPreview(result); setError(''); } }).catch((reason) => { if (revision.current === version) setError(userErrorMessage(reason)); }).finally(() => { if (revision.current === version) setCalculating(false); });
    }, 200); return () => { clearTimeout(timer); revision.current++; };
  }, [rule, smart, existing?.id,previewEpoch]);
  const chooseTags = (key: 'tags' | 'notTags') => <div className="rule-tag-options">{tags.filter((tag) => !tag.blocked).map((tag) => <label key={tag.id}><input type="checkbox" checked={rule[key].includes(tag.id)} onChange={(event) => setRule((value) => ({ ...value, [key]: event.target.checked ? [...value[key], tag.id] : value[key].filter((id) => id !== tag.id) }))} />{tag.path??tagLabel(tag)}</label>)}</div>;
  return <div className="dialog-backdrop"><ActionForm ref={dialogRef} className="tag-dialog album-editor" role="dialog" aria-modal="true" aria-label={existing ? '编辑相册' : smart ? '新建智能相册' : '新建相册'} onSubmit={async (event) => {
    event.preventDefault(); if (busy) return; if (!name.trim()) { setError('请输入相册名称'); return; }
    setBusy(true); setError('');
    try {
      if (smart) await window.lumina.command({ type: 'smart.save', id: existing?.id, name, description,...(!managed?{parentId}:{}), rule, revision: preview?.revision ?? '', ...(coverEdited ? { coverMediaId: coverId } : {}) });
      else await window.lumina.command({ type: 'albums.edit', id: existing?.id, name, description,...(!managed?{parentId}:{}), tagIds, ...(coverEdited ? { coverMediaId: coverId } : {}) });
      await onSaved(); onClose();
    } catch (reason) { setError(userErrorMessage(reason)); if(userErrorMessage(reason).includes('匹配结果已变化'))setPreview(null); } finally { setBusy(false); }
  }}><div className="dialog-head"><div>{smart && <span className="smart-badge">智能相册</span>}<strong>{existing ? '编辑相册' : smart ? '新建智能相册' : '新建相册'}</strong></div><ActionButton type="button" className="icon-button" disabled={busy} onClick={onClose}>×</ActionButton></div>
    <div className="library-fields"><label>相册名称<input autoFocus value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label><label>所在文件夹<select aria-label="相册所在文件夹" value={parentId??''} disabled={managed} onChange={event=>setParentId(event.target.value||null)}><option value="">相册首页</option>{albumParentOptions(albums,existing?.id).map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select></label><label>相册描述<textarea aria-label="相册描述" value={description} maxLength={2000} rows={3} onChange={(event) => setDescription(event.target.value)} /></label>
      {existing && <div className="editor-cover"><div><small>当前封面 · {(coverEdited ? coverId !== null : existing.coverMode === 'manual') ? '已指定' : '自动 · 最新照片'}</small>{shownCover && <img src={window.lumina.mediaUrl('thumbnail', shownCover.id)} alt="当前封面" />}<ActionButton type="button" className="ghost" onClick={() => { setCoverId(null); setCoverEdited(true); setCoverImage(existing.cover); }}>恢复默认封面</ActionButton></div><ActionButton type="button" className="ghost" onClick={() => setPicker(true)}>设置封面</ActionButton></div>}
      <label className="check-label album-type-choice"><input type="checkbox" checked={smart} disabled={busy || Boolean(existing)} onChange={()=>setSmart(true)}/>创建智能相册</label>
      {smart && <><label>满足以下标签</label>{chooseTags('tags')}<label>标签关系<select value={rule.relation} onChange={(event) => setRule({ ...rule, relation: event.target.value as Rule['relation'] })}><option value="AND">AND · 同时满足</option><option value="OR">OR · 满足任一</option></select></label><details className="album-exclude-section"><summary>排除标签{rule.notTags.length>0 && <small> · 已选择 {rule.notTags.length} 个</small>}</summary>{chooseTags('notTags')}</details>
        {rule.excludedMediaIds.length > 0 && <p>另排除 {rule.excludedMediaIds.length} 项媒体 <ActionButton className="ghost" type="button" onClick={() => setRule({ ...rule, excludedMediaIds: [] })}>清除媒体排除项</ActionButton></p>}
        <p className="dialog-hint">规则实时匹配；选择父标签时包含全部后代标签的媒体。智能相册不能手动加入照片。</p><ActionButton type="button" className="ghost" disabled={busy || calculating || !rule.tags.length} onClick={()=>setPreviewEpoch((value)=>value+1)}>重新计算预览</ActionButton>
        <div className="rule-preview" aria-live="polite"><p className="preview-status">{calculating?'正在计算变更预览…':preview?`当前匹配 ${preview.total} 项`:'请选择至少一个标签'}</p><p>新增标签预计 +{preview?.added ?? '—'} 项</p><PreviewSamples items={preview?.addedSamples ?? []}/><p>移除标签预计 −{preview?.removed ?? '—'} 项</p><PreviewSamples items={preview?.removedSamples ?? []}/></div>
        {existing?.manualCoverMediaId && <p className="dialog-hint">{preview?.coverRetained === false ? '当前封面不再符合新规则，保存后将回退到最新匹配照片。' : '规则改变后封面不再匹配时，会回退为最新匹配照片。'}</p>}
      </>}<label className="check-label album-type-choice"><input type="checkbox" checked={!smart} disabled={busy || Boolean(existing)} onChange={()=>setSmart(false)}/>普通相册</label>      {!smart && <div className="ordinary-album-options" role="region" aria-label="普通相册标签"><label>相册标签</label><p className="dialog-hint">为相册内所有媒体增加普通标签，目录标签由目录设置管理。</p><div className="rule-tag-options">{tags.filter((tag)=>!tag.blocked&&!tag.directory).map((tag)=><label key={tag.id}><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={(event)=>setTagIds((ids)=>event.target.checked?[...ids,tag.id]:ids.filter((id)=>id!==tag.id))} />{tag.path??tagLabel(tag)}</label>)}</div></div>}{error && <p className="form-error" role="alert">{error}</p>}
    </div><div className="dialog-footer library-dialog-actions"><ActionButton type="button" className="ghost" disabled={busy} onClick={onClose}>取消</ActionButton><ActionButton type="submit" className="primary" disabled={busy || Boolean(smart && (calculating || !preview))}>{busy ? '保存中…' : '保存'}</ActionButton></div>
  </ActionForm>{picker && existing && <CoverPicker key={existing.id} album={existing} rule={smart ? rule : undefined} initialSelection={coverId} onSelect={(id,media) => { setCoverId(id); setCoverImage(media ?? existing.cover); setCoverEdited(true); }} onClose={() => setPicker(false)} onSaved={onSaved} />}</div>;
}
function PreviewSamples({ items }: { items: Media[] }) { return <div className="preview-samples">{Array.from({length:5},(_,index)=>items[index]?<img key={items[index]!.id} src={window.lumina.mediaUrl('thumbnail',items[index]!.id)} alt="变更预览"/>:<span className="sample-placeholder" aria-hidden="true" key={`empty-${index}`}/>)}</div>; }

function CoverCandidateGrid({ items, selected, onSelect, onEnd }: { items: Media[]; selected: string | null; onSelect: (id: string) => void; onEnd: () => void }) {
  const [scrollTop,setScrollTop] = useState(0); const first = Math.max(0,Math.floor(scrollTop/112)-2); const last = Math.min(Math.ceil(items.length/3),first+9);
  const rows: Media[][] = []; for (let index=first;index<last;index++) rows.push(items.slice(index*3,index*3+3));
  return <div className="cover-candidates" onScroll={(event) => { const node=event.currentTarget; setScrollTop(node.scrollTop); if (node.scrollTop+node.clientHeight>node.scrollHeight-200) onEnd(); }}><div className="cover-grid-canvas" style={{height:Math.ceil(items.length/3)*112}}>{rows.map((row,index) => <div className="cover-grid-row" key={first+index} style={{top:(first+index)*112}}>{row.map((item) => <ActionButton key={item.id} className={selected===item.id?'selected':''} title={item.absolutePath.split(/[\\/]/u).pop()} onClick={() => onSelect(item.id)}><img src={window.lumina.mediaUrl('thumbnail',item.id)} alt="封面候选" onError={(event) => { event.currentTarget.style.visibility='hidden'; }} /></ActionButton>)}</div>)}</div></div>;
}

function CoverPicker({ album, rule, initialSelection, onSelect, onClose, onSaved }: { album: Album; rule?: Rule; initialSelection?: string | null; onSelect?: (id: string | null, media?: Media) => void; onClose: () => void; onSaved: () => Promise<void> }) {
  const [items, setItems] = useState<Media[]>([]); const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(initialSelection === undefined ? album.manualCoverMediaId : initialSelection); const [error, setError] = useState('');
  const [more, setMore] = useState(false); const [busy, setBusy] = useState(false); const version = useRef(0); const pending = useRef(false);
  const dialogRef=useModalEscape<HTMLElement>(onClose,busy);
  const [defaultCover,setDefaultCover]=useState<Media|null>(null);const [chosenImage,setChosenImage]=useState<Media|null>(album.cover ?? null);
  const shownCover=selected ? chosenImage : defaultCover;
  useEffect(()=>{let valid=true;void window.lumina.command({type:'albums.defaultCover',id:album.id,rule}).then((item)=>{if(valid)setDefaultCover(item);}).catch(()=>{});return()=>{valid=false;};},[album.id,rule]);
  async function load(reset: boolean, quiet=false) {
    if (pending.current && !reset) return; const request = reset ? ++version.current : version.current; pending.current = true;
    try { const rows: Media[] = await window.lumina.command({ type: 'albums.candidates', id: album.id, query, rule, offset: reset ? 0 : items.length, limit: 100 }); if (request === version.current) { setItems((old) => reset ? rows : [...old, ...rows]); setMore(rows.length === 100); } } catch (reason) { setError(userErrorMessage(reason)); } finally { if (request === version.current) pending.current = false; }
  }
  useEffect(() => { void load(true); return () => { version.current++; }; }, [query]);
  return <div className="dialog-backdrop"><section ref={dialogRef} className="tag-dialog cover-picker" role="dialog" aria-modal="true" aria-label="设置封面"><div className="dialog-head"><strong>设置封面 · {album.name}</strong><ActionButton className="icon-button" onClick={onClose}>×</ActionButton></div><div className="cover-picker-body"><aside><p>当前封面</p>{shownCover && <img src={window.lumina.mediaUrl('thumbnail', shownCover.id)} alt="当前封面" />}<ActionButton className="ghost" onClick={() => setSelected(null)}>恢复默认封面</ActionButton><p className="dialog-hint">{selected ? '已选择媒体' : '自动 · 最新照片'}</p></aside><div><input className="organization-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索照片名称或日期…" /><p className="dialog-hint">按拍摄时间 · 最新在前</p><CoverCandidateGrid items={items} selected={selected} onSelect={(id)=>{setSelected(id);setChosenImage(items.find((item)=>item.id===id) ?? null);}} onEnd={() => { if (more) void load(false); }} /></div></div>{error && <p className="form-error">{error}</p>}<div className="dialog-footer library-dialog-actions"><ActionButton className="ghost" onClick={onClose}>取消</ActionButton><ActionButton className="primary" disabled={busy} onClick={async () => { setBusy(true); try { if (onSelect) onSelect(selected,chosenImage ?? undefined); else { await window.lumina.command({ type: 'albums.setCover', id: album.id, mediaId: selected }); await onSaved(); } onClose(); } catch (reason) { setError(userErrorMessage(reason)); } finally { setBusy(false); } }}>保存封面</ActionButton></div></section></div>;
}

function albumParentOptions(albums:Album[],exclude?:string){
  const forbidden=new Set<string>(exclude?[exclude]:[]);let changed=true;while(changed){changed=false;for(const album of albums)if(album.parentId&&forbidden.has(album.parentId)&&!forbidden.has(album.id)){forbidden.add(album.id);changed=true;}}
  return albums.filter(album=>album.kind!=='smart'&&!forbidden.has(album.id)).map(album=>{const names=[album.name],seen=new Set([album.id]);let parent=album.parentId;while(parent&&!seen.has(parent)){seen.add(parent);const row=albums.find(row=>row.id===parent);if(!row)break;names.unshift(row.name);parent=row.parentId;}return {id:album.id,label:names.join(' / ')};});
}
function AlbumFolderDialog({folder,albums,parentId:initialParentId,onClose,onSaved}:{folder:Album|'create';albums:Album[];parentId:string|null;onClose:()=>void;onSaved:()=>Promise<void>}){
 const existing=typeof folder==='object'?folder:null,[name,setName]=useState(existing?.name??''),[parentId,setParentId]=useState(existing?(existing.parentId??null):initialParentId),[busy,setBusy]=useState(false),[error,setError]=useState('');const ref=useModalEscape<HTMLFormElement>(onClose,busy);
 return <div className="dialog-backdrop"><ActionForm ref={ref} className="tag-dialog library-form" role="dialog" aria-modal="true" aria-label={existing?'编辑文件夹':'新建文件夹'} onSubmit={async event=>{event.preventDefault();if(busy)return;setBusy(true);setError('');try{await window.lumina.command({type:'albums.folder',id:existing?.id,name,parentId});await onSaved();onClose();}catch(error){setError(userErrorMessage(error));}finally{setBusy(false);}}}>
 <div className="dialog-head"><strong>{existing?'编辑文件夹':'新建文件夹'}</strong><ActionButton type="button" className="icon-button" disabled={busy} aria-label="关闭" onClick={onClose}>×</ActionButton></div><div className="library-fields"><label>文件夹名称<input autoFocus aria-label="文件夹名称" value={name} maxLength={200} onChange={event=>setName(event.target.value)}/></label><label>所在位置<select aria-label="文件夹所在位置" value={parentId??''} onChange={event=>setParentId(event.target.value||null)}><option value="">相册首页</option>{albumParentOptions(albums,existing?.id).map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select></label><p className="dialog-hint">用于组织相册，最多 5 级；不会创建或移动磁盘文件。</p>{error&&<p className="form-error" role="alert">{error}</p>}</div><div className="dialog-footer library-dialog-actions"><ActionButton type="button" className="ghost" disabled={busy} onClick={onClose}>取消</ActionButton><ActionButton type="submit" className="primary" disabled={busy||!name.trim()}>{busy?'保存中…':'保存'}</ActionButton></div></ActionForm></div>;
}
