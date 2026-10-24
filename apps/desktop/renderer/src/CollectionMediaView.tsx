import {t} from './i18n';
import {ActionButton} from './ActionControls';
import {CollectionSearch,type MediaFilters} from './CollectionSearch';
import type {Tag} from './media-types';
import {useEffect,useMemo,useRef,useState,type ComponentProps,type ReactNode,type RefObject} from 'react';
import {TimelineGrid} from './TimelineGrid';
import {useDismissableLayer} from './useDismissableLayer';
export type CollectionSort=MediaFilters & {sortBy:'fileTime'|'capturedAt'|'name'|'size';sort:'asc'|'desc'};
const labels={fileTime:'按文件时间',capturedAt:'按拍摄时间',name:'按文件名',size:'按文件大小'};
type View='time'|'immersive'|'masonry'|'list';
export function useCollectionView(key:string,scopeId:string|null=null,initialView:View='immersive'){
 const [search,setSearch]=useState<{scopeId:string|null;filters:MediaFilters}>({scopeId,filters:{}});
 const filters=useMemo(()=>search.scopeId===scopeId?search.filters:{},[search,scopeId]);
 const setFilters=(filters:MediaFilters)=>setSearch({scopeId,filters});
 const filterKey=JSON.stringify(filters);
 const [saved]=useState(()=>{try{return JSON.parse(localStorage.getItem(`lumina.${key}.view`)??'{}');}catch{return {};}});
 const [view,setViewState]=useState<View>(['time','immersive','masonry','list'].includes(saved.view)?saved.view:initialView);
 const [gridView,setGridView]=useState<'time'|'immersive'|'masonry'>(saved.view==='masonry'||saved.gridView==='masonry'?'masonry':saved.view==='time'||saved.gridView==='time'?'time':'immersive');
 function setView(value:View){if(value!=='list')setGridView(value);setViewState(value);}
 const [size,setSize]=useState(Math.max(110,Math.min(320,Number(saved.size)||165)));
 const [sortBy,setSortBy]=useState<CollectionSort['sortBy']>(Object.hasOwn(labels,saved.sortBy)?saved.sortBy:'fileTime');
 const [sort,setSort]=useState<CollectionSort['sort']>(saved.sort==='asc'?'asc':'desc');
 useEffect(()=>{localStorage.setItem(`lumina.${key}.view`,JSON.stringify({view,gridView,size,sortBy,sort}));},[key,view,gridView,size,sortBy,sort]);
 return {filters,setFilters,filterKey,view,setView,gridView,size,setSize,sortBy,setSortBy,sort,setSort};
}
type Settings=ReturnType<typeof useCollectionView>;
export function useCollectionZoom(ref:RefObject<HTMLElement>,settings:Settings,enabled=true){
 useEffect(()=>{const element=ref.current;if(!element || !enabled)return;const wheel=(event:WheelEvent)=>{if(!event.ctrlKey || !event.deltaY)return;event.preventDefault();if(event.deltaY>0 && settings.size<=110){settings.setView('list');return;}if(settings.view==='list' && event.deltaY<0){settings.setView(settings.gridView);settings.setSize(110);return;}settings.setSize(value=>Math.max(110,Math.min(320,value+(event.deltaY<0?15:-15))));};element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);},[enabled,settings.view,settings.gridView,settings.size]);
}
export function MediaViewToolbar({settings:s}:{settings:Settings}){
 const [open,setOpen]=useState(false);const ref=useRef<HTMLDivElement>(null);useDismissableLayer(open,()=>setOpen(false),[ref]);
 return <div className="home-view-toolbar"><label className="thumbnail-size">{t("缩略图")}<input aria-label={t("缩略图大小")} type="range" min="105" max="320" step="1" value={s.view==='list'?105:s.size} onChange={event=>{const size=Number(event.target.value);if(size<110)s.setView('list');else{if(s.view==='list')s.setView(s.gridView);s.setSize(size);}}}/></label><div className="page-actions"><select className="view-select" aria-label={t("视图切换")} value={s.view} onChange={event=>s.setView(event.target.value as View)}><option value="immersive">{t("默认视图")}</option><option value="time">{t("时间视图")}</option><option value="masonry">{t("瀑布视图")}</option><option value="list">{t("列表")}</option></select><div ref={ref} className="sort-control"><ActionButton className="ghost sort-label" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{t(labels[s.sortBy])}</ActionButton><ActionButton className="ghost sort-direction" aria-label={s.sort==='desc'?t("倒序，点击切换为正序"):t("正序，点击切换为倒序")} title={s.sort==='desc'?t("当前倒序，点击切换为正序"):t("当前正序，点击切换为倒序")} onClick={()=>s.setSort(value=>value==='desc'?'asc':'desc')}>{s.sort==='desc'?'↓':'↑'}</ActionButton>{open && <div className="sort-menu" role="listbox">{(Object.keys(labels) as CollectionSort['sortBy'][]).map(sortBy=><ActionButton key={sortBy} role="option" aria-selected={s.sortBy===sortBy} className={s.sortBy===sortBy?'active':''} onClick={()=>{s.setSortBy(sortBy);setOpen(false);}}>{t(labels[sortBy])}</ActionButton>)}</div>}</div></div></div>;
}
export function CollectionMediaView({settings,tags,summary,onClear,empty,aside,searchKey,...grid}:Omit<ComponentProps<typeof TimelineGrid>,'view'|'cardSize'|'capturedTime'|'groupByMonth'> & {settings:Settings;tags:Tag[];summary?:{total:number;photo:number;video:number};onClear?:()=>void;empty:ReactNode;aside?:ReactNode;searchKey?:string}){
 const ref=useRef<HTMLDivElement>(null);
 useCollectionZoom(ref,settings);
 return <div ref={ref} className="collection-media-browser" onClick={event=>{if(!(event.target as HTMLElement).closest('.media-card,.media-row,button,input,textarea,select'))onClear?.();}}><CollectionSearch key={searchKey??grid.windowKey?.split(':')[0]} tags={tags} hiddenOnly={grid.selectionSource?.hiddenOnly===true} onChange={settings.setFilters}/>{summary && <p className="collection-result-summary">{summary.total}{t("项 · 照片")}{summary.photo}{t("· 视频")}{summary.video}</p>}<MediaViewToolbar settings={settings}/><div className="collection-grid-area">{grid.items.length?<TimelineGrid {...grid} view={settings.view} cardSize={settings.size} groupByMonth={settings.view==='time' && ['fileTime','capturedAt'].includes(settings.sortBy)} capturedTime={settings.sortBy==='capturedAt'}/>:empty}{aside}</div></div>;
}

