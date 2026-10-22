import {useMediaActivity} from './MediaActivity';
import {ActionButton} from './ActionControls';
import { useCallback,useEffect, useRef, useState } from 'react';
import {animationPreferences,subscribeAnimationPreferences,animationMetadataQueue,automaticAnimationBytes,observeAnimatedPreview,type AnimationMetadata} from './animated-previews';
import {playAnimationFrames} from './animation-frame-player';

const animationMetadata=animationMetadataQueue(id=>window.lumina.command({type:'media.animation',id}));

type Props = { id: string; kind: string; source?: string; preview?:boolean;previewPath?:string;animated?:boolean;sizeBytes?:number;animationWidth?:number;animationHeight?:number;animationFrames?:number };

export function MediaThumbnail({ id, kind, source,preview=false,previewPath='',animated=false,sizeBytes=0,animationWidth,animationHeight,animationFrames }: Props) {
  const active=useMediaActivity();
  const [limits,setLimits]=useState(animationPreferences);
  useEffect(()=>subscribeAnimationPreferences(()=>setLimits(animationPreferences())),[]);
  const [replacement, setReplacement] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const attempted = useRef(false);
  const mounted = useRef(true);
  const pending = useRef(false);
  const image=useRef<HTMLImageElement>(null);
  const [animation,setAnimation]=useState({visible:false,automatic:false});
  const [identified,setIdentified]=useState<{key:string;data:AnimationMetadata}>();
  const [automaticFailedKey,setAutomaticFailedKey]=useState('');
  const animationKey=JSON.stringify([id,source]),details=identified?.key===animationKey?identified.data:{animated,width:animationWidth,height:animationHeight,frames:animationFrames};
  const failureKey=JSON.stringify([animationKey,limits.maxBytes]);
  const automaticFailed=automaticFailedKey===failureKey;
  const failAutomatic=useCallback(()=>setAutomaticFailedKey(failureKey),[failureKey]);
  // Read eligibility again when settings change, without tearing down observers
  // or waiting for a second intersection callback on already visible cards.
  useEffect(()=>{setAnimation({visible:false,automatic:false});const node=image.current;if(!active || !animated || !node)return;return observeAnimatedPreview(node,()=>automaticFailed?0:automaticAnimationBytes(sizeBytes,details.width,details.height,details.frames),(visible,automatic)=>setAnimation({visible,automatic}));},[active,id,animated,sizeBytes,details.width,details.height,details.frames,source,failed,replacement,automaticFailed]);
  useEffect(()=>{if(!active||!animated||!animation.visible||sizeBytes<=0||limits.maxBytes>0&&sizeBytes>limits.maxBytes||(details.width&&details.height&&details.frames))return;let valid=true;void animationMetadata(id,source??'').then(data=>{if(valid)setIdentified({key:animationKey,data});}).catch(()=>{});return()=>{valid=false;};},[active,id,animated,animation.visible,sizeBytes,source,animationKey,details.width,details.height,details.frames,limits.maxBytes]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setReplacement(undefined); setFailed(false); attempted.current = false; }, [id, source]);

  async function retry(force=false) {
    if (pending.current) return;
    pending.current = true; attempted.current = true; setRetrying(true); setFailed(true);
    try {
      const url = await window.lumina.thumbnail(id,force);
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(); image.onerror = () => reject(new Error('缩略图解码失败')); image.src = url;
      });
      if (mounted.current) { setReplacement(url); setFailed(false); }
    } catch { /* Keep a retry action when the original is unavailable. */ }
    finally { pending.current = false; if (mounted.current) setRetrying(false); }
  }

  const url = replacement ?? source;
  if (failed || !url) return <div className="thumbnail-fallback"><span>{kind === 'video' ? '▶' : '✦'}</span><ActionButton type="button" className="thumbnail-retry" title="重试缩略图" disabled={retrying} onClick={(event) => { event.stopPropagation(); return retry(true); }} onDoubleClick={(event) => event.stopPropagation()}>{retrying ? '正在重试…' : failed ? '缩略图加载失败 · 重试' : '加载缩略图'}</ActionButton></div>;
  return <><img draggable={false} ref={image} src={active?url:undefined} alt="" onError={() => { if(!active)return;setFailed(true); if (!attempted.current) void retry(); }} />{kind==='video' && <span className="video-play-badge" aria-label="视频">▶</span>}{active && animated && animation.visible && (animation.automatic || preview) && (animation.automatic&&!automaticFailed?<AutomaticPhoto key={animationKey} id={id} width={details.width!} height={details.height!} maxBytes={limits.maxBytes===0?0:sizeBytes} onError={failAutomatic}/>:<AnimatedPhoto key={id} id={id}/>)}{active && preview && kind==='video' && <HoverVideo key={id} id={id} path={previewPath}/>}</>;
}

function AutomaticPhoto({id,width,height,maxBytes,onError}:{id:string;width:number;height:number;maxBytes:number;onError:()=>void}){
 const ref=useRef<HTMLCanvasElement>(null),[ready,setReady]=useState(false);
 useEffect(()=>{setReady(false);if(!ref.current)return;return playAnimationFrames({canvas:ref.current,url:window.lumina.mediaUrl('original',id),width,height,maxBytes,onReady:()=>setReady(true),onError});},[id,width,height,maxBytes,onError]);
 return <canvas ref={ref} className={`thumbnail-animated-photo${ready?' ready':''}`} data-animation-playback="frames" aria-hidden="true"/>;
}

function AnimatedPhoto({id}:{id:string}){const [ready,setReady]=useState(false),[failed,setFailed]=useState(false);return failed?null:<img draggable={false} className={`thumbnail-animated-photo${ready?' ready':''}`} src={window.lumina.mediaUrl('original',id)} alt="" decoding="async" onLoad={()=>setReady(true)} onError={()=>setFailed(true)}/>;}

function HoverVideo({id,path}:{id:string;path:string}){
  const video=useRef<HTMLVideoElement>(null);const [ready,setReady]=useState(false);const [failed,setFailed]=useState(false);
  const [compatible,setCompatible]=useState(/\.avi$/iu.test(path));const [session]=useState(()=>crypto.randomUUID());
  useEffect(()=>{const node=video.current;return()=>{if(node){node.pause();node.removeAttribute('src');node.load();}if(compatible)void window.lumina.command({type:'media.cancelHover',session}).catch(()=>{});};},[compatible]);
  if(failed)return null;
  return <video draggable={false} key={String(compatible)} ref={video} className={`thumbnail-hover-video${ready?' ready':''}`} src={window.lumina.mediaUrl(compatible?'hover':'original',id)+(compatible?'?session='+session:'')} muted autoPlay loop playsInline preload="metadata" tabIndex={-1} aria-hidden="true" onLoadedData={event=>{setReady(true);void event.currentTarget.play().catch(()=>{});}} onError={event=>{const code=event.currentTarget.error?.code;if(!compatible && (code===3 || code===4)){setReady(false);setCompatible(true);}else setFailed(true);}}/>;
}
