import {t,translateMessage} from './i18n';
import {ActionButton} from './ActionControls';
import {useEffect,useRef,useState,type ComponentProps} from 'react';
import {CollectionMediaView,useCollectionView,type CollectionSort} from './CollectionMediaView';
import {LibraryTimeAxis,type TimelineMonth} from './LibraryTimeAxis';
import {useHomeKeyboard} from './useHomeKeyboard';
import {usePageLocation} from './useAppNavigation';
import {userErrorMessage} from './user-error';
import type {Media,Tag} from './media-types';

type Props=Omit<ComponentProps<typeof CollectionMediaView>,'items'|'settings'|'empty'|'tags'|'onClear'> & {
  tags:Tag[];active:boolean;revision:number;editMode:boolean;onClear:()=>void;
  onMediaChange:(items:Media[])=>void;onScopeChange:(scope:CollectionSort & {kind?:'photo'|'video'})=>void;
};
export function HiddenMediaPage({tags,active,revision,editMode,onClear,onMediaChange,onScopeChange,...grid}:Props){
  const settings=useCollectionView('hidden');
  const [kind,setKind]=useState<'all'|'photo'|'video'>('all'),[anchor,setAnchor]=useState<string|null>(null),[jump,setJump]=useState(0);
  const [items,setItems]=useState<Media[]>([]),[months,setMonths]=useState<TimelineMonth[]>([]),[stats,setStats]=useState({total:0,photo:0,video:0});
  const [start,setStart]=useState(0),[more,setMore]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const query={...settings.filters,hiddenOnly:true,...(kind==='all'?{}:{kind}),sortBy:settings.sortBy,sort:settings.sort,query:settings.filters.query??''};
  const key=JSON.stringify([query,anchor,jump]),generation=useRef(0),pending=useRef(false),deferred=useRef(false);
  const windowRef=useRef({items,start,more});windowRef.current={items,start,more};
  const queryRef=useRef(query);queryRef.current=query;
  const latest=useRef(load);latest.current=load;
  useEffect(()=>{onScopeChange({...settings.filters,...(kind==='all'?{}:{kind}),sortBy:settings.sortBy,sort:settings.sort});},[settings.filterKey,kind,settings.sortBy,settings.sort,onScopeChange]);
  async function load(mode:'reset'|'refresh'|'next'|'previous'='refresh'){
    if(pending.current && mode!=='reset'){if(mode==='refresh')deferred.current=true;return;}
    const token=++generation.current;pending.current=true;setLoading(true);setError('');
    try{
      const current=windowRef.current,scope=queryRef.current;
      let offset=mode==='next'?current.start+current.items.length:mode==='previous'?Math.max(0,current.start-200):mode==='refresh'?current.start:0;
      let count=mode==='refresh'?Math.max(200,current.items.length):mode==='previous'?current.start-offset:200;
      if(mode==='reset'||mode==='refresh'){
        const [total,times]=await Promise.all([window.lumina.command({...scope,type:'media.filteredStats'}),['fileTime','capturedAt'].includes(scope.sortBy)?window.lumina.command({...scope,type:'media.timeline'}):Promise.resolve([])]);
        if(token!==generation.current)return;setStats(total);setMonths(times);
        if(mode==='reset' && anchor){offset=0;for(const month of times){if(scope.sort==='asc'?month.month>=anchor:month.month<=anchor)break;offset+=month.count;}}
        offset=Math.min(offset,Math.max(0,total.total-1));
      }
      if(!count)return;
      const rows:Media[]=[];while(rows.length<count){const limit=Math.min(1000,count-rows.length);const batch:Media[]=await window.lumina.command({...scope,type:'media.search',offset:offset+rows.length,limit});if(token!==generation.current)return;rows.push(...batch);if(batch.length<limit)break;}
      const next=mode==='next'?[...current.items,...rows]:mode==='previous'?[...rows,...current.items]:rows;
      const unique=[...new Map(next.map(row=>[row.id,row])).values()];
      const nextStart=mode==='next'?current.start:offset;
      const peek=await window.lumina.command({...scope,type:'media.search',offset:nextStart+unique.length,limit:1});if(token!==generation.current)return;
      windowRef.current={items:unique,start:nextStart,more:peek.length>0};setItems(unique);setStart(nextStart);setMore(peek.length>0);onMediaChange(unique);
    }catch(reason){if(token===generation.current)setError(userErrorMessage(reason));}
    finally{if(token===generation.current){pending.current=false;setLoading(false);if(deferred.current){deferred.current=false;void latest.current('refresh');}}}
  }
  useEffect(()=>{onClear();void load('reset');return()=>{generation.current++;pending.current=false;};},[key]);
  const seen=useRef(revision);useEffect(()=>{if(active && seen.current!==revision){seen.current=revision;void load('refresh');}},[active,revision]);
  const selectionAnchor=useRef<string|null>(null),cursor=useRef<string|null>(null);
  const latestKey=useRef(key);if(latestKey.current!==key){selectionAnchor.current=null;cursor.current=null;latestKey.current=key;}
  useHomeKeyboard({editMode,active,items,selected:grid.selected,onSelect:ids=>grid.onSelectMany?.(ids),anchor:selectionAnchor,cursor,loadMore:()=>load('next'),loadPrevious:()=>load('previous'),isLoading:()=>pending.current,hasPrevious:start>0,hasMore:more,view:settings.view,queryKey:key,request:query});
  usePageLocation('hidden',null,()=>{},()=>load('refresh'));
  return <section className="content organization-page hidden-content">
    <div className="section-head"><div><h2>{t("已隐藏内容")}</h2><p className="page-summary">{stats.total}{t("项 · 照片")}{stats.photo}{t("· 视频")}{stats.video}</p></div><div className="filter-group" aria-label={t("媒体类型")}>{(['all','photo','video'] as const).map(value=><ActionButton key={value} className={kind===value?'active':''} onClick={()=>setKind(value)}>{({all:t("全部"),photo:t("照片"),video:t("视频")})[value]}</ActionButton>)}</div></div>
    {error && <p className="form-error" role="alert">{translateMessage(error)}</p>}
    <CollectionMediaView searchKey="hidden" {...grid} selectionSource={{...query,scope:'library'}} tags={tags} settings={settings} items={items} editMode={editMode} tagRevision={revision} selected={grid.selected} onToggle={(id,event)=>{cursor.current=id;selectionAnchor.current=id;grid.onToggle(id,event);}} onClear={()=>{if(!editMode)onClear();}} windowKey={key} startOffset={start} monthCounts={Object.fromEntries(months.map(month=>[`${month.month.slice(0,4)}年${Number(month.month.slice(5))}月`,month.count]))} hasMore={more} loadingMore={loading} onEndReached={()=>{if(more)void load('next');}} onStartReached={()=>{if(start>0)void load('previous');}} aside={['fileTime','capturedAt'].includes(settings.sortBy)?<LibraryTimeAxis months={months} anchor={anchor} onJump={month=>{setAnchor(month);setJump(value=>value+1);}} onReset={()=>{setAnchor(null);setJump(value=>value+1);}}/>:null} empty={<div className="empty compact"><h3>{loading?t("正在加载…"):t("暂无媒体")}</h3></div>}/>
  </section>;
}
