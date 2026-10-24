import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,stat,utimes} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {openDatabase,closeDatabase,rawMedia,createTag,createAlbum} from '@lumina/storage';
import {LibraryService} from './service.js';
import * as geography from './geography.js';

async function setup(){
 const temp=await mkdtemp(path.join(os.tmpdir(),'lumina-geography-')),root=path.join(temp,'photos');await mkdir(root);
 const base=()=>sharp({create:{width:96,height:64,channels:3 as const,background:'#3578ab'}});
 const plain=await base().jpeg().toBuffer(),gps=await base().jpeg().withExif({IFD3:{GPSLatitudeRef:'N',GPSLatitude:'31/1 14/1 0/1',GPSLongitudeRef:'E',GPSLongitude:'121/1 28/1 0/1'}}).toBuffer();
 await writeFile(path.join(root,'located.jpg'),gps);await writeFile(path.join(root,'plain.jpg'),plain);
 const db=openDatabase(path.join(temp,'test.db')),service=new LibraryService(db,path.join(temp,'cache'));const command=(input:unknown):Promise<any>=>service.handle(input);
 await command({type:'roots.addAndScan',absolutePath:root});const media=await command({type:'media.list'}),located=media.find((row:any)=>row.absolutePath.endsWith('located.jpg')),unlocated=media.find((row:any)=>row.absolutePath.endsWith('plain.jpg'));
 const finish=async(id:string)=>{for(let i=0;i<500;i++){const result=await command({type:'jobs.result',id});if(!result.active)return result;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('地理整理未结束');};
 return {temp,root,db,service,command,located,unlocated,plain,finish,close:async()=>{vi.restoreAllMocks();service.close();closeDatabase(db);await rm(temp,{recursive:true,force:true,maxRetries:4,retryDelay:100});}};
}
it('shows scan-derived cities immediately and organizes cached GPS without reading originals; repeated jobs have no work',async()=>{
 const t=await setup();try{
  expect((await t.command({type:'geo.places'}))).toMatchObject({countries:1,noLocation:1,pendingLocation:0});
  const read=vi.spyOn(geography,'extractMetadata').mockRejectedValue(Error('不应再次读取原文件'));
  const first=await t.command({type:'jobs.start',kind:'geo'});
  expect(await t.finish(first.id)).toMatchObject({status:'completed',total:1,processed:1});expect(read).not.toHaveBeenCalled();
  expect(await t.command({type:'media.tags',id:t.located.id})).toHaveLength(0);
  expect(await t.command({type:'albums.list'})).toHaveLength(0);
  const next=await t.command({type:'jobs.start',kind:'geo'});expect(await t.finish(next.id)).toMatchObject({status:'completed',total:0});expect(read).not.toHaveBeenCalled();
  expect((await t.command({type:'geo.places'})).cities).toBe(1);
 }finally{await t.close();}
});
it('uses legacy cached metadata and only reads genuinely uninitialized rows once',async()=>{
 const t=await setup();try{
  t.db.prepare("UPDATE media_details SET metadata_json=json_remove(metadata_json,'$.geoMetadataVersion','$.country','$.region','$.city','$.placeSource','$.distanceKm') WHERE media_id=?").run(t.located.id);
  t.db.prepare("UPDATE media_details SET metadata_json='{}' WHERE media_id=?").run(t.unlocated.id);
  let began!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>began=resolve),gate=new Promise<void>(resolve=>release=resolve),original=geography.extractMetadata;
  const read=vi.spyOn(geography,'extractMetadata').mockImplementation(async file=>{began();await gate;return original(file);});const job=await t.command({type:'jobs.start',kind:'geo'});
  await started;const same=await t.command({type:'jobs.start',kind:'geo'});expect(same.id).toBe(job.id);release();
  expect(await t.finish(job.id)).toMatchObject({status:'completed',total:2});expect(read).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledWith(t.unlocated.absolutePath);
  expect((await t.command({type:'geo.places'})).cities).toBe(1);
  const next=await t.command({type:'jobs.start',kind:'geo'});expect(await t.finish(next.id)).toMatchObject({total:0});expect(read).toHaveBeenCalledTimes(1);
 }finally{await t.close();}
});
it('invalidates only changed files and clears removed GPS and stale automatic places during scan',async()=>{
 const t=await setup();try{
  await t.finish((await t.command({type:'jobs.start',kind:'geo'})).id);
  const info=await stat(t.located.absolutePath);await writeFile(t.located.absolutePath,t.plain);const date=new Date(info.mtimeMs+5000);await utimes(t.located.absolutePath,date,date);
  await t.command({type:'roots.scan',id:(await t.command({type:'roots.list'}))[0].id});
  expect(rawMedia(t.db,t.located.id)?.metadata.latitude).toBeUndefined();expect(rawMedia(t.db,t.located.id)?.metadata.city).toBeUndefined();
  expect(await t.command({type:'geo.places'})).toMatchObject({cities:0,noLocation:2});
  const read=vi.spyOn(geography,'extractMetadata').mockRejectedValue(Error('不应读文件'));
  const job=await t.command({type:'jobs.start',kind:'geo'});expect(await t.finish(job.id)).toMatchObject({total:0,status:'completed'});expect(read).not.toHaveBeenCalled();
 }finally{await t.close();}
});
it('preserves manual places across changed-file scans and later location completion',async()=>{
 const t=await setup();try{
  await t.command({type:'media.attributes',id:t.located.id,country:'自定义国家',city:'我的地点',favorite:true});
  const info=await stat(t.located.absolutePath);await writeFile(t.located.absolutePath,t.plain);const date=new Date(info.mtimeMs+5000);await utimes(t.located.absolutePath,date,date);
  await t.command({type:'roots.scan',id:(await t.command({type:'roots.list'}))[0].id});expect(rawMedia(t.db,t.located.id)?.metadata).toMatchObject({country:'自定义国家',city:'我的地点',placeSource:'user',favorite:true});
  const result=await t.finish((await t.command({type:'jobs.start',kind:'geo'})).id);expect(result.status).toBe('completed');
  expect(await t.command({type:'media.tags',id:t.located.id})).toHaveLength(0);
  expect(rawMedia(t.db,t.located.id)?.metadata).toMatchObject({city:'我的地点',favorite:true});
 }finally{await t.close();}
});
it('reprocesses a changed GPS photo and keeps unchanged photos out of the job',async()=>{
 const t=await setup();try{
  await t.finish((await t.command({type:'jobs.start',kind:'geo'})).id);
  const info=await stat(t.located.absolutePath),date=new Date(info.mtimeMs+5000);await utimes(t.located.absolutePath,date,date);
  await t.command({type:'roots.scan',id:(await t.command({type:'roots.list'}))[0].id});
  const read=vi.spyOn(geography,'extractMetadata').mockRejectedValue(Error('不应重复读取'));
  expect(await t.command({type:'geo.places'})).toMatchObject({pendingOrganization:1});
  const result=await t.finish((await t.command({type:'jobs.start',kind:'geo'})).id);expect(result).toMatchObject({total:1,status:'completed'});expect(read).not.toHaveBeenCalled();
 }finally{await t.close();}
});
it('skips 30000 indexed photos already known to have no GPS without probing their files',async()=>{
 const t=await setup();try{
  const insert=t.db.prepare("INSERT INTO media(id,absolute_path,file_name,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,?,'photo',1,1,?)"),detail=t.db.prepare('INSERT INTO media_details(media_id,metadata_json) VALUES(?,?)');
  const metadata=JSON.stringify({width:96,height:64,format:'jpeg',geoMetadataVersion:1});
  t.db.transaction(()=>{for(let i=0;i<30000;i++){const id=`no-gps-${i}`;insert.run(id,path.join(t.root,`${id}.jpg`),`${id}.jpg`,id);detail.run(id,metadata);}})();
  const read=vi.spyOn(geography,'extractMetadata').mockRejectedValue(Error('大图库不应重读原文件')),began=Date.now();
  const result=await t.finish((await t.command({type:'jobs.start',kind:'geo'})).id);expect(result).toMatchObject({status:'completed',total:1,processed:1});expect(read).not.toHaveBeenCalled();
  const second=await t.finish((await t.command({type:'jobs.start',kind:'geo'})).id);expect(second.total).toBe(0);expect(read).not.toHaveBeenCalled();console.log(JSON.stringify({geographyIndexedPhotos:30002,processedPhotos:1,sourceReads:0,twoRunsMs:Date.now()-began}));
 }finally{await t.close();}
});
it('ignores old creation options and never creates tags, albums or undo batches',async()=>{
 const t=await setup();try{
  const read=vi.spyOn(geography,'extractMetadata').mockRejectedValue(Error('不应再次读取'));
  const result=await t.finish((await t.command({type:'jobs.start',kind:'geo',geoTags:true,geoAlbums:true,geoLevel:'both'})).id);expect(result).toMatchObject({status:'completed',total:1});expect(result.geoRunId).toBeUndefined();
  expect(await t.command({type:'albums.list'})).toHaveLength(0);expect(await t.command({type:'media.tags',id:t.located.id})).toHaveLength(0);
  expect(await t.finish((await t.command({type:'jobs.start',kind:'geo'})).id)).toMatchObject({status:'completed',total:0});expect(read).not.toHaveBeenCalled();
 }finally{await t.close();}
});
it('uses ordinary tags and SQL paging, sorting and filters inside a city',async()=>{
 const t=await setup();try{
  const {city,country}=rawMedia(t.db,t.located.id)!.metadata;
  await t.command({type:'media.addTag',id:t.located.id,tagName:'人工标签'});
  expect(await t.command({type:'albums.list'})).toHaveLength(0);const tags=await t.command({type:'media.tags',id:t.located.id});expect(tags).toHaveLength(1);
  const scope={country,city};expect(await t.command({type:'geo.stats',...scope})).toMatchObject({total:1,photo:1});
  expect(await t.command({type:'geo.media',...scope,fileNames:['plain']})).toHaveLength(0);
  expect(await t.command({type:'geo.media',...scope,tagNames:[tags[0].name],sortBy:'name',sort:'asc'})).toMatchObject([{id:t.located.id}]);
  expect(await t.command({type:'geo.ids',...scope})).toEqual([t.located.id]);expect((await t.command({type:'geo.timeline',...scope})).reduce((sum:number,row:any)=>sum+row.count,0)).toBe(1);
  expect(await t.command({type:'geo.media',noLocation:true})).toMatchObject([{id:t.unlocated.id}]);
  expect(await t.command({type:'geo.media',...scope,limit:1,offset:1})).toHaveLength(0);
 }finally{await t.close();}
});
it('cleans only provenance-owned legacy collections, preserves media, places and manual references, and is repeatable',async()=>{
 const t=await setup();try{
  const auto=createTag(t.db,'地点·旧自动城市'),manual=createTag(t.db,'地点·手动同前缀'),used=createTag(t.db,'地点·手动沿用'),ruleTag=createTag(t.db,'地点·被规则使用');
  for(const id of [auto,used,ruleTag])t.db.prepare("UPDATE tag_options SET source='geo' WHERE tag_id=?").run(id);
  t.db.prepare("INSERT INTO geo_runs(id,changes_json) VALUES('legacy-run','[]')").run();
  for(const id of [auto,used,ruleTag]){t.db.prepare('INSERT INTO media_tags(media_id,tag_id) VALUES(?,?)').run(t.located.id,id);t.db.prepare('INSERT INTO media_tag_origins(media_id,tag_id,source) VALUES(?,?,?)').run(t.located.id,id,id===used?'user':'legacy-run');}
  const album=createAlbum(t.db,'旧地点相册'),ordinary=createAlbum(t.db,'普通相册'),smart=createAlbum(t.db,'手动规则相册');
  t.db.prepare("INSERT INTO smart_albums(album_id,rule_json,source) VALUES(?,?,'geo')").run(album.id,JSON.stringify({relation:'AND',tags:[auto],notTags:[],excludedMediaIds:[]}));
  t.db.prepare("INSERT INTO smart_albums(album_id,rule_json,source) VALUES(?,?,'user')").run(smart.id,JSON.stringify({relation:'AND',tags:[ruleTag],notTags:[],excludedMediaIds:[]}));
  const before=rawMedia(t.db,t.located.id)!.metadata;const preview=await t.command({type:'geo.cleanupPreview'});expect(preview).toMatchObject({albums:1,tags:3,links:2});
  await t.command({type:'geo.cleanup',revision:preview.revision});expect((await t.command({type:'albums.list'})).map((row:any)=>row.id).sort()).toEqual([ordinary.id,smart.id].sort());
  expect((await t.command({type:'tags.list'})).map((row:any)=>row.id)).toEqual(expect.arrayContaining([manual,used,ruleTag]));expect(t.db.prepare('SELECT 1 FROM tags WHERE id=?').get(auto)).toBeUndefined();
  expect((await t.command({type:'albums.media',id:smart.id})).map((row:any)=>row.id)).toContain(t.located.id);expect(rawMedia(t.db,t.located.id)!.metadata).toEqual(before);expect(await t.command({type:'geo.places'})).toMatchObject({cities:1,legacy:{albums:0,tags:0,links:0}});expect((await stat(t.located.absolutePath)).isFile()).toBe(true);
  const again=await t.command({type:'geo.cleanupPreview'});expect(await t.command({type:'geo.cleanup',revision:again.revision})).toMatchObject({albums:0,tags:0,links:0});
 }finally{await t.close();}
});
it('rejects stale cleanup confirmation when a tag gains a manual association',async()=>{
 const t=await setup();try{
  const tag=createTag(t.db,'地点·旧标签');t.db.prepare("UPDATE tag_options SET source='geo' WHERE tag_id=?").run(tag);const preview=await t.command({type:'geo.cleanupPreview'});
  await t.command({type:'media.addTag',id:t.located.id,tagName:'地点·旧标签'});await expect(t.command({type:'geo.cleanup',revision:preview.revision})).rejects.toThrow('已变化');expect(t.db.prepare('SELECT 1 FROM tags WHERE id=?').get(tag)).toBeTruthy();
 }finally{await t.close();}
});
it('paginates place covers in stable capture/modified order without duplicates, skipping hidden and other places',async()=>{
 const t=await setup();try{
  const insert=t.db.prepare("INSERT INTO media(id,absolute_path,file_name,kind,size_bytes,modified_at_ms,captured_at_ms,fingerprint) VALUES(?,?,?,'photo',1,?,?,?)"),detail=t.db.prepare('INSERT INTO media_details(media_id,metadata_json) VALUES(?,?)');
  const place={country:'CN',region:'测试',city:'候选城市',sortBy:'capturedAt'};
  t.db.transaction(()=>{for(let i=0;i<80;i++){const id=`cover-${String(i).padStart(3,'0')}`;insert.run(id,path.join(t.root,`${id}.jpg`),`${id}.jpg`,2000-i,i%2===0?1000:null,id);detail.run(id,JSON.stringify({...place,geoMetadataVersion:1}));}})();
  t.db.prepare("INSERT INTO hidden_media(media_id) VALUES('cover-003')").run();
  t.db.prepare("UPDATE media_details SET missing=1 WHERE media_id='cover-005'").run();
  const read=vi.spyOn(geography,'extractMetadata').mockRejectedValue(Error('不应读原文件'));
  const summary=(await t.command({type:'geo.places',sortBy:place.sortBy})).places.find((row:any)=>row.city===place.city);expect(summary.count).toBe(78);expect(summary.samples).toHaveLength(12);
  const ids:string[]=[];let cursor:unknown;for(let i=0;i<20;i++){const page=await t.command({type:'geo.coverCandidates',...place,cursor,limit:7});ids.push(...page.items.map((row:any)=>row.id));if(!page.hasMore)break;const last=page.items.at(-1);cursor={value:last.coverSortValue,id:last.id};}
  const expected=Array.from({length:80},(_,i)=>i).filter(i=>i!==3&&i!==5).sort((a,b)=>((b%2===0?1000:2000-b)-(a%2===0?1000:2000-a))||a-b).map(i=>`cover-${String(i).padStart(3,'0')}`);
  expect(ids).toEqual(expected);expect(new Set(ids).size).toBe(78);expect(summary.samples.map((row:any)=>row.id)).toEqual(ids.slice(0,12));expect(read).not.toHaveBeenCalled();
  expect(await t.command({type:'geo.coverCandidates',...place,country:'不存在',limit:7})).toEqual({items:[],hasMore:false});
  t.db.prepare('UPDATE library_roots SET enabled=0').run();expect(await t.command({type:'geo.coverCandidates',...place,limit:7})).toEqual({items:[],hasMore:false});
 }finally{await t.close();}
});
it('invalidates the place cover revision for a changed candidate beyond the twelve seeds',async()=>{
 const t=await setup();try{
  const insert=t.db.prepare("INSERT INTO media(id,absolute_path,file_name,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,?,'photo',1,?,?)"),detail=t.db.prepare('INSERT INTO media_details(media_id,metadata_json) VALUES(?,?)');
  t.db.transaction(()=>{for(let i=0;i<30;i++){const id=`revision-${i}`;insert.run(id,path.join(t.root,`${id}.jpg`),`${id}.jpg`,1000-i,id);detail.run(id,JSON.stringify({country:'CN',city:'revision'}));}})();
  const place=async()=>(await t.command({type:'geo.places'})).places.find((row:any)=>row.city==='revision');const before=await place();expect((await place()).coverRevision).toBe(before.coverRevision);
  t.db.prepare("UPDATE media SET fingerprint='changed' WHERE id='revision-29'").run();const after=await place();expect(after.samples.map((row:any)=>row.id)).toEqual(before.samples.map((row:any)=>row.id));expect(after.coverRevision).not.toBe(before.coverRevision);
 }finally{await t.close();}
});
it('uses the city browser order for covers in every sort and direction, excluding hidden tail items before paging',async()=>{
 const t=await setup();try{
  const insert=t.db.prepare("INSERT INTO media(id,absolute_path,file_name,kind,size_bytes,modified_at_ms,captured_at_ms,fingerprint) VALUES(?,?,?,'photo',?,?,?,?)"),detail=t.db.prepare('INSERT INTO media_details(media_id,metadata_json) VALUES(?,?)');
  const scope={country:'CN',region:'测试',city:'统一排序'};
  t.db.transaction(()=>{for(let i=0;i<19;i++){const id=`sorted-${String(i).padStart(2,'0')}`,name=i<3?['a.jpg','A.jpg','a.jpg'][i]:`${19-i}.jpg`;insert.run(id,path.join(t.root,`${id}.jpg`),name,(i%4+1)*100,2000-i,i===0?500:i%3===0?null:3000+i,id);detail.run(id,JSON.stringify(scope));}})();
  for(const id of ['sorted-15','sorted-18'])await t.command({type:'media.hide',id});
  const defaults=(await t.command({type:'geo.places'})).places.find((row:any)=>row.city===scope.city);expect(defaults.count).toBe(17);expect(defaults.samples.slice(0,4).map((row:any)=>row.id)).toEqual(['sorted-00','sorted-01','sorted-02','sorted-03']);
  for(const sortBy of ['fileTime','capturedAt','name','size'])for(const sort of ['asc','desc']){
   const order={sortBy,sort},browser=await t.command({type:'geo.media',...scope,...order,limit:100}),summary=(await t.command({type:'geo.places',...order})).places.find((row:any)=>row.city===scope.city),candidateIds:string[]=[];let cursor:unknown;
   for(let n=0;n<20;n++){const page=await t.command({type:'geo.coverCandidates',...scope,...order,cursor,limit:3});candidateIds.push(...page.items.map((row:any)=>row.id));if(!page.hasMore)break;const last=page.items.at(-1);cursor={value:last.coverSortValue,id:last.id};}
   expect(candidateIds,`${sortBy}/${sort}`).toEqual(browser.map((row:any)=>row.id));expect(candidateIds).toHaveLength(17);expect(summary.samples.map((row:any)=>row.id)).toEqual(candidateIds.slice(0,12));
  }
  // Hiding a cover candidate replaces it with the next visible one; hiding a later item leaves the leading four intact.
  await t.command({type:'media.hide',id:'sorted-00'});const after=(await t.command({type:'geo.places'})).places.find((row:any)=>row.city===scope.city);expect(after.count).toBe(16);expect(after.samples.slice(0,4).map((row:any)=>row.id)).toEqual(['sorted-01','sorted-02','sorted-03','sorted-04']);expect(after.coverRevision).not.toBe(defaults.coverRevision);
 }finally{await t.close();}
});
