import {afterEach,it,expect,vi} from 'vitest';
import {layoutKeyframes,layoutDelta,layoutMoved,GridLayoutMotion,layoutMotionDuration,springSample} from '../apps/desktop/renderer/src/grid-layout-motion';
import {uiMotionFps,setUiMotionFps,uiMotionEnabled,setUiMotion} from '../apps/desktop/renderer/src/useUiMotion';
afterEach(()=>vi.unstubAllGlobals());
it('smooth mode continuously interpolates the spring while the optional 30 FPS mode uses stepped frames',()=>{
 const from={x:300,y:-180,sx:.5,sy:2};
 for(const fps of [30,60] as const){const frames=layoutKeyframes(from,fps);expect(frames).toHaveLength(Math.ceil(layoutMotionDuration*fps/1000)+1);expect(frames[0]).toMatchObject({offset:0,transformOrigin:'0 0',transform:'translate(300px,-180px) scale(0.5,2)'});expect(frames.at(-1)).toMatchObject({offset:1,transform:'translate(0px,0px) scale(1,1)'});expect(frames.every(frame=>frame.easing===(fps===60?'linear':'steps(1,end)'))).toBe(true);}
});
it('conserves initial velocity and settles without visible bounce or a final snap',()=>{
 expect(springSample(100,80,0)).toEqual({value:100,velocity:80});
 const step=.00001,current=springSample(100,80,.12),next=springSample(100,80,.12+step);expect((next.value-current.value)/step).toBeCloseTo(current.velocity,0);
 expect(Math.abs(springSample(100,80,layoutMotionDuration/1000).value)).toBeLessThan(.1);
 const stopped=springSample(200,0,.08),redirected=springSample(stopped.value-120,stopped.velocity,0);expect(redirected.value+120).toBe(stopped.value);expect(redirected.velocity).toBe(stopped.velocity);
});
it('converts position and size differences to transform-only FLIP and ignores subpixel layout noise',()=>{
 const from={left:120,top:200,width:100,height:80},to={left:40,top:100,width:200,height:160};expect(layoutDelta(from,to)).toEqual({x:80,y:100,sx:.5,sy:.5});expect(layoutMoved(from,to)).toBe(true);expect(layoutMoved(from,{...from,left:120.2,height:80.4})).toBe(false);
});
it('defaults to smooth mode and persists an explicit 30 FPS preference',()=>{
 const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key),setItem:(key:string,value:string)=>values.set(key,value)});vi.stubGlobal('window',new EventTarget());vi.stubGlobal('document',{documentElement:{dataset:{}}});expect(uiMotionFps()).toBe(60);setUiMotionFps(30);expect(uiMotionFps()).toBe(30);expect(values.get('lumina.ui.motionFps')).toBe('30');values.set('lumina.ui.motionFps','bad');expect(uiMotionFps()).toBe(60);
});
function grid(){
 vi.stubGlobal('localStorage',{getItem:()=>null});vi.stubGlobal('window',{matchMedia:()=>({matches:false})});vi.stubGlobal('document',{documentElement:{dataset:{}}});
 let rect={left:10,top:10,width:100,height:100,right:110,bottom:110};
 type MockAnimation={currentTime:number;cancel:ReturnType<typeof vi.fn>;play:ReturnType<typeof vi.fn>;effect:{setKeyframes:ReturnType<typeof vi.fn>}|null;onfinish:(()=>void)|null;oncancel:(()=>void)|null};
 const animations:MockAnimation[]=[];
 const node={dataset:{layoutKey:'media:one',layoutMoving:undefined as string|undefined},style:{willChange:''},getBoundingClientRect:vi.fn(()=>rect),animate:vi.fn((frames:Keyframe[],_options:unknown)=>{const animation:MockAnimation={currentTime:0,cancel:vi.fn(),play:vi.fn(),effect:{setKeyframes:vi.fn()},onfinish:null,oncancel:null};animations.push(animation);return animation;})};
 const host={scrollTop:0,scrollLeft:0,getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:600,width:800,height:600}),querySelectorAll:()=>[node]} as unknown as HTMLElement;
 return {host,node,animations,resolve:()=>animations.at(-1)?.onfinish?.(),move:(next:Partial<typeof rect>)=>rect={...rect,...next}};
}
it('retains starting geometry after scrolling and releases temporary compositor hints on finish',async()=>{
 const t=grid(),motion=new GridLayoutMotion();motion.update(t.host,{top:0,left:0});expect(t.node.animate).not.toHaveBeenCalled();
 t.host.scrollTop=20;t.move({top:30,bottom:230,width:200,height:200});motion.update(t.host,{top:20,left:0});expect(t.node.animate).toHaveBeenCalledTimes(1);expect(t.node.animate.mock.calls[0]![0][0].transform).toBe('translate(0px,-40px) scale(0.5,0.5)');expect(t.node.style.willChange).toBe('transform');t.resolve();await Promise.resolve();expect(t.node.style.willChange).toBe('');expect(t.animations[0]!.cancel).toHaveBeenCalled();expect(t.animations[0]!.effect).toBeNull();expect(t.animations[0]!.onfinish).toBeNull();motion.clear();
});
it('retargets from the current visual size with carried momentum and one active animation',()=>{
 const t=grid(),motion=new GridLayoutMotion();motion.track(t.host);t.move({width:300,height:300});motion.update(t.host,{top:0,left:0});t.animations[0]!.currentTime=80;
 const state=springSample(-200,0,.08),visualWidth=300+state.value;t.move({width:150,height:150});motion.update(t.host,{top:0,left:0});
 expect(t.node.animate).toHaveBeenCalledTimes(1);expect(t.animations[0]!.play).toHaveBeenCalledOnce();const frames=t.animations[0]!.effect!.setKeyframes.mock.calls[0]![0];expect(frames[0]!.transform).toBe(`translate(0px,0px) scale(${visualWidth/150},${visualWidth/150})`);expect(t.animations[0]!.cancel).toHaveBeenCalled();
 // A reversal initially keeps moving in the previous direction before braking.
 const firstScale=Number(/scale\(([^,]+)/u.exec(String(frames[1]!.transform))![1]);expect(firstScale).toBeGreaterThan(visualWidth/150);motion.clear();
});
it('tracks virtual cards without creating scroll animations or measuring unchanged cards repeatedly',()=>{
 const t=grid(),motion=new GridLayoutMotion();motion.track(t.host);const reads=t.node.getBoundingClientRect.mock.calls.length;
 t.host.scrollTop=25;t.move({top:-15,bottom:85});motion.track(t.host);expect(t.node.getBoundingClientRect.mock.calls.length).toBe(reads);expect(t.node.animate).not.toHaveBeenCalled();
 // A newly mounted virtual card needs a snapshot before the next reflow.
 t.node.dataset.layoutKey='media:new';motion.track(t.host);expect(t.node.getBoundingClientRect.mock.calls.length).toBe(reads+1);t.move({left:70,right:170});motion.update(t.host,{top:25,left:0});expect(t.node.animate).toHaveBeenCalledTimes(1);motion.clear();expect(t.node.style.willChange).toBe('');
});

it('follows reduced system motion only until the user makes an explicit app choice',()=>{
 const values=new Map<string,string>();let reduced=true;vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key),setItem:(key:string,value:string)=>values.set(key,value)});const target=new EventTarget();Object.assign(target,{matchMedia:()=>({matches:reduced})});vi.stubGlobal('window',target);vi.stubGlobal('document',{documentElement:{dataset:{}}});
 expect(uiMotionEnabled()).toBe(false);setUiMotion(true);expect(uiMotionEnabled()).toBe(true);expect(document.documentElement.dataset.motion).toBe('on');setUiMotion(false);reduced=false;expect(uiMotionEnabled()).toBe(false);values.delete('lumina.ui.animations');expect(uiMotionEnabled()).toBe(true);
});
it('runs layout springs on explicit enable even when the system requests reduced motion',()=>{
 const t=grid();vi.stubGlobal('localStorage',{getItem:(key:string)=>key==='lumina.ui.animations'?'on':null});vi.stubGlobal('window',{matchMedia:()=>({matches:true})});const motion=new GridLayoutMotion();motion.track(t.host);t.move({width:200,height:200});motion.update(t.host,{top:0,left:0});expect(t.node.animate).toHaveBeenCalledTimes(1);motion.clear();
});

it('reuses one native effect throughout 500 interrupted layout changes and detaches it on clear',()=>{
 const t=grid(),motion=new GridLayoutMotion();motion.track(t.host);
 for(let i=0;i<500;i++){t.move({width:i%2?150:300,height:i%2?150:300});motion.update(t.host,{top:0,left:0});t.animations[0]!.currentTime=16;}
 expect(t.node.animate).toHaveBeenCalledTimes(1);expect(t.animations[0]!.effect!.setKeyframes).toHaveBeenCalledTimes(499);
 motion.clear();expect(t.animations[0]!.effect).toBeNull();expect(t.animations[0]!.onfinish).toBeNull();expect(t.node.style.willChange).toBe('');
});
