import {t} from './i18n';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {type Media,mediaName} from './media-types';

export function FilmstripHoverPreview({media,anchor,host}:{media:Media;anchor:HTMLElement;host:HTMLElement}){
  const [animated,setAnimated]=useState(Boolean(media.metadata?.animated)||/\.gif$/iu.test(media.absolutePath));
  const [videoReady,setVideoReady]=useState(false),[failed,setFailed]=useState(false);
  const [size,setSize]=useState({width:media.metadata?.width||320,height:media.metadata?.height||220});
  const [position,setPosition]=useState({left:0,top:0,width:0,height:0});
  const [session]=useState(()=>crypto.randomUUID());const video=useRef<HTMLVideoElement>(null);
  useEffect(()=>{
    if(media.kind!=='photo'||media.metadata?.animationVersion===3)return;
    let valid=true;void window.lumina.command({type:'media.animation',id:media.id}).then(result=>{if(valid)setAnimated(Boolean(result.animated));}).catch(()=>{});
    return()=>{valid=false;};
  },[media.id]);
  useEffect(()=>{
    const node=video.current;
    return()=>{if(node){node.pause();node.removeAttribute('src');node.load();}if(media.kind==='video')void window.lumina.command({type:'media.cancelHover',session}).catch(()=>{});};
  },[media.id,session]);
  useLayoutEffect(()=>{
    const bounds=host.getBoundingClientRect(),rect=anchor.getBoundingClientRect();
    const availableHeight=Math.max(1,rect.top-bounds.top-16),maxWidth=Math.max(1,Math.min(320,bounds.width-24)),maxHeight=Math.min(220,availableHeight);
    const ratio=size.width/Math.max(1,size.height),width=Math.min(maxWidth,maxHeight*ratio),height=width/ratio;
    setPosition({width,height,left:Math.max(bounds.left+12,Math.min(bounds.right-width-12,rect.left+rect.width/2-width/2)),top:Math.max(bounds.top+8,rect.top-height-10)});
  },[anchor,host,size]);
  return createPortal(<div className="filmstrip-hover-preview" role="tooltip" aria-label={t("放大预览 {0}", [mediaName(media)])} style={{left:position.left,top:position.top,width:position.width,visibility:position.width?'visible':'hidden'}}>
    <div className="filmstrip-hover-image" style={{height:position.height}}>
      <img draggable={false} alt={mediaName(media)} src={window.lumina.mediaUrl(animated?'original':'thumbnail',media.id)+'?v='+encodeURIComponent(media.fingerprint??media.modifiedAtMs)} onLoad={event=>setSize({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})}/>
      {media.kind==='video'&&!failed&&<video ref={video} className={videoReady?'ready':''} src={window.lumina.mediaUrl('hover',media.id)+'?session='+session} muted autoPlay loop playsInline preload="auto" tabIndex={-1} onLoadedData={event=>{setVideoReady(true);void event.currentTarget.play().catch(()=>{});}} onError={()=>setFailed(true)}/>}
      {media.kind==='video'&&!videoReady&&<span className="filmstrip-hover-status">{failed?t("视频预览暂不可用"):t("正在准备短片预览…")}</span>}
    </div>
  </div>,host);
}
