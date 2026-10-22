import {FilmstripHoverPreview} from './FilmstripHoverPreview';
import {ActionButton} from './ActionControls';
import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {type Media,mediaName,bytesText} from './media-types';

const STEP=70;
// Only the visible part of the complete playlist owns thumbnail elements/records.
export function ViewerFilmstrip({ids,item,known,stripRef,onSelect,includeHidden=false}:{includeHidden?:boolean;ids:string[];item:Media;known:Media[];stripRef:RefObject<HTMLDivElement>;onSelect:(index:number)=>void}){
  const [hover,setHover]=useState<{media:Media;anchor:HTMLButtonElement;host:HTMLElement}>();
  const hoverTimer=useRef<ReturnType<typeof setTimeout>>();
  function closeHover(){clearTimeout(hoverTimer.current);setHover(undefined);}
  function showHover(media:Media|undefined,anchor:HTMLButtonElement){closeHover();const host=stripRef.current?.closest<HTMLElement>('.media-viewer');if(!media||!host)return;hoverTimer.current=setTimeout(()=>{if(anchor.isConnected)setHover({media,anchor,host});},220);}
  useEffect(()=>{const dismiss=()=>closeHover();window.addEventListener('resize',dismiss);window.addEventListener('blur',dismiss);document.addEventListener('fullscreenchange',dismiss);return()=>{clearTimeout(hoverTimer.current);window.removeEventListener('resize',dismiss);window.removeEventListener('blur',dismiss);document.removeEventListener('fullscreenchange',dismiss);};},[]);
  useEffect(()=>closeHover(),[item.id,ids]);
  const [position,setPosition]=useState({left:0,width:800});
  const [records,setRecords]=useState(new Map<string,Media>());
  const cache=useRef(new Map<string,Media>());
  const tagCache=useRef<Record<string,{name:string}[]>>({});const [tags,setTags]=useState<Record<string,{name:string}[]>>({});
  const [failed,setFailed]=useState(false);
  const [retry,setRetry]=useState(0);
  const first=Math.max(0,Math.floor(position.left/STEP)-4);
  const last=Math.min(ids.length,Math.ceil((position.left+position.width)/STEP)+4);
  const visible=ids.slice(first,last);
  useLayoutEffect(()=>{
    const node=stripRef.current;if(!node)return;
    const measure=()=>setPosition({left:node.scrollLeft,width:node.clientWidth});
    const observer=new ResizeObserver(measure);observer.observe(node);measure();
    const wheel=(event:WheelEvent)=>{if(event.ctrlKey || Math.abs(event.deltaX)>=Math.abs(event.deltaY))return;event.preventDefault();node.scrollLeft+=event.deltaY*(event.deltaMode===1?20:event.deltaMode===2?node.clientWidth:1);};
    node.addEventListener('wheel',wheel,{passive:false});
    return()=>{observer.disconnect();node.removeEventListener('wheel',wheel);};
  },[]);
  useLayoutEffect(()=>{
    const node=stripRef.current,at=ids.indexOf(item.id);if(!node || at<0)return;
    // Navigation reveals the active item; merely scrolling never changes it.
    if(at*STEP<node.scrollLeft || (at+1)*STEP>node.scrollLeft+node.clientWidth)node.scrollLeft=Math.max(0,at*STEP-(node.clientWidth-STEP)/2);
    setPosition({left:node.scrollLeft,width:node.clientWidth});
  },[item.id,ids]);
  useEffect(()=>{cache.current.clear();setRecords(new Map());tagCache.current={};setTags({});},[ids]);
  useEffect(()=>{
    let valid=true;setFailed(false);
    const wanted=ids.slice(first,last),available=new Map([...known,item].map(media=>[media.id,media]));
    for(const id of wanted){const media=available.get(id);if(media)cache.current.set(id,media);}
    const missing=wanted.filter(id=>!cache.current.has(id));
    void (async()=>{
      for(let at=0;at<missing.length;at+=31){
        const rows:Media[]=await window.lumina.command({type:'media.playbackItems',includeHidden,mediaIds:missing.slice(at,at+31)});
        if(!valid)return;for(const row of rows)cache.current.set(row.id,row);
      }
      if(!valid)return;
      // Scrolling a very large collection keeps memory and decoded thumbnails bounded.
      const keep=new Set(wanted);for(const id of cache.current.keys())if(!keep.has(id))cache.current.delete(id);
      setRecords(new Map(cache.current));
      const missingTags=wanted.filter(id=>!tagCache.current[id]);
      if(missingTags.length){const result=await window.lumina.command({type:'media.cardTags',mediaIds:missingTags});if(!valid)return;tagCache.current={...tagCache.current,...result};}
      tagCache.current=Object.fromEntries(wanted.map(id=>[id,tagCache.current[id]??[]]));setTags(tagCache.current);
    })().catch(()=>{if(valid)setFailed(true);});
    return()=>{valid=false;};
  },[ids,first,last,known,item,retry,includeHidden]);
  return <><div ref={stripRef} className="filmstrip" aria-label="胶片条" onMouseLeave={closeHover} onScroll={event=>{closeHover();setPosition({left:event.currentTarget.scrollLeft,width:event.currentTarget.clientWidth});}}>
    <div className="filmstrip-canvas" style={{width:ids.length*STEP,minWidth:'100%'}}>
      {visible.map((id,offset)=>{const media=records.get(id),name=media?mediaName(media):`第 ${first+offset+1} 项`;return <ActionButton type="button" key={id} data-film-index={first+offset} aria-label={name} title={media?`${name}\n${tags[id]?.length?'标签：'+tags[id].map(tag=>tag.name).join(' · '):'暂无标签'}\n文件大小：${bytesText(media.sizeBytes)}`:name} aria-current={id===item.id?'true':undefined} className={id===item.id?'active':''} onMouseEnter={event=>showHover(media,event.currentTarget)} onMouseLeave={closeHover} onFocus={event=>showHover(media,event.currentTarget)} onBlur={closeHover} style={{left:(first+offset)*STEP}} onClick={()=>{closeHover();onSelect(first+offset);}}>{media?<img src={window.lumina.mediaUrl('thumbnail',id)+'?v='+encodeURIComponent(media.fingerprint??media.modifiedAtMs)} alt={name} loading="lazy" onError={event=>{event.currentTarget.style.visibility='hidden';}}/>:<span aria-label="正在加载缩略图">·</span>}</ActionButton>;})}
    </div>
    {failed && <ActionButton className="filmstrip-retry" onClick={()=>setRetry(value=>value+1)}>胶片加载失败 · 重试</ActionButton>}
  </div>{hover&&<FilmstripHoverPreview key={hover.media.id} {...hover}/>}</>;
}
