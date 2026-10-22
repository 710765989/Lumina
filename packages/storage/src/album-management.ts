import {randomUUID} from 'node:crypto';
import type {LuminaDatabase} from './index.js';
import {albumContains,albumRule,reconcileCover} from './organization.js';
import {createAlbum,getAlbum,updateAlbum} from './repository.js';

export function setAlbumParent(db:LuminaDatabase,id:string,parentId:string|null){
  if(!getAlbum(db,id))throw new Error('相册不存在');
  if(db.prepare('SELECT 1 FROM directory_albums WHERE album_id=?').get(id)){
    if(getAlbum(db,id)?.parentId===parentId)return;
    throw new Error('目录相册的层级由原目录管理');
  }
  if(parentId && (!getAlbum(db,parentId)||albumRule(db,parentId)))throw new Error('请选择有效的相册文件夹或普通相册');
  const rows=db.prepare('SELECT id,parent_id AS parentId FROM albums').all() as {id:string;parentId:string|null}[];
  const parents=new Map(rows.map(row=>[row.id,row.parentId]));parents.set(id,parentId);
  // Check the entire affected subtree as well as the moved album itself.
  const affected=new Set([id]);let added=true;while(added){added=false;for(const row of rows)if(row.parentId&&affected.has(row.parentId)&&!affected.has(row.id)){affected.add(row.id);added=true;}}
  for(const row of rows.filter(row=>affected.has(row.id))){const seen=new Set<string>();let current:string|null=row.id;
    while(current){if(seen.has(current))throw new Error('不能将相册移动到自身或子相册中');seen.add(current);if(seen.size>5)throw new Error('相册层级最多支持 5 级');current=parents.get(current)??null;}
  }
  db.prepare('UPDATE albums SET parent_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(parentId,id);
}

export function saveAlbumFolder(db:LuminaDatabase,input:{id?:string;name:string;description?:string;parentId?:string|null}){
  return db.transaction(()=>{
    const folder=input.id?getAlbum(db,input.id):createAlbum(db,input.name,input.description);
    if(!folder || input.id&&!folder.isFolder)throw new Error('相册文件夹不存在');
    if(input.id)updateAlbum(db,folder.id,input);
    db.prepare('UPDATE albums SET is_folder=1 WHERE id=?').run(folder.id);
    if(input.parentId!==undefined)setAlbumParent(db,folder.id,input.parentId);
    return getAlbum(db,folder.id)!;
  })();
}

export function removeAlbumItems(db:LuminaDatabase,id:string,mediaIds:string[]){
  return db.transaction(()=>{
    const album=getAlbum(db,id);if(!album)throw new Error('相册不存在');
    const rule=albumRule(db,id),ids=[...new Set(mediaIds)];
    const members=rule?ids.filter(mediaId=>!rule.excludedMediaIds.includes(mediaId)&&albumContains(db,id,mediaId)):ids.filter(mediaId=>Boolean(db.prepare('SELECT 1 FROM album_media WHERE album_id=? AND media_id=?').get(id,mediaId)));
    const directory=db.prepare('SELECT media_id AS id,owned FROM directory_album_media WHERE album_id=? AND media_id IN(SELECT value FROM json_each(?))').all(id,JSON.stringify(members));
    if(rule){rule.excludedMediaIds=[...new Set([...rule.excludedMediaIds,...members])];db.prepare('UPDATE smart_albums SET rule_json=? WHERE album_id=?').run(JSON.stringify(rule),id);}
    else db.prepare('DELETE FROM album_media WHERE album_id=? AND media_id IN(SELECT value FROM json_each(?))').run(id,JSON.stringify(members));
    reconcileCover(db,id);
    if(!members.length)return {removed:0,undoToken:null};
    const token=randomUUID(),snapshot={kind:rule?'smart':'ordinary',mediaIds:members,directory,cover:album.manualCoverMediaId};
    db.prepare('INSERT INTO album_removal_undo(id,album_id,detail_json) VALUES(?,?,?)').run(token,id,JSON.stringify(snapshot));
    db.exec('DELETE FROM album_removal_undo WHERE id NOT IN(SELECT id FROM album_removal_undo ORDER BY rowid DESC LIMIT 20)');
    return {removed:members.length,undoToken:token};
  })();
}

export function undoAlbumRemoval(db:LuminaDatabase,token:string){
  return db.transaction(()=>{
    const entry=db.prepare('SELECT album_id AS albumId,detail_json AS detail FROM album_removal_undo WHERE id=?').get(token) as {albumId:string;detail:string}|undefined;
    if(!entry)throw new Error('该移出操作已撤销或记录已过期');
    const album=getAlbum(db,entry.albumId);if(!album)throw new Error('相册已删除，无法撤销');
    const snapshot=JSON.parse(entry.detail) as {kind:string;mediaIds:string[];directory:{id:string;owned:number}[];cover:string|null};
    const ids=snapshot.mediaIds.filter(id=>db.prepare('SELECT 1 FROM media WHERE id=?').get(id));
    if(snapshot.kind==='smart'){
      const rule=albumRule(db,album.id);if(!rule)throw new Error('智能相册已改变，无法撤销');
      const restore=new Set(ids);rule.excludedMediaIds=rule.excludedMediaIds.filter(id=>!restore.has(id));
      db.prepare('UPDATE smart_albums SET rule_json=? WHERE album_id=?').run(JSON.stringify(rule),album.id);
    }else{
      const insert=db.prepare('INSERT OR IGNORE INTO album_media(album_id,media_id) VALUES(?,?)');for(const id of ids)insert.run(album.id,id);
      for(const row of snapshot.directory)if(ids.includes(row.id))db.prepare('INSERT INTO directory_album_media(album_id,media_id,owned) VALUES(?,?,?) ON CONFLICT(album_id,media_id) DO UPDATE SET owned=excluded.owned').run(album.id,row.id,row.owned);
    }
    if(!album.manualCoverMediaId&&snapshot.cover&&albumContains(db,album.id,snapshot.cover))db.prepare("UPDATE albums SET cover_mode='manual',manual_cover_media_id=? WHERE id=?").run(snapshot.cover,album.id);
    db.prepare('DELETE FROM album_removal_undo WHERE id=?').run(token);
    return {restored:ids.length,albumId:album.id};
  })();
}
