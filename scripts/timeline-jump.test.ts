import {it,expect} from 'vitest';
import {latestRequest,timelinePosition} from '../apps/desktop/renderer/src/latest-request.js';
import {openDatabase,closeDatabase,addLibraryRoot,hideMedia,searchMedia,mediaTimeline} from '../packages/storage/src/index.js';
it('runs one position at a time and replaces intermediate pending jumps with the last target',async()=>{
 const visited:string[]=[],gates:Array<()=>void>=[];let active=0,max=0;
 const queue=latestRequest(async (value:string)=>{visited.push(value);active++;max=Math.max(max,active);await new Promise<void>(resolve=>gates.push(resolve));active--;});
 const first=queue('a');void queue('b');void queue('c');expect(visited).toEqual(['a']);gates.shift()!();await Promise.resolve();await Promise.resolve();expect(visited).toEqual(['a','c']);gates.shift()!();await first;expect(max).toBe(1);
});
it('date-index jumps match the same position in the full filtered query for both directions and time fields',()=>{
 const db=openDatabase(':memory:');try{addLibraryRoot(db,'F:/timeline-fixtures');const insert=db.prepare('INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,captured_at_ms,fingerprint,file_name) VALUES(?,?,?,?,?,?,?,?)');
  for(let i=0;i<80;i++)insert.run(String(i).padStart(3,'0'),`F:/timeline-fixtures/${i}.jpg`,'photo',1000,new Date(2025,Math.floor(i/8),i%8+1).getTime(),i%3?new Date(2024,Math.floor(i/10),i%10+1).getTime():null,String(i),`${i}.jpg`);
  hideMedia(db,'006');hideMedia(db,'014');
  for(const sort of ['asc','desc'] as const)for(const sortBy of ['fileTime','capturedAt'] as const){const options={sort,sortBy},months=mediaTimeline(db,'',options);for(const {month} of months){const position=timelinePosition(months,month,sort),jumped=searchMedia(db,'',{...options,...position.bounds,limit:60}),normal=searchMedia(db,'',{...options,offset:position.start,limit:60});expect(jumped.map(row=>row.id)).toEqual(normal.map(row=>row.id));}}
 }finally{closeDatabase(db);}
});
