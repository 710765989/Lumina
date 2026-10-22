import {it,expect,vi} from 'vitest';
import {PreviewRequests} from '../apps/desktop/src/preview-requests.js';
it('coalesces identical browser requests and invalidates once per successful explicit retry token',async()=>{
 const cache=new PreviewRequests(),load=vi.fn(async(regenerate:boolean)=>({cachePath:regenerate?'rebuilt':'cached'}));
 await Promise.all(Array.from({length:20},()=>cache.load('photo/screen','session:1',load)));expect(load).toHaveBeenCalledTimes(1);expect(load).toHaveBeenLastCalledWith(true);
 await cache.load('photo/screen','session:1',load);expect(load).toHaveBeenLastCalledWith(false);
 await cache.load('photo/screen','session:2',load);expect(load).toHaveBeenLastCalledWith(true);
 await cache.load('photo/screen',undefined,load);expect(load).toHaveBeenLastCalledWith(false);
 await cache.load('photo/full','session:2',load);expect(load).toHaveBeenLastCalledWith(true);
});
it('failed retries remain retryable and successful tokens do not bypass subsequent core authorization',async()=>{
 const cache=new PreviewRequests(),read=vi.fn(async()=>{throw Error('unavailable');});await expect(cache.load('a','retry',read)).rejects.toThrow('unavailable');
 const restored=vi.fn(async()=>({cachePath:'restored'}));await cache.load('a','retry',restored);expect(restored).toHaveBeenLastCalledWith(true);
 await expect(cache.load('a','retry',read)).rejects.toThrow('unavailable');expect(read).toHaveBeenCalledTimes(2);expect(read).toHaveBeenLastCalledWith(false);
});
