import {it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {WindowsHiddenAttributes} from './windows-hidden-worker.js';
vi.mock('node:child_process',()=>({spawn:vi.fn()}));
function processMock(){return Object.assign(new EventEmitter(),{stdin:Object.assign(new EventEmitter(),{write:vi.fn(),end:vi.fn()}),stdout:new EventEmitter(),stderr:new EventEmitter(),kill:vi.fn()});}
it('aborts an in-flight attribute helper promptly and discards aborted queued requests without writing them',async()=>{
 const child=processMock(),next=processMock(),worker=new WindowsHiddenAttributes();vi.mocked(spawn).mockReturnValueOnce(child as any).mockReturnValueOnce(next as any);
 try{
  const active=new AbortController(),queued=new AbortController();const first=worker.request('C:/isolated/first.jpg',true,active.signal).catch(error=>error),second=worker.request('C:/isolated/second.jpg',true,queued.signal).catch(error=>error);
  await Promise.resolve();expect(child.stdin.write).toHaveBeenCalledTimes(1);queued.abort();active.abort();expect((await first).message).toContain('停止');expect((await second).name).toBe('AbortError');expect(child.kill).toHaveBeenCalledTimes(1);expect(child.stdin.write).toHaveBeenCalledTimes(1);
  const resumed=worker.request('C:/isolated/third.jpg',true);await new Promise(resolve=>setTimeout(resolve,0));expect(next.stdin.write).toHaveBeenCalledTimes(1);next.stdout.emit('data',Buffer.from('{"ok":true,"attributes":32}\n'));expect(await resumed).toBe(32);
 }finally{worker.close();}
});
