import {it} from 'vitest';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {openDatabase,closeDatabase,addLibraryRoot} from '@lumina/storage';
import {LibraryService} from '@lumina/core';
it.skipIf(!process.env.LUMINA_DIRECTORY_BENCH)('benchmarks an indexed directory without disk reads',async()=>{
const count=Number(process.env.LUMINA_BENCH_COUNT??10000),out=process.env.LUMINA_BENCH_OUTPUT,db=openDatabase(':memory:');let notifications=0;
const service=new LibraryService(db,undefined,{notify:()=>notifications++});
const root=addLibraryRoot(db,'F:/isolated-lumina-benchmark/photos','测试目录');
db.prepare("INSERT INTO settings(key,value_json) VALUES('organization',?)").run(JSON.stringify({watch:false,syncHidden:false}));
const insert=db.prepare("INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,'photo',1000,1,?)");db.transaction(()=>{for(let i=0;i<count;i++)insert.run(String(i),`F:/isolated-lumina-benchmark/photos/group-${i%40}/child-${i%10}/${i}.jpg`,String(i));})();
try{
 const start=performance.now();const result:any=await service.handle({type:'roots.configure',id:root.id,absolutePath:root.absolutePath,label:root.label,autoAlbums:true,hierarchy:true,rules:[]});const returned=performance.now();
 while(service.directories.isActive(result.taskId)){if(performance.now()-start>120000)throw Error('timeout');await new Promise<void>(resolve=>setTimeout(resolve,5));}
 const job:any=await service.handle({type:'jobs.result',id:result.taskId});if(job.status!=='completed')throw Error(JSON.stringify(job));
 const created=performance.now();const result2:any=await service.handle({type:'roots.configure',id:root.id,absolutePath:root.absolutePath,label:root.label,autoAlbums:true,hierarchy:false,rules:[]});const returned2=performance.now();while(service.directories.isActive(result2.taskId))await new Promise<void>(resolve=>setTimeout(resolve,5));
 const json={count,saveMs:Math.round(returned-start),firstCreateMs:Math.round(created-start),changeSaveMs:Math.round(returned2-created),changeMs:Math.round(performance.now()-created),notifications,albums:(db.prepare('SELECT COUNT(*) AS n FROM albums').get() as any).n,links:(db.prepare('SELECT COUNT(*) AS n FROM album_media').get() as any).n,scanTasks:(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='scan'").get() as any).n};console.log(JSON.stringify(json));if(out)writeFileSync(out,JSON.stringify(json,null,2));
}finally{service.close();closeDatabase(db);}

},120000);
