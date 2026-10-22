import {animationWorkingBytes} from './animation-frame-player';
// Share visibility observation and limit automatic decoders across all media views.
// Zero is a persisted, JSON-safe sentinel for an explicitly unrestricted setting.
export const animationSizeOptions=[512*1024,1024*1024,2*1024*1024,4*1024*1024,8*1024*1024,10*1024*1024,0];
type AnimationPreferences={maxBytes:number;count:number};
const defaults:AnimationPreferences={maxBytes:2*1024*1024,count:8};
function normalize(value:Partial<AnimationPreferences>):AnimationPreferences{return {maxBytes:typeof value.maxBytes==='number'&&animationSizeOptions.includes(value.maxBytes)?value.maxBytes:defaults.maxBytes,count:value.count===0?0:typeof value.count==='number'&&Number.isFinite(value.count)?Math.max(1,Math.min(16,Math.round(value.count))):defaults.count};}
function readPreferences(){try{return normalize(JSON.parse(localStorage.getItem('lumina.gif.autoplay')??'{}'));}catch{return {...defaults};}}
let preferences=readPreferences();const preferenceListeners=new Set<()=>void>();
export const animationPreferences=()=>({...preferences});
export function subscribeAnimationPreferences(update:()=>void){preferenceListeners.add(update);return()=>{preferenceListeners.delete(update);};}
export function setAnimationPreferences(value:AnimationPreferences){preferences=normalize(value);try{localStorage.setItem('lumina.gif.autoplay',JSON.stringify(preferences));}catch{/* Keep session preference when persistence is unavailable. */}refresh();preferenceListeners.forEach(update=>update());}
if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(event.key==='lumina.gif.autoplay'){preferences=readPreferences();refresh();preferenceListeners.forEach(update=>update());}});
const maximumDecodedBytes=128*1024*1024;
export type AnimationMetadata={animated:boolean;width?:number;height?:number;frames?:number};
// Older indexes may have no dimensions/frame count. Probe only visible small
// animations, without rescanning the library or starting unbounded file reads.
export function animationMetadataQueue(read:(id:string)=>Promise<AnimationMetadata>){
 const cache=new Map<string,Promise<AnimationMetadata>>(),pending:Array<()=>Promise<void>>=[];let active=0;
 function pump(){while(active<2&&pending.length){active++;void pending.shift()!().finally(()=>{active--;pump();});}}
 return (id:string,version:string)=>{const key=JSON.stringify([id,version]),found=cache.get(key);if(found){cache.delete(key);cache.set(key,found);return found;}
  const promise=new Promise<AnimationMetadata>((resolve,reject)=>{pending.push(async()=>{try{resolve(await read(id));}catch(error){cache.delete(key);reject(error);}});});cache.set(key,promise);while(cache.size>256)cache.delete(cache.keys().next().value!);pump();return promise;
 };
}
export function automaticAnimationBytes(sizeBytes:number,width?:number,height?:number,frames?:number){
 if(!Number.isFinite(sizeBytes)||sizeBytes<=0||preferences.maxBytes>0&&sizeBytes>preferences.maxBytes||!width||!height||!frames||![width,height,frames].every(value=>Number.isFinite(value)&&value>0))return 0;
 const working=animationWorkingBytes(sizeBytes,width,height);
 return Number.isFinite(working)&&(preferences.maxBytes===0||working<=32*1024*1024)?working:0;
}
type AnimationCost=number|(()=>number);
type Subscriber={decodedBytes:AnimationCost;visible:boolean;active:boolean;reportedVisible:boolean;clip:Element|null;update:(visible:boolean,automatic:boolean)=>void};
const subscribers=new Map<Element,Subscriber>();
let observer:IntersectionObserver|undefined;
let scrollFrame=0;
function scheduleRefresh(){if(subscribers.size&&!scrollFrame)scrollFrame=requestAnimationFrame(()=>{scrollFrame=0;refresh();});}
// Grid reflow and completed FLIP animations can change priority without another
// scroll or intersection-threshold event. Share the same bounded frame callback.
export const refreshAnimatedPreviewLayout=scheduleRefresh;
function refresh(){
 let available=preferences.count===0?Infinity:preferences.count,budget=preferences.count===0?Infinity:maximumDecodedBytes;
 const foreground=typeof document!=='undefined'&&document.visibilityState!=='hidden',bounds=new Map<Element,DOMRect>();
 // Read current positions once per animation frame. IO alone does not notify when
 // two still-visible rows exchange priority while scrolling in either direction.
 const ranked=[...subscribers].map(([node,item])=>{
  let area=item.visible?1:0,top=0,left=0,complete=true;
  if(foreground&&item.visible&&typeof node.getBoundingClientRect==='function'){
   const rect=node.getBoundingClientRect();top=rect.top;left=rect.left;
   let bottom=window.innerHeight,right=window.innerWidth,clipTop=0,clipLeft=0;
   if(item.clip){let clip=bounds.get(item.clip);if(!clip){clip=item.clip.getBoundingClientRect();bounds.set(item.clip,clip);}clipTop=Math.max(clipTop,clip.top);clipLeft=Math.max(clipLeft,clip.left);bottom=Math.min(bottom,clip.bottom);right=Math.min(right,clip.right);}
   area=Math.max(0,Math.min(rect.bottom,bottom)-Math.max(rect.top,clipTop))*Math.max(0,Math.min(rect.right,right)-Math.max(rect.left,clipLeft));
   complete=rect.top>=clipTop-1&&rect.left>=clipLeft-1&&rect.bottom<=bottom+1&&rect.right<=right+1;
  }
  return {item,area,top,left,complete};
 }).sort((a,b)=>Number(b.complete)-Number(a.complete)||Math.round(b.area)-Math.round(a.area)||a.top-b.top||a.left-b.left);
 const states=ranked.map(({item,area})=>{
  const cost=typeof item.decodedBytes==='function'?item.decodedBytes():item.decodedBytes;
  const visible=foreground&&item.visible&&area>0,active=visible&&Number.isFinite(cost)&&cost>0&&available>0&&cost<=budget;
  if(active){available--;budget-=cost;}return {item,visible,active};
 });
 // Release old decoders before activating their replacements.
 for(const {item,visible,active} of states.filter(state=>!state.active).concat(states.filter(state=>state.active))){if(item.active!==active||item.reportedVisible!==visible){item.active=active;item.reportedVisible=visible;item.update(visible,active);}}
}
export function observeAnimatedPreview(node:Element,decodedBytes:AnimationCost,update:Subscriber['update']){
 if(!observer){observer=new IntersectionObserver(entries=>{for(const entry of entries){const item=subscribers.get(entry.target);if(item)item.visible=entry.isIntersecting;}refresh();},{threshold:[0,.01,1]});document.addEventListener('visibilitychange',refresh);document.addEventListener('scroll',scheduleRefresh,{capture:true,passive:true});if(typeof window!=='undefined')window.addEventListener('resize',scheduleRefresh,{passive:true});}
 const clip=node.closest?.('.grouped-media-scroll,.virtual-grid-viewport,.smart-exclusions-list,.page-content')??null;
 subscribers.set(node,{decodedBytes,visible:false,active:false,reportedVisible:false,clip,update});observer.observe(node);
 return()=>{observer?.unobserve(node);subscribers.delete(node);if(!subscribers.size){observer?.disconnect();observer=undefined;document.removeEventListener('visibilitychange',refresh);document.removeEventListener('scroll',scheduleRefresh,{capture:true});if(typeof window!=='undefined')window.removeEventListener('resize',scheduleRefresh);if(scrollFrame){cancelAnimationFrame(scrollFrame);scrollFrame=0;}}else refresh();};
}
