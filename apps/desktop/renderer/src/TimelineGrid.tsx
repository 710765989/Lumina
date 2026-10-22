import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {useMediaActivity} from './MediaActivity';
import { MediaThumbnail } from './MediaThumbnail';
import {GridLayoutMotion,layoutMotionDuration} from './grid-layout-motion';
import {uiMotionEnabled} from './useUiMotion';
import {useExternalMediaDrag} from './useExternalMediaDrag';
import { type Media, mediaName, bytesText } from './media-types';
type Props = {renderBadge?:(item:Media)=>ReactNode;renderRowActions?:(item:Media)=>ReactNode;onMonthIds?:(fromMs:number,beforeMs:number)=>Promise<string[]>;selectionSource?:Record<string,unknown>; tagRevision?:unknown;windowKey?:string;startOffset?:number;onStartReached?:()=>void;monthCounts?:Record<string,number>; items: Media[]; thumbnails: Record<string, string>; selected: Set<string>; onToggle: (id: string, event: MouseEvent<HTMLElement>) => void; onOpen: (item: Media) => void; onContextMenu: (item: Media, event: MouseEvent<HTMLElement>) => void; onVisible: (items: Media[]) => void; onEndReached?: () => void; onSelectMany?: (ids: Set<string>) => void; groupByMonth?: boolean; capturedTime?: boolean; editMode?:boolean; view?:'time'|'immersive'|'masonry'|'list'; cardSize?:number; hasMore?:boolean;loadingMore?:boolean };
type CardTag={id:string;name:string;englishName?:string;color:string;directory:boolean};
type Row = {left?:number;width?:number; top: number; height: number; label?: string; count?: number; items?: Media[] };
export function TimelineGrid({ renderBadge,renderRowActions,onMonthIds,selectionSource,items, thumbnails, selected, onToggle, onOpen, onContextMenu, onVisible, onEndReached, onSelectMany, groupByMonth = true, capturedTime = false, editMode=false,view='time',cardSize=165,hasMore=false,loadingMore=false,monthCounts,startOffset=0,onStartReached,windowKey='',tagRevision }: Props) {
  const active=useMediaActivity();
  const drag=useExternalMediaDrag({selected,onSelectMany,includeHidden:selectionSource?.hiddenOnly===true,enabled:selectionSource?.scope!=='trash'});
  const viewport = useRef<HTMLDivElement>(null); const [size, setSize] = useState({ width: 900, height: 500 }); const [scroll, setScroll] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const selection = useRef<{ x: number; y: number; clientX: number; clientY: number; base: Set<string>; accumulated: Set<string>;hits:Set<string>;toggle:boolean; moved: boolean } | null>(null);
  const suppressClick = useRef(false); const columns = view==='list'?1:Math.max(1,Math.floor((size.width+2)/(cardSize+2)));
  const cardWidth=view==='masonry'?Math.max(1,(size.width-(columns-1)*2)/columns):Math.min(cardSize,size.width);const cardHeight=Math.round(cardWidth*.76)+46;const rowHeight=view==='list'?77:cardHeight+2;
  const [cardTags,setCardTags]=useState<Record<string,CardTag[]>>({});const cardTagCache=useRef<Record<string,CardTag[]>>({});const [tagEpoch,setTagEpoch]=useState(0);
  useEffect(()=>{cardTagCache.current={};setTagEpoch(value=>value+1);},[tagRevision]);
  useEffect(()=>{let timer:number|undefined;const off=window.lumina.onLibraryChanged(()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>{cardTagCache.current={};setTagEpoch(value=>value+1);},250);});return()=>{off();window.clearTimeout(timer);};},[]);
  const [preview,setPreview]=useState<string|null>(null);const hoverTimer=useRef<number>();
  useEffect(()=>{const clear=()=>{window.clearTimeout(hoverTimer.current);setPreview(null);};window.addEventListener('blur',clear);window.addEventListener('pointerdown',clear,true);document.addEventListener('visibilitychange',clear);return()=>{clear();window.removeEventListener('blur',clear);window.removeEventListener('pointerdown',clear,true);document.removeEventListener('visibilitychange',clear);};},[]);
  const [visibilityEpoch,setVisibilityEpoch]=useState(0);
  useEffect(()=>{const refresh=()=>setVisibilityEpoch(value=>value+1);window.addEventListener('lumina-cache-cleared',refresh);return()=>window.removeEventListener('lumina-cache-cleared',refresh);},[]);
  const scrollFrame=useRef(0);const scrollBucket=useRef(0);
  useEffect(()=>()=>cancelAnimationFrame(scrollFrame.current),[]);
  const [slowLoading,setSlowLoading]=useState(false);
  useEffect(()=>{setSlowLoading(false);if(!loadingMore)return;const timer=window.setTimeout(()=>setSlowLoading(true),180);return()=>window.clearTimeout(timer);},[loadingMore]);
  useEffect(() => { const node = viewport.current; if (!node) return; let shown=false;const observer = new ResizeObserver(() => {if(!node.clientWidth || !node.clientHeight){shown=false;return;}if(!shown){shown=true;setVisibilityEpoch(value=>value+1);}if(node.clientWidth && node.clientHeight)setSize({ width: node.clientWidth - 4, height: node.clientHeight });}); observer.observe(node); return () => observer.disconnect(); }, []);
  const { rows, height } = useMemo(() => {
    if(view==='masonry'){
      const bottoms=Array.from({length:columns},()=>0),rows:Row[]=[];
      for(const item of items){const column=bottoms.indexOf(Math.min(...bottoms)),metadata=item.metadata??{};
        const ratio=metadata.width&&metadata.height?metadata.height/metadata.width:.76;
        const height=Math.max(56,Math.min(cardWidth*4,cardWidth*ratio));
        rows.push({top:bottoms[column]!,left:column*(cardWidth+2),width:cardWidth,height:height+2,items:[item]});bottoms[column]!+=height+2;
      }
      rows.sort((a,b)=>a.top-b.top);return {rows,height:Math.max(0,...bottoms)};
    }
    const groups: Array<{ label: string; items: Media[] }> = [];
    for (const item of items) { const date = new Date(capturedTime ? item.capturedAtMs ?? item.modifiedAtMs : item.modifiedAtMs); const label = groupByMonth && view==='time' ? `${date.getFullYear()}年${date.getMonth() + 1}月` : ''; let group = groups.at(-1); if (!group || group.label !== label) { group = { label, items: [] }; groups.push(group); } group.items.push(item); }
    const rows: Row[] = []; let top = 0;
    for (const group of groups) { if (group.label) { rows.push({ top, height: 32, label: group.label, count: group.items.length }); top += 32; } for (let i = 0; i < group.items.length; i += columns) { rows.push({ top, height: rowHeight, items: group.items.slice(i, i + columns) }); top += rowHeight; } top += 2; }
    return { rows, height: top };
  }, [items, columns, capturedTime, groupByMonth,view,rowHeight,cardWidth]);
  const [monthIds,setMonthIds]=useState<Record<string,string[]>>({}),[monthLoading,setMonthLoading]=useState<string|null>(null),[pendingMonthChecked,setPendingMonthChecked]=useState(false),[monthError,setMonthError]=useState('');
  const sourceKey=JSON.stringify(selectionSource),latestSelection=useRef(selected),latestSource=useRef(sourceKey);latestSelection.current=selected;latestSource.current=sourceKey;
  useEffect(()=>{setMonthIds({});setMonthLoading(null);setMonthError('');},[sourceKey]);
  const localMonth=(item:Media)=>{const date=new Date(capturedTime?item.capturedAtMs??item.modifiedAtMs:item.modifiedAtMs);return `${date.getFullYear()}年${date.getMonth()+1}月`;};
  function monthChoice(label:string){const ids=monthIds[label]??items.filter(item=>localMonth(item)===label).map(item=>item.id),count=ids.filter(id=>selected.has(id)).length;const total=monthCounts?.[label]??ids.length;return {all:ids.length>0&&count===total&&ids.length===total,partial:count>0&&(count<total||ids.length<total)};}
  async function selectMonth(label:string){
    if(!onSelectMany || monthLoading)return;setPendingMonthChecked(!monthChoice(label).all);setMonthLoading(label);setMonthError('');const key=sourceKey;
    try{const match=/^(\d{4})年(\d+)月$/u.exec(label);if(!match)return;
      const year=Number(match[1]),month=Number(match[2])-1;
      const ids:string[]=onMonthIds?await onMonthIds(new Date(year,month,1).getTime(),new Date(year,month+1,1).getTime()):selectionSource?await window.lumina.command({type:'media.playlist',source:{...selectionSource,timeFromMs:new Date(year,month,1).getTime(),timeBeforeMs:new Date(year,month+1,1).getTime()}}):items.filter(item=>localMonth(item)===label).map(item=>item.id);
      if(key!==latestSource.current)return;setMonthIds(current=>({...current,[label]:ids}));
      const next=new Set(latestSelection.current),clear=ids.length>0&&ids.every(id=>next.has(id));for(const id of ids){if(clear)next.delete(id);else next.add(id);}onSelectMany(next);
    }catch{if(key===latestSource.current)setMonthError('月份选择失败，请重试');}finally{if(key===latestSource.current)setMonthLoading(null);}
  }
  const [layoutMotion]=useState(()=>new GridLayoutMotion());const beforeLayoutScroll=useRef({top:0,left:0});
  const previousLayout=useRef<{rows:Row[];cardSize:number;view:string;width:number;scrollTop:number;windowKey:string}|null>(null);
  const previous=previousLayout.current;
  const geometryChanged=Boolean(previous && (previous.cardSize!==cardSize || previous.view!==view || previous.width!==size.width));
  const firstId=previous?.rows.find(row=>row.items?.length)?.items?.[0]?.id;
  const prepended=firstId!==undefined && firstId!==items[0]?.id && items.some(item=>item.id===firstId);
  let layoutScroll=scroll;
  if(previous && previous.windowKey!==windowKey)layoutScroll=0;
  else if(previous && (geometryChanged || prepended)){
    const oldGap=previous.view==='list'?1:2;
    const anchor=previous.rows.find(row=>row.items?.length && row.top+row.height-oldGap>previous.scrollTop+8);
    const next=anchor && rows.find(row=>row.items?.some(item=>item.id===anchor.items![0]!.id));
    if(anchor && next){const offset=previous.scrollTop-anchor.top,newHeight=next.height-(view==='list'?1:2);layoutScroll=Math.max(0,next.top+(offset<0?offset:Math.min(.85,offset/(anchor.height-oldGap))*newHeight));}
  }
  // Calculate the new virtual window before committing DOM changes. Otherwise
  // a deep-scroll resize first mounts the wrong page and destroys the old cards.
  useLayoutEffect(()=>{
    const node=viewport.current;if(!node)return;beforeLayoutScroll.current={top:previous?.scrollTop??node.scrollTop,left:node.scrollLeft};
    if(previous && (previous.windowKey!==windowKey || geometryChanged || prepended)){
      node.scrollTop=layoutScroll;scrollBucket.current=Math.floor(node.scrollTop/Math.max(48,Math.min(160,rowHeight/2)));setScroll(node.scrollTop);
    }
    previousLayout.current={rows,cardSize,view,width:size.width,scrollTop:node.scrollTop,windowKey};
  },[rows,cardSize,view,size.width,windowKey]);
  const pinned=useRef(new Set<string>()),lastViewportIds=useRef(new Set<string>()),releasePinned=useRef<number>();
  const [pinRevision,setPinRevision]=useState(0);
  const keepOld=geometryChanged && previous?.windowKey===windowKey && uiMotionEnabled();
  const pinnedIds=keepOld?new Set([...pinned.current,...lastViewportIds.current].slice(0,240)):pinned.current;
  useEffect(()=>{const stop=()=>layoutMotion.stop();window.addEventListener('lumina-motion-changed',stop);return()=>{layoutMotion.clear();window.removeEventListener('lumina-motion-changed',stop);};},[layoutMotion]);
  useEffect(()=>{const node=viewport.current;if(!node)return;const remember=()=>{if(previousLayout.current)previousLayout.current.scrollTop=node.scrollTop;};node.addEventListener('scroll',remember);return()=>node.removeEventListener('scroll',remember);},[]);
  useEffect(()=>{const reveal=(event:Event)=>{const id=(event as CustomEvent<string>).detail;const row=rows.find(row=>row.items?.some(item=>item.id===id));const node=viewport.current;if(!row || !node || node.closest('[hidden]'))return;if(row.top<node.scrollTop)node.scrollTop=row.top;else if(row.top+row.height>node.scrollTop+node.clientHeight)node.scrollTop=row.top+row.height-node.clientHeight;setScroll(node.scrollTop);requestAnimationFrame(()=>requestAnimationFrame(()=>node.querySelector<HTMLElement>(`[data-media-id="${CSS.escape(id)}"]`)?.focus({preventScroll:true})));};window.addEventListener('lumina-home-reveal',reveal);return()=>window.removeEventListener('lumina-home-reveal',reveal);},[rows]);
  const visible = useMemo(() => {
    const windowRows:Row[]=[];
    if(view==='masonry')windowRows.push(...rows.filter(row=>row.top+row.height>=layoutScroll-400&&row.top<layoutScroll+size.height+400));
    else{
      let low=0,high=rows.length;while(low<high){const middle=(low+high)>>>1;if(rows[middle]!.top+rows[middle]!.height<layoutScroll-400)low=middle+1;else high=middle;}
      for(let i=low;i<rows.length&&rows[i]!.top<layoutScroll+size.height+400;i++)windowRows.push(rows[i]!);
    }
    if(pinnedIds.size){const known=new Set(windowRows);for(const row of rows)if(!known.has(row)&&row.items?.some(item=>pinnedIds.has(item.id)))windowRows.push(row);windowRows.sort((a,b)=>a.top-b.top);}
    return windowRows;
  }, [rows, layoutScroll, size.height,view,pinRevision,pinnedIds]);
  useLayoutEffect(()=>{
    if(keepOld){pinned.current=pinnedIds;window.clearTimeout(releasePinned.current);releasePinned.current=window.setTimeout(()=>{pinned.current=new Set();setPinRevision(value=>value+1);},layoutMotionDuration+40);}
    lastViewportIds.current=new Set(visible.filter(row=>row.top+row.height>layoutScroll&&row.top<layoutScroll+size.height).flatMap(row=>row.items?.map(item=>item.id)??[]));
  });
  const lastMotionLayout=useRef<{rows:Row[];view:string;size:number;width:number;key:string}>();
  useLayoutEffect(()=>{
    const node=viewport.current;if(!node)return;if(!active){layoutMotion.clear();return;}const old=lastMotionLayout.current;
    if(!old||old.rows!==rows||old.view!==view||old.size!==cardSize||old.width!==size.width||old.key!==windowKey)layoutMotion.update(node,beforeLayoutScroll.current);
    else layoutMotion.track(node);
    lastMotionLayout.current={rows,view,size:cardSize,width:size.width,key:windowKey};
  });
  useEffect(()=>()=>window.clearTimeout(releasePinned.current),[]);
  useEffect(()=>{if(!active){window.clearTimeout(releasePinned.current);pinned.current=new Set();setPreview(null);}},[active]);
  const visibleItems = useMemo(() => visible.flatMap((row) => row.items ?? []), [visible]);
  useEffect(() => { if (visibleItems.length && !viewport.current?.closest('[hidden]')) onVisible(visibleItems); }, [visibleItems, onVisible,visibilityEpoch]);
  useEffect(()=>{if(viewport.current?.closest('[hidden]'))return;let valid=true;const ids=visibleItems.map(item=>item.id).filter(id=>!cardTagCache.current[id]).slice(0,300);if(!ids.length)return;void window.lumina.command({type:'media.cardTags',mediaIds:ids}).then(result=>{if(valid){cardTagCache.current={...cardTagCache.current,...result};setCardTags(cardTagCache.current);}}).catch(()=>{});return()=>{valid=false;};},[visibleItems,view,tagEpoch,visibilityEpoch]);
  useEffect(() => { const node=viewport.current; if(items.length && node && node.scrollTop+node.clientHeight>=node.scrollHeight-410) onEndReached?.(); }, [items.length,height,scroll,size.height,onEndReached]);
  function updateBox() {
    const node = viewport.current; const current = selection.current; if (!node || !current) return;
    const rect = node.getBoundingClientRect(); const x = current.clientX - rect.left; const y = current.clientY - rect.top + node.scrollTop;
    const left = Math.min(current.x, x); const top = Math.min(current.y, y); const width = Math.abs(x - current.x); const height = Math.abs(y - current.y);
    if (width + height < 5 && !current.moved) return; current.moved = true; suppressClick.current = true; setBox({ left, top, width, height });
    const hits = new Set(current.accumulated);
    for (const card of Array.from(node.querySelectorAll<HTMLElement>('[data-media-id]'))) { const bounds = card.getBoundingClientRect(); const cx = bounds.left - rect.left; const cy = bounds.top - rect.top + node.scrollTop; if (cx < left + width && cx + bounds.width > left && cy < top + height && cy + bounds.height > top) hits.add(card.dataset.mediaId!); }
    current.hits=hits;const ids=new Set(current.base);for(const id of hits){if(current.toggle && ids.has(id))ids.delete(id);else ids.add(id);}onSelectMany?.(ids);
  }
  useEffect(() => { if (!box) return; let frame: number; const tick = () => { const node = viewport.current; const current = selection.current; if (node && current) { const rect = node.getBoundingClientRect(); const delta = current.clientY < rect.top + 35 ? -14 : current.clientY > rect.bottom - 35 ? 14 : 0; if (delta) { for (const id of current.hits) current.accumulated.add(id); node.scrollTop += delta; updateBox(); } } frame = requestAnimationFrame(tick); }; frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame); }, [Boolean(box), selected]);
  function beginSelection(event:PointerEvent,node:HTMLDivElement){
    if(!onSelectMany || event.button!==0 || (event.target as HTMLElement).closest('.media-card,.media-row,button,input,textarea,select,label,a,[role=menu],[role=listbox],.library-time-axis'))return;
    const rect=node.getBoundingClientRect();event.preventDefault();selection.current={x:event.clientX-rect.left,y:event.clientY-rect.top+node.scrollTop,clientX:event.clientX,clientY:event.clientY,base:event.ctrlKey || editMode?new Set(selected):new Set(),accumulated:new Set(),hits:new Set(),toggle:editMode,moved:false};node.setPointerCapture(event.pointerId);
  }
  useEffect(()=>{
    const node=viewport.current,host=node?.closest<HTMLElement>('.content');if(!node || !host)return;
    const down=(event:PointerEvent)=>{if(node.contains(event.target as Node) || node.closest('[hidden]'))return;const rect=node.getBoundingClientRect();if(rect.width && rect.height && event.clientY>=rect.top && event.clientY<=rect.bottom)beginSelection(event,node);};
    const click=(event:Event)=>{if(suppressClick.current){event.preventDefault();event.stopImmediatePropagation();suppressClick.current=false;}};
    host.addEventListener('pointerdown',down);host.addEventListener('click',click,true);return()=>{host.removeEventListener('pointerdown',down);host.removeEventListener('click',click,true);};
  },[onSelectMany,selected,editMode]);
  return <div className={`grouped-media-scroll home-grid view-${view}`} ref={viewport} onWheel={(event)=>{if(event.deltaY<0 && !event.ctrlKey && startOffset>0 && event.currentTarget.scrollTop<80)onStartReached?.();}} onScroll={(event) => { const node = event.currentTarget; const movingUp=node.scrollTop<scroll;if(!scrollFrame.current)scrollFrame.current=requestAnimationFrame(()=>{scrollFrame.current=0;const quantum=Math.max(48,Math.min(160,rowHeight/2)),bucket=Math.floor(node.scrollTop/quantum);if(bucket!==scrollBucket.current){scrollBucket.current=bucket;setScroll(node.scrollTop);}});if(movingUp && node.scrollTop<80 && startOffset>0)onStartReached?.(); if (node.scrollTop + node.clientHeight >= node.scrollHeight - 410) onEndReached?.(); }} onClickCapture={(event) => { if (suppressClick.current) { event.stopPropagation(); event.preventDefault(); suppressClick.current = false; } }} onPointerDown={(event) => {
    beginSelection(event.nativeEvent,event.currentTarget);
  }} onPointerMove={(event) => { if (selection.current) { selection.current.clientX = event.clientX; selection.current.clientY = event.clientY; updateBox(); } }} onPointerUp={() => { selection.current = null; setBox(null); }} onPointerCancel={() => { selection.current = null; setBox(null); }}><div className="grouped-media-canvas" data-columns={columns} data-total={items.length} data-start-offset={startOffset} data-has-more={hasMore} style={{ height:height+(slowLoading?38:0) }}>
    {visible.flatMap((row) => row.items ? row.items.map((item,itemIndex)=><div className="grouped-media-row" data-layout-key={`media:${item.id}`} key={`media:${item.id}`} style={{top:row.top,left:view==='list'?0:(row.left??0)+itemIndex*(cardWidth+2),width:view==='list'?undefined:cardWidth,right:view==='list'?0:'auto',gap:2,gridTemplateColumns:'minmax(0,1fr)'}}>
<article title={`${mediaName(item)}\n${(cardTags[item.id]??[]).length?'标签：'+cardTags[item.id].map(tag=>tag.name).join(' · '):'暂无标签'}\n文件大小：${bytesText(item.sizeBytes)}`} data-media-id={item.id} className={`${view==='list'?'media-row':'media-card'}${selected.has(item.id)?' selected':''}`} style={view==='list'?{height:76}:{height:view==='masonry'?row.height-2:cardHeight,minHeight:view==='masonry'?row.height-2:cardHeight}} key={item.id} tabIndex={0} onMouseEnter={()=>{window.clearTimeout(hoverTimer.current);if(item.kind==='video' || item.metadata?.animated || /\.gif$/iu.test(item.absolutePath))hoverTimer.current=window.setTimeout(()=>setPreview(item.id),item.kind==='video'?450:120);}} onMouseLeave={()=>{window.clearTimeout(hoverTimer.current);setPreview(current=>current===item.id?null:current);}} draggable={drag.enabled} onDragStart={(event)=>{setPreview(null);drag.start(event,item.id);}} onClickCapture={drag.click} onClick={(event) => onToggle(item.id, event)} onDoubleClick={() => {setPreview(null);onOpen(item);}} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault();setPreview(null); onOpen(item); } }} onContextMenu={(event) => {setPreview(null);onContextMenu(item, event);}}><div className="media-placeholder" style={view==='list'?{width:58,height:46,minHeight:46,flex:'0 0 58px'}:{height:view==='masonry'?row.height-2:cardHeight,minHeight:0,flexBasis:view==='masonry'?row.height-2:cardHeight}}><MediaThumbnail id={item.id} kind={item.kind} source={thumbnails[item.id]} preview={preview===item.id} previewPath={item.absolutePath} animated={Boolean(item.metadata?.animated || /\.gif$/iu.test(item.absolutePath))} sizeBytes={item.sizeBytes} animationWidth={item.metadata?.width} animationHeight={item.metadata?.height} animationFrames={item.metadata?.frames}/></div>{view!=='list' && <div className="immersive-media-overlay"><strong>{mediaName(item)}</strong><MediaTags tags={cardTags[item.id]??[]}/>{renderBadge?.(item)}</div>}{view==='list' && <div className="media-meta"><strong>{mediaName(item)}</strong><small>{item.absolutePath}</small><MediaTags tags={cardTags[item.id]??[]}/>{renderBadge?.(item)}</div>}{view==='list' && <span>{bytesText(item.sizeBytes)}</span>}{view==='list' && renderRowActions?.(item)}</article></div>) : <div data-layout-key={`month:${row.label}`} className="media-month-heading grouped-media-heading" style={{ top: row.top }} key={`heading:${row.label}`}><label className="month-select"><input type="checkbox" aria-label={`选择${row.label}全部媒体`} checked={monthLoading===row.label?pendingMonthChecked:monthChoice(row.label!).all} disabled={Boolean(monthLoading)} ref={node=>{if(node)node.indeterminate=monthChoice(row.label!).partial;}} onChange={()=>void selectMonth(row.label!)}/></label><h3>{row.label}</h3><span>{monthCounts?.[row.label!]??row.count} 项</span></div>)}
    {monthError && <p className="grid-selection-error" role="alert">{monthError}</p>}{slowLoading && hasMore && <p className="grid-loading" style={{top:height}}>正在加载…</p>}{box && <div className="selection-rectangle" style={box} />}
  </div></div>;
}

function MediaTags({tags}:{tags:CardTag[]}){return <div className="immersive-tag-list" aria-label="媒体标签">{tags.map(tag=><span key={tag.id} className={tag.directory?'media-tag directory-tag':'media-tag ordinary-tag'}>{tag.directory?'▱ ':'#'}{tag.name}</span>)}{!tags.length && <small className="media-tag-empty">暂无标签</small>}</div>;}
