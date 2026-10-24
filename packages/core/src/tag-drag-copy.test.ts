import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openDatabase,closeDatabase,createTag,type LuminaDatabase} from '@lumina/storage';
import {tagOccurrences} from '@lumina/contracts';
import {LibraryService} from './service.js';
let temp:string,db:LuminaDatabase,service:LibraryService;
const command=(input:unknown):Promise<any>=>service.handle(input),tag=async(name:string,parentIds?:string[])=>(await command({type:'tags.create',name,parentIds})).id;
beforeEach(async()=>{temp=await mkdtemp(path.join(os.tmpdir(),'lumina-copy-tag-'));db=openDatabase(path.join(temp,'test.db'));service=new LibraryService(db,path.join(temp,'cache'));});
afterEach(async()=>{service.close();closeDatabase(db);await rm(temp,{recursive:true,force:true,maxRetries:4});});
it('copies a child reference, inherits both parents and ignores repeated copies without duplicating media or tags',async()=>{
 const a=await tag('甲'),b=await tag('乙'),c=await tag('子',[a]);db.prepare("INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,fingerprint) VALUES('photo',?,'photo',1,1,'photo')").run(path.join(temp,'indexed.jpg'));await command({type:'media.addTag',id:'photo',tagName:'子'});
 const request={type:'tags.moveReference',id:c,fromParentId:a,parentId:b,copy:true};await command(request);await command(request);expect(await command({type:'tags.list'})).toHaveLength(3);expect((await command({type:'media.tags',id:'photo'})).map((row:any)=>row.id).sort()).toEqual([a,b,c].sort());const rows=tagOccurrences(await command({type:'tags.list'}));expect(rows.filter(row=>row.id===c).map(row=>row.parentId).sort()).toEqual([a,b].sort());expect(db.prepare('SELECT * FROM media WHERE id=?').get('photo')).toBeTruthy();
});
it('persists both root and nested appearances when copying a top-level tag',async()=>{
 const a=await tag('父'),c=await tag('顶级子');await command({type:'tags.moveReference',id:c,fromParentId:null,parentId:a,copy:true});service.close();closeDatabase(db);db=openDatabase(path.join(temp,'test.db'));service=new LibraryService(db,path.join(temp,'cache'));const rows=tagOccurrences(await command({type:'tags.list'})).filter(row=>row.id===c);expect(rows.map(row=>row.parentId)).toEqual([a,null]);expect(rows.every(row=>row.rootReference)).toBe(true);
});
it('moves only the chosen occurrence and can remove an extra root reference without deleting the label',async()=>{
 const a=await tag('甲'),b=await tag('乙'),c=await tag('子',[a]);await command({type:'tags.moveReference',id:c,fromParentId:a,parentId:b,copy:true});await command({type:'tags.moveReference',id:c,fromParentId:a,parentId:null});let row=(await command({type:'tags.list'})).find((row:any)=>row.id===c);expect(row).toMatchObject({parentIds:[b],rootReference:true});
 await command({type:'tags.delete',id:c,mode:'reference',parentId:null});row=(await command({type:'tags.list'})).find((row:any)=>row.id===c);expect(row).toMatchObject({parentIds:[b],rootReference:false});
 await command({type:'tags.moveReference',id:c,fromParentId:b,parentId:null,copy:true});await command({type:'tags.moveReference',id:c,fromParentId:null,parentId:a});row=(await command({type:'tags.list'})).find((row:any)=>row.id===c);expect(row.parentIds.sort()).toEqual([a,b].sort());expect(row.rootReference).toBe(false);
});
it('protects a copied root occurrence during parent cascade deletion',async()=>{
 const a=await tag('父'),c=await tag('子',[a]);await command({type:'tags.moveReference',id:c,fromParentId:a,parentId:null,copy:true});const preview=await command({type:'tags.deletePreview',id:a});expect(preview.exclusiveChildren).toHaveLength(0);await command({type:'tags.delete',id:a,deleteChildren:true});expect((await command({type:'tags.list'})).map((row:any)=>row.id)).toEqual([c]);
});
it('retains explicit root occurrences when merging labels or promoting children of a deleted parent',async()=>{
 const a=await tag('父甲'),b=await tag('父乙'),source=await tag('来源',[a]),target=await tag('目标',[b]);await command({type:'tags.moveReference',id:source,fromParentId:a,parentId:null,copy:true});const preview=await command({type:'tags.mergePreview',sourceId:source,targetId:target});await command({type:'tags.merge',sourceId:source,targetId:target,revision:preview.revision});let rows=tagOccurrences(await command({type:'tags.list'})).filter(row=>row.id===target);expect(rows.map(row=>row.parentId).sort()).toEqual([a,b,null].sort());const child=await tag('下级',[target]);await command({type:'tags.delete',id:target,deleteChildren:false});rows=tagOccurrences(await command({type:'tags.list'})).filter(row=>row.id===child);expect(rows.map(row=>row.parentId).sort()).toEqual([a,b,null].sort());
});
it('rejects stale origins, cycles and cross-type copies without creating a root flag or another reference',async()=>{
 const a=await tag('甲'),b=await tag('乙'),c=await tag('子',[a]),directory=createTag(db,'目录','directory');
 await expect(command({type:'tags.moveReference',id:c,fromParentId:b,parentId:a,copy:true})).rejects.toThrow('引用已变化');await expect(command({type:'tags.moveReference',id:a,fromParentId:null,parentId:c,copy:true})).rejects.toThrow('自己或子标签');await expect(command({type:'tags.moveReference',id:c,fromParentId:a,parentId:directory,copy:true})).rejects.toThrow('不能建立父子关系');expect((await command({type:'tags.list'})).find((row:any)=>row.id===a).rootReference).toBe(false);expect((await command({type:'tags.list'})).find((row:any)=>row.id===c).parentIds).toEqual([a]);
});
it('backs up schema11 before adding persistent root references and does not repeat the migration',async()=>{
 const a=await tag('父'),c=await tag('子',[a]);service.close();db.exec('ALTER TABLE tags DROP COLUMN root_reference;DELETE FROM schema_migrations WHERE version>=12;INSERT OR IGNORE INTO schema_migrations(version) VALUES(11)');closeDatabase(db);db=openDatabase(path.join(temp,'test.db'));service=new LibraryService(db,path.join(temp,'cache'));expect((await command({type:'tags.list'})).find((row:any)=>row.id===c)).toMatchObject({parentIds:[a],rootReference:false});let backups=(await readdir(temp)).filter(name=>name.includes('.pre-m2-'));expect(backups).toHaveLength(1);service.close();closeDatabase(db);db=openDatabase(path.join(temp,'test.db'));service=new LibraryService(db,path.join(temp,'cache'));expect((await readdir(temp)).filter(name=>name.includes('.pre-m2-'))).toEqual(backups);
});
