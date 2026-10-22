import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,copyFile,writeFile,rename,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {openDatabase,closeDatabase,schemaVersion,saveDirectoryConfiguration,applyDirectoryRules,directoryRuleContext,createTag,addTagReference,type LuminaDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';
let temp:string,root:string,db:LuminaDatabase,service:LibraryService,bytes:Buffer;
const command=(request:unknown):Promise<any>=>service.handle(request);
async function done(id:string){for(let i=0;i<1000;i++){const job=await command({type:'jobs.result',id});if(!job.active && ['completed','failed','cancelled','paused'].includes(job.status)){expect(job.status,job.error).toBe('completed');return job;}await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('directory task timeout');}
async function configure(options:any={}){const old=(await command({type:'roots.list'})).find((row:any)=>row.absolutePath===root);const result=await command({type:'roots.configure',absolutePath:root,id:old?.id,label:'图库',autoAlbums:false,hierarchy:false,rules:[{relativePath:'',name:'旅行'},{relativePath:'child',name:'海边'},{relativePath:'child/deep',name:'日落'}],...options});if(result.taskId)await done(result.taskId);return result;}
beforeEach(async()=>{temp=await mkdtemp(path.join(os.tmpdir(),'lumina-directory-'));root=path.join(temp,'photos');await mkdir(path.join(root,'child','deep'),{recursive:true});await mkdir(path.join(root,'empty'));bytes=await sharp({create:{width:80,height:60,channels:3,background:'blue'}}).jpeg().toBuffer();await writeFile(path.join(root,'root.jpg'),bytes);await writeFile(path.join(root,'child','child.jpg'),bytes);await writeFile(path.join(root,'child','deep','deep.jpg'),bytes);await writeFile(path.join(root,'notes.txt'),'not a media');db=openDatabase(path.join(temp,'library.db'));service=new LibraryService(db,path.join(temp,'cache'));});
afterEach(async()=>{service.close();closeDatabase(db);await rm(temp,{recursive:true,force:true,maxRetries:5});});
it('previews recursive totals and small thumbnails without registering or indexing the root',async()=>{
 const preview=await command({type:'roots.preview',absolutePath:root});expect(preview).toMatchObject({fileCount:4,mediaCount:3,photo:3,video:0});expect(preview.directories).toHaveLength(4);expect(preview.directories.find((row:any)=>row.relativePath==='child').mediaCount).toBe(2);expect(preview.samples).toHaveLength(3);expect(preview.samples.every((row:any)=>row.preview.startsWith('data:image/jpeg;base64,'))).toBe(true);expect(await command({type:'roots.list'})).toHaveLength(0);expect(await command({type:'media.list'})).toHaveLength(0);
});
it('edits indexed directories offline without rescanning, preserves empty paths and skips unchanged/name-only jobs',async()=>{
 const {root:managed}=await configure();const before=db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE kind='scan'").get();
 await rename(root,root+'-offline');
 const preview=await command({type:'roots.preview',id:managed.id,absolutePath:root});expect(preview.source).toBe('index');expect(preview.mediaCount).toBe(3);expect(preview.directories.some((row:any)=>row.relativePath==='empty')).toBe(true);
 const first=await configure({label:'新目录名'});expect(first.taskId).toBeUndefined();const count=db.prepare('SELECT COUNT(*) AS count FROM tasks').get();
 await configure({label:'新目录名'});expect(db.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual(count);
 const result=await configure({rules:[{relativePath:'',name:'离线整理'}],autoAlbums:true,hierarchy:true});expect(result.taskId).toBeTruthy();expect((await command({type:'jobs.result',id:result.taskId})).phase).toBe('整理已索引媒体');
 for(const item of await command({type:'media.list'}))expect((await command({type:'media.tags',id:item.id})).map((tag:any)=>tag.name)).toEqual(['离线整理']);
 expect(db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE kind='scan'").get()).toEqual(before);expect((await command({type:'albums.list'})).some((album:any)=>album.name==='empty')).toBe(true);
 await expect(command({type:'roots.preview',id:managed.id,absolutePath:root,refresh:true})).rejects.toThrow();
});
it('only imports new files on an explicit scan, and explicitly refreshing a preview does not index files',async()=>{
 const {root:managed}=await configure();await mkdir(path.join(root,'new-empty'));await writeFile(path.join(root,'new.jpg'),bytes);
 let preview=await command({type:'roots.preview',id:managed.id,absolutePath:root});expect(preview.mediaCount).toBe(3);expect(preview.directories.some((row:any)=>row.relativePath==='new-empty')).toBe(false);
 preview=await command({type:'roots.preview',id:managed.id,absolutePath:root,refresh:true});expect(preview.source).toBe('disk');expect(preview.mediaCount).toBe(4);expect(await command({type:'media.list'})).toHaveLength(3);
 await configure({autoAlbums:true,hierarchy:true,rules:[{relativePath:'',name:'更新规则'}]});expect(await command({type:'media.list'})).toHaveLength(3);expect((await command({type:'albums.list'})).some((album:any)=>album.name==='new-empty')).toBe(true);
 await command({type:'roots.scan',id:managed.id});const [added]=await command({type:'media.search',query:'new.jpg'});expect((await command({type:'media.tags',id:added.id})).map((tag:any)=>tag.name)).toEqual(['更新规则']);
 service.close();closeDatabase(db);db=openDatabase(path.join(temp,'library.db'));service=new LibraryService(db);preview=await command({type:'roots.preview',id:managed.id,absolutePath:root});expect(preview.mediaCount).toBe(4);expect(preview.directories.some((row:any)=>row.relativePath==='new-empty')).toBe(true);
 await command({type:'roots.remove',id:managed.id});expect(db.prepare('SELECT 1 FROM settings WHERE key=?').get(`directory-paths:${managed.id}`)).toBeUndefined();
});
it('derives legacy directory previews from indexed ancestors and rejects newly introduced symbolic-link paths',async()=>{
 const {root:managed}=await command({type:'roots.addAndScan',absolutePath:root});const preview=await command({type:'roots.preview',id:managed.id,absolutePath:root});expect(preview.source).toBe('index');expect(preview.directories.map((row:any)=>row.relativePath)).toEqual(['','child','child/deep']);
 await mkdir(path.join(root,'new-empty'));await configure({rules:[{relativePath:'new-empty',name:'新目录标签'}]});expect((await command({type:'roots.configuration',id:managed.id})).rules).toHaveLength(1);
 const {symlink}=await import('node:fs/promises');await symlink(path.join(root,'child'),path.join(root,'linked'),process.platform==='win32'?'junction':'dir');
 await expect(configure({rules:[{relativePath:'linked/deep',name:'不允许链接'}]})).rejects.toThrow('实际目录');
 await expect(command({type:'roots.preview',id:managed.id,absolutePath:path.join(root,'child')})).rejects.toThrow('目录已变化');
});
it.each(['directory-rules','scan','tags','duplicates','similar','geo','export','delete','restore','purge','visibility','thumbnail','video-preview'])('cancels a paused %s task without changing completed progress',async(kind)=>{
 const id='paused-'+kind;db.prepare("INSERT INTO tasks(id,kind,status,total,processed,payload_json) VALUES(?,?,'paused',3,1,'{}')").run(id,kind);
 if(kind==='directory-rules')db.prepare("INSERT INTO tasks(id,kind,status,total,processed,payload_json) VALUES(?,'scan','paused',3,1,'{}')").run(id+'-scan');
 await command({type:'jobs.control',id,action:'cancel'});expect(db.prepare('SELECT status,processed FROM tasks WHERE id=?').get(id)).toEqual({status:'cancelled',processed:1});
 if(kind==='directory-rules')expect(db.prepare('SELECT status FROM tasks WHERE id=?').get(id+'-scan')).toEqual({status:'cancelled'});
});
it('recursively applies parent/child rules and automatically inherits them on incremental additions and restart',async()=>{
 const {root:managed}=await configure();const tags=await command({type:'tags.list'}),parent=tags.find((row:any)=>row.name==='旅行'),child=tags.find((row:any)=>row.name==='海边'),deep=tags.find((row:any)=>row.name==='日落');expect(child.parentIds).toEqual([parent.id]);expect(deep.parentIds).toEqual([child.id]);expect(tags.every((row:any)=>row.directory)).toBe(true);
 const media=await command({type:'media.list'});for(const item of media){const names=(await command({type:'media.tags',id:item.id})).map((row:any)=>row.name);expect(names).toContain('旅行');if(item.absolutePath.includes(path.sep+'child'+path.sep))expect(names).toContain('海边');if(item.absolutePath.includes('deep.jpg'))expect(names).toContain('日落');}
 await writeFile(path.join(root,'child','new.jpg'),bytes);const {scanDirectory}=await import('./index.js');await scanDirectory(db,root,{rootId:managed.id,changedPaths:[path.join(root,'child','new.jpg')]});const [added]=await command({type:'media.search',query:'new.jpg'});expect((await command({type:'media.tags',id:added.id})).map((row:any)=>row.name).sort()).toEqual(['旅行','海边'].sort());
 service.close();closeDatabase(db);db=openDatabase(path.join(temp,'library.db'));service=new LibraryService(db);await writeFile(path.join(root,'child','deep','after-restart.jpg'),bytes);await command({type:'roots.scan',id:managed.id});const [after]=await command({type:'media.search',query:'after-restart.jpg'});expect(await command({type:'media.tags',id:after.id})).toHaveLength(3);
});
it('keeps ordinary tags and manual applications when directory rules change, and removes stale directory inheritance on file moves',async()=>{
 const {root:managed}=await configure();const media=await command({type:'media.list'}),deep=media.find((row:any)=>row.absolutePath.endsWith('deep.jpg'));await command({type:'media.addTag',id:deep.id,tagName:'普通标签'});await command({type:'media.addTag',id:deep.id,tagName:'海边普通'});
 await configure({rules:[{relativePath:'',name:'归档'},{relativePath:'child',name:'新子标签'}]});expect((await command({type:'media.tags',id:deep.id})).map((row:any)=>row.name).sort()).toEqual(['普通标签','海边普通','归档','新子标签'].sort());
 await rename(deep.absolutePath,path.join(root,'moved.jpg'));await command({type:'roots.scan',id:managed.id});const [moved]=await command({type:'media.search',query:'moved.jpg'});expect(moved.id).toBe(deep.id);expect((await command({type:'media.tags',id:moved.id})).map((row:any)=>row.name).sort()).toEqual(['普通标签','海边普通','归档'].sort());
 await configure({rules:[]});expect((await command({type:'media.tags',id:moved.id})).map((row:any)=>row.name).sort()).toEqual(['普通标签','海边普通'].sort());expect((db.prepare('SELECT COUNT(*) AS n FROM directory_rules').get() as {n:number}).n).toBe(0);
});
it('creates navigable album hierarchy once, includes empty folders, and syncs added/moved media',async()=>{
 const {root:managed}=await configure({autoAlbums:true,hierarchy:true});let albums=await command({type:'albums.list'});expect(albums).toHaveLength(4);const parent=albums.find((row:any)=>!row.parentId),child=albums.find((row:any)=>row.name==='child'),deep=albums.find((row:any)=>row.name==='deep');expect(child.parentId).toBe(parent.id);expect(deep.parentId).toBe(child.id);expect(parent.mediaCount).toBe(3);expect(child.mediaCount).toBe(2);expect(deep.mediaCount).toBe(1);
 await configure({autoAlbums:true,hierarchy:true});expect((await command({type:'albums.list'})).map((row:any)=>row.id).sort()).toEqual(albums.map((row:any)=>row.id).sort());await mkdir(path.join(root,'new-folder'));await writeFile(path.join(root,'new-folder','new.jpg'),bytes);await command({type:'roots.scan',id:managed.id});albums=await command({type:'albums.list'});const fresh=albums.find((row:any)=>row.name==='new-folder');expect(fresh.parentId).toBe(parent.id);expect(fresh.mediaCount).toBe(1);expect(albums.find((row:any)=>row.id===parent.id).mediaCount).toBe(4);
 const [photo]=await command({type:'albums.media',id:deep.id});await rename(photo.absolutePath,path.join(root,'moved.jpg'));await command({type:'roots.scan',id:managed.id});expect(await command({type:'albums.media',id:deep.id})).toHaveLength(0);
 await configure({rules:[],autoAlbums:false,hierarchy:false});expect((await command({type:'albums.list'})).find((row:any)=>row.id===parent.id).mediaCount).toBe(4);
});
it('offers a single recursive album without hierarchy and applies rules to disabled roots without changing originals',async()=>{
 const {root:managed}=await configure({autoAlbums:true});expect(await command({type:'albums.list'})).toHaveLength(1);await command({type:'roots.setEnabled',id:managed.id,enabled:false});await configure({rules:[{relativePath:'',name:'停用目录标签'}],autoAlbums:true});const ids=await command({type:'roots.mediaIds',id:managed.id});expect(ids).toHaveLength(3);for(const id of ids)expect((await command({type:'media.tags',id})).map((row:any)=>row.name)).toEqual(['停用目录标签']);expect(await readFile(path.join(root,'root.jpg'))).toEqual(bytes);
});
it('rejects escaping, cyclic or over-depth rules atomically and protects managed tags from direct deletion or reference moves',async()=>{
 const {root:managed}=await configure();const before=await command({type:'roots.configuration',id:managed.id});await expect(command({type:'roots.configure',id:managed.id,absolutePath:root,label:'图库',autoAlbums:false,hierarchy:false,rules:[{relativePath:'../elsewhere',name:'越界'}]})).rejects.toThrow();expect(await command({type:'roots.configuration',id:managed.id})).toEqual(before);
 expect(()=>saveDirectoryConfiguration(db,managed.id,{autoAlbums:false,hierarchy:false,rules:[{relativePath:'',name:'相同'},{relativePath:'child',name:'相同'}]})).toThrow('同一个标签');expect(await command({type:'roots.configuration',id:managed.id})).toEqual(before);
 const tags=await command({type:'tags.list'}),parent=tags.find((row:any)=>row.name==='旅行'),child=tags.find((row:any)=>row.name==='海边');await expect(command({type:'tags.delete',id:parent.id})).rejects.toThrow('目录');await expect(command({type:'tags.moveReference',id:child.id,fromParentId:parent.id,parentId:null})).rejects.toThrow('目录');
 let previous=parent.id;for(let i=0;i<4;i++){const id=createTag(db,`外部层级${i}`,'directory');addTagReference(db,id,previous);previous=id;}expect(()=>saveDirectoryConfiguration(db,managed.id,{autoAlbums:false,hierarchy:false,rules:[{relativePath:'',name:'外部层级3'},{relativePath:'child',name:'第六级'}]})).toThrow('5 级');expect(await command({type:'roots.configuration',id:managed.id})).toEqual(before);
});
it('returns directory tags before ordinary tags for bounded hover queries and protects them from media tag removal',async()=>{
 await configure();const media=await command({type:'media.list'}),deep=media.find((row:any)=>row.absolutePath.endsWith('deep.jpg'));await command({type:'media.addTag',id:deep.id,tagName:'AAA普通'});const result=await command({type:'media.cardTags',mediaIds:[deep.id]});expect(result[deep.id]).toHaveLength(4);expect(result[deep.id].slice(0,3).every((row:any)=>row.directory)).toBe(true);expect(result[deep.id].at(-1).name).toBe('AAA普通');await expect(command({type:'media.removeTag',id:deep.id,tagName:'日落'})).rejects.toThrow('目录规则');await command({type:'media.setTags',id:deep.id,tagNames:[]});expect(await command({type:'media.tags',id:deep.id})).toHaveLength(3);
});
it('upgrades schema 7 once with a consistent backup while preserving media, manual tags and existing albums',async()=>{
 await command({type:'roots.addAndScan',absolutePath:root});const [media]=await command({type:'media.list'});await command({type:'media.addTag',id:media.id,tagName:'旧标签'});const album=await command({type:'albums.create',name:'旧相册'});await command({type:'albums.addMedia',id:album.id,mediaIds:[media.id]});db.prepare('DELETE FROM schema_migrations WHERE version>=8').run();db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES(7)').run();service.close();closeDatabase(db);db=openDatabase(path.join(temp,'library.db'));service=new LibraryService(db);expect(schemaVersion).toBe(11);expect((await readdir(temp)).some(name=>name.includes('.pre-m2-'))).toBe(true);expect((await command({type:'media.tags',id:media.id}))[0].name).toBe('旧标签');expect(await command({type:'albums.media',id:album.id})).toHaveLength(1);const before=(await readdir(temp)).filter(name=>name.includes('.pre-m2-')).length;service.close();closeDatabase(db);db=openDatabase(path.join(temp,'library.db'));service=new LibraryService(db);expect((await readdir(temp)).filter(name=>name.includes('.pre-m2-')).length).toBe(before);
});
it('pauses, persists after restart, resumes and cancels directory jobs without losing saved rules',async()=>{
 for(let i=0;i<120;i++)await writeFile(path.join(root,`extra-${i}.jpg`),bytes);
 const first=await command({type:'roots.configure',absolutePath:root,label:'可恢复目录',autoAlbums:true,hierarchy:true,rules:[{relativePath:'',name:'持久目录'}]});
 await command({type:'jobs.control',id:first.taskId,action:'pause'});
 async function stopped(id:string,status:string){for(let i=0;i<1000;i++){const job=await command({type:'jobs.result',id});if(!job.active){expect(job.status).toBe(status);return;}await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('stop timeout');}
 await stopped(first.taskId,'paused');expect((await command({type:'roots.configuration',id:first.root.id})).rules[0].name).toBe('持久目录');
 service.close();closeDatabase(db);db=openDatabase(path.join(temp,'library.db'));service=new LibraryService(db);
 expect((await command({type:'jobs.result',id:first.taskId})).status).toBe('paused');await command({type:'jobs.control',id:first.taskId,action:'resume'});const completed=await done(first.taskId);expect(completed.total).toBe(123);expect((await command({type:'tags.list'})).find((tag:any)=>tag.name==='持久目录').count).toBe(123);
 const second=await command({type:'roots.configure',id:first.root.id,absolutePath:root,label:'可恢复目录',autoAlbums:false,hierarchy:false,rules:[{relativePath:'',name:'持久目录'}]});await command({type:'jobs.control',id:second.taskId,action:'cancel'});await stopped(second.taskId,'cancelled');expect((await command({type:'roots.configuration',id:first.root.id})).rules).toHaveLength(1);expect(await readFile(path.join(root,'root.jpg'))).toEqual(bytes);
});
it('preserves existing child album contents when hierarchical automatic updates are switched off',async()=>{
 await configure({autoAlbums:true,hierarchy:true});const child=(await command({type:'albums.list'})).find((album:any)=>album.name==='child');expect(child.mediaCount).toBe(2);
 await configure({autoAlbums:true,hierarchy:false});expect((await command({type:'albums.list'})).find((album:any)=>album.id===child.id).mediaCount).toBe(2);
 await writeFile(path.join(root,'child','new-single-only.jpg'),bytes);await command({type:'roots.scan',id:(await command({type:'roots.list'}))[0].id});expect((await command({type:'albums.list'})).find((album:any)=>album.id===child.id).mediaCount).toBe(2);
 await configure({autoAlbums:true,hierarchy:true});expect((await command({type:'albums.list'})).find((album:any)=>album.id===child.id).mediaCount).toBe(3);
});
it('combines overlapping root rules and preserves remaining rules when one root is removed',async()=>{
 const {root:parent}=await configure();const sub=path.join(root,'child');const nested=await command({type:'roots.configure',absolutePath:sub,label:'子图库',autoAlbums:false,hierarchy:false,rules:[{relativePath:'',name:'另一目录标签'}]});await done(nested.taskId);
 let [photo]=await command({type:'media.search',query:'child.jpg'});expect((await command({type:'media.tags',id:photo.id})).map((tag:any)=>tag.name).sort()).toEqual(['旅行','海边','另一目录标签'].sort());
 await command({type:'media.addTag',id:photo.id,tagName:'重叠目录手动标签'});const stableId=photo.id;await command({type:'roots.remove',id:nested.root.id});[photo]=await command({type:'media.search',query:'child.jpg'});expect(photo.id).toBe(stableId);expect((await command({type:'media.tags',id:photo.id})).map((tag:any)=>tag.name).sort()).toEqual(['旅行','海边','重叠目录手动标签'].sort());
});
it('supports several directory tags without taking an ordinary name, and limits ordinary album tags to ordinary labels',async()=>{
 const ordinary=await command({type:'tags.create',name:'旅行'});await command({type:'roots.addAndScan',absolutePath:root});const media=await command({type:'media.list'});await command({type:'media.addTag',id:media[0].id,tagName:ordinary.name});
 const saved=await configure({rules:[{relativePath:'',name:'旅行'},{relativePath:'',name:'精选目录'},{relativePath:'child',name:'子标签甲'},{relativePath:'child',name:'子标签乙'}],autoAlbums:true,hierarchy:true});
 const config=await command({type:'roots.configuration',id:saved.root.id});expect(config.rules).toHaveLength(4);expect(config.rules.filter((row:any)=>row.relativePath==='').map((row:any)=>row.name).sort()).toEqual(['旅行（目录）','精选目录'].sort());
 const tags=await command({type:'tags.list'});expect(tags.find((row:any)=>row.id===ordinary.id).directory).toBe(false);const directory=tags.find((row:any)=>row.name==='旅行（目录）');expect(directory.directory).toBe(true);expect(directory.id).not.toBe(ordinary.id);
 const deep=media.find((row:any)=>row.absolutePath.endsWith('deep.jpg'));expect((await command({type:'media.tags',id:deep.id})).map((row:any)=>row.name)).toEqual(expect.arrayContaining(['旅行（目录）','精选目录','子标签甲','子标签乙']));
 const a=tags.find((row:any)=>row.name==='子标签甲');expect(a.parentIds.sort()).toEqual(config.rules.filter((row:any)=>row.relativePath==='').map((row:any)=>row.tagId).sort());
 const album=(await command({type:'albums.list'})).find((row:any)=>!row.parentId);await expect(command({type:'albums.edit',id:album.id,name:album.name,description:'',tagIds:[directory.id]})).rejects.toThrow('只能使用普通标签');
 await command({type:'albums.edit',id:album.id,name:album.name,description:'',tagIds:[ordinary.id]});expect((await command({type:'tags.list'})).find((row:any)=>row.id===ordinary.id).directory).toBe(false);
 await writeFile(path.join(root,'child','future.jpg'),bytes);await command({type:'roots.scan',id:saved.root.id});const [future]=await command({type:'media.search',query:'future.jpg'});expect((await command({type:'media.tags',id:future.id})).map((row:any)=>row.name)).toEqual(expect.arrayContaining(['旅行','旅行（目录）','精选目录','子标签甲','子标签乙']));
 const stable=config.rules.map((row:any)=>({relativePath:row.relativePath,name:row.name}));const unchanged=await configure({rules:stable.reverse(),autoAlbums:true,hierarchy:true});expect(unchanged.taskId).toBeUndefined();
 await configure({rules:stable.filter((row:any)=>row.name!=='精选目录'),autoAlbums:true,hierarchy:true});expect((await command({type:'media.tags',id:future.id})).map((row:any)=>row.name)).not.toContain('精选目录');expect((await command({type:'media.tags',id:future.id})).map((row:any)=>row.name)).toContain('旅行');
});
it('rejects adding the same directory again in preview and commit paths without creating work or changing settings',async()=>{
 const {root:managed}=await configure();const count=db.prepare('SELECT COUNT(*) AS n FROM tasks').get(),config=await command({type:'roots.configuration',id:managed.id});
 await expect(command({type:'roots.preview',absolutePath:root})).rejects.toThrow('该目录已添加');
 await expect(command({type:'roots.addAndScan',absolutePath:root.toUpperCase()+'\\'})).rejects.toThrow('该目录已添加');
 await expect(command({type:'roots.configure',absolutePath:root,label:'不应修改',autoAlbums:true,hierarchy:true,rules:[]})).rejects.toThrow('该目录已添加');
 expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual(count);expect(await command({type:'roots.configuration',id:managed.id})).toEqual(config);
});
it('changing only album options preserves tag rows and resuming skips completed directory items',async()=>{
 const {root:managed}=await configure();db.transaction(()=>{const insert=db.prepare("INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,'photo',1,1,?)");for(let i=0;i<180;i++)insert.run(`extra-${i}`,path.join(root,`extra-${i}.jpg`),`extra-${i}`);})();
 db.exec("CREATE TABLE qa_replayed(n INTEGER);CREATE TRIGGER qa_directory_replayed AFTER UPDATE OF status ON job_items WHEN OLD.status='completed' AND NEW.status='completed' BEGIN INSERT INTO qa_replayed VALUES(1);END;");
 const job=await command({type:'roots.configure',id:managed.id,absolutePath:root,label:'图库',autoAlbums:true,hierarchy:true,rules:(await command({type:'roots.configuration',id:managed.id})).rules});await command({type:'jobs.control',id:job.taskId,action:'pause'});
 for(let i=0;i<1000&&service.directories.isActive(job.taskId);i++)await new Promise(resolve=>setTimeout(resolve,2));
 const paused=await command({type:'jobs.result',id:job.taskId});expect(paused.processed).toBeGreaterThan(0);expect(paused.processed).toBeLessThan(paused.total);
 await command({type:'jobs.control',id:job.taskId,action:'resume'});const completed=await done(job.taskId);expect(completed.processed).toBe(completed.total);expect(db.prepare('SELECT COUNT(*) AS n FROM qa_replayed').get()).toEqual({n:0});
});

it('rebuilds deleted main and child directory albums on identical settings without scanning or rewriting tags',async()=>{
 const saved=await configure({autoAlbums:true,hierarchy:true});let albums=await command({type:'albums.list'});const parent=albums.find((row:any)=>!row.parentId),child=albums.find((row:any)=>row.name==='child'),deep=albums.find((row:any)=>row.name==='deep');
 await command({type:'albums.delete',id:parent.id});await command({type:'albums.delete',id:child.id});
 const scans=db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='scan'").get();
 db.exec("CREATE TABLE qa_tag_writes(n INTEGER);CREATE TRIGGER qa_tag_write AFTER INSERT ON media_tags BEGIN INSERT INTO qa_tag_writes VALUES(1);END;");
 const repair=await configure({autoAlbums:true,hierarchy:true});expect(repair.taskId).toBeTruthy();albums=await command({type:'albums.list'});const restoredParent=albums.find((row:any)=>!row.parentId),restoredChild=albums.find((row:any)=>row.name==='child');
 expect(restoredParent).toBeTruthy();expect(restoredChild.parentId).toBe(restoredParent.id);expect(albums.find((row:any)=>row.id===deep.id).parentId).toBe(restoredChild.id);expect(restoredParent.mediaCount).toBe(3);expect(restoredChild.mediaCount).toBe(2);
 expect(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='scan'").get()).toEqual(scans);expect(db.prepare('SELECT COUNT(*) AS n FROM qa_tag_writes').get()).toEqual({n:0});expect((await configure({autoAlbums:true,hierarchy:true})).taskId).toBeUndefined();
});
it('creates the main album before background processing even if the root contains media only in child folders',async()=>{
 await rm(path.join(root,'root.jpg'));const saved=await command({type:'roots.configure',absolutePath:root,label:'仅子目录有照片',autoAlbums:true,hierarchy:true,rules:[]});
 const initial=await command({type:'albums.list'}),parent=initial.find((row:any)=>row.name==='仅子目录有照片');expect(parent).toBeTruthy();expect(parent.parentId).toBeNull();expect(initial.find((row:any)=>row.name==='child').parentId).toBe(parent.id);await done(saved.taskId);
 expect((await command({type:'albums.list'})).find((row:any)=>row.id===parent.id).mediaCount).toBe(2);
});
it('migrates legacy mixed tag references without stealing ordinary tags, memberships or album bindings',async()=>{
 const normal=await command({type:'tags.create',name:'混用标签'});const {root:managed}=await configure({rules:[{relativePath:'',name:'旧目录专用'}],autoAlbums:true,hierarchy:true});const members=await command({type:'media.list'});const dirId=(await command({type:'roots.configuration',id:managed.id})).rules[0].tagId;
 await command({type:'media.addTag',id:members[0].id,tagName:normal.name});const album=await command({type:'albums.edit',name:'普通绑定',tagIds:[normal.id]});
 // Recreate schema10's mixed directory/ordinary association and old unique rule.
 db.prepare("UPDATE tag_options SET source='user' WHERE tag_id=?").run(dirId);db.prepare('UPDATE directory_rules SET tag_id=? WHERE tag_id=?').run(normal.id,dirId);
 for(const row of members){db.prepare('INSERT OR IGNORE INTO directory_media_tags(media_id,tag_id) VALUES(?,?)').run(row.id,normal.id);db.prepare('INSERT OR IGNORE INTO media_tags(media_id,tag_id) VALUES(?,?)').run(row.id,normal.id);db.prepare("INSERT INTO media_tag_origins(media_id,tag_id,source) VALUES(?,?,'directory') ON CONFLICT(media_id,tag_id) DO UPDATE SET source='directory'").run(row.id,normal.id);}
 db.prepare("UPDATE media_tag_origins SET source='user' WHERE media_id=? AND tag_id=?").run(members[0].id,normal.id);
 db.exec("DROP INDEX idx_directory_rules_tag;ALTER TABLE directory_rules RENAME TO qa_new_rules;CREATE TABLE directory_rules(id TEXT PRIMARY KEY,root_id TEXT NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,relative_path TEXT NOT NULL,tag_id TEXT NOT NULL REFERENCES tags(id),UNIQUE(root_id,relative_path));INSERT INTO directory_rules SELECT * FROM qa_new_rules;DROP TABLE qa_new_rules;CREATE INDEX idx_directory_rules_tag ON directory_rules(tag_id);DELETE FROM schema_migrations WHERE version>10;INSERT OR IGNORE INTO schema_migrations(version) VALUES(10);");
 service.close();closeDatabase(db);db=openDatabase(path.join(temp,'library.db'));service=new LibraryService(db,path.join(temp,'cache'));
 const tags=await command({type:'tags.list'});expect(tags.find((row:any)=>row.id===normal.id)).toMatchObject({name:'混用标签',directory:false});const directory=tags.find((row:any)=>row.name==='混用标签（目录）');expect(directory.directory).toBe(true);
 expect((await command({type:'roots.configuration',id:managed.id})).rules[0].tagId).toBe(directory.id);expect((await command({type:'albums.list'})).find((row:any)=>row.id===album.id).tagIds).toEqual([normal.id]);
 expect((await command({type:'media.tags',id:members[0].id})).map((row:any)=>row.id)).toEqual(expect.arrayContaining([normal.id,directory.id]));expect((await command({type:'media.tags',id:members[1].id})).map((row:any)=>row.id)).not.toContain(normal.id);
 const backup=(await readdir(temp)).find(name=>name.startsWith('library.db.pre-m2-'));expect(backup).toBeTruthy();
 saveDirectoryConfiguration(db,managed.id,{autoAlbums:true,hierarchy:true,rules:[{relativePath:'',name:directory.name},{relativePath:'',name:'升级后第二目录标签'}]});expect((await command({type:'roots.configuration',id:managed.id})).rules).toHaveLength(2);
});
