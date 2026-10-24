import {it,expect} from 'vitest';
import {openDatabase,createTag,addTagToMedia,createAlbum,addMediaToAlbum} from '@lumina/storage';
import {LibraryService} from './service.js';
import path from 'node:path';
it('searches Japanese kanji in the library, filename suggestions, counts, timeline and collections without scanning',async()=>{
 process.env.LUMINA_JAPANESE_WORKER=path.resolve('apps/desktop/dist/japanese-worker.cjs');
 const db=openDatabase(':memory:'),service=new LibraryService(db);const command=(value:unknown)=>service.handle(value) as Promise<any>;
 try{
  db.prepare("INSERT INTO media(id,absolute_path,file_name,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,?,'photo',100,1700000000000,'test')").run('one','F:/isolated/写真.jpg','写真.jpg');
  db.prepare("INSERT INTO media(id,absolute_path,file_name,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,?,'photo',200,1700000000000,'test2')").run('two','F:/isolated/other.jpg','other.jpg');
  const tag=createTag(db,'写真'),chinese=createTag(db,'人像');addTagToMedia(db,'two','写真');addTagToMedia(db,'one','人像');const album=createAlbum(db,'test');addMediaToAlbum(db,album.id,['one','two']);
  const options={query:'shashin',searchLanguage:'ja'};
  expect((await command({type:'media.search',...options})).map((row:any)=>row.id).sort()).toEqual(['one','two']);
  expect(await command({type:'media.filteredStats',...options})).toMatchObject({total:2});expect((await command({type:'media.timeline',...options}))[0].count).toBe(2);
  expect(await command({type:'media.playlist',source:{scope:'library',...options}})).toHaveLength(2);
  expect(await command({type:'albums.media',id:album.id,...options})).toHaveLength(2);expect(await command({type:'tags.media',id:tag,...options})).toHaveLength(1);
  expect(await command({type:'media.nameSuggestions',...options})).toEqual([{name:'写真.jpg',count:1}]);
  expect(await command({type:'media.search',query:'',searchLanguage:'ja',fileNames:['shashin']})).toHaveLength(1);expect(await command({type:'media.search',query:'',searchLanguage:'ja',excludeFileNames:['shashin']})).toHaveLength(1);
  expect(await command({type:'media.search',query:'shashin',searchLanguage:'en'})).toHaveLength(0);expect(await command({type:'media.search',query:'ren',searchLanguage:'en'})).toHaveLength(0);expect(await command({type:'media.search',query:'ren',searchLanguage:'ja'})).toHaveLength(0);expect(await command({type:'media.search',query:'ren',searchLanguage:'zh-CN'})).toHaveLength(1);
  await command({type:'tags.create',name:'Camera',englishName:'桜'});await command({type:'media.addTag',id:'two',tagName:'Camera'});
  expect((await command({type:'media.search',query:'sakura',searchLanguage:'ja'})).map((row:any)=>row.id)).toEqual(['two']);
  expect(await command({type:'media.search',query:'sakura',searchLanguage:'en'})).toHaveLength(0);
  expect(await command({type:'tasks.list'})).toHaveLength(0);
 }finally{service.close();db.close();delete process.env.LUMINA_JAPANESE_WORKER;}
},20000);
