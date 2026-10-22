import {it,expect,vi} from 'vitest';
import {parseExternalDrag,createExternalDragController} from '../apps/desktop/src/external-drag.js';

it('validates IDs and visibility scope, deduplicating without changing selection order',()=>{
 expect(parseExternalDrag(['b','a','b'])).toEqual({mediaIds:['b','a'],includeHidden:false});
 expect(parseExternalDrag({mediaIds:['b','a'],includeHidden:true})).toEqual({mediaIds:['b','a'],includeHidden:true});
 for(const input of [null,{},[],[''],[1],{mediaIds:['a'],includeHidden:'true'},Array(10001).fill('a')])expect(()=>parseExternalDrag(input)).toThrow();
});
it('resolves the entire selection before starting a native drag, without pretending a receiver copied it',async()=>{
 const deliver=vi.fn(async()=>[{absolutePath:'C:/fixtures/b.jpg'},{absolutePath:'C:/fixtures/a.mp4'}]),start=vi.fn();
 const drag=createExternalDragController(deliver);
 expect(await drag(1,{mediaIds:['b','a'],includeHidden:true},start)).toEqual({count:2});
 expect(deliver).toHaveBeenCalledWith({mediaIds:['b','a'],includeHidden:true});
 expect(start).toHaveBeenCalledOnce();expect(start).toHaveBeenCalledWith(['C:/fixtures/b.jpg','C:/fixtures/a.mp4']);
});
it('blocks duplicate in-flight drags from one window but keeps another window independent',async()=>{
 let release!:(value:{absolutePath:string}[])=>void;
 const deliver=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockResolvedValue([{absolutePath:'C:/b.jpg'}]);
 const drag=createExternalDragController(deliver),first=drag(1,['a'],vi.fn());
 await expect(drag(1,['a'],vi.fn())).rejects.toThrow('正在准备拖出');
 await expect(drag(2,['b'],vi.fn())).resolves.toEqual({count:1});
 release([{absolutePath:'C:/a.jpg'}]);await first;
 await expect(drag(1,['b'],vi.fn())).resolves.toEqual({count:1});
});
it('does not drag a partial selection and releases the window for retry after preparation failure',async()=>{
 const deliver=vi.fn().mockRejectedValueOnce(new Error('原文件不存在')).mockResolvedValueOnce([{absolutePath:'C:/a.jpg'}]).mockResolvedValueOnce([{absolutePath:'C:/a.jpg'}]);
 const drag=createExternalDragController(deliver),start=vi.fn();
 await expect(drag(1,['a'],start)).rejects.toThrow('原文件不存在');expect(start).not.toHaveBeenCalled();
 await expect(drag(1,['a','b'],start)).rejects.toThrow('部分媒体已不可用');expect(start).not.toHaveBeenCalled();
 await expect(drag(1,['a'],start)).resolves.toEqual({count:1});
});
it('releases native drag state after a native API error or cancellation return',async()=>{
 const drag=createExternalDragController(async()=>[{absolutePath:'C:/a.jpg'}]);
 await expect(drag(1,['a'],()=>{throw new Error('native failure');})).rejects.toThrow('native failure');
 await expect(drag(1,['a'],()=>{})).resolves.toEqual({count:1});
});
it('keeps the drag locked while its thumbnail is prepared and releases async failures',async()=>{
 let finish!:()=>void;
 const drag=createExternalDragController(async()=>[{absolutePath:'C:/a.jpg'}]);
 const first=drag(1,['a'],()=>new Promise<void>(resolve=>{finish=resolve;}));
 await Promise.resolve();await Promise.resolve();
 await expect(drag(1,['a'],()=>{})).rejects.toThrow('正在准备拖出');
 finish();await first;
 await expect(drag(1,['a'],async()=>{throw new Error('thumbnail/native failure');})).rejects.toThrow('thumbnail/native failure');
 await expect(drag(1,['a'],()=>{})).resolves.toEqual({count:1});
});
