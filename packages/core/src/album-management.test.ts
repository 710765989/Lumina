import {beforeEach,afterEach,it,expect} from 'vitest';
import {openDatabase,closeDatabase,type LuminaDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';
let db:LuminaDatabase,service:LibraryService;
const command=(input:unknown):Promise<any>=>service.handle(input);
beforeEach(()=>{db=openDatabase(':memory:');service=new LibraryService(db);for(let n=0;n<3;n++)db.prepare("INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,'photo',100,?,?)").run(`photo${n}`,`F:/isolated-album-qa/${n}.jpg`,n+1,`photo${n}`);});
afterEach(()=>{service.close();closeDatabase(db);});

it('keeps independent parent/child/smart covers and restores an ordinary removal without editing media tags',async()=>{
 const folder=await command({type:'albums.folder',name:'相册文件夹'}),parent=await command({type:'albums.edit',name:'父相册',parentId:folder.id}),child=await command({type:'albums.edit',name:'子相册',parentId:parent.id});
 await command({type:'albums.addMedia',id:parent.id,mediaIds:['photo0','photo1','photo2']});await command({type:'albums.addMedia',id:child.id,mediaIds:['photo0','photo1']});
 await command({type:'albums.setCover',id:parent.id,mediaId:'photo2'});await command({type:'albums.setCover',id:child.id,mediaId:'photo0'});
 const tag=await command({type:'tags.create',name:'保留普通标签'});await command({type:'media.addTag',id:'photo0',tagName:tag.name});
 const removed=await command({type:'albums.removeMedia',id:child.id,mediaIds:['photo0','photo0','photo2']});expect(removed.removed).toBe(1);expect((await command({type:'albums.media',id:parent.id})).length).toBe(3);
 expect((await command({type:'albums.list'})).find((row:any)=>row.id===child.id).cover.id).toBe('photo1');
 await command({type:'albums.undoRemoval',token:removed.undoToken});await expect(command({type:'albums.undoRemoval',token:removed.undoToken})).rejects.toThrow('已撤销');
 const albums=await command({type:'albums.list'});expect(albums.find((row:any)=>row.id===parent.id).cover.id).toBe('photo2');expect(albums.find((row:any)=>row.id===child.id)).toMatchObject({parentId:parent.id,manualCoverMediaId:'photo0',cover:{id:'photo0'}});
 expect((await command({type:'media.tags',id:'photo0'})).map((row:any)=>row.id)).toEqual([tag.id]);
 await expect(command({type:'albums.addMedia',id:folder.id,mediaIds:['photo0']})).rejects.toThrow('文件夹用于组织相册');
});

it('undoes only the current smart exclusion and preserves later exclusions and a later manual cover',async()=>{
 const tag=await command({type:'tags.create',name:'智能相册标签'});for(let n=0;n<3;n++)await command({type:'media.addTag',id:`photo${n}`,tagName:tag.name});
 const rule={relation:'AND',tags:[tag.id],notTags:[],excludedMediaIds:[]},preview=await command({type:'smart.preview',rule});
 const album=await command({type:'smart.save',name:'智能封面',rule,revision:preview.revision});await command({type:'albums.setCover',id:album.id,mediaId:'photo0'});
 const first=await command({type:'smart.exclude',id:album.id,mediaIds:['photo0']});await command({type:'smart.exclude',id:album.id,mediaIds:['photo1']});await command({type:'albums.setCover',id:album.id,mediaId:'photo2'});
 await command({type:'albums.undoRemoval',token:first.undoToken});const current=(await command({type:'albums.list'})).find((row:any)=>row.id===album.id);
 expect(current.rule.excludedMediaIds).toEqual(['photo1']);expect(current.cover.id).toBe('photo2');expect((await command({type:'albums.media',id:album.id})).map((row:any)=>row.id).sort()).toEqual(['photo0','photo2']);
});

it('creates five levels, moves existing albums, rejects cycles/overdepth atomically, and deletes descendants on folder deletion',async()=>{
 const first=await command({type:'albums.folder',name:'第一层'});let parent=first;
 for(let level=2;level<=5;level++)parent=await command({type:'albums.folder',name:`第${level}层`,parentId:parent.id});
 await expect(command({type:'albums.folder',name:'超出层级',parentId:parent.id})).rejects.toThrow('最多支持 5 级');
 expect((await command({type:'albums.list'})).some((row:any)=>row.name==='超出层级')).toBe(false);
 await expect(command({type:'albums.folder',id:first.id,name:first.name,parentId:parent.id})).rejects.toThrow('自身或子相册');
 const album=await command({type:'albums.edit',name:'可移动相册'});await command({type:'albums.edit',id:album.id,name:album.name??'可移动相册',parentId:first.id});
 expect((await command({type:'albums.list'})).find((row:any)=>row.id===album.id).parentId).toBe(first.id);
 const deleted=await command({type:'albums.delete',id:first.id});expect(deleted.deletedIds).toContain(album.id);expect(await command({type:'albums.list'})).toHaveLength(0);
});

it('deletes only the actual album subtree, preserving independent albums, tags, covers and media',async()=>{
 const folder=await command({type:'albums.folder',name:'待删文件夹'}),parent=await command({type:'albums.edit',name:'父相册',parentId:folder.id}),child=await command({type:'albums.edit',name:'子相册',parentId:parent.id});
 const tag=await command({type:'tags.create',name:'共享标签'});await command({type:'media.addTag',id:'photo0',tagName:tag.name});
 const rule={relation:'AND',tags:[tag.id],notTags:[],excludedMediaIds:[]},preview=await command({type:'smart.preview',rule});
 const nestedSmart=await command({type:'smart.save',name:'子智能相册',parentId:child.id,rule,revision:preview.revision});
 const independent=await command({type:'albums.edit',name:'独立子相册',description:'独立使用相同媒体',tagIds:[tag.id]});await command({type:'albums.addMedia',id:child.id,mediaIds:['photo0','photo1']});await command({type:'albums.addMedia',id:independent.id,mediaIds:['photo0','photo1']});await command({type:'albums.setCover',id:independent.id,mediaId:'photo1'});
 const externalRule=await command({type:'smart.preview',rule}),externalSmart=await command({type:'smart.save',name:'独立智能相册',rule,revision:externalRule.revision});
 const expected=[folder.id,parent.id,child.id,nestedSmart.id].sort(),plan=await command({type:'albums.deletePreview',id:folder.id});expect(plan.total).toBe(4);expect(plan.albums.map((row:any)=>row.id).sort()).toEqual(expected);
 const before=db.prepare('SELECT * FROM media ORDER BY id').all(),tagsBefore=await command({type:'media.tags',id:'photo0'});
 const result=await command({type:'albums.delete',id:folder.id,revision:plan.revision});expect(result.deletedIds.sort()).toEqual(expected);
 const remaining=await command({type:'albums.list'});expect(remaining.map((row:any)=>row.id).sort()).toEqual([independent.id,externalSmart.id].sort());expect(remaining.find((row:any)=>row.id===independent.id)).toMatchObject({manualCoverMediaId:'photo1',mediaCount:2});expect(await command({type:'albums.media',id:externalSmart.id})).toHaveLength(2);
 expect(db.prepare('SELECT * FROM media ORDER BY id').all()).toEqual(before);expect(await command({type:'media.tags',id:'photo0'})).toEqual(tagsBefore);expect(db.pragma('foreign_key_check')).toEqual([]);
 expect(await command({type:'albums.delete',id:folder.id})).toMatchObject({deletedIds:[]});
});
it('rejects a stale deletion scope and preserves a child moved out before a fresh confirmation',async()=>{
 const parent=await command({type:'albums.edit',name:'父'}),child=await command({type:'albums.edit',name:'子',parentId:parent.id}),plan=await command({type:'albums.deletePreview',id:parent.id});
 await command({type:'albums.edit',id:child.id,name:'子',parentId:null});await expect(command({type:'albums.delete',id:parent.id,revision:plan.revision})).rejects.toThrow('相册层级已变化');expect(await command({type:'albums.list'})).toHaveLength(2);
 const refreshed=await command({type:'albums.deletePreview',id:parent.id});expect(refreshed.total).toBe(1);await command({type:'albums.delete',id:parent.id,revision:refreshed.revision});expect((await command({type:'albums.list'})).map((row:any)=>row.id)).toEqual([child.id]);
 const parent2=await command({type:'albums.folder',name:'新父'}),old=await command({type:'albums.deletePreview',id:parent2.id});await command({type:'albums.edit',name:'后来添加的子相册',parentId:parent2.id});await expect(command({type:'albums.delete',id:parent2.id,revision:old.revision})).rejects.toThrow('相册层级已变化');expect(await command({type:'albums.list'})).toHaveLength(3);
});
