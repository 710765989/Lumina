import {afterEach,it,expect,vi} from 'vitest';
import {createImageMemoryCleanup} from '../apps/desktop/src/image-memory';
const MiB=1024*1024;
afterEach(()=>vi.useRealTimers());
function fixture(bytes=0,rss=0){
 vi.useFakeTimers();const clear=vi.fn(),residentBytes=vi.fn(async()=>rss);
 const cleanup=createImageMemoryCleanup({resources:()=>({images:{size:bytes,liveSize:0,count:2}}),residentBytes,clear});
 return {cleanup,clear,residentBytes};
}
it('coalesces rapid navigation and leaves low-pressure image caches warm',async()=>{
 const {cleanup,clear,residentBytes}=fixture(8*MiB,100*MiB);
 for(let i=0;i<15;i++){cleanup.request('step');await vi.advanceTimersByTimeAsync(100);}
 expect(residentBytes).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(900);
 expect(residentBytes).toHaveBeenCalledOnce();expect(clear).not.toHaveBeenCalled();cleanup.dispose();
});
it('trims unused decoded resources without an IPC roundtrip and defers the last request until cooldown ends',async()=>{
 const {cleanup,clear,residentBytes}=fixture(64*MiB);
 cleanup.request('close');await vi.advanceTimersByTimeAsync(900);expect(clear).toHaveBeenCalledOnce();expect(residentBytes).not.toHaveBeenCalled();
 cleanup.request('page');await vi.advanceTimersByTimeAsync(900);expect(clear).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(2100);
 expect(clear).toHaveBeenCalledTimes(2);expect(cleanup.stats().lastReason).toBe('page');cleanup.dispose();
});
it('trims native decoder pressure even when Blink reports few encoded image bytes',async()=>{
 const {cleanup,clear}=fixture(0,700*MiB);cleanup.request('close');await vi.advanceTimersByTimeAsync(900);expect(clear).toHaveBeenCalledOnce();cleanup.dispose();
});
it('does not clear after disposal while a memory measurement is in flight',async()=>{
 const {cleanup,clear,residentBytes}=fixture();let finish!:(value:number)=>void;
 residentBytes.mockImplementation(()=>new Promise(resolve=>finish=resolve));cleanup.request('close');await vi.advanceTimersByTimeAsync(900);
 cleanup.dispose();finish(700*MiB);await Promise.resolve();expect(clear).not.toHaveBeenCalled();cleanup.request('late');expect(vi.getTimerCount()).toBe(0);
});
