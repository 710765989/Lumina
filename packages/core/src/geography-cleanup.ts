import {createHash} from 'node:crypto';
import {deleteAlbum,refreshMediaStats,reconcileAllCovers,type LuminaDatabase} from '@lumina/storage';

function snapshot(db:LuminaDatabase){
 const albums=db.prepare("SELECT a.*,s.rule_json FROM albums a JOIN smart_albums s ON s.album_id=a.id WHERE s.source='geo' ORDER BY a.id").all() as {id:string}[];
 const tags=db.prepare("SELECT t.*,o.* FROM tags t JOIN tag_options o ON o.tag_id=t.id WHERE o.source='geo' ORDER BY t.id").all() as {id:string}[];
 // Provenance, rather than the visible name, identifies automatic assignments.
 const links=db.prepare('SELECT o.media_id,o.tag_id,o.source FROM media_tag_origins o JOIN geo_runs r ON r.id=o.source ORDER BY o.media_id,o.tag_id').all() as {media_id:string;tag_id:string;source:string}[];
 const references={media:db.prepare("SELECT mt.* FROM media_tags mt JOIN tag_options o ON o.tag_id=mt.tag_id WHERE o.source='geo' ORDER BY mt.media_id,mt.tag_id").all(),edges:db.prepare('SELECT * FROM tag_edges ORDER BY parent_id,child_id').all(),rules:db.prepare("SELECT * FROM smart_albums WHERE source<>'geo' ORDER BY album_id").all(),albumTags:db.prepare('SELECT * FROM album_tags ORDER BY album_id,tag_id').all(),directoryTags:db.prepare('SELECT * FROM directory_rules ORDER BY root_id,relative_path,tag_id').all()};
 return {albums,tags,links,revision:createHash('sha256').update(JSON.stringify({albums,tags,links,references})).digest('hex')};
}
export function geographyCleanupPreview(db:LuminaDatabase){const value=snapshot(db);return {albums:value.albums.length,tags:value.tags.length,links:value.links.length,revision:value.revision};}
export function geographyCleanupSummary(db:LuminaDatabase){return db.prepare(`SELECT (SELECT COUNT(*) FROM smart_albums WHERE source='geo') AS albums,(SELECT COUNT(*) FROM tag_options WHERE source='geo') AS tags,(SELECT COUNT(*) FROM media_tag_origins o JOIN geo_runs r ON r.id=o.source) AS links`).get() as {albums:number;tags:number;links:number};}
export function cleanupGeographicCollections(db:LuminaDatabase,revision:string){
 if(db.prepare("SELECT 1 FROM tasks WHERE kind='geo' AND status IN('running','queued') LIMIT 1").get())throw new Error('地点任务正在处理，请等待完成后再清理');
 return db.transaction(()=>{
  const value=snapshot(db);if(value.revision!==revision)throw new Error('地点分类已变化，请重新打开清理确认');
  for(const album of value.albums)deleteAlbum(db,album.id);
  const protectedTag=db.prepare(`SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM tag_options WHERE tag_id=? AND source='geo') OR EXISTS(SELECT 1 FROM media_tag_origins WHERE tag_id=? AND source='user') OR EXISTS(SELECT 1 FROM tag_edges WHERE parent_id=? OR child_id=?) OR EXISTS(SELECT 1 FROM album_tags WHERE tag_id=?) OR EXISTS(SELECT 1 FROM directory_rules WHERE tag_id=?) OR EXISTS(SELECT 1 FROM smart_albums s,json_each(s.rule_json,'$.tags') j WHERE j.value=?) OR EXISTS(SELECT 1 FROM smart_albums s,json_each(s.rule_json,'$.notTags') j WHERE j.value=?) OR EXISTS(SELECT 1 FROM tag_options WHERE tag_id=? AND (blocked=1 OR group_name<>'' OR aliases_json<>'[]'))`);
  const preserve=new Set([...value.tags.map(tag=>tag.id),...value.links.map(link=>link.tag_id)].filter(id=>Boolean(protectedTag.get(id,id,id,id,id,id,id,id,id))));
  let removedLinks=0;
  for(const link of value.links){
   if(preserve.has(link.tag_id))db.prepare("UPDATE media_tag_origins SET source='user' WHERE media_id=? AND tag_id=? AND source=?").run(link.media_id,link.tag_id,link.source);
   else removedLinks+=db.prepare('DELETE FROM media_tags WHERE media_id=? AND tag_id=? AND EXISTS(SELECT 1 FROM media_tag_origins o WHERE o.media_id=? AND o.tag_id=? AND o.source=?)').run(link.media_id,link.tag_id,link.media_id,link.tag_id,link.source).changes;
  }
  let removedTags=0;
  for(const tag of value.tags){
   const referenced=db.prepare(`SELECT 1 WHERE EXISTS(SELECT 1 FROM media_tags WHERE tag_id=?) OR EXISTS(SELECT 1 FROM tag_edges WHERE parent_id=? OR child_id=?) OR EXISTS(SELECT 1 FROM album_tags WHERE tag_id=?) OR EXISTS(SELECT 1 FROM directory_rules WHERE tag_id=?) OR EXISTS(SELECT 1 FROM smart_albums s,json_each(s.rule_json,'$.tags') j WHERE j.value=?) OR EXISTS(SELECT 1 FROM smart_albums s,json_each(s.rule_json,'$.notTags') j WHERE j.value=?)`).get(tag.id,tag.id,tag.id,tag.id,tag.id,tag.id,tag.id);
   if(referenced||preserve.has(tag.id))db.prepare("UPDATE tag_options SET source='user' WHERE tag_id=? AND source='geo'").run(tag.id);
   else removedTags+=db.prepare("DELETE FROM tags WHERE id=? AND EXISTS(SELECT 1 FROM tag_options WHERE tag_id=? AND source='geo')").run(tag.id,tag.id).changes;
  }
  refreshMediaStats(db);reconcileAllCovers(db);
  return {albums:value.albums.length,tags:removedTags,links:removedLinks};
 })();
}
