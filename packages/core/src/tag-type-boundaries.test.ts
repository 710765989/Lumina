import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openDatabase,closeDatabase,createTag,setTagParents,type LuminaDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';
let temp:string,db:LuminaDatabase,service:LibraryService,ordinary:string,directory:string;
const command=(input:unknown):Promise<any>=>service.handle(input);
beforeEach(async()=>{temp=await mkdtemp(path.join(os.tmpdir(),'lumina-tag-types-'));db=openDatabase(path.join(temp,'test.db'));service=new LibraryService(db,path.join(temp,'cache'));ordinary=createTag(db,'普通');directory=createTag(db,'目录','directory');});
afterEach(async()=>{service.close();closeDatabase(db);await rm(temp,{recursive:true,force:true,maxRetries:4});});
it('rejects cross-type parents in either direction without renaming or changing existing parents',async()=>{
 for(const [id,parentId,name] of [[ordinary,directory,'普通已改名'],[directory,ordinary,'目录已改名']])await expect(command({type:'tags.edit',id,name,englishName:'changed',parentIds:[parentId]})).rejects.toThrow('不能建立父子关系');
 expect((await command({type:'tags.list'})).map((row:any)=>row.name).sort()).toEqual(['普通','目录'].sort());expect(db.prepare('SELECT * FROM tag_edges').all()).toEqual([]);expect(db.prepare("SELECT * FROM tags WHERE english_name='changed'").all()).toEqual([]);
});
it('rolls back new and shared ordinary children under directory parents',async()=>{
 await expect(command({type:'tags.create',name:'不应创建',parentIds:[directory]})).rejects.toThrow('不能建立父子关系');
 await expect(command({type:'tags.create',name:'普通',parentIds:[directory]})).rejects.toThrow('不能建立父子关系');expect(await command({type:'tags.list'})).toHaveLength(2);expect(db.prepare('SELECT * FROM tag_edges').all()).toEqual([]);
});
it('blocks cross-type reference drags and storage writes while preserving the original branch',async()=>{
 const child=(await command({type:'tags.create',name:'普通子',parentIds:[ordinary]})).id;
 await expect(command({type:'tags.moveReference',id:child,fromParentId:ordinary,parentId:directory})).rejects.toThrow('不能建立父子关系');
 expect(()=>setTagParents(db,directory,[child])).toThrow('不能建立父子关系');expect((await command({type:'tags.list'})).find((row:any)=>row.id===child).parentIds).toEqual([ordinary]);
});
it('blocks cross-type merge previews and execution in both directions, retaining labels and media links',async()=>{
 db.prepare("INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,fingerprint) VALUES('photo',?,'photo',1,1,'photo')").run(path.join(temp,'indexed-only.jpg'));db.prepare("INSERT INTO media_tags(media_id,tag_id) VALUES('photo',?)").run(ordinary);
 for(const [sourceId,targetId] of [[ordinary,directory],[directory,ordinary]]){
  await expect(command({type:'tags.mergePreview',sourceId,targetId})).rejects.toThrow('不能合并');
  await expect(command({type:'tags.merge',sourceId,targetId,revision:'old-revision'})).rejects.toThrow('不能合并');
 }
 expect(await command({type:'tags.list'})).toHaveLength(2);expect(db.prepare("SELECT tag_id FROM media_tags WHERE media_id='photo'").all()).toEqual([{tag_id:ordinary}]);expect(db.prepare("SELECT * FROM organization_log WHERE action='tags.merge'").all()).toEqual([]);
});
it('rechecks actual types at merge commit instead of accepting a stale ordinary-only preview',async()=>{
 const target=createTag(db,'目标'),preview=await command({type:'tags.mergePreview',sourceId:ordinary,targetId:target});db.prepare("UPDATE tag_options SET source='directory' WHERE tag_id=?").run(target);
 await expect(command({type:'tags.merge',sourceId:ordinary,targetId:target,revision:preview.revision})).rejects.toThrow('不能合并');expect(await command({type:'tags.list'})).toHaveLength(3);
});
it('preserves same-type multiple parents and ordinary merges; directory-only parent links remain valid',async()=>{
 const second=createTag(db,'普通父二'),child=(await command({type:'tags.create',name:'普通子',parentIds:[ordinary,second]})).id;
 expect((await command({type:'tags.list'})).find((row:any)=>row.id===child).parentIds.sort()).toEqual([ordinary,second].sort());const dirChild=createTag(db,'目录子','directory');setTagParents(db,dirChild,[directory]);expect((await command({type:'tags.list'})).find((row:any)=>row.id===dirChild).parentIds).toEqual([directory]);
 const preview=await command({type:'tags.mergePreview',sourceId:ordinary,targetId:second});await command({type:'tags.merge',sourceId:ordinary,targetId:second,revision:preview.revision});expect((await command({type:'tags.list'})).find((row:any)=>row.id===child).parentIds).toEqual([second]);
});
