import {afterEach,expect,it,vi} from 'vitest';
import {animationPreviewSize,playAnimationFrames} from '../apps/desktop/renderer/src/animation-frame-player';
const cleanups:Array<()=>void>=[];
afterEach(()=>{cleanups.splice(0).forEach(stop=>stop());vi.useRealTimers();vi.unstubAllGlobals();});
async function settle(){for(let i=0;i<40;i++)await Promise.resolve();}
function environment(pending=false){
 vi.useFakeTimers();const frames:Array<{close:ReturnType<typeof vi.fn>}>[]=[],close=vi.fn(),drawImage=vi.fn(),onReady=vi.fn(),onError=vi.fn(),decodeIndices:number[]=[];
 let finish:((value:{image:any})=>void)|undefined;
 function frame(){const image={displayWidth:96,displayHeight:64,duration:100000,close:vi.fn()};frames.push(image);return image;}
 class Decoder{static async isTypeSupported(){return true;}tracks={ready:Promise.resolve(),selectedTrack:{frameCount:303}};close=close;async decode({frameIndex}:{frameIndex:number}){expect(frames.every(frame=>frame.close.mock.calls.length===1)).toBe(true);decodeIndices.push(frameIndex);if(pending)return new Promise<{image:any}>(resolve=>{finish=resolve;});return {image:frame()};}}
 const fetch=vi.fn(async()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/gif','content-length':'3'}}));
 vi.stubGlobal('ImageDecoder',Decoder);vi.stubGlobal('fetch',fetch);
 const canvas={width:0,height:0,getContext:()=>({clearRect:vi.fn(),drawImage})} as unknown as HTMLCanvasElement;
 function start(maxBytes=1024){const stop=playAnimationFrames({canvas,url:'lumina-media://original/test',width:300,height:200,maxBytes,onReady,onError});cleanups.push(stop);return stop;}
 return {frames,close,drawImage,onReady,onError,decodeIndices,fetch,canvas,start,resolve:()=>finish!({image:frame()})};
}
it('plays a long animation sequentially, closes each output before decoding another and stops all timers on disposal',async()=>{
 const e=environment(),stop=e.start();await settle();expect(e.onError).not.toHaveBeenCalled();expect(e.onReady).toHaveBeenCalledOnce();expect(e.decodeIndices).toEqual([0]);
 await vi.advanceTimersByTimeAsync(230);expect(e.decodeIndices.length).toBeGreaterThan(2);expect(e.frames.every(frame=>frame.close.mock.calls.length===1)).toBe(true);expect(e.drawImage).toHaveBeenCalledTimes(e.frames.length);
 stop();expect(e.close).toHaveBeenCalledOnce();expect(e.canvas.width).toBe(0);expect((e.fetch.mock.calls[0] as unknown as [string,RequestInit])[1].signal?.aborted).toBe(true);
 const count=e.decodeIndices.length;await vi.advanceTimersByTimeAsync(1000);expect(e.decodeIndices).toHaveLength(count);
});
it('releases a frame arriving after cancellation without drawing it or reporting a playback error',async()=>{
 const e=environment(true),stop=e.start();await settle();expect(e.decodeIndices).toEqual([0]);stop();e.resolve();await settle();expect(e.frames[0].close).toHaveBeenCalledOnce();expect(e.drawImage).not.toHaveBeenCalled();expect(e.onError).not.toHaveBeenCalled();expect(e.close).toHaveBeenCalledOnce();
});
it('rejects an original that has grown beyond the size budget before creating a decoder',async()=>{
 const e=environment();e.start(2);await settle();expect(e.onError).toHaveBeenCalledOnce();expect(e.decodeIndices).toEqual([]);expect(e.canvas.width).toBe(0);
});
it('treats an explicitly unlimited read budget as no file-size cap',async()=>{
 const e=environment(),stop=e.start(0);await settle();expect(e.onError).not.toHaveBeenCalled();expect(e.onReady).toHaveBeenCalledOnce();expect(e.drawImage).toHaveBeenCalledOnce();stop();expect(e.close).toHaveBeenCalledOnce();
});
it('limits automatic canvas dimensions while preserving the original aspect ratio',()=>{
 expect(animationPreviewSize(944,1280)).toEqual({width:236,height:320});expect(animationPreviewSize(300,200)).toEqual({width:300,height:200});expect(animationPreviewSize(2400,600)).toEqual({width:480,height:120});
});
