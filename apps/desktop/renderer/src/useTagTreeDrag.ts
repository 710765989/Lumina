import {t} from './i18n';
import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent,type RefObject} from 'react';
import type {Tag} from './media-types';
import {planTagDrop,type TagDropPlan} from './tag-drop-plan';
import {uiMotionEnabled} from './useUiMotion';
type DragState={sourceKey:string;copy:boolean;plan:TagDropPlan|null;message:string};
type Options={tags:Tag[];list:RefObject<HTMLDivElement>;blocked:boolean;active:boolean;onCommit:(plan:TagDropPlan)=>void};
// Only target/modifier changes enter React. The floating row follows the pointer
// directly, so dragging does not rerender or remeasure the tree on every pixel.
export function useTagTreeDrag(options:Options){
 const latest=useRef(options);latest.current=options;
 const [drag,setDrag]=useState<DragState|null>(null),[landingKey,setLandingKey]=useState<string|null>(null);
 const cancelRef=useRef<()=>void>(()=>{}),releaseLanding=useRef<()=>void>(()=>{});
 useEffect(()=>()=>{cancelRef.current();releaseLanding.current();},[]);
 useEffect(()=>{if(!options.active){cancelRef.current();releaseLanding.current();}},[options.active]);
 function start(event:ReactPointerEvent<HTMLElement>,sourceKey:string){
  if(event.button!==0||latest.current.blocked)return;
  const row=event.currentTarget.closest<HTMLElement>('.tag-management-row');if(!row)return;
  event.preventDefault();event.stopPropagation();cancelRef.current();releaseLanding.current();
  const initial={x:event.clientX,y:event.clientY},rect=row.getBoundingClientRect(),controller=new AbortController(),signal=controller.signal;
  let active=false,copy=event.ctrlKey,point={...initial},ghost:HTMLDivElement|undefined,frame=0,plan:TagDropPlan|null=null,lastSignature='',sticky:{key:string|null;rect:DOMRect}|undefined;
  const offset={x:Math.min(initial.x-rect.left,500),y:initial.y-rect.top};let position={x:rect.left,y:rect.top};
  const stop=()=>{controller.abort();cancelAnimationFrame(frame);document.body.classList.remove('tag-tree-dragging');document.body.style.removeProperty('--tag-drag-cursor');};
  const cancel=()=>{stop();ghost?.remove();ghost=undefined;setDrag(null);};cancelRef.current=cancel;
  function locate(){
   if(!active)return;
   const hit=document.elementFromPoint(point.x,point.y),list=latest.current.list.current;
   let key:string|null|undefined;
   const candidate=hit?.closest<HTMLElement>('.tag-management-row');
   if(candidate?.classList.contains('tag-drop-placeholder')&&plan)key=plan.targetKey;
   else if(sticky&&point.x>=sticky.rect.left&&point.x<=sticky.rect.right&&point.y>=sticky.rect.top&&point.y<=sticky.rect.bottom)key=sticky.key;
   else if(candidate&&list?.contains(candidate)){key=candidate.dataset.tagKey;sticky={key:key??null,rect:candidate.getBoundingClientRect()};}
   else if(hit?.closest('.tag-management-footer')){key=null;sticky={key:null,rect:hit.closest('.tag-management-footer')!.getBoundingClientRect()};}
   else sticky=undefined;
   const signature=JSON.stringify([key??'__outside__',key===null,copy]);if(signature===lastSignature)return;lastSignature=signature;
   let message='';plan=null;
   if(key!==undefined&&key!==sourceKey)try{plan=planTagDrop(latest.current.tags,sourceKey,key,copy);if(!plan)message=t('该位置已包含此引用');}catch(reason){message=reason instanceof Error?reason.message:t("不能放到该位置");}
   setDrag({sourceKey,copy,plan,message});
  }
  function follow(){
   if(!ghost)return;position={x:point.x-offset.x,y:point.y-offset.y};ghost.style.transform=`translate3d(${position.x}px,${position.y}px,0)`;ghost.dataset.copy=String(copy);ghost.querySelector('.tag-drag-mode')!.textContent=copy?t("＋ 复制引用"):t("移动引用");document.body.style.setProperty('--tag-drag-cursor',copy?'copy':'grabbing');
  }
  function scroll(){
   const list=latest.current.list.current;if(!list||!active)return;const box=list.getBoundingClientRect();
   if(point.x>=box.left&&point.x<=box.right&&point.y>=box.top-24&&point.y<=box.bottom+24){const speed=point.y<box.top+42?-Math.min(16,(box.top+42-point.y)/3):point.y>box.bottom-42?Math.min(16,(point.y-box.bottom+42)/3):0;if(speed){const before=list.scrollTop;list.scrollTop+=speed;if(list.scrollTop!==before){sticky=undefined;lastSignature='';locate();}}}
   frame=requestAnimationFrame(scroll);
  }
  function begin(){
   active=true;ghost=document.createElement('div');ghost.className='tag-drag-overlay';ghost.setAttribute('aria-hidden','true');ghost.inert=true;ghost.style.width=Math.min(rect.width,560)+'px';ghost.dataset.sourceKey=sourceKey;
   const clone=row!.cloneNode(true) as HTMLElement;for(const node of [clone,...Array.from(clone.querySelectorAll<HTMLElement>('[id],[data-tag-id],[data-tag-key],[data-layout-key]'))])for(const attribute of ['id','data-tag-id','data-tag-key','data-layout-key'])node.removeAttribute(attribute);clone.style.margin='0';clone.style.transform='none';clone.classList.remove('tag-drop-target','tag-drop-placeholder');ghost.append(clone);
   const badge=document.createElement('span');badge.className='tag-drag-mode';ghost.append(badge);document.body.append(ghost);document.body.classList.add('tag-tree-dragging');setDrag({sourceKey,copy,plan:null,message:''});follow();locate();frame=requestAnimationFrame(scroll);
  }
  function move(input:PointerEvent){if(input.pointerId!==event.pointerId)return;point={x:input.clientX,y:input.clientY};copy=input.ctrlKey;if(!active&&Math.hypot(point.x-initial.x,point.y-initial.y)>=6)begin();if(active){input.preventDefault();follow();locate();}}
  function release(input:PointerEvent){
   if(input.pointerId!==event.pointerId)return;point={x:input.clientX,y:input.clientY};copy=input.ctrlKey;follow();lastSignature='';locate();stop();cancelRef.current=()=>{};
   if(!active||!plan||!ghost){ghost?.remove();setDrag(null);return;}
   const committed=plan,landing=ghost;ghost=undefined;setDrag(null);setLandingKey(committed.newKey);latest.current.onCommit(committed);
   let animation:Animation|undefined,timer=0;const finish=()=>{clearTimeout(timer);if(animation){animation.onfinish=null;animation.oncancel=null;animation.cancel();animation.effect=null;}landing.remove();setLandingKey(null);releaseLanding.current=()=>{};};releaseLanding.current=finish;
   requestAnimationFrame(()=>{if(!landing.isConnected)return;const host=latest.current.list.current,target=host?.querySelector<HTMLElement>(`[data-tag-key="${CSS.escape(committed.newKey)}"]`);if(!target||!host){finish();return;}if(target.offsetTop<host.scrollTop)host.scrollTop=target.offsetTop;else if(target.offsetTop+target.offsetHeight>host.scrollTop+host.clientHeight)host.scrollTop=target.offsetTop+target.offsetHeight-host.clientHeight;if(!uiMotionEnabled()){finish();return;}const box=host.getBoundingClientRect(),left=box.left+target.offsetLeft-host.scrollLeft,top=box.top+target.offsetTop-host.scrollTop;
    animation=landing.animate([{transform:`translate3d(${position.x}px,${position.y}px,0) scale(1)`,opacity:.94},{transform:`translate3d(${left}px,${top}px,0) scale(${target.offsetWidth/landing.offsetWidth},${target.offsetHeight/landing.offsetHeight})`,opacity:0}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});animation.onfinish=finish;timer=window.setTimeout(finish,350);
   });
  }
  const key=(input:KeyboardEvent)=>{if(input.key==='Escape'){input.preventDefault();cancel();return;}if(input.key==='Control'){copy=input.type==='keydown';sticky=undefined;lastSignature='';follow();locate();}};
  window.addEventListener('pointermove',move,{capture:true,passive:false,signal});window.addEventListener('pointerup',release,{capture:true,signal});window.addEventListener('pointercancel',cancel,{capture:true,signal});window.addEventListener('keydown',key,{capture:true,signal});window.addEventListener('keyup',key,{capture:true,signal});window.addEventListener('blur',cancel,{signal});
 }
 return {drag,landingKey,start};
}
