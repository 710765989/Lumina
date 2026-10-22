import {afterEach,it,expect,vi} from 'vitest';
import {createActionLock} from '../apps/desktop/renderer/src/action-lock';
import {singleFlight} from '../apps/desktop/src/single-flight';
afterEach(()=>vi.useRealTimers());
it.each([2,3,5])('runs an async action once for %i rapid clicks and releases after completion',async clicks=>{
 vi.useFakeTimers();let finish!:()=>void;const changed=vi.fn(),action=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;})),lock=createActionLock(changed);
 const first=lock.run(action);for(let i=1;i<clicks;i++)expect(lock.run(action)).toBeUndefined();expect(action).toHaveBeenCalledTimes(1);expect(lock.busy).toBe(true);finish();await vi.advanceTimersByTimeAsync(300);await first;expect(lock.busy).toBe(false);expect(changed.mock.calls).toEqual([[true],[false]]);
});
it('releases rejected actions for a deliberate retry and does not throttle synchronous navigation or toggles',async()=>{
 const lock=createActionLock(()=>{},0);await expect(lock.run(()=>Promise.reject(new Error('失败')))).rejects.toThrow('失败');expect(lock.busy).toBe(false);
 const toggle=vi.fn();for(let i=0;i<3;i++)lock.run(toggle);expect(toggle).toHaveBeenCalledTimes(3);await lock.run(()=>Promise.resolve());expect(lock.busy).toBe(false);
});
it('unlocks synchronous exceptions without losing the user error',()=>{const lock=createActionLock();expect(()=>lock.run(()=>{throw new Error('标签名称已存在');})).toThrow('标签名称已存在');expect(lock.busy).toBe(false);});
it('coalesces identical IPC calls, keeps different requests separate and permits retry after rejection',async()=>{
 const once=singleFlight();let finish!:(value:number)=>void;const operation=vi.fn(()=>new Promise<number>(resolve=>{finish=resolve;}));
 const a=once('same',operation),b=once('same',operation),c=once('same',operation);expect(a).toBe(b);expect(b).toBe(c);await Promise.resolve();expect(operation).toHaveBeenCalledTimes(1);expect(await once('different',async()=>9)).toBe(9);finish(7);expect(await a).toBe(7);expect(await once('same',async()=>8)).toBe(8);
 await expect(once('failed',async()=>{throw new Error('请求失败');})).rejects.toThrow('请求失败');expect(await once('failed',async()=>1)).toBe(1);
});
