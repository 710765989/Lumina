import {spawn} from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {openDatabase,closeDatabase,type LuminaDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';
let db:LuminaDatabase,service:LibraryService,temp:string,media:any[];
const command=(input:unknown):Promise<any>=>service.handle(input);
beforeEach(async()=>{temp=await mkdtemp(path.join(os.tmpdir(),'lumina-hierarchy-'));const fixtures=path.join(temp,'fixtures');await mkdir(fixtures);for(const [name,color] of [['a.jpg','red'],['b.jpg','blue']])await sharp({create:{width:64,height:48,channels:3,background:color!}}).jpeg().toFile(path.join(fixtures,name!));db=openDatabase(path.join(temp,'library.db'));service=new LibraryService(db,path.join(temp,'cache'));await command({type:'roots.addAndScan',absolutePath:fixtures});media=await command({type:'media.list'});});
afterEach(async()=>{service.close();closeDatabase(db);await rm(temp,{recursive:true,force:true,maxRetries:4});});
it('limits hierarchy to five levels and rolls back cyclic/deep moves atomically',async()=>{
 const chain:{id:string;name:string}[]=[];for(let i=0;i<5;i++)chain.push(await command({type:'tags.create',name:`第${i+1}级`,parentId:chain.at(-1)?.id}));
 await expect(command({type:'tags.create',name:'第六级',parentId:chain[4]!.id})).rejects.toThrow('5 级');expect(await command({type:'tags.list'})).toHaveLength(5);
 await expect(command({type:'tags.edit',id:chain[0]!.id,name:'不应改名',parentId:chain[4]!.id})).rejects.toThrow('自己或子标签');expect((await command({type:'tags.list'}))[0].name).toBe('第1级');
 await command({type:'media.addTag',id:media[0].id,tagName:'第5级'});expect((await command({type:'media.tags',id:media[0].id})).map((tag:any)=>tag.name).sort()).toEqual(chain.map((tag)=>tag.name).sort());
 expect((await command({type:'tags.list'}))[4]).toMatchObject({depth:5,path:'第1级 / 第2级 / 第3级 / 第4级 / 第5级'});
});
it('expands parent browsing, playlists, search, smart AND/NOT and hidden scopes without duplicate media',async()=>{
 const parent=await command({type:'tags.create',name:'人物'});const child=await command({type:'tags.create',name:'家人',parentId:parent.id});await command({type:'media.addTag',id:media[0].id,tagName:'家人'});
 // Exercise descendant queries independently of the automatic stored parent association.
 db.prepare('DELETE FROM media_tags WHERE media_id=? AND tag_id=?').run(media[0].id,parent.id);
 expect(await command({type:'tags.media',id:parent.id})).toHaveLength(1);expect(await command({type:'media.playlist',source:{scope:'tag',id:parent.id}})).toEqual([media[0].id]);
 expect(await command({type:'media.search',query:'',tagNames:['人物']})).toHaveLength(1);
 const rule={relation:'AND',tags:[parent.id],notTags:[],excludedMediaIds:[]};expect((await command({type:'smart.preview',rule})).total).toBe(1);expect((await command({type:'smart.preview',rule:{...rule,notTags:[child.id]}})).total).toBe(0);
 expect((await command({type:'tags.visibilityPreview',id:parent.id})).visible).toBe(1);await command({type:'tags.setHidden',id:parent.id,hidden:true});expect(await command({type:'media.list'})).toHaveLength(1);expect(await command({type:'tags.media',id:child.id})).toHaveLength(0);
 await command({type:'tags.setHidden',id:child.id,hidden:true});await command({type:'tags.setHidden',id:parent.id,hidden:false});expect(await command({type:'media.list'})).toHaveLength(1);
});
it('recomputes inherited parents when dragged while retaining explicit parent labels',async()=>{
 const a=await command({type:'tags.create',name:'旧父'});const b=await command({type:'tags.create',name:'新父'});const c=await command({type:'tags.create',name:'子标签',parentId:a.id});await command({type:'media.addTag',id:media[0].id,tagName:'子标签'});await command({type:'media.addTag',id:media[1].id,tagName:'子标签'});await command({type:'media.addTag',id:media[1].id,tagName:'旧父'});
 await command({type:'tags.edit',id:c.id,name:c.name,parentId:b.id});expect((await command({type:'media.tags',id:media[0].id})).map((tag:any)=>tag.name).sort()).toEqual(['子标签','新父'].sort());expect((await command({type:'media.tags',id:media[1].id})).some((tag:any)=>tag.name==='旧父')).toBe(true);
 expect(await command({type:'tags.media',id:a.id})).toHaveLength(1);expect(await command({type:'tags.media',id:b.id})).toHaveLength(2);
 await command({type:'media.removeTag',id:media[0].id,tagName:'子标签'});expect(await command({type:'media.tags',id:media[0].id})).toHaveLength(0);
});
it('deletes a parent with explicit keep-children or cascade semantics and keeps source files',async()=>{
 const p=await command({type:'tags.create',name:'父'});const c=await command({type:'tags.create',name:'子',parentId:p.id});const g=await command({type:'tags.create',name:'孙',parentId:c.id});await command({type:'media.addTag',id:media[0].id,tagName:'孙'});await command({type:'tags.setHidden',id:c.id,hidden:true});
 expect((await command({type:'tags.deletePreview',id:p.id})).children).toHaveLength(2);await command({type:'tags.delete',id:p.id});let tags=await command({type:'tags.list'});expect(tags.find((tag:any)=>tag.id===c.id)).toMatchObject({parentId:null,blocked:true,depth:1});expect(tags.find((tag:any)=>tag.id===g.id).depth).toBe(2);
 await command({type:'tags.delete',id:c.id,deleteChildren:true});expect(await command({type:'tags.list'})).toHaveLength(0);expect(await command({type:'media.tags',id:media[0].id})).toHaveLength(0);expect((await readFile(media[0].absolutePath)).length).toBeGreaterThan(0);
});
it('computes full filtered totals after hidden, filename and descendant tag exclusion',async()=>{
 const parent=await command({type:'tags.create',name:'总类'});await command({type:'tags.create',name:'子类',parentId:parent.id});await command({type:'media.addTag',id:media[0].id,tagName:'子类'});
 expect(await command({type:'media.filteredStats',tagNames:['总类']})).toMatchObject({total:1,photo:1,video:0});await command({type:'media.hide',id:media[0].id});expect((await command({type:'media.filteredStats',tagNames:['总类']})).total).toBe(0);expect((await command({type:'media.filteredStats',excludeTagNames:['总类']})).total).toBe(1);expect((await command({type:'media.filteredStats',fileNames:['absent']})).total).toBe(0);
});
it('recognizes animation by content when an animated GIF has a jpg suffix',async()=>{
 const file=path.join(temp,'fixtures','animation.jpg');await new Promise<void>((resolve,reject)=>{const child=spawn(ffmpegPath as unknown as string,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=32x32:rate=4:duration=1','-loop','0','-f','gif',file],{windowsHide:true});child.on('error',reject);child.on('exit',(code)=>code===0?resolve():reject(new Error('gif fixture')));});await command({type:'roots.scan',id:(await command({type:'roots.list'}))[0].id});const animation=(await command({type:'media.list'})).find((row:any)=>row.absolutePath===file);expect(await command({type:'media.animation',id:animation.id})).toMatchObject({animated:true,format:'gif'});expect((await command({type:'media.filePath',id:animation.id})).contentType).toBe('image/gif');
});

it('moves only affected media associations instead of rebuilding unrelated hierarchy links',async()=>{
 const old=await command({type:'tags.create',name:'原父'}),next=await command({type:'tags.create',name:'新父'}),child=await command({type:'tags.create',name:'移动子',parentId:old.id});const separate=await command({type:'tags.create',name:'独立父'});await command({type:'tags.create',name:'独立子',parentId:separate.id});await command({type:'media.addTag',id:media[0].id,tagName:'移动子'});await command({type:'media.addTag',id:media[1].id,tagName:'独立子'});
 db.exec('CREATE TEMP TABLE protected_media(id TEXT);CREATE TEMP TABLE touched_unrelated(id TEXT);');db.prepare('INSERT INTO protected_media VALUES(?)').run(media[1].id);
 db.exec('CREATE TEMP TRIGGER no_unrelated_delete AFTER DELETE ON media_tags WHEN old.media_id IN(SELECT id FROM protected_media) BEGIN INSERT INTO touched_unrelated VALUES(old.media_id);END; CREATE TEMP TRIGGER no_unrelated_insert AFTER INSERT ON media_tags WHEN new.media_id IN(SELECT id FROM protected_media) BEGIN INSERT INTO touched_unrelated VALUES(new.media_id);END;');
 await command({type:'tags.edit',id:child.id,name:child.name,parentId:next.id});expect(db.prepare('SELECT * FROM touched_unrelated').all()).toHaveLength(0);expect((await command({type:'media.tags',id:media[0].id})).some((tag:any)=>tag.id===next.id)).toBe(true);
});

it('searches and excludes untagged media without treating the reserved option as a real label',async()=>{
 await command({type:'media.addTag',id:media[0].id,tagName:'无'});
 expect((await command({type:'media.search',query:'',untaggedOnly:true})).map((item:any)=>item.id)).toEqual([media[1].id]);expect((await command({type:'media.search',query:'',excludeUntagged:true})).map((item:any)=>item.id)).toEqual([media[0].id]);expect((await command({type:'media.search',query:'',tagNames:['无']})).map((item:any)=>item.id)).toEqual([media[0].id]);
 expect((await command({type:'media.filteredStats',untaggedOnly:true})).total).toBe(1);expect(await command({type:'media.playlist',source:{scope:'library',untaggedOnly:true}})).toEqual([media[1].id]);expect(await command({type:'media.search',query:'',untaggedOnly:true,excludeUntagged:true})).toHaveLength(0);await command({type:'media.hide',id:media[1].id});expect((await command({type:'media.filteredStats',untaggedOnly:true})).total).toBe(0);
});
