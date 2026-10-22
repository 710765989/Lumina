import { mkdtemp,rm,mkdir,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { openDatabase,closeDatabase } from '@lumina/storage';
import { LibraryService } from '@lumina/core';

const root=await mkdtemp(path.join(os.tmpdir(),'lumina-m2-benchmark-'));
const db=openDatabase(path.join(root,'benchmark.db'));const service=new LibraryService(db);
try{
  const insert=db.prepare("INSERT INTO media(id,absolute_path,file_name,kind,size_bytes,modified_at_ms,captured_at_ms,fingerprint) VALUES(?,?,?,'photo',?,?,?,?)");
  db.transaction(()=>{for(let index=0;index<100000;index++){const id=String(index).padStart(6,'0');const name=`photo-${id}.jpg`;insert.run(id,path.join(root,name),name,(index*7919)%10000000,1700000000000+index*1000,index%3?1600000000000+index*1000:null,id);}})();
  const cases:any[]=[];
  for(const sortBy of ['fileTime','capturedAt','name','size'])for(const offset of [0,50000]){
    const times:number[]=[];for(let sample=0;sample<7;sample++){const start=performance.now();const rows=await service.handle({type:'media.list',sortBy,sort:'desc',limit:200,offset}) as unknown[];if(rows.length!==200)throw new Error('Incorrect page size');times.push(performance.now()-start);}
    times.sort((a,b)=>a-b);cases.push({sortBy,offset,medianMs:Math.round(times[3]!),p95Ms:Math.round(times[6]!)});
  }
  const start=performance.now();const search=await service.handle({type:'media.search',query:'',fileNames:['photo-05'],sortBy:'name',sort:'asc',limit:200,offset:5000}) as unknown[];
  if(search.length!==200)throw new Error('Incorrect search page size');
  const filenameSearchMs=Math.round(performance.now()-start);
  const playlistStart=performance.now();const playlist=await service.handle({type:'media.playlist',source:{scope:'library',sortBy:'fileTime',sort:'desc'}}) as string[];
  if(playlist.length!==100000 || playlist[0]!=='099999' || playlist.at(-1)!=='000000')throw new Error('Incorrect full playlist');
  const playlistMs=Math.round(performance.now()-playlistStart);
  const result={syntheticRecords:100000,pageSize:200,cases,filenameSearchMs,playlistMs,playlistCount:playlist.length,playlistJsonBytes:Buffer.byteLength(JSON.stringify(playlist)),scope:'Synthetic SQLite query benchmark only; not a real 100k media scan/thumbnail/30min scrolling acceptance test'};
  const out=path.resolve('build-staging/m2-performance.json');await mkdir(path.dirname(out),{recursive:true});await writeFile(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{service.close();closeDatabase(db);await rm(root,{recursive:true,force:true});}
