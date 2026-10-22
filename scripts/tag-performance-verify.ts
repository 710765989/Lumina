import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {openDatabase,closeDatabase,createTag,addTagToMedia} from '@lumina/storage';
import {LibraryService} from '@lumina/core';
const root=await mkdtemp(path.join(os.tmpdir(),'lumina-tag-perf-')),db=openDatabase(path.join(root,'test.db')),service=new LibraryService(db);
const command=(input:unknown):Promise<any>=>service.handle(input),label=process.argv[2]??'sample';
try{
 const parent=createTag(db,'父标签'),child=createTag(db,'子标签'),target=createTag(db,'移动目标'),other=createTag(db,'另一个父标签'),otherChild=createTag(db,'另一个子标签');
 db.prepare('INSERT INTO tag_edges(parent_id,child_id) VALUES(?,?)').run(parent,child);db.prepare('INSERT INTO tag_edges(parent_id,child_id) VALUES(?,?)').run(other,otherChild);
 const media=db.prepare("INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,'photo',1024,1700000000000,?)"),metadata=db.prepare('INSERT INTO media_details(media_id,metadata_json) VALUES(?,?)'),link=db.prepare('INSERT INTO media_tags(media_id,tag_id) VALUES(?,?)'),origin=db.prepare("INSERT INTO media_tag_origins(media_id,tag_id,source) VALUES(?,?,'ancestor')");
 db.transaction(()=>{for(let i=0;i<40000;i++){const id=String(i);media.run(id,path.join(root,id+'.jpg'),id);metadata.run(id,JSON.stringify({width:4000,height:3000,camera:'synthetic',description:'x'.repeat(512)}));const p=i<10?parent:other,c=i<10?child:otherChild;link.run(id,p);link.run(id,c);origin.run(id,p);}})();
 const measure=async(name:string,action:()=>unknown|Promise<unknown>)=>{const start=performance.now();const result=await action();timings[name]=Math.round((performance.now()-start)*100)/100;return result;};const timings:Record<string,number>={};
 await measure('oneMediaJobMs',async()=>{const job=await command({type:'jobs.start',kind:'tags',mediaIds:['0'],tagName:'子标签'});for(let n=0;n<100;n++){const result=await command({type:'jobs.result',id:job.id});if(!result.active){assert.equal(result.status,'completed');return;}await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('tag job timeout');});
 await measure('directSingleEditMs',()=>command({type:'media.addTag',id:'0',tagName:'子标签'}));
 await measure('tagListMs',()=>command({type:'tags.list'}));await measure('recentTagsMs',()=>command({type:'tags.recent'}));await measure('moveTenMediaTagMs',()=>command({type:'tags.edit',id:child,name:'子标签',parentId:target}));assert.equal((await command({type:'media.tags',id:'0'})).some((tag:any)=>tag.id===parent),false);assert.equal((await command({type:'media.tags',id:'0'})).some((tag:any)=>tag.id===target),true);assert.equal((await command({type:'media.tags',id:'100'})).some((tag:any)=>tag.id===other),true);
 const result={ok:true,syntheticRecords:40000,associations:80000,taggedMoveMedia:10,label,timings,scope:'Synthetic SQLite workload only; no real media decoding, filesystem scanning or user library.'};const out=path.resolve('build-staging',`tag-performance-${label}.json`);await mkdir(path.dirname(out),{recursive:true});await writeFile(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{service.close();closeDatabase(db);await rm(root,{recursive:true,force:true,maxRetries:4});}
