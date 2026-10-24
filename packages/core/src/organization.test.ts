import { mkdtemp, mkdir, writeFile, readFile, unlink, rename, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import exifr from 'exifr';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { openDatabase, closeDatabase, type LuminaDatabase, rawMedia } from '@lumina/storage';
import { LibraryService } from './service.js';
import { nearbyPlace } from './geography.js';
import { windowsHiddenAttribute } from './windows-hidden.js';

sharp.cache(false);
let root: string, library: string, db: LuminaDatabase, service: LibraryService, media: any[];
const command = (input: unknown): Promise<any> => service.handle(input);
async function until(check: () => Promise<boolean>, timeout = 10000) {
  const start = Date.now(); while (!await check()) { if (Date.now() - start > timeout) throw new Error('测试等待超时'); await new Promise((resolve) => setTimeout(resolve, 20)); }
}
async function finished(id: string) { await until(async () => ['completed', 'failed', 'cancelled', 'paused'].includes((await command({ type: 'jobs.result', id })).status)); return command({ type: 'jobs.result', id }); }
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'lumina-m2-')); library = path.join(root, 'library'); await mkdir(path.join(library, 'nested'), { recursive: true });
  const bytes = await sharp({ create: { width: 96, height: 64, channels: 3, background: '#3478d4' } }).jpeg().withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '31/1 14/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '121/1 28/1 0/1' } }).toBuffer();
  await writeFile(path.join(library, 'a.jpg'), bytes); await writeFile(path.join(library, 'b.jpg'), bytes);
  await writeFile(path.join(library, 'nested/a.jpg'), await sharp({ create: { width: 96, height: 64, channels: 3, background: 'white' } }).jpeg().toBuffer());
  db = openDatabase(path.join(root, 'library.db')); service = new LibraryService(db, path.join(root, 'cache'), { systemTrash: async () => { throw new Error('测试系统回收站不可用'); } });
  await command({ type: 'roots.addAndScan', absolutePath: library });
  media = (await command({ type: 'media.list', sortBy: 'name', sort: 'asc' })) as any[];
});
afterEach(async () => { service.close(); closeDatabase(db); await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); });

describe('M2 organization workflows', () => {
  it('filters excluded filenames and exact suffixes consistently across full library, albums, tags, counts and playback',async()=>{
    const tag=await command({type:'tags.create',name:'后缀测试'}),album=await command({type:'albums.edit',name:'后缀测试相册'});
    const insert=db.prepare("INSERT INTO media(id,absolute_path,file_name,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,?,'photo',100,?,?)"),link=db.prepare('INSERT INTO media_tags(media_id,tag_id) VALUES(?,?)'),join=db.prepare('INSERT INTO album_media(album_id,media_id) VALUES(?,?)');
    const names=Array.from({length:225},(_,i)=>`search-check.${String(i).padStart(3,'0')}${i===0?'-skip':''}.PNG`);
    names.push('search-check.final.photo.JpG','search-check.jpg.backup.png','search-check.custom.JXL','search-check.no-extension','search-check-100%.jpg','search-check-100_.jpg','search-check-100x.jpg');
    db.transaction(()=>{for(let i=0;i<names.length;i++){const id=`suffix-${i}`;insert.run(id,path.join(library,names[i]!),names[i],new Date(2026,9,19).getTime()+i,id);link.run(id,tag.id);join.run(album.id,id);}})();
    const rule={relation:'AND',tags:[tag.id],notTags:[],excludedMediaIds:[]},preview=await command({type:'smart.preview',rule}),smart=await command({type:'smart.save',name:'智能后缀相册',rule,revision:preview.revision});
    const filters={query:'',fileNames:['search-check'],excludeFileNames:['skip'],extensions:['.PNG'],sortBy:'name',sort:'asc'};
    for(const scope of [{scope:'library'},{scope:'album',id:album.id},{scope:'album',id:smart.id},{scope:'tag',id:tag.id}]){
      const type=scope.scope==='library'?'media.search':scope.scope==='album'?'albums.media':'tags.media',statsType=scope.scope==='library'?'media.filteredStats':scope.scope==='album'?'albums.filteredStats':'tags.filteredStats';
      const first=await command({type,id:scope.id,...filters,limit:200}),second=await command({type,id:scope.id,...filters,limit:200,offset:200});
      expect(first).toHaveLength(200);expect(second).toHaveLength(25);expect(new Set([...first,...second].map(row=>row.id)).size).toBe(225);
      expect((await command({type:statsType,id:scope.id,...filters})).total).toBe(225);
      expect(await command({type:'media.playlist',source:{...scope,...filters}})).toEqual([...first,...second].map(row=>row.id));
    }
    const months=await command({type:'media.timeline',...filters});expect(months.reduce((sum:number,row:any)=>sum+row.count,0)).toBe(225);
    expect((await command({type:'media.search',query:'',fileNames:['search-check'],extensions:['JPG']})).map((row:any)=>row.fileName??path.basename(row.absolutePath))).toEqual(expect.arrayContaining(['search-check.final.photo.JpG','search-check-100%.jpg','search-check-100_.jpg','search-check-100x.jpg']));
    expect(await command({type:'media.search',query:'',fileNames:['search-check'],extensions:['jpg','png'],limit:1000})).toHaveLength(230);
    expect(await command({type:'media.search',query:'',extensions:['*.JXL']})).toMatchObject([{id:'suffix-227'}]);
    expect(await command({type:'media.search',query:'',fileNames:['search-check-100'],excludeFileNames:['%'],extensions:['jpg']})).toHaveLength(2);
    expect(await command({type:'media.search',query:'',fileNames:['search-check-100'],excludeFileNames:['_'],extensions:['jpg']})).toHaveLength(2);
    expect(await command({type:'media.search',query:'',fileNames:['search-check'],extensions:['pg']})).toHaveLength(0);
    await command({type:'media.hide',id:'suffix-1'});expect((await command({type:'media.filteredStats',...filters})).total).toBe(224);
  });
  it('makes filename exclusion the inverse of Chinese initial matching and rejects invalid suffix input',async()=>{
    const id=media[0].id;db.prepare('UPDATE media SET file_name=? WHERE id=?').run('人物日常.jpg',id);
    expect((await command({type:'media.search',query:'',fileNames:['rwrc']})).map((row:any)=>row.id)).toContain(id);
    expect((await command({type:'media.search',query:'',excludeFileNames:['rwrc']})).map((row:any)=>row.id)).not.toContain(id);
    for(const suffix of ['', '.', '%', 'jpg.backup', '../jpg'])await expect(command({type:'media.search',query:'',extensions:[suffix]})).rejects.toThrow();
  });
  it('filters full ordinary/smart album and tag scopes consistently for pages, statistics and playback',async()=>{
    const rootTag=await command({type:'tags.create',name:'范围父标签'}),child=await command({type:'tags.create',name:'范围子标签',parentId:rootTag.id}),exclude=await command({type:'tags.create',name:'排除标签'});
    const ordinary=await command({type:'albums.edit',name:'搜索范围'}),insert=db.prepare("INSERT INTO media(id,absolute_path,file_name,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,?,'photo',100,?,?)"),link=db.prepare('INSERT INTO media_tags(media_id,tag_id) VALUES(?,?)'),albumLink=db.prepare('INSERT INTO album_media(album_id,media_id) VALUES(?,?)');
    db.transaction(()=>{for(let i=0;i<235;i++){const id=`scope-${i}`,name=`匹配-${String(i).padStart(3,'0')}.jpg`;insert.run(id,path.join(library,name),name,1700000000000+i,id);link.run(id,child.id);if(i<225)albumLink.run(ordinary.id,id);if(i%2===0)link.run(id,exclude.id);}})();
    const rule={relation:'AND',tags:[rootTag.id],notTags:[],excludedMediaIds:[]},preview=await command({type:'smart.preview',rule}),smart=await command({type:'smart.save',name:'智能搜索范围',rule,revision:preview.revision});
    for(const [type,id,scope,total] of [['albums',ordinary.id,'album',225],['albums',smart.id,'album',235],['tags',rootTag.id,'tag',235]] as const){
      const filters={query:'',fileNames:['匹配'],tagNames:['范围父标签'],sortBy:'name',sort:'asc'};
      const first=await command({type:`${type}.media`,id,...filters,limit:200}),next=await command({type:`${type}.media`,id,...filters,limit:200,offset:200}),stats=await command({type:`${type}.filteredStats`,id,...filters}),ids=await command({type:'media.playlist',source:{scope,id,...filters}});
      expect(first).toHaveLength(200);expect(next).toHaveLength(total-200);expect(stats).toMatchObject({total,photo:total,video:0});expect(ids).toEqual([...first,...next].map((row:any)=>row.id));
      const excluded=await command({type:`${type}.media`,id,...filters,excludeTagNames:['排除标签'],limit:1000});expect(excluded.every((row:any)=>Number(row.id.split('-')[1])%2===1)).toBe(true);expect((await command({type:`${type}.filteredStats`,id,...filters,excludeTagNames:['排除标签']})).total).toBe(excluded.length);
      expect(await command({type:`${type}.media`,id,untaggedOnly:true})).toEqual([]);expect((await command({type:`${type}.filteredStats`,id,excludeUntagged:true})).total).toBe(total);
    }
    const absent=await command({type:'albums.filteredStats',id:ordinary.id,fileNames:['匹配-234']});expect(absent.total).toBe(0);expect((await command({type:'tags.filteredStats',id:rootTag.id,fileNames:['匹配-234']})).total).toBe(1);
    await command({type:'media.hide',id:'scope-0'});expect((await command({type:'albums.filteredStats',id:ordinary.id})).total).toBe(224);expect((await command({type:'tags.filteredStats',id:rootTag.id})).total).toBe(234);
  });
  it('suppresses a smart album only when matching media exist but none are visible, and restores it automatically',async()=>{
    const tag=await command({type:'tags.create',name:'可见性规则'});for(const item of media)await command({type:'media.addTag',id:item.id,tagName:tag.name});
    const rule={relation:'AND',tags:[tag.id],notTags:[],excludedMediaIds:[]},preview=await command({type:'smart.preview',rule}),album=await command({type:'smart.save',name:'自动隐藏相册',rule,revision:preview.revision});
    const summary=async()=> (await command({type:'albums.list'})).find((row:any)=>row.id===album.id);
    expect(await summary()).toMatchObject({mediaCount:3,hiddenByVisibility:false});await command({type:'media.hide',id:media[0].id});expect(await summary()).toMatchObject({mediaCount:2,hiddenByVisibility:false});for(const item of media.slice(1))await command({type:'media.hide',id:item.id});expect(await summary()).toMatchObject({mediaCount:0,hiddenByVisibility:true});
    await command({type:'media.unhide',id:media[0].id});expect(await summary()).toMatchObject({mediaCount:1,hiddenByVisibility:false});
    const [managed]=await command({type:'roots.list'});await command({type:'roots.setEnabled',id:managed.id,enabled:false});expect((await summary()).hiddenByVisibility).toBe(true);await command({type:'roots.setEnabled',id:managed.id,enabled:true});expect((await summary()).hiddenByVisibility).toBe(false);
    await command({type:'tags.setHidden',id:tag.id,hidden:true});expect((await summary()).hiddenByVisibility).toBe(true);await command({type:'tags.setHidden',id:tag.id,hidden:false});expect((await summary()).hiddenByVisibility).toBe(false);
    expect((await summary()).rule).toEqual(rule);
    const emptyTag=await command({type:'tags.create',name:'没有匹配媒体'}),emptyRule={...rule,tags:[emptyTag.id]},emptyPreview=await command({type:'smart.preview',rule:emptyRule}),empty=await command({type:'smart.save',name:'可编辑的空相册',rule:emptyRule,revision:emptyPreview.revision});expect((await command({type:'albums.list'})).find((row:any)=>row.id===empty.id)).toMatchObject({mediaCount:0,hiddenByVisibility:false});
    const ordinary=await command({type:'albums.edit',name:'普通空相册'});expect((await command({type:'albums.list'})).find((row:any)=>row.id===ordinary.id).hiddenByVisibility).toBe(false);
  });
  it('restores hidden manual covers for ordinary and smart albums without losing the selection',async()=>{
    const tag=await command({type:'tags.create',name:'封面隐藏'});await command({type:'media.addTag',id:media[0].id,tagName:'封面隐藏'});
    const ordinary=await command({type:'albums.create',name:'普通封面'});await command({type:'albums.addMedia',id:ordinary.id,mediaIds:media.map((item)=>item.id)});
    const rule={relation:'AND',tags:[tag.id],notTags:[],excludedMediaIds:[]};const preview=await command({type:'smart.preview',rule});const smart=await command({type:'smart.save',name:'智能封面',rule,revision:preview.revision});
    for(const album of [ordinary,smart])await command({type:'albums.setCover',id:album.id,mediaId:media[0].id});
    await command({type:'tags.setHidden',id:tag.id,hidden:true});
    for(const album of await command({type:'albums.list'})){expect(album.cover?.id).not.toBe(media[0].id);expect(album.manualCoverMediaId).toBe(media[0].id);}
    await command({type:'tags.setHidden',id:tag.id,hidden:false});
    for(const album of await command({type:'albums.list'})){expect(album.cover.id).toBe(media[0].id);expect(album.coverMode).toBe('manual');}
  });
  it('matches Chinese filename and tag initials and persists recent tag ordering',async()=>{
    await writeFile(path.join(library,'人物日常.jpg'),await readFile(media[0].absolutePath));await command({type:'roots.scan',id:(await command({type:'roots.list'}))[0].id});
    const ren=await command({type:'tags.create',name:'人'});await command({type:'tags.create',name:'日'});
    expect((await command({type:'media.nameSuggestions',query:'r'})).some((row:any)=>row.name==='人物日常.jpg')).toBe(true);
    expect((await command({type:'media.search',query:'',fileNames:['rwrc']})).some((row:any)=>row.absolutePath.endsWith('人物日常.jpg'))).toBe(true);
    await command({type:'media.addTag',id:media[0].id,tagName:'人'});await command({type:'media.addTag',id:media[1].id,tagName:'日'});await command({type:'media.addTag',id:media[2].id,tagName:'人'});
    expect((await command({type:'tags.recent'})).slice(0,2).map((row:any)=>row.name)).toEqual(['人','日']);
    expect((await command({type:'media.search',query:'ren'})).some((row:any)=>row.id===media[0].id)).toBe(true);
    service.close();closeDatabase(db);db=openDatabase(path.join(root,'library.db'));service=new LibraryService(db,path.join(root,'cache'));
    expect((await command({type:'tags.recent'}))[0].id).toBe(ren.id);
  });
  it('pages every task in stable groups of ten without dropping old history',async()=>{
    const insert=db.prepare("INSERT INTO tasks(id,kind,status,total,processed) VALUES(?,'scan','completed',0,0)");for(let i=0;i<24;i++)insert.run(`history-${i}`);
    const first=await command({type:'tasks.page',limit:10,offset:0});const second=await command({type:'tasks.page',limit:10,offset:10});const last=await command({type:'tasks.page',limit:10,offset:20});
    expect(first.total).toBe(25);expect(first.items).toHaveLength(10);expect(second.items).toHaveLength(10);expect(last.items).toHaveLength(5);expect(new Set([...first.items,...second.items,...last.items].map((row:any)=>row.id)).size).toBe(25);
  });
  it('prioritizes unfinished tasks and filters counts and pagination across the complete history',async()=>{
    const insert=db.prepare("INSERT INTO tasks(id,kind,status,total,processed,created_at) VALUES(?,'scan',?,10,0,?)");
    for(let i=0;i<7;i++)insert.run(`pending-${i}`,['running','queued','paused'][i%3],'2020-01-01 00:00:00');
    for(let i=0;i<8;i++)insert.run(`completed-${i}`,'completed','2030-01-01 00:00:00');
    for(let i=0;i<6;i++)insert.run(`failed-${i}`,'failed','2030-01-01 00:00:00');
    insert.run('cancelled','cancelled','2030-01-01 00:00:00');
    const first=await command({type:'tasks.page',limit:5});expect(first.total).toBe(23);expect(first.items.every((row:any)=>['running','queued','paused'].includes(row.status))).toBe(true);
    expect((await command({type:'tasks.list',limit:5})).map((row:any)=>row.id)).toEqual(first.items.map((row:any)=>row.id));
    const pending=await command({type:'tasks.page',filter:'pending',limit:5}),rest=await command({type:'tasks.page',filter:'pending',limit:5,offset:5});expect(pending.total).toBe(7);expect(rest.items).toHaveLength(2);expect(new Set([...pending.items,...rest.items].map((row:any)=>row.id)).size).toBe(7);
    const completed=await command({type:'tasks.page',filter:'completed',limit:200});expect(completed.total).toBe(9);expect(completed.items.every((row:any)=>row.status==='completed')).toBe(true);
    const failed=await command({type:'tasks.page',filter:'failed',limit:5,offset:5});expect(failed.total).toBe(6);expect(failed.items).toHaveLength(1);expect(failed.items[0].status).toBe('failed');
    db.prepare("UPDATE tasks SET status='completed' WHERE id LIKE 'pending-%'").run();expect(await command({type:'tasks.page',filter:'pending'})).toEqual({total:0,items:[]});
    await expect(command({type:'tasks.page',filter:'invalid'})).rejects.toThrow();
  });
  it('coalesces concurrent root scans and updates only changed paths in watcher work',async()=>{
    const {scanDirectory}=await import('./index.js');const managed=(await command({type:'roots.list'}))[0];const before=(await command({type:'tasks.page',limit:200})).total;
    const [a,b]=await Promise.all([scanDirectory(db,library,{rootId:managed.id}),scanDirectory(db,library,{rootId:managed.id})]);expect(a.task.id).toBe(b.task.id);expect((await command({type:'tasks.page',limit:200})).total).toBe(before+1);
    const first=path.join(library,'incremental.jpg');await writeFile(first,await readFile(media[0].absolutePath));
    const updated=await scanDirectory(db,library,{rootId:managed.id,changedPaths:[first]});expect(updated.task.total).toBe(1);expect(await command({type:'media.list'})).toHaveLength(4);
    await unlink(first);const removed=await scanDirectory(db,library,{rootId:managed.id,changedPaths:[first]});expect(removed.task.id).toBe(updated.task.id);expect(await command({type:'media.list'})).toHaveLength(3);
    const nested=path.join(library,'nested');await rm(nested,{recursive:true});await scanDirectory(db,library,{rootId:managed.id,changedPaths:[nested]});expect(await command({type:'media.list'})).toHaveLength(2);
  });
  it('honors selected similar deletions while retaining at least one verified original',async()=>{
    const job=await command({type:'jobs.start',kind:'similar'});expect((await finished(job.id)).status).toBe('completed');
    const all=await command({type:'similar.cleanupPreview'});expect(all.mediaIds).toHaveLength(1);
    const none=await command({type:'similar.cleanupPreview',removeIds:[]});expect(none.mediaIds).toHaveLength(0);
    const chosen=await command({type:'similar.cleanupPreview',removeIds:[all.mediaIds[0]]});expect(chosen.mediaIds).toEqual(all.mediaIds);await command({type:'similar.validateCleanup',removeIds:[all.mediaIds[0]],revision:chosen.revision});
    const protectedPlan=await command({type:'similar.cleanupPreview',removeIds:[...all.mediaIds,all.groups[0].keep.id]});expect(protectedPlan.mediaIds).not.toContain(all.groups[0].keep.id);
  });
  it('detects visually similar photos across sizes and preserves its index across restart',async()=>{
    const smaller=path.join(library,'smaller.jpg');await sharp(path.join(library,'a.jpg')).resize(48,32).jpeg({quality:40}).withExif({IFD0:{ImageDescription:'x'.repeat(6000)}}).toFile(smaller);
    const [managed]=await command({type:'roots.list'});await command({type:'roots.scan',id:managed.id});
    const job=await command({type:'jobs.start',kind:'similar'});expect((await finished(job.id)).status).toBe('completed');
    const result=await command({type:'similar.list'});expect(result.indexed).toBe(4);expect(result.groups.some((group:any)=>group.items.length===3)).toBe(true);
    expect(result.groups[0].items.slice(0,2).every((item:any)=>item.exactDuplicate)).toBe(true);
    const largest=await command({type:'similar.cleanupPreview',keepLargest:true});
    expect(largest.groups[0].keep.absolutePath).toBe(smaller);expect(largest.mediaIds).toHaveLength(2);
    await command({type:'similar.validateCleanup',keepLargest:true,revision:largest.revision});
    const representative=await command({type:'similar.cleanupPreview',keepLargest:false});expect(representative.groups[0].keep.absolutePath).not.toBe(smaller);
    service.close();closeDatabase(db);db=openDatabase(path.join(root,'library.db'));service=new LibraryService(db,path.join(root,'cache'));
    expect((await command({type:'similar.list'})).indexed).toBe(4);
    const [item]=await command({type:'media.search',query:'smaller.jpg'});await command({type:'media.hide',id:item.id});
    expect((await command({type:'similar.list'})).indexed).toBe(3);
  });
  it('keeps one chosen original per duplicate group and rejects a changed keeper',async()=>{
    const a=media.find((item)=>item.absolutePath===path.join(library,'a.jpg')),b=media.find((item)=>item.absolutePath===path.join(library,'b.jpg'));
    const job=await command({type:'jobs.start',kind:'duplicates'});await finished(job.id);
    const plan=await command({type:'duplicates.cleanupPreview',keepIds:[b.id]});expect(plan.mediaIds).toEqual([a.id]);
    expect(plan.groups[0].keep.id).toBe(b.id);expect(plan.sizeBytes).toBe(a.sizeBytes);
    await command({type:'duplicates.validateCleanup',keepIds:[b.id],revision:plan.revision});
    const original=await readFile(b.absolutePath);await writeFile(b.absolutePath,'changed keeper');
    await expect(command({type:'duplicates.validateCleanup',keepIds:[b.id],revision:plan.revision})).rejects.toThrow('保留');
    expect(await readFile(a.absolutePath)).toEqual(original);
    await writeFile(b.absolutePath,original);await command({type:'roots.scan',id:(await command({type:'roots.list'}))[0].id});
    await expect(command({type:'duplicates.validateCleanup',keepIds:[b.id],revision:plan.revision})).rejects.toThrow('变化');
  });
  it('hides all media associated with a tag while preserving tag options and independent hiding',async()=>{
    await command({type:'media.addTag',id:media[0].id,tagName:'隐藏类别'});await command({type:'media.addTag',id:media[1].id,tagName:'隐藏类别'});
    const tag=(await command({type:'tags.list'})).find((row:any)=>row.name==='隐藏类别');
    await command({type:'tags.options',id:tag.id,color:'#123456',group:'测试分组',aliases:['别名'],blocked:false});
    expect(await command({type:'tags.visibilityPreview',id:tag.id})).toMatchObject({total:2,visible:2});
    await command({type:'tags.setHidden',id:tag.id,hidden:true});expect(await command({type:'media.list'})).toHaveLength(1);
    await command({type:'media.addTag',id:media[2].id,tagName:'隐藏类别'});expect(await command({type:'media.list'})).toHaveLength(0);
    await command({type:'media.hide',id:media[2].id});await command({type:'tags.setHidden',id:tag.id,hidden:false});
    expect(await command({type:'media.list'})).toHaveLength(2);
    expect((await command({type:'tags.list'})).find((row:any)=>row.id===tag.id)).toMatchObject({color:'#123456',group:'测试分组',aliases:['别名'],blocked:false});
  });
  it('suggests visible filenames with escaped literal wildcard input',async()=>{
    const suggested=await command({type:'media.nameSuggestions',query:'a.jpg'});expect(suggested).toContainEqual({name:'a.jpg',count:2});
    await writeFile(path.join(library,'literal_100%.jpg'),await readFile(media[0].absolutePath));await command({type:'roots.scan',id:(await command({type:'roots.list'}))[0].id});
    expect(await command({type:'media.nameSuggestions',query:'%'})).toEqual([{name:'literal_100%.jpg',count:1}]);
    const [item]=await command({type:'media.search',query:'literal_100%'});await command({type:'media.hide',id:item.id});
    expect(await command({type:'media.nameSuggestions',query:'%'})).toEqual([]);
  });
  it('does not announce a library change for empty or wholly failed expiry sweeps',async()=>{
    service.close();let notifications=0;service=new LibraryService(db,path.join(root,'cache'),{notify:()=>notifications++,systemTrash:async()=>{throw new Error('测试系统回收站不可用');}});
    expect(await command({type:'trash.expired'})).toEqual([]);expect(notifications).toBe(0);
    await command({type:'trash.put',mediaIds:[media[0].id]});notifications=0;
    db.prepare("UPDATE trash_entries SET expires_at='2000-01-01T00:00:00.000Z'").run();
    expect((await command({type:'trash.expired'}))[0].ok).toBe(false);expect(notifications).toBe(0);
    expect(await command({type:'trash.list'})).toHaveLength(1);
  });
  it('rejects removed, disabled and re-created roots when retrying an old failed scan', async () => {
    const broken=path.join(library,'broken.jpg');await writeFile(broken,'invalid image');
    const [managed]=await command({type:'roots.list'});
    const scan=await command({type:'roots.scan',id:managed.id});expect(scan.task.status).toBe('failed');
    await command({type:'roots.setEnabled',id:managed.id,enabled:false});
    await expect(command({type:'jobs.control',id:scan.task.id,action:'retry'})).rejects.toThrow('停用');
    await expect(command({type:'roots.scan',id:managed.id})).rejects.toThrow('停用');
    await command({type:'roots.remove',id:managed.id});
    await expect(command({type:'jobs.control',id:scan.task.id,action:'retry'})).rejects.toThrow('移除');
    expect(await command({type:'media.list'})).toHaveLength(0);
    await command({type:'roots.addAndScan',absolutePath:library});
    await expect(command({type:'jobs.control',id:scan.task.id,action:'resume'})).rejects.toThrow('移除');
  });
  it('does not recreate media when a root is removed during async directory enumeration', async () => {
    const [managed]=await command({type:'roots.list'});
    const scan=command({type:'roots.scan',id:managed.id});
    const rejected=expect(scan).rejects.toThrow('移除或停用');
    await command({type:'roots.remove',id:managed.id});await rejected;
    expect(await command({type:'roots.list'})).toHaveLength(0);
    expect(await command({type:'media.list'})).toHaveLength(0);
  });
  it('preserves changed files and their records for both direct deletion destinations', async () => {
    const item=media[0];const replacement=path.join(root,'replacement.jpg');
    await writeFile(replacement,await readFile(item.absolutePath));
    await unlink(item.absolutePath);await rename(replacement,item.absolutePath);
    for(const destination of ['system','permanent']) {
      const result=await command({type:'trash.purge',mediaIds:[item.id],destination});
      expect(result[0]).toMatchObject({ok:false,error:expect.stringContaining('文件已改变')});
      expect(rawMedia(db,item.id)).toBeDefined();expect((await stat(item.absolutePath)).isFile()).toBe(true);
    }
    // A normal unchanged temporary fixture can still be removed.
    expect((await command({type:'trash.purge',mediaIds:[media[1].id],destination:'permanent'}))[0].ok).toBe(true);
    await expect(stat(media[1].absolutePath)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('checks recycled content before purge and refreshes identity after restoring elsewhere', async () => {
    const item=media[0];await command({type:'trash.put',mediaIds:[item.id]});
    const [entry]=await command({type:'trash.list'});const original=await readFile(entry.storedPath);
    const changed=Buffer.from(original);changed[changed.length-1]=changed[changed.length-1]!^1;await writeFile(entry.storedPath,changed);
    const blocked=await command({type:'trash.purge',mediaIds:[item.id],destination:'permanent'});
    expect(blocked[0]).toMatchObject({ok:false,error:expect.stringContaining('内容已变化')});
    expect(await readFile(entry.storedPath)).toEqual(changed);expect(await command({type:'trash.list'})).toHaveLength(1);
    await writeFile(entry.storedPath,original);
    const restoreRoot=path.join(root,'restored');await mkdir(restoreRoot);await command({type:'roots.addAndScan',absolutePath:restoreRoot});
    expect((await command({type:'trash.restore',mediaIds:[item.id],directory:restoreRoot}))[0].ok).toBe(true);
    expect((await command({type:'trash.purge',mediaIds:[item.id],destination:'permanent'}))[0].ok).toBe(true);
  });
  it('returns saved organizing metadata consistently across list, search, albums and tags', async () => {
    const item=media[0];await command({type:'media.attributes',id:item.id,displayName:'我的名称',favorite:true,rating:4});
    const album=await command({type:'albums.create',name:'元数据检查'});await command({type:'albums.addMedia',id:album.id,mediaIds:[item.id]});
    await command({type:'media.addTag',id:item.id,tagName:'元数据标签'});const tag=(await command({type:'tags.list'})).find((tag:any)=>tag.name==='元数据标签');
    for(const request of [{type:'media.list'},{type:'media.search',query:'a.jpg'},{type:'albums.media',id:album.id},{type:'tags.media',id:tag.id}]) {
      expect((await command(request)).find((row:any)=>row.id===item.id)?.metadata).toMatchObject({displayName:'我的名称',favorite:true,rating:4});
    }
  });
  it('marks location as manual only when a location value actually changes', async () => {
    const item=media[0];await command({type:'media.attributes',id:item.id,country:'CN',region:'上海',city:'上海'});
    db.prepare("UPDATE media_details SET metadata_json=json_set(metadata_json,'$.placeSource','nearby-city') WHERE media_id=?").run(item.id);
    await command({type:'media.attributes',id:item.id,country:'CN',region:'上海',city:'上海',rating:5,favorite:true});
    expect(rawMedia(db,item.id)?.metadata.placeSource).toBe('nearby-city');
    await command({type:'media.attributes',id:item.id,region:'江苏'});
    expect(rawMedia(db,item.id)?.metadata.placeSource).toBe('user');
  });
  it('indexes full playback scopes beyond the first page with matching filters and ordering', async () => {
    const source=media[0];
    const insert=db.prepare('INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,fingerprint,file_name) VALUES(?,?,?,?,?,?,?)');
    db.transaction(()=>{for(let index=0;index<202;index++)insert.run(`playlist-${index}`,path.join(library,`playlist-${String(index).padStart(3,'0')}.jpg`),'photo',source.sizeBytes,source.modifiedAtMs,`test-${index}`,`playlist-${String(index).padStart(3,'0')}.jpg`);})();
    const ordered=await command({type:'media.playlist',source:{scope:'library',sortBy:'name',sort:'asc'}});
    expect(ordered).toHaveLength(205);expect(await command({type:'media.list'})).toHaveLength(200);
    expect((await command({type:'media.playbackItems',mediaIds:[ordered[204]]}))[0].id).toBe(ordered[204]);
    await command({type:'tags.create',name:'播放标签'});
    const tag=(await command({type:'tags.list'})).find((row:any)=>row.name==='播放标签');
    await command({type:'media.addTag',id:ordered[0],tagName:'播放标签'});await command({type:'media.addTag',id:ordered[204],tagName:'播放标签'});
    const filtered=await command({type:'media.playlist',source:{scope:'library',tagNames:['播放标签'],sortBy:'name',sort:'asc'}});
    expect(filtered).toEqual([ordered[0],ordered[204]]);
    expect((await command({type:'media.playlist',source:{scope:'library',excludeTagNames:['播放标签']}}))).toHaveLength(203);
    expect(await command({type:'media.playlist',source:{scope:'tag',id:tag.id}})).toHaveLength(2);
    const album=await command({type:'albums.create',name:'全范围播放'});await command({type:'albums.addMedia',id:album.id,mediaIds:ordered});
    expect(await command({type:'media.playlist',source:{scope:'album',id:album.id}})).toHaveLength(205);
    const rule={relation:'AND',tags:[tag.id],notTags:[],excludedMediaIds:[]};const preview=await command({type:'smart.preview',rule});
    const smart=await command({type:'smart.save',name:'智能播放',rule,revision:preview.revision});
    expect(await command({type:'media.playlist',source:{scope:'album',id:smart.id}})).toHaveLength(2);
    await command({type:'media.hide',id:ordered[204]});
    expect(await command({type:'media.playlist',source:{scope:'tag',id:tag.id}})).toHaveLength(1);
    expect(await command({type:'media.playbackItems',mediaIds:[ordered[204]]})).toHaveLength(0);
    const [managed]=await command({type:'roots.list'});await command({type:'roots.setEnabled',id:managed.id,enabled:false});
    expect(await command({type:'media.playlist',source:{scope:'library'}})).toHaveLength(0);
  });
  it('persists bulk tag results and permits removal only for common tags', async () => {
    const ids=media.map((item)=>item.id);
    let started=await command({type:'jobs.start',kind:'tags',mediaIds:ids,tagName:'批量整理'});
    expect((await finished(started.id)).counts.completed).toBe(3);
    expect(await command({type:'media.tagSummary',mediaIds:ids})).toEqual([expect.objectContaining({name:'批量整理',count:3})]);
    await command({type:'media.addTag',id:ids[0],tagName:'只有一项'});
    await expect(command({type:'jobs.start',kind:'tags',mediaIds:ids,tagName:'只有一项',tagAction:'remove'})).rejects.toThrow('共有');
    started=await command({type:'jobs.start',kind:'tags',mediaIds:ids,tagName:'批量整理',tagAction:'remove'});
    expect((await finished(started.id)).status).toBe('completed');
    expect((await command({type:'media.tagSummary',mediaIds:ids})).map((tag:any)=>tag.name)).toEqual(['只有一项']);
  });
  it.runIf(process.platform==='win32')('syncs Hidden attributes only after opt-in and restores their original state', async () => {
    const file=media[0].absolutePath;const original=await readFile(file);const attributes=await windowsHiddenAttribute(file);
    await command({type:'media.hide',id:media[0].id});expect(await windowsHiddenAttribute(file)).toBe(attributes);
    await command({type:'media.unhide',id:media[0].id});
    const config=await command({type:'organization.settings'});await command({type:'organization.configure',...config,syncHidden:true});
    const hiding=await command({type:'media.hide',id:media[0].id});if(hiding.taskId)await until(async()=>!(await command({type:'jobs.result',id:hiding.taskId})).active);expect((await windowsHiddenAttribute(file))&2).toBe(2);
    expect(rawMedia(db,media[0].id)?.metadata.windowsHiddenOriginal).toBe(Boolean(attributes&2));
    // Disabling sync must not prevent restoring an already saved original bit.
    await command({type:'organization.configure',...config,syncHidden:false});await command({type:'media.unhide',id:media[0].id});
    await until(async()=>!(await command({type:'tasks.list',limit:200})).some((task:any)=>task.kind==='visibility'&&['queued','running'].includes(task.status)) && (db.prepare('SELECT COUNT(*) AS n FROM windows_visibility_queue').get() as {n:number}).n===0 && (await windowsHiddenAttribute(file))===attributes);expect(await windowsHiddenAttribute(file)).toBe(attributes);
    await windowsHiddenAttribute(file,true);
    await command({type:'organization.configure',...config,syncHidden:true});await command({type:'media.hide',id:media[0].id});await command({type:'media.unhide',id:media[0].id});
    expect((await windowsHiddenAttribute(file))&2).toBe(2);expect(await readFile(file)).toEqual(original);
    await windowsHiddenAttribute(file,Boolean(attributes&2));
  },25000);
  it('retries only unreadable scan files and preserves previous successful metadata', async () => {
    const broken=path.join(library,'broken.jpg'); await writeFile(broken,'not an image');
    const roots=await command({type:'roots.list'});
    const scanned=await command({type:'roots.scan',id:roots[0].id});
    const job=await command({type:'jobs.result',id:scanned.task.id});
    expect(job).toMatchObject({status:'failed',total:4,processed:4,detailTotal:1,counts:{completed:3,failed:1,pending:0}});
    expect(job.items[0].path).toBe(broken);
    await command({type:'media.addTag',id:media[0].id,tagName:'保留整理'});
    await sharp({create:{width:20,height:30,channels:3,background:'white'}}).jpeg().toFile(broken);
    await command({type:'jobs.control',id:job.id,action:'retry'});
    await until(async()=>{const result=await command({type:'jobs.result',id:job.id});return result.status==='completed'&&!result.active;});
    const result=await command({type:'jobs.result',id:job.id});
    expect(result).toMatchObject({processed:4,total:4,detailTotal:0,counts:{completed:4,failed:0}});
    expect((await command({type:'media.tags',id:media[0].id}))[0].name).toBe('保留整理');
    expect(await command({type:'media.list'})).toHaveLength(4);
  });

  it('exports custom names under the album folder without changing source files', async () => {
    const album=await command({type:'albums.create',name:'旅行:精选'});
    await command({type:'albums.addMedia',id:album.id,mediaIds:[media[0].id,media[1].id]});
    const before=await readFile(media[0].absolutePath);
    const {id}=await command({type:'jobs.start',kind:'export',albumId:album.id,directory:path.join(root,'custom-export'),naming:'custom',prefix:'旅行',byAlbum:true,xmp:true});
    const job=await finished(id); expect(job.status).toBe('completed');expect(job.items).toHaveLength(2);
    expect(path.basename(job.items[0].output)).toMatch(/^旅行_00[12]\.jpg$/u);
    expect(path.basename(path.dirname(job.items[0].output))).toBe('旅行_精选');
    expect(await readFile(media[0].absolutePath)).toEqual(before);
    expect(await readFile(`${job.items[0].output}.xmp`,'utf8')).toContain('x:xmpmeta');
  });
  it('uses dynamic AND/OR/NOT membership, stale preview checks and cover fallback', async () => {
    const a = await command({ type: 'tags.create', name: '旅行' }); const b = await command({ type: 'tags.create', name: '人物' });
    await command({ type: 'media.setTags', id: media[0].id, tagNames: ['旅行','人物'] });
    await command({ type: 'media.setTags', id: media[1].id, tagNames: ['旅行'] });
    await command({ type: 'media.setTags', id: media[2].id, tagNames: ['人物'] });
    const rule = { relation: 'AND', tags: [a.id,b.id], notTags: [], excludedMediaIds: [] };
    let preview = await command({ type: 'smart.preview', rule }); expect(preview.total).toBe(1);
    const album = await command({ type: 'smart.save', name: '智能旅行', rule, revision: preview.revision });
    expect(await command({ type: 'albums.media', id: album.id })).toHaveLength(1);
    await expect(command({ type: 'albums.addMedia', id: album.id, mediaIds: [media[1].id] })).rejects.toThrow('不能手动加入');
    await command({ type: 'albums.setCover', id: album.id, mediaId: media[0].id });
    preview = await command({ type: 'smart.preview', id: album.id, rule: { ...rule, relation: 'OR' } });
    expect(preview).toMatchObject({ total: 3, added: 2, removed: 0 }); expect(preview.addedSamples).toHaveLength(2);
    const changed = { ...rule, tags: [a.id], notTags: [b.id] };
    preview = await command({ type: 'smart.preview', id: album.id, rule: changed });
    await command({ type: 'media.addTag', id: media[2].id, tagName: '旅行' });
    // This mutation doesn't change A AND NOT B; create a mutation that does.
    await command({ type: 'media.addTag', id: media[1].id, tagName: '人物' });
    await expect(command({ type: 'smart.save', id: album.id, name: '智能旅行', rule: changed, revision: preview.revision })).rejects.toThrow('重新计算');
    await command({ type: 'media.removeTag', id: media[1].id, tagName: '人物' });
    preview = await command({ type: 'smart.preview', id: album.id, rule: changed });
    await command({ type: 'smart.save', id: album.id, name: '智能旅行', rule: changed, revision: preview.revision });
    expect((await command({ type: 'albums.list' }))[0].coverMode).toBe('auto');
    expect((await command({ type: 'albums.media', id: album.id }))[0].id).toBe(media[1].id);
  });

  it('blocks conflicting tag merges and atomically migrates valid smart rules', async () => {
    const a = await command({ type: 'tags.create', name: '旧标签' }); const b = await command({ type: 'tags.create', name: '目标标签' });
    await command({ type: 'media.addTag', id: media[0].id, tagName: '旧标签' });
    const rule = { relation: 'AND', tags: [a.id], notTags: [b.id], excludedMediaIds: [] };
    const preview = await command({ type: 'smart.preview', rule }); const album = await command({ type: 'smart.save', name: '冲突测试', rule, revision: preview.revision });
    let merge = await command({ type: 'tags.mergePreview', sourceId: a.id, targetId: b.id });
    expect(merge.conflicting).toEqual([album.id]);
    await expect(command({ type: 'tags.merge', sourceId: a.id, targetId: b.id, revision: merge.revision })).rejects.toThrow('冲突');
    expect(await command({ type: 'tags.list' })).toHaveLength(2);
    const validRule = { ...rule, notTags: [] };
    const valid = await command({ type: 'smart.preview', id: album.id, rule: validRule });
    await command({ type: 'smart.save', id: album.id, name: '冲突测试', rule: validRule, revision: valid.revision });
    merge = await command({ type: 'tags.mergePreview', sourceId: a.id, targetId: b.id });
    await command({ type: 'tags.merge', sourceId: a.id, targetId: b.id, revision: merge.revision });
    expect((await command({ type: 'albums.list' }))[0].rule.tags).toEqual([b.id]);
    expect((await command({ type: 'media.tags', id: media[0].id }))[0].id).toBe(b.id);
  });

  it('hides blacklisted tags across library, search, albums and footprints', async () => {
    const tag = await command({ type: 'tags.create', name: '隐藏标签' });
    await command({ type: 'media.addTag', id: media[0].id, tagName: '隐藏标签' });
    await command({ type: 'tags.options', id: tag.id, color: '#2874df', group: '地点', aliases: ['别名'], blocked: true });
    expect(await command({ type: 'media.list' })).toHaveLength(2);
    expect(await command({ type: 'hidden.list' })).toHaveLength(1);
    expect(await command({ type: 'media.search', query: '隐藏标签' })).toHaveLength(0);
    await expect(command({ type: 'media.delivery', mediaIds: [media[0].id] })).rejects.toThrow('隐藏');
  });

  it('moves files into software trash, preserves all metadata and refuses restore collisions', async () => {
    const item = media[0]; const original = await readFile(item.absolutePath);
    const album = await command({ type: 'albums.create', name: '保留整理' });
    await command({ type: 'albums.addMedia', id: album.id, mediaIds: [item.id] });
    await command({ type: 'media.addTag', id: item.id, tagName: '珍藏' });
    await command({ type: 'media.attributes', id: item.id, favorite: true, rating: 5, displayName: '我的照片' });
    expect(await command({ type: 'trash.put', mediaIds: [item.id] })).toEqual([{ id: item.id, ok: true }]);
    await expect(stat(item.absolutePath)).rejects.toThrow();
    expect(await command({ type: 'albums.media', id: album.id })).toHaveLength(0);
    const [entry] = await command({ type: 'trash.list' }); expect(await readFile(entry.storedPath)).toEqual(original);
    await writeFile(item.absolutePath, 'collision');
    expect((await command({ type: 'trash.restore', mediaIds: [item.id] }))[0].ok).toBe(false);
    expect(await readFile(item.absolutePath, 'utf8')).toBe('collision');
    await unlink(item.absolutePath);
    service.close(); closeDatabase(db); db = openDatabase(path.join(root, 'library.db')); service = new LibraryService(db, path.join(root, 'cache'));
    expect((await command({ type: 'trash.restore', mediaIds: [item.id] }))[0].ok).toBe(true);
    expect(await readFile(item.absolutePath)).toEqual(original);
    expect(rawMedia(db,item.id)?.metadata).toMatchObject({ favorite: true, rating: 5, displayName: '我的照片' });
    expect(await command({ type: 'media.tags', id: item.id })).toHaveLength(1);
    expect(await command({ type: 'albums.media', id: album.id })).toHaveLength(1);
  });

  it('snapshots expiry policy, freezes cleanup with selections and retains files on system-trash failure', async () => {
    const item = media[0]; await command({ type: 'trash.put', mediaIds: [item.id] });
    await command({ type: 'organization.configure', retentionDays: 7, expiryAction: 'permanent', watch: false, deleteMode: 'software' });
    expect(db.prepare('SELECT retention_days,expiry_action FROM trash_entries WHERE media_id=?').get(item.id)).toEqual({ retention_days: 30, expiry_action: 'system' });
    db.prepare("UPDATE trash_entries SET expires_at='2000-01-01T00:00:00.000Z'").run();
    expect(await command({ type: 'trash.expired', protectedIds: [item.id] })).toEqual([]);
    const results = await command({ type: 'trash.expired' }); expect(results[0].ok).toBe(false);
    const [entry] = await command({ type: 'trash.list' }); expect((await stat(entry.storedPath)).isFile()).toBe(true);
    await command({ type: 'trash.purge', mediaIds: [item.id], destination: 'permanent' });
    expect(await command({ type: 'trash.list' })).toHaveLength(0); await expect(stat(entry.storedPath)).rejects.toThrow();
  });

  it('exports with conflict-safe names, XMP and GPS removal without modifying originals', async () => {
    const item = media.find((item) => item.absolutePath.endsWith(`${path.sep}b.jpg`)); const original = await readFile(item.absolutePath);
    expect(await exifr.gps(original)).toBeTruthy();
    const directory = path.join(root, 'export'); await mkdir(directory); await writeFile(path.join(directory, 'b.jpg'), 'existing');
    const { id } = await command({ type: 'jobs.start', kind: 'export', mediaIds: [item.id], directory, stripGps: true, xmp: true });
    const result = await finished(id); expect(result.status).toBe('completed'); const output = result.items[0].output;
    expect(path.basename(output)).toBe('b (1).jpg'); expect(await exifr.gps(await readFile(output))).toBeUndefined();
    expect((await stat(`${output}.xmp`)).isFile()).toBe(true); expect(await readFile(item.absolutePath)).toEqual(original);
    expect(await readFile(path.join(directory, 'b.jpg'), 'utf8')).toBe('existing');
  });

  it('compares content hashes, not names, and never deletes duplicate originals', async () => {
    const { id } = await command({ type: 'jobs.start', kind: 'duplicates' }); expect((await finished(id)).status).toBe('completed');
    const groups = await command({ type: 'duplicates.list' }); expect(groups).toHaveLength(1); expect(groups[0]).toHaveLength(2);
    for (const item of media) expect((await stat(item.absolutePath)).isFile()).toBe(true);
  });

  it('extracts GPS, builds offline place groups and undoes auto organization', async () => {
    expect(nearbyPlace(39.9042,116.4074)?.country).toBe('CN');
    const { id } = await command({ type: 'jobs.start', kind: 'geo',geoTags:true,geoAlbums:true,geoLevel:'both' }); const job = await finished(id); expect(job.status).toBe('completed');
    const places = await command({ type: 'geo.places' }); expect(places.countries).toBe(1); expect(places.cities).toBeGreaterThan(0); expect(places.noLocation).toBe(1);
    expect(await command({ type: 'albums.list' })).toHaveLength(0);
    expect(job.geoRunId).toBeUndefined(); expect((await command({ type: 'geo.places' })).cities).toBeGreaterThan(0);
    expect(await command({type:'albums.list'})).toHaveLength(0);
    expect(await command({ type: 'media.list' })).toHaveLength(3);
  });

  it('watches recursive additions and preserves media identity and tags on rename', async () => {
    service.start(); const item = media[0]; await command({ type: 'media.addTag', id: item.id, tagName: '重命名保留' });
    const renamed = path.join(library, 'renamed.jpg'); await rename(item.absolutePath, renamed);
    await until(async () => (await command({ type: 'media.list' })).some((record: any) => record.id === item.id && record.absolutePath === renamed));
    expect((await command({ type: 'media.tags', id: item.id }))[0].name).toBe('重命名保留');
    await writeFile(path.join(library, 'nested/new.jpg'), await readFile(renamed));
    await until(async () => (await command({ type: 'media.list' })).length === 4);
  }, 20000);

  it('keeps success receipts when retrying a partially failed export', async () => {
    const missing=media[0]; const bytes=await readFile(missing.absolutePath); await unlink(missing.absolutePath);
    const directory=path.join(root,'partial-export');
    const {id}=await command({type:'jobs.start',kind:'export',mediaIds:media.map((item)=>item.id),directory});
    const first=await finished(id); expect(first.status).toBe('failed'); expect(first.counts).toMatchObject({completed:2,failed:1});
    const successful=first.items.filter((item:any)=>item.status==='completed').map((item:any)=>item.output);
    await writeFile(missing.absolutePath,bytes); await command({type:'jobs.control',id,action:'retry'});
    const retried=await finished(id); expect(retried.status).toBe('completed'); expect(retried.counts.completed).toBe(3);
    for(const output of successful) expect(retried.items.some((item:any)=>item.output===output)).toBe(true);
    const {readdir}=await import('node:fs/promises'); expect(await readdir(directory)).toHaveLength(3);
    expect((await command({type:'jobs.result',id,limit:1,offset:1})).items).toHaveLength(1);
    expect((db.prepare('SELECT length(payload_json) AS bytes FROM tasks WHERE id=?').get(id) as any).bytes).toBeLessThan(2048);
  });

  it('pauses and resumes persistent work after reopening the database', async () => {
    for(let index=0;index<20;index++) await writeFile(path.join(library,`more-${index}.jpg`),await readFile(media[0].absolutePath));
    await command({type:'roots.scan',id:(await command({type:'roots.list'}))[0].id});
    const {id}=await command({type:'jobs.start',kind:'duplicates'}); await command({type:'jobs.control',id,action:'pause'});
    await until(async()=>!(await command({type:'jobs.result',id})).active);
    const processed=(await command({type:'jobs.result',id})).processed;
    service.close();closeDatabase(db);db=openDatabase(path.join(root,'library.db'));service=new LibraryService(db,path.join(root,'cache'));
    await command({type:'jobs.control',id,action:'resume'}); const complete=await finished(id);
    expect(complete.status).toBe('completed');expect(complete.processed).toBe(complete.total);expect(complete.processed).toBeGreaterThanOrEqual(processed);
  });

  it('recovers a restore interrupted between the file move and database commit', async () => {
    const item=media[0];await command({type:'trash.put',mediaIds:[item.id]});
    const [entry]=await command({type:'trash.list'});
    const row=db.prepare('SELECT snapshot_json FROM trash_entries WHERE media_id=?').get(item.id) as any;
    const snapshot={...JSON.parse(row.snapshot_json),restoreTarget:item.absolutePath};
    db.prepare("UPDATE trash_entries SET state='restoring',snapshot_json=? WHERE media_id=?").run(JSON.stringify(snapshot),item.id);
    await rename(entry.storedPath,item.absolutePath);
    await service.organization.recycle.recover();
    expect(await command({type:'trash.list'})).toHaveLength(0);expect((await stat(item.absolutePath)).isFile()).toBe(true);
    expect(await command({type:'media.list'})).toHaveLength(3);
  });

  it('does not discard trashed files when their library root is removed', async () => {
    const item=media[0];await command({type:'trash.put',mediaIds:[item.id]});
    const [managed]=await command({type:'roots.list'});await command({type:'roots.remove',id:managed.id});
    const [entry]=await command({type:'trash.list'});expect((await stat(entry.storedPath)).isFile()).toBe(true);
    expect((await command({type:'trash.restore',mediaIds:[item.id]}))[0].ok).toBe(false);
    await command({type:'roots.addAndScan',absolutePath:library});
    expect((await command({type:'trash.restore',mediaIds:[item.id]}))[0].ok).toBe(true);
  });

  it('preserves manual places and existing organization when completing footprints', async () => {
    const item=media[0];await command({type:'media.addTag',id:item.id,tagName:'手动地点'});await command({type:'media.attributes',id:item.id,city:'我的地点',favorite:true,rating:4});
    const album=await command({type:'albums.edit',name:'我的相册'});await command({type:'albums.addMedia',id:album.id,mediaIds:[item.id]});
    const {id}=await command({type:'jobs.start',kind:'geo'});expect((await finished(id)).status).toBe('completed');
    expect(rawMedia(db,item.id)?.metadata).toMatchObject({city:'我的地点',favorite:true,rating:4});
    expect((await command({type:'media.tags',id:item.id})).map((tag:any)=>tag.name)).toEqual(['手动地点']);expect((await command({type:'albums.list'})).map((row:any)=>row.id)).toEqual([album.id]);
  });

  it('searches a large result without a SQL parameter overflow and pages stably', async () => {
    const insert=db.prepare('INSERT INTO media(id,absolute_path,file_name,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,?,\'photo\',1,1,?)');
    db.transaction(()=>{for(let index=0;index<35000;index++){const id=`bench-${String(index).padStart(5,'0')}`;insert.run(id,path.join(library,`${id}.jpg`),`${id}.jpg`,id);}})();
    const first=await command({type:'media.search',query:'bench',limit:200,offset:0,sortBy:'name',sort:'asc'});
    const last=await command({type:'media.search',query:'bench',limit:200,offset:34800,sortBy:'name',sort:'asc'});
    expect(first).toHaveLength(200);expect(last).toHaveLength(200);expect(first[0].id).toBe('bench-00000');expect(last.at(-1).id).toBe('bench-34999');
  });

  it('resolves aliases exactly and treats percent/underscore in filename filters literally', async () => {
    const tag=await command({type:'tags.create',name:'旅行'});
    await command({type:'tags.options',id:tag.id,color:'#2874df',group:'地点',aliases:['旅拍'],blocked:false});
    await command({type:'media.addTag',id:media[0].id,tagName:'旅拍'});
    expect(await command({type:'tags.list'})).toHaveLength(1);
    expect(await command({type:'media.search',query:'',tagNames:['旅拍']})).toHaveLength(1);
    expect(await command({type:'media.search',query:'',tagNames:['旅']})).toHaveLength(0);
    expect(await command({type:'media.search',query:'',fileNames:['%']})).toHaveLength(0);
    expect(await command({type:'media.search',query:'',excludeTagNames:['旅拍']})).toHaveLength(2);
  });

  it('updates ordinary album text, bound tags and cover atomically', async () => {
    const album=await command({type:'albums.edit',name:'完整编辑',description:'初始',tagIds:[]});
    await command({type:'albums.addMedia',id:album.id,mediaIds:[media[0].id]});
    const tag=await command({type:'tags.create',name:'相册分类'});
    await command({type:'albums.edit',id:album.id,name:'完整编辑',description:'已编辑',tagIds:[tag.id],coverMediaId:media[0].id});
    await expect(command({type:'albums.edit',id:album.id,name:'不应保存',description:'错误',tagIds:[tag.id],coverMediaId:media[1].id})).rejects.toThrow('封面');
    const saved=(await command({type:'albums.list'})).find((candidate:any)=>candidate.id===album.id);
    expect(saved).toMatchObject({name:'完整编辑',description:'已编辑',tagIds:[tag.id],manualCoverMediaId:media[0].id,mediaCount:1});
  });
  it('applies ordinary album tags to existing and future nested members without removing independent tags',async()=>{
    const parent=await command({type:'tags.create',name:'相册父标签'}),child=await command({type:'tags.create',name:'相册子标签',parentId:parent.id});
    const album=await command({type:'albums.edit',name:'父相册'}),nested=await command({type:'albums.edit',name:'子相册'});
    db.prepare('UPDATE albums SET parent_id=? WHERE id=?').run(album.id,nested.id);
    await command({type:'albums.addMedia',id:nested.id,mediaIds:[media[0].id]});await command({type:'media.addTag',id:media[0].id,tagName:'手动标签'});await command({type:'media.hide',id:media[0].id});
    await command({type:'albums.edit',id:album.id,name:'父相册',tagIds:[child.id]});
    expect((await command({type:'media.tags',id:media[0].id})).map((tag:any)=>tag.name).sort()).toEqual(['手动标签','相册父标签','相册子标签'].sort());
    await command({type:'albums.addMedia',id:nested.id,mediaIds:[media[1].id]});expect((await command({type:'media.tags',id:media[1].id})).map((tag:any)=>tag.name).sort()).toEqual(['相册父标签','相册子标签'].sort());
    await command({type:'albums.edit',id:album.id,name:'父相册',tagIds:[]});await command({type:'albums.removeMedia',id:nested.id,mediaIds:[media[0].id]});await command({type:'albums.delete',id:album.id});expect((await command({type:'media.tags',id:media[0].id})).map((tag:any)=>tag.name).sort()).toEqual(['手动标签','相册父标签','相册子标签'].sort());
    await expect(command({type:'albums.edit',id:nested.id,name:'子相册',tagIds:[child.id],coverMediaId:media[2].id})).rejects.toThrow('封面');expect((await command({type:'albums.list'})).find((row:any)=>row.id===nested.id).tagIds).toEqual([]);
  });
  it('filters hidden collections across search, statistics, timeline and playback without leaking visible or disabled media',async()=>{
    const a=media.find(row=>row.absolutePath===path.join(library,'a.jpg'))!,b=media.find(row=>row.absolutePath===path.join(library,'b.jpg'))!;
    const tag:any=await command({type:'tags.create',name:'隐藏筛选'});
    await command({type:'media.addTag',id:a.id,tagName:tag.name});await command({type:'tags.setHidden',id:tag.id,hidden:true});await command({type:'media.hide',id:b.id});
    const scope={hiddenOnly:true,query:'',sortBy:'fileTime',sort:'desc'};
    const rows=await command({...scope,type:'media.search'});expect(rows.map((row:any)=>row.id).sort()).toEqual([a.id,b.id].sort());
    expect((await command({...scope,type:'media.filteredStats'})).total).toBe(2);
    expect((await command({...scope,type:'media.timeline'})).reduce((sum:number,row:any)=>sum+row.count,0)).toBe(2);
    const ids=await command({type:'media.playlist',source:{...scope,scope:'library'}});expect(ids).toEqual(rows.map((row:any)=>row.id));
    expect(await command({type:'media.playbackItems',mediaIds:ids,includeHidden:true})).toHaveLength(2);expect(await command({type:'media.playbackItems',mediaIds:ids})).toHaveLength(0);
    expect((await command({...scope,type:'media.search',fileNames:['a.jpg']}))).toHaveLength(1);
    const job=await command({type:'jobs.start',kind:'tags',mediaIds:ids,tagName:'隐藏中编辑',tagAction:'add'});expect((await finished(job.id)).status).toBe('completed');
    const roots=await command({type:'roots.list'});await command({type:'roots.setEnabled',id:roots[0].id,enabled:false});expect(await command({...scope,type:'media.search'})).toHaveLength(0);expect(await command({type:'media.playbackItems',mediaIds:ids,includeHidden:true})).toHaveLength(0);
  });
  it('ignores unchanged and irrelevant watcher events without adding scan tasks or emitting refresh notifications',async()=>{
    const {scanDirectory}=await import('./index.js');const [{id}]=await command({type:'roots.list'});const before=await command({type:'tasks.list',limit:200});let notifications=0;
    await writeFile(path.join(library,'notes.txt'),'unrelated');
    const result=await scanDirectory(db,library,{rootId:id,changedPaths:[path.join(library,'a.jpg'),path.join(library,'notes.txt')],notify:()=>notifications++});
    expect(result.media).toHaveLength(0);expect(await command({type:'tasks.list',limit:200})).toEqual(before);expect(notifications).toBe(0);
    await unlink(path.join(library,'a.jpg'));await scanDirectory(db,library,{rootId:id,changedPaths:[path.join(library,'a.jpg')],notify:()=>notifications++});expect(notifications).toBe(1);expect(await command({type:'media.search',query:'a.jpg'})).toHaveLength(1);
    await scanDirectory(db,library,{rootId:id,changedPaths:[path.join(library,'a.jpg')],notify:()=>notifications++});expect(notifications).toBe(1);
    await writeFile(path.join(library,'new.jpg'),await readFile(path.join(library,'b.jpg')));await scanDirectory(db,library,{rootId:id,changedPaths:[path.join(library,'new.jpg')]});expect(await command({type:'media.search',query:'new.jpg'})).toHaveLength(1);
  });

});
