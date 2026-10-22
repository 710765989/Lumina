import {uiMotionEnabled,uiMotionFps} from './useUiMotion';
import {refreshAnimatedPreviewLayout} from './animated-previews';

export type MotionRect={left:number;top:number;width:number;height:number};
export type MotionVelocity={x:number;y:number;width:number;height:number};
type Delta={x:number;y:number;sx:number;sy:number};
const still:MotionVelocity={x:0,y:0,width:0,height:0};
export const layoutMotionDuration=540;

// Keep position and velocity when a gesture interrupts an existing spring.
export function springSample(displacement:number,velocity:number,seconds:number){
 const omega=18,damping=.9,decay=omega*damping,frequency=omega*Math.sqrt(1-damping*damping);
 const a=displacement,b=(velocity+decay*a)/frequency,t=Math.max(0,seconds);
 const envelope=Math.exp(-decay*t),cos=Math.cos(frequency*t),sin=Math.sin(frequency*t),wave=a*cos+b*sin;
 return {value:envelope*wave,velocity:envelope*((-a*frequency*sin+b*frequency*cos)-decay*wave)};
}
export function layoutKeyframes(from:Delta,fps:30|60,duration=layoutMotionDuration,velocity:MotionVelocity=still,targetSize={width:1,height:1}):Keyframe[]{
 const steps=Math.ceil(duration*fps/1000);
 return Array.from({length:steps+1},(_,index)=>{
  const offset=index/steps,t=offset*duration/1000,last=index===steps;
  const x=last?0:springSample(from.x,velocity.x,t).value,y=last?0:springSample(from.y,velocity.y,t).value;
  const sx=last?1:Math.max(.01,1+springSample(from.sx-1,velocity.width/targetSize.width,t).value);
  const sy=last?1:Math.max(.01,1+springSample(from.sy-1,velocity.height/targetSize.height,t).value);
  // Smooth mode interpolates continuously at the display refresh rate. Only
  // the explicit power-saving preference uses stepped frames.
  return {offset,easing:fps===30?'steps(1,end)':'linear',transformOrigin:'0 0',transform:`translate(${x}px,${y}px) scale(${sx},${sy})`};
 });
}
export function layoutDelta(from:MotionRect,to:MotionRect){return {x:from.left-to.left,y:from.top-to.top,sx:from.width/Math.max(1,to.width),sy:from.height/Math.max(1,to.height)};}
export function layoutMoved(from:MotionRect,to:MotionRect){return Math.abs(from.left-to.left)>.5||Math.abs(from.top-to.top)>.5||Math.abs(from.width-to.width)>.5||Math.abs(from.height-to.height)>.5;}
const intersects=(r:MotionRect,v:DOMRect)=>r.left+r.width>v.left&&r.left<v.right&&r.top+r.height>v.top&&r.top<v.bottom;
const identity=(node:HTMLElement)=>node.dataset.layoutKey??'media:'+node.dataset.mediaId;
function nodes(host:HTMLElement){const wrappers=Array.from(host.querySelectorAll<HTMLElement>('[data-layout-key]'));return wrappers.length?wrappers:Array.from(host.querySelectorAll<HTMLElement>('[data-media-id]'));}
type Running={animation:Animation;willChange:string;from:MotionRect;to:MotionRect;velocity:MotionVelocity};
function releaseAnimation(node:HTMLElement,item:Running){
 item.animation.onfinish=null;item.animation.oncancel=null;
 item.animation.cancel();item.animation.effect=null;
 node.style.willChange=item.willChange;delete node.dataset.layoutMoving;
}

export class GridLayoutMotion{
 private rects=new Map<string,{node:HTMLElement;rect:MotionRect}>();
 private animations=new Map<HTMLElement,Running>();
 private viewport?:DOMRect;
 stop(){
  for(const [node,item] of this.animations)releaseAnimation(node,item);
  this.animations.clear();refreshAnimatedPreviewLayout();
 }
 clear(){this.stop();this.rects.clear();this.viewport=undefined;}
 // Ordinary scroll commits record newly mounted virtual cards without
 // interrupting active springs. No per-frame React renders or file reads.
 track(host:HTMLElement){
  const viewport=host.getBoundingClientRect();if(!viewport.width||!viewport.height)return;
  const next=new Map<string,{node:HTMLElement;rect:MotionRect}>();
  for(const node of nodes(host)){
   const id=identity(node),saved=this.rects.get(id);
   if(saved?.node===node){next.set(id,saved);continue;}
   const rect=node.getBoundingClientRect();next.set(id,{node,rect:{left:rect.left-viewport.left+host.scrollLeft,top:rect.top-viewport.top+host.scrollTop,width:rect.width,height:rect.height}});
  }
  this.rects=next;this.viewport=viewport;
 }
 update(host:HTMLElement,scrollBefore:{top:number;left:number}){
  const viewport=host.getBoundingClientRect();if(!viewport.width||!viewport.height){this.clear();return;}
  const cards=nodes(host),visual=new Map<string,{rect:MotionRect;velocity:MotionVelocity}>();
  for(const node of cards){
   const id=identity(node),old=this.rects.get(id);if(!old||old.node!==node||!this.viewport)continue;
   const rect={...old.rect,left:old.rect.left+this.viewport.left-scrollBefore.left,top:old.rect.top+this.viewport.top-scrollBefore.top};
   const running=this.animations.get(node);let velocity={...still};
   if(running){
    const seconds=Math.min(layoutMotionDuration,Number(running.animation.currentTime??0))/1000;
    const x=springSample(running.from.left-running.to.left,running.velocity.x,seconds),y=springSample(running.from.top-running.to.top,running.velocity.y,seconds);
    const width=springSample(running.from.width-running.to.width,running.velocity.width,seconds),height=springSample(running.from.height-running.to.height,running.velocity.height,seconds);
    rect.left+=x.value;rect.top+=y.value;rect.width=Math.max(1,rect.width+width.value);rect.height=Math.max(1,rect.height+height.value);
    velocity={x:x.velocity,y:y.velocity,width:width.velocity,height:height.velocity};
   }
   visual.set(id,{rect,velocity});
  }
  // Cancel the transform for layout measurement, but reuse the same native
  // Animation/KeyframeEffect during an interrupted gesture. Creating thousands
  // of cancelled effects lets Blink retain native keyframe data until much later.
  const interrupted=this.animations;this.animations=new Map();
  for(const [node,item] of interrupted){item.animation.onfinish=null;item.animation.oncancel=null;item.animation.cancel();node.style.willChange=item.willChange;delete node.dataset.layoutMoving;}
  const next=new Map<string,{node:HTMLElement;rect:MotionRect}>(),targets=cards.map(node=>({node,rect:node.getBoundingClientRect()}));
  const enabled=uiMotionEnabled()&&document.documentElement.dataset.motion!=='off';
  const plans:Array<{node:HTMLElement;from:MotionRect;to:DOMRect;velocity:MotionVelocity}>=[];
  for(const {node,rect} of targets){
   const id=identity(node);next.set(id,{node,rect:{left:rect.left-viewport.left+host.scrollLeft,top:rect.top-viewport.top+host.scrollTop,width:rect.width,height:rect.height}});
   const from=visual.get(id);
   if(enabled&&from&&(layoutMoved(from.rect,rect)||Object.values(from.velocity).some(value=>Math.abs(value)>2))&&(intersects(from.rect,viewport)||intersects(rect,viewport)))plans.push({node,from:from.rect,to:rect,velocity:from.velocity});
  }
  this.rects=next;this.viewport=viewport;
  for(const {node,from,to,velocity} of plans.slice(0,200)){
   const willChange=node.style.willChange;node.style.willChange='transform';node.dataset.layoutMoving='true';
   const frames=layoutKeyframes(layoutDelta(from,to),uiMotionFps(),layoutMotionDuration,velocity,to);
   const reusable=interrupted.get(node);let animation:Animation;
   if(reusable?.animation.effect && 'setKeyframes' in reusable.animation.effect){
    animation=reusable.animation;(animation.effect as KeyframeEffect).setKeyframes(frames);animation.play();interrupted.delete(node);
   }else animation=node.animate(frames,{duration:layoutMotionDuration,easing:'linear'});
   const item={animation,willChange,from,to,velocity};this.animations.set(node,item);
   animation.onfinish=()=>{if(this.animations.get(node)!==item)return;releaseAnimation(node,item);this.animations.delete(node);refreshAnimatedPreviewLayout();};
  }
  for(const [node,item] of interrupted){if(!this.animations.has(node))releaseAnimation(node,item);else{item.animation.cancel();item.animation.effect=null;}}
  refreshAnimatedPreviewLayout();
 }
}
