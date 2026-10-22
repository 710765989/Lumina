import {it,expect,vi} from 'vitest';
import {openDatabase,closeDatabase,libraryFormats,hideMedia,unhideMedia,createTag,addTagToMedia} from './index.js';
it('lists only indexed visible suffixes, normalizes case, excludes unavailable media, and refreshes after mutations',()=>{
 const db=openDatabase(':memory:');try{
  const insert=db.prepare("INSERT INTO media(id,absolute_path,file_name,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,?,'photo',1,1,?)");
  for(const [id,name] of [['a','a.JPG'],['b','b.jpg'],['c','c.PNG'],['d','d.custom'],['e','no-extension'],['f','.hidden'],['g','multi.photo.JPEG']])insert.run(id,`C:/files/${name}`,name,id);
  expect(libraryFormats(db)).toEqual(['custom','jpeg','jpg','png']);hideMedia(db,'c');expect(libraryFormats(db)).toEqual(['custom','jpeg','jpg']);expect(libraryFormats(db,true)).toEqual(['png']);unhideMedia(db,'c');expect(libraryFormats(db)).toContain('png');
  db.prepare('INSERT INTO media_details(media_id,missing) VALUES(?,1)').run('d');expect(libraryFormats(db)).not.toContain('custom');
  const tag=createTag(db,'隐藏');addTagToMedia(db,'g','隐藏');db.prepare('INSERT INTO tag_options(tag_id,blocked) VALUES(?,1) ON CONFLICT(tag_id) DO UPDATE SET blocked=1').run(tag);expect(libraryFormats(db)).not.toContain('jpeg');expect(libraryFormats(db,true)).toContain('jpeg');
  db.prepare("INSERT INTO library_roots(id,absolute_path,label,enabled) VALUES('disabled','C:/files','停用',0)").run();expect(libraryFormats(db)).toEqual([]);db.prepare("UPDATE library_roots SET enabled=1 WHERE id='disabled'").run();expect(libraryFormats(db)).toEqual(['jpg','png']);
  db.prepare("DELETE FROM media WHERE id='c'").run();expect(libraryFormats(db)).toEqual(['jpg']);
 }finally{closeDatabase(db);}
});
it('reuses a cached index result on repeated opens and filters suggestions locally while retaining manual suffix input',()=>{
 const db=openDatabase(':memory:');try{
  db.prepare("INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,fingerprint) VALUES('a','C:/photo.JXL','photo',1,1,'a')").run();
  const prepare=db.prepare.bind(db),queries:string[]=[];const spy=vi.spyOn(db,'prepare').mockImplementation(((sql:string)=>{queries.push(sql);return prepare(sql);}) as typeof db.prepare);
  expect(libraryFormats(db)).toEqual(['jxl']);for(let i=0;i<20;i++)libraryFormats(db);expect(queries.filter(sql=>sql.includes('AS name FROM media'))).toHaveLength(1);spy.mockRestore();
 }finally{closeDatabase(db);}
});
