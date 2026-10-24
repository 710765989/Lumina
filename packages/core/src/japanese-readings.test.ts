import {it,expect} from 'vitest';
import {JapaneseReadings} from './japanese-readings.js';
import path from 'node:path';
it('uses the bundled offline dictionary, coalesces requests, releases idle worker, and retains readings',async()=>{
 const service=new JapaneseReadings(path.resolve('apps/desktop/dist/japanese-worker.cjs'),100);
 try{
  const [a,b]=await Promise.all([service.read(['写真','シャシン','学校','ガッコウ']),service.read(['写真'])]);
  expect(a).toEqual([{text:'写真',reading:'しゃしん'},{text:'シャシン',reading:'しゃしん'},{text:'学校',reading:'がっこう'},{text:'ガッコウ',reading:'がっこう'}]);expect(b[0]).toEqual(a[0]);
  await new Promise(resolve=>setTimeout(resolve,300));expect((service as any).worker).toBeUndefined();
  expect(await service.read(['写真'])).toEqual([a[0]]);expect((service as any).worker).toBeUndefined();
  expect((await service.read(['東京']))[0]?.reading).toBe('とうきょう');
 }finally{service.close();}
},20000);
