import {it,expect,vi} from 'vitest';
import {PlaceCoverLoader,type CoverSnapshot} from '../apps/desktop/renderer/src/place-cover-loader';
import type {Media} from '../apps/desktop/renderer/src/media-types';
const media=(n:number):Media=>({id:String(n),absolutePath:`/${n}.jpg`,kind:'photo',hidden:false,sizeBytes:1,modifiedAtMs:1000-n});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(check:()=>boolean){for(let n=0;n<200;n++){if(check())return;await tick();}throw Error('封面加载未结束');}
it('pages beyond twelve failed seeds and stops at four successes; reopening does not retry failed candidates',async()=>{
 const all=Array.from({length:90},(_,i)=>media(i)),load=vi.fn(async(item:Media)=>{if(Number(item.id)!==0&&Number(item.id)<61)throw Error('unsupported');return item.id;});
 const page=vi.fn(async(cursor?:{value:number|string;id:string})=>{const start=cursor?Number(cursor.id)+1:0;return {items:all.slice(start,start+24),hasMore:start+24<all.length};}),loader=new PlaceCoverLoader(load);let state:CoverSnapshot|undefined;
 const source={samples:all.slice(0,12),count:all.length,page};const stop=loader.watch('place',source,value=>state=value);await until(()=>Boolean(state?.done));
 expect(state?.items.map(row=>row.item.id)).toEqual(['0','61','62','63']);expect(load).toHaveBeenCalledTimes(64);expect(page).toHaveBeenCalledTimes(3);expect(page.mock.calls.map(args=>args[0]?.id)).toEqual(['11','35','59']);stop();
 const again=loader.watch('place',source,value=>state=value);await tick();expect(load).toHaveBeenCalledTimes(64);expect(page).toHaveBeenCalledTimes(3);again();
});
it('shares a runner and suspends after the in-flight request when all listeners leave',async()=>{
 let release!:(value:string)=>void;const load=vi.fn(()=>new Promise<string>(resolve=>release=resolve)),loader=new PlaceCoverLoader(load),source={samples:[media(0),media(1)],count:2,page:vi.fn()};let state:CoverSnapshot|undefined;
 const stop=loader.watch('place',source,value=>state=value),stop2=loader.watch('place',source,()=>{});expect(load).toHaveBeenCalledTimes(1);stop();stop2();release('0');await tick();expect(load).toHaveBeenCalledTimes(1);
 const stop3=loader.watch('place',source,value=>state=value);expect(load).toHaveBeenCalledTimes(2);release('1');await until(()=>Boolean(state?.done));expect(state?.items).toHaveLength(2);stop3();
});
it('does not loop on a candidate API error and resumes on explicit retry without discarding a valid cover',async()=>{
 const load=vi.fn(async(item:Media)=>item.id),page=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue({items:[media(1),media(2),media(3)],hasMore:false}),loader=new PlaceCoverLoader(load);let state:CoverSnapshot|undefined;
 const stop=loader.watch('place',{samples:[media(0)],count:4,page},value=>state=value);await until(()=>Boolean(state?.error));await tick();expect(page).toHaveBeenCalledTimes(1);expect(state?.items).toHaveLength(1);
 loader.retry('place');await until(()=>Boolean(state?.done));expect(state?.items).toHaveLength(4);expect(load).toHaveBeenCalledTimes(4);expect(page).toHaveBeenCalledTimes(2);stop();
});
it('exhausts an all-failed place once, allows manual retry and evicts old idle places',async()=>{
 let fail=true;const load=vi.fn(async(item:Media)=>{if(fail)throw Error('unsupported');return item.id;}),loader=new PlaceCoverLoader(load,1),source={samples:[media(0)],count:1,page:vi.fn()};let state:CoverSnapshot|undefined;
 let stop=loader.watch('a',source,value=>state=value);await until(()=>Boolean(state?.done));expect(state?.items).toEqual([]);await tick();expect(load).toHaveBeenCalledTimes(1);fail=false;loader.retry('a');await until(()=>Boolean(state?.done&&state.items.length));stop();
 stop=loader.watch('b',source,()=>{});await tick();stop();stop=loader.watch('a',source,()=>{});await tick();expect(load).toHaveBeenCalledTimes(4);stop();
});
