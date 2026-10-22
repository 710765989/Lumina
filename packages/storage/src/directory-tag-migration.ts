import type {LuminaDatabase} from './index.js';
import {createTag} from './repository.js';
import {inheritTagAncestors} from './tag-hierarchy.js';

// Old versions inferred the tag type from the presence of a directory rule.
// Preserve ordinary uses, splitting only the directory references of mixed tags.
export function migrateDirectoryTagTypes(db:LuminaDatabase){
  db.transaction(()=>{
    const tags=db.prepare("SELECT DISTINCT t.id,t.name FROM directory_rules r JOIN tags t ON t.id=r.tag_id LEFT JOIN tag_options o ON o.tag_id=t.id WHERE COALESCE(o.source,'user')<>'directory'").all() as {id:string;name:string}[];
    if(!tags.length)return;
    const edges=db.prepare('SELECT parent_id AS parent,child_id AS child,owned FROM directory_edges').all() as {parent:string;child:string;owned:number}[];
    const remap=new Map<string,string>(),affected=new Set<string>();
    for(const tag of tags){
      const ordinary=Boolean(db.prepare(`SELECT 1 FROM media_tag_origins WHERE tag_id=? AND source='user' LIMIT 1`).get(tag.id)
        || db.prepare('SELECT 1 FROM album_tags WHERE tag_id=? LIMIT 1').get(tag.id)
        || db.prepare(`SELECT 1 FROM media_tags m WHERE m.tag_id=? AND NOT EXISTS(SELECT 1 FROM directory_media_tags d WHERE d.media_id=m.media_id AND d.tag_id=m.tag_id) LIMIT 1`).get(tag.id)
        || db.prepare(`SELECT 1 FROM tag_edges e WHERE (e.parent_id=? OR e.child_id=?) AND NOT EXISTS(SELECT 1 FROM directory_edges d WHERE d.parent_id=e.parent_id AND d.child_id=e.child_id AND d.owned=1) LIMIT 1`).get(tag.id,tag.id));
      if(!ordinary){db.prepare("INSERT INTO tag_options(tag_id,source) VALUES(?,'directory') ON CONFLICT(tag_id) DO UPDATE SET source='directory'").run(tag.id);continue;}
      const directoryId=createTag(db,tag.name,'directory');remap.set(tag.id,directoryId);
      db.prepare(`UPDATE tag_options SET blocked=COALESCE((SELECT blocked FROM tag_options WHERE tag_id=?),0) WHERE tag_id=?`).run(tag.id,directoryId);
      const members=db.prepare('SELECT media_id AS id FROM directory_media_tags WHERE tag_id=?').all(tag.id) as {id:string}[];
      for(const member of members){
        affected.add(member.id);
        db.prepare('INSERT OR IGNORE INTO media_tags(media_id,tag_id) VALUES(?,?)').run(member.id,directoryId);
        db.prepare("INSERT OR IGNORE INTO media_tag_origins(media_id,tag_id,source) VALUES(?,?,'directory')").run(member.id,directoryId);
        db.prepare('INSERT OR IGNORE INTO directory_media_tags(media_id,tag_id) VALUES(?,?)').run(member.id,directoryId);
        db.prepare("DELETE FROM media_tags WHERE media_id=? AND tag_id=? AND EXISTS(SELECT 1 FROM media_tag_origins o WHERE o.media_id=? AND o.tag_id=? AND o.source='directory')").run(member.id,tag.id,member.id,tag.id);
      }
      db.prepare('DELETE FROM directory_media_tags WHERE tag_id=?').run(tag.id);
      db.prepare('UPDATE directory_rules SET tag_id=? WHERE tag_id=?').run(directoryId,tag.id);
    }
    if(!remap.size)return;
    for(const edge of edges)if(edge.owned)db.prepare('DELETE FROM tag_edges WHERE parent_id=? AND child_id=?').run(edge.parent,edge.child);
    db.prepare('DELETE FROM directory_edges').run();
    for(const edge of edges){
      const parent=remap.get(edge.parent)??edge.parent,child=remap.get(edge.child)??edge.child;
      const exists=db.prepare('SELECT 1 FROM tag_edges WHERE parent_id=? AND child_id=?').get(parent,child);
      db.prepare('INSERT OR IGNORE INTO tag_edges(parent_id,child_id) VALUES(?,?)').run(parent,child);
      db.prepare('INSERT OR IGNORE INTO directory_edges(parent_id,child_id,owned) VALUES(?,?,?)').run(parent,child,exists?0:1);
    }
    inheritTagAncestors(db,[...affected]);
  })();
}
