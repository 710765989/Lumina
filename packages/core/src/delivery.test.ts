import {mkdtemp,mkdir,writeFile,readFile,rm,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {it,expect} from 'vitest';
import {openDatabase,closeDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';

it('delivers single/multiple original files in order, allowing hidden items only in an explicit hidden scope',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'lumina-delivery-')),library=path.join(root,'fixtures');await mkdir(library);
 const original=await sharp({create:{width:32,height:24,channels:3,background:'blue'}}).jpeg().toBuffer();
 await writeFile(path.join(library,'中文 空格.jpg'),original);await writeFile(path.join(library,'other.jpg'),original);
 const db=openDatabase(path.join(root,'test.db')),service=new LibraryService(db,path.join(root,'cache'));
 try{
  await service.handle({type:'roots.addAndScan',absolutePath:library});
  const media:any[]=await service.handle({type:'media.list'}) as any[],ids=media.map(item=>item.id);
  const delivery=async(mediaIds:string[],includeHidden=false)=>service.handle({type:'media.delivery',mediaIds,includeHidden}) as Promise<any[]>;
  expect((await delivery([...ids].reverse())).map(item=>item.id)).toEqual([...ids].reverse());
  expect(await delivery([ids[0]!,ids[0]!])).toHaveLength(1);
  await service.handle({type:'media.hide',id:ids[0]});
  await expect(delivery([ids[0]!])).rejects.toThrow('媒体已隐藏');
  expect((await delivery([ids[0]!],true))[0].absolutePath).toBe(media[0].absolutePath);
  const tag:any=await service.handle({type:'tags.create',name:'标签隐藏'});
  await service.handle({type:'media.addTag',id:ids[1],tagName:tag.name});await service.handle({type:'tags.setHidden',id:tag.id,hidden:true});
  await expect(delivery([ids[1]!])).rejects.toThrow('媒体已隐藏');expect(await delivery(ids,true)).toHaveLength(2);
  for(const item of media)expect(await readFile(item.absolutePath)).toEqual(original);
  const roots:any[]=await service.handle({type:'roots.list'}) as any[];
  await service.handle({type:'roots.setEnabled',id:roots[0].id,enabled:false});
  await expect(delivery(ids,true)).rejects.toThrow('停用');
  await service.handle({type:'roots.setEnabled',id:roots[0].id,enabled:true});
  await unlink(media[0].absolutePath);await expect(delivery(ids,true)).rejects.toThrow('无法读取');
 }finally{service.close();closeDatabase(db);await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
});
it('does not allow trash files to bypass visibility checks through the hidden scope',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'lumina-delivery-trash-')),library=path.join(root,'fixtures');await mkdir(library);
 await sharp({create:{width:32,height:24,channels:3,background:'blue'}}).jpeg().toFile(path.join(library,'photo.jpg'));
 const db=openDatabase(path.join(root,'test.db')),service=new LibraryService(db,path.join(root,'cache'));
 try{
  await service.handle({type:'roots.addAndScan',absolutePath:library});const [media]=await service.handle({type:'media.list'}) as any[];
  await service.handle({type:'trash.put',mediaIds:[media.id]});
  await expect(service.handle({type:'media.delivery',mediaIds:[media.id],includeHidden:true})).rejects.toThrow('删除');
 }finally{service.close();closeDatabase(db);await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
});
