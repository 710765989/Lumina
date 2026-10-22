import {afterEach,expect,it,vi} from 'vitest';
import {animationMetadataQueue,automaticAnimationBytes,observeAnimatedPreview,setAnimationPreferences,animationPreferences,refreshAnimatedPreviewLayout} from '../apps/desktop/renderer/src/animated-previews';
import {mediaAnimationProps} from '../apps/desktop/renderer/src/media-animation';
const cleanup:(()=>void)[]=[];
it('fills legacy animation metadata with two reads at most, deduplicates remounts and invalidates changed files',async()=>{
 const gates:Array<()=>void>=[],reads:string[]=[];let active=0,maximum=0;
 const query=animationMetadataQueue(async id=>{reads.push(id);active++;maximum=Math.max(maximum,active);await new Promise<void>(resolve=>gates.push(resolve));active--;return {animated:true,width:96,height:64,frames:4};});
 const first=query('a','v1'),again=query('a','v1'),second=query('b','v1'),third=query('c','v1');expect(first).toBe(again);expect(reads).toEqual(['a','b']);gates.shift()!();await first;await Promise.resolve();await Promise.resolve();expect(reads).toEqual(['a','b','c']);while(gates.length)gates.shift()!();await Promise.all([second,third]);expect(maximum).toBe(2);expect(await query('a','v1')).toMatchObject({width:96,frames:4});const updated=query('a','v2');gates.shift()!();await updated;expect(reads).toEqual(['a','b','c','a']);
});
afterEach(()=>{cleanup.splice(0).forEach(off=>off());setAnimationPreferences({maxBytes:2*1024*1024,count:8});vi.unstubAllGlobals();});
function environment(){
 const document=Object.assign(new EventTarget(),{visibilityState:'visible'});let observer:any;
 class Observer{callback:any;constructor(callback:any){this.callback=callback;observer=this;}observe(){}unobserve(){}disconnect(){}}
 vi.stubGlobal('document',document);vi.stubGlobal('IntersectionObserver',Observer);
 const window=Object.assign(new EventTarget(),{innerWidth:800,innerHeight:600}),frames=new Map<number,FrameRequestCallback>();let sequence=0;
 vi.stubGlobal('window',window);vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++sequence,callback);return sequence;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
 const active=new Map<Element,boolean>();
 function add(bytes:number|(()=>number),rect?:()=>any,clip?:Element){const node=(rect?{getBoundingClientRect:rect,closest:()=>clip??null}:{}) as Element;cleanup.push(observeAnimatedPreview(node,bytes,(_visible,playing)=>active.set(node,playing)));return node;}
 function show(nodes:Element[],visible=true){observer.callback(nodes.map(target=>({target,isIntersecting:visible})));}
 function scroll(){document.dispatchEvent(new Event('scroll'));}
 function flush(){const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(0));}
 return {document,window,active,add,show,scroll,flush,frames};
}
it('limits autoplay by compressed size and working surfaces without excluding long small GIFs by total frame count',()=>{
 expect(automaticAnimationBytes(2*1024*1024,320,240,12)).toBeGreaterThan(0);
 expect(automaticAnimationBytes(2*1024*1024+1,320,240,12)).toBe(0);
 expect(automaticAnimationBytes(100000,4096,4096,10)).toBe(0);
 expect(automaticAnimationBytes(100000,320,240)).toBe(0);
 expect(automaticAnimationBytes(1485311,300,200,303)).toBeGreaterThan(0);
 expect(automaticAnimationBytes(1485311,300,200,303)).toBe(automaticAnimationBytes(1485311,300,200,12));
 expect(automaticAnimationBytes(1024,NaN,240,10)).toBe(0);
});
it('plays at most eight visible animations, releases offscreen slots and pauses all previews in background',()=>{
 const {document,active,add,show}=environment(),nodes=Array.from({length:12},()=>add(1024));show(nodes);
 expect([...active.values()].filter(Boolean)).toHaveLength(8);show(nodes.slice(0,4),false);expect(nodes.slice(0,4).every(node=>!active.get(node))).toBe(true);expect(nodes.slice(4).every(node=>active.get(node))).toBe(true);
 document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));expect([...active.values()].some(Boolean)).toBe(false);
 document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));expect([...active.values()].filter(Boolean)).toHaveLength(8);
});
it('caps the combined decoded budget at 128 MiB and lets smaller visible animations use the remaining budget',()=>{
 const {active,add,show}=environment(),large=Array.from({length:5},()=>add(30*1024*1024)),small=Array.from({length:4},()=>add(4*1024*1024));show([...large,...small]);
 expect(large.filter(node=>active.get(node))).toHaveLength(4);expect(small.filter(node=>active.get(node))).toHaveLength(2);
 show(large.slice(0,1),false);expect(large.filter(node=>active.get(node))).toHaveLength(4);expect(small.filter(node=>active.get(node))).toHaveLength(2);
});

it('applies configured autoplay count immediately and accepts 10 MiB without relaxing decoded memory limits',()=>{
 const {active,add,show}=environment(),nodes=Array.from({length:16},()=>add(1024));show(nodes);expect([...active.values()].filter(Boolean)).toHaveLength(8);
 setAnimationPreferences({maxBytes:10*1024*1024,count:16});expect([...active.values()].filter(Boolean)).toHaveLength(16);expect(automaticAnimationBytes(10*1024*1024,128,96,6)).toBeGreaterThan(0);expect(automaticAnimationBytes(10*1024*1024+1,128,96,6)).toBe(0);expect(automaticAnimationBytes(1024,2000,2000,20)).toBe(0);
 setAnimationPreferences({maxBytes:512*1024,count:1});expect([...active.values()].filter(Boolean)).toHaveLength(1);expect(automaticAnimationBytes(512*1024+1,128,96,6)).toBe(0);
});
it('normalizes invalid stored preferences and remembers valid choices',()=>{
 const data=new Map<string,string>();vi.stubGlobal('localStorage',{setItem:(key:string,value:string)=>data.set(key,value)});
 setAnimationPreferences({maxBytes:10*1024*1024,count:3});expect(JSON.parse(data.get('lumina.gif.autoplay')!)).toEqual({maxBytes:10*1024*1024,count:3});
 setAnimationPreferences({maxBytes:-1,count:100});expect(animationPreferences()).toEqual({maxBytes:2*1024*1024,count:16});
});

it('wires GIF animation metadata into shared grids while keeping WebM a video',()=>{
 expect(mediaAnimationProps({kind:'photo',absolutePath:'C:/media/motion.GIF',sizeBytes:123,metadata:{width:320,height:240,frames:12}})).toEqual({animated:true,sizeBytes:123,animationWidth:320,animationHeight:240,animationFrames:12});
 expect(mediaAnimationProps({kind:'video',absolutePath:'C:/media/clip.webm',sizeBytes:456,metadata:{animated:true,width:640,height:360,frames:200}})).toEqual({animated:false,sizeBytes:456,animationWidth:640,animationHeight:360,animationFrames:200});
});

it('rechecks visible GIF file-size eligibility immediately without remounting or another visibility event',()=>{
 const {active,add,show}=environment();
 const small=add(()=>automaticAnimationBytes(500000,96,64,4));
 const large=add(()=>automaticAnimationBytes(4*1024*1024,96,64,4));
 show([small,large]);expect(active.get(small)).toBe(true);expect(active.get(large)).toBe(false);
 setAnimationPreferences({maxBytes:10*1024*1024,count:8});expect(active.get(large)).toBe(true);
 setAnimationPreferences({maxBytes:512*1024,count:1});expect(active.get(small)).toBe(true);expect(active.get(large)).toBe(false);
});

it('allows explicit unlimited size/count to bypass file, per-item and total-memory budgets, and restores finite limits immediately',()=>{
 const {active,add,show}=environment();
 const cost=()=>automaticAnimationBytes(64*1024*1024,4096,4096,303);
 const nodes=Array.from({length:24},()=>add(cost));show(nodes);expect([...active.values()].some(Boolean)).toBe(false);
 setAnimationPreferences({maxBytes:0,count:0});expect(cost()).toBeGreaterThan(128*1024*1024);expect([...active.values()].filter(Boolean)).toHaveLength(24);
 setAnimationPreferences({maxBytes:2*1024*1024,count:8});expect([...active.values()].some(Boolean)).toBe(false);
});

it('remembers zero-valued unlimited settings without treating missing preferences as unlimited',()=>{
 const data=new Map<string,string>();vi.stubGlobal('localStorage',{setItem:(key:string,value:string)=>data.set(key,value)});
 setAnimationPreferences({maxBytes:0,count:0});expect(animationPreferences()).toEqual({maxBytes:0,count:0});expect(JSON.parse(data.get('lumina.gif.autoplay')!)).toEqual({maxBytes:0,count:0});
 setAnimationPreferences({} as any);expect(animationPreferences()).toEqual({maxBytes:2*1024*1024,count:8});
});

it('prioritizes the largest currently visible area, then top and left, regardless of mount order',()=>{
 const {active,add,show}=environment();setAnimationPreferences({maxBytes:0,count:2});
 const rect=(top:number,left=0)=>({top,left,bottom:top+100,right:left+100});
 const bottom=add(1,()=>rect(570)),lower=add(1,()=>rect(300)),upperRight=add(1,()=>rect(100,120)),upperLeft=add(1,()=>rect(100));
 show([bottom,lower,upperRight,upperLeft]);expect([bottom,lower,upperRight,upperLeft].map(node=>active.get(node))).toEqual([false,false,true,true]);
});

it('reassigns slots after scrolling upward or downward without IO changes and batches scroll geometry reads',()=>{
 const {active,add,show,scroll,flush,frames}=environment();setAnimationPreferences({maxBytes:0,count:1});let offset=0,reads=0;
 const rect=(base:number)=>()=>{reads++;return {top:base-offset,bottom:base+100-offset,left:0,right:100};};
 const lower=add(1,rect(540)),upper=add(1,rect(-50));show([lower,upper]);expect(active.get(lower)).toBe(true);
 reads=0;offset=-60;scroll();scroll();scroll();expect(frames.size).toBe(1);expect(reads).toBe(0);flush();expect(reads).toBe(2);expect(active.get(upper)).toBe(true);expect(active.get(lower)).toBe(false);
 offset=0;scroll();flush();expect(active.get(lower)).toBe(true);expect(active.get(upper)).toBe(false);
});

it('prefers a completely visible GIF over a larger but clipped GIF',()=>{
 const {active,add,show}=environment();setAnimationPreferences({maxBytes:0,count:1});
 const clipped=add(1,()=>({top:400,bottom:800,left:0,right:400})),complete=add(1,()=>({top:100,bottom:150,left:0,right:50}));
 show([clipped,complete]);expect(active.get(complete)).toBe(true);expect(active.get(clipped)).toBe(false);
});

it('clips visible area to the media viewport above the footer and stops fully obscured items even when unlimited',()=>{
 const {active,add,show}=environment();let reads=0;const clip={getBoundingClientRect:()=>{reads++;return {top:100,bottom:400,left:0,right:800};}} as Element;
 const rect=(top:number)=>()=>({top,bottom:top+100,left:0,right:100});
 const bottom=add(1,rect(360),clip),upper=add(1,rect(150),clip),obscured=add(1,rect(410),clip);
 setAnimationPreferences({maxBytes:0,count:1});show([bottom,upper,obscured]);expect(reads).toBe(1);expect(active.get(upper)).toBe(true);expect(active.get(bottom)).toBe(false);
 setAnimationPreferences({maxBytes:0,count:0});expect(active.get(bottom)).toBe(true);expect(Boolean(active.get(obscured))).toBe(false);
});

it('removes scroll and resize listeners and cancels pending geometry work after the last preview unmounts',()=>{
 const {document,window,add,scroll,frames}=environment();const remove=vi.spyOn(document,'removeEventListener'),resize=vi.spyOn(window,'removeEventListener');add(1);scroll();expect(frames.size).toBe(1);
 cleanup.splice(0).forEach(off=>off());expect(frames.size).toBe(0);expect(remove).toHaveBeenCalledWith('scroll',expect.any(Function),{capture:true});expect(resize).toHaveBeenCalledWith('resize',expect.any(Function));scroll();expect(frames.size).toBe(0);
});

it('rechecks priority after grid reflow or animation completion without a scroll/intersection event',()=>{
 const {active,add,show,flush,frames}=environment();setAnimationPreferences({maxBytes:0,count:1});let moving=true;
 const first=add(1,()=>({top:moving?-80:10,bottom:moving?20:110,left:0,right:100})),second=add(1,()=>({top:200,bottom:300,left:0,right:100}));show([first,second]);expect(active.get(second)).toBe(true);
 moving=false;refreshAnimatedPreviewLayout();refreshAnimatedPreviewLayout();expect(frames.size).toBe(1);flush();expect(active.get(first)).toBe(true);expect(active.get(second)).toBe(false);
});
