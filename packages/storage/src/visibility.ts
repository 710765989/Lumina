import type {LuminaDatabase} from './index.js';
import {tagFamilySql} from './tag-hierarchy.js';

export function tagHiddenSql(alias='m'){
 return `EXISTS(SELECT 1 FROM media_tags hidden_tag JOIN (${tagFamilySql}) hidden_family ON hidden_family.id=hidden_tag.tag_id JOIN tag_options hidden_option ON hidden_option.tag_id=hidden_family.ancestor WHERE hidden_tag.media_id=${alias}.id AND hidden_option.blocked=1 AND NOT EXISTS(SELECT 1 FROM tag_visibility_exceptions exception WHERE exception.media_id=${alias}.id AND exception.tag_id=hidden_option.tag_id))`;
}
export function hiddenReasons(db:LuminaDatabase,ids:readonly string[]){
 const scope=JSON.stringify([...new Set(ids)]),rows=db.prepare(`SELECT DISTINCT mt.media_id AS mediaId,o.tag_id AS tagId,t.name FROM media_tags mt JOIN (${tagFamilySql}) family ON family.id=mt.tag_id JOIN tag_options o ON o.tag_id=family.ancestor JOIN tags t ON t.id=o.tag_id WHERE mt.media_id IN(SELECT value FROM json_each(?)) AND o.blocked=1 AND NOT EXISTS(SELECT 1 FROM tag_visibility_exceptions x WHERE x.media_id=mt.media_id AND x.tag_id=o.tag_id) ORDER BY t.name`).all(scope) as {mediaId:string;tagId:string;name:string}[];
 const byMedia:Record<string,string[]>={},summary=new Map<string,{id:string;name:string;count:number}>();
 for(const row of rows){(byMedia[row.mediaId]??=[]).push(row.tagId);const tag=summary.get(row.tagId)??{id:row.tagId,name:row.name,count:0};tag.count++;summary.set(row.tagId,tag);}
 return {byMedia,tags:[...summary.values()],affected:Object.keys(byMedia).length};
}
export function initializeVisibility(db:LuminaDatabase){
 db.exec(`CREATE TABLE IF NOT EXISTS tag_visibility_exceptions(media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(media_id,tag_id));
 CREATE INDEX IF NOT EXISTS idx_visibility_exception_tag ON tag_visibility_exceptions(tag_id,media_id);
 CREATE TABLE IF NOT EXISTS windows_visibility_queue(media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE);`);
 const enabled=`COALESCE((SELECT json_extract(value_json,'$.syncHidden') FROM settings WHERE key='organization'),0)=1`;
 const tracked=(alias:string)=>`EXISTS(SELECT 1 FROM media_details d WHERE d.media_id=${alias}.id AND json_type(d.metadata_json,'$.windowsHiddenOriginal') IN('true','false'))`;
 const notQueued='NOT EXISTS(SELECT 1 FROM windows_visibility_queue queued WHERE queued.media_id=m.id)';
 for(const table of ['hidden_media','media_tags','tag_visibility_exceptions'])for(const operation of ['INSERT','DELETE']){
  const row=operation==='INSERT'?'NEW':'OLD';
  db.exec(`CREATE TRIGGER IF NOT EXISTS queue_windows_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table} BEGIN INSERT OR IGNORE INTO windows_visibility_queue(media_id) SELECT m.id FROM media m WHERE ${notQueued} AND m.id=${row}.media_id AND (${enabled} OR ${tracked('m')});END;`);
 }
 for(const operation of ['INSERT','UPDATE','DELETE']){
  const row=operation==='DELETE'?'OLD':'NEW',when=operation==='UPDATE'?'WHEN OLD.blocked<>NEW.blocked':`WHEN ${row}.blocked=1`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS queue_windows_tag_options_${operation.toLowerCase()} AFTER ${operation} ON tag_options ${when} BEGIN INSERT OR IGNORE INTO windows_visibility_queue(media_id) SELECT DISTINCT m.id FROM media m JOIN media_tags mt ON mt.media_id=m.id JOIN (${tagFamilySql}) family ON family.id=mt.tag_id WHERE ${notQueued} AND family.ancestor=${row}.tag_id AND (${enabled} OR ${tracked('m')});END;`);
 }
 for(const operation of ['INSERT','UPDATE']){
  const changed=operation==='UPDATE'?`AND COALESCE(json_extract(OLD.value_json,'$.syncHidden'),0)<>COALESCE(json_extract(NEW.value_json,'$.syncHidden'),0)`:'';
  db.exec(`CREATE TRIGGER IF NOT EXISTS queue_windows_setting_${operation.toLowerCase()} AFTER ${operation} ON settings WHEN NEW.key='organization' ${changed} BEGIN INSERT OR IGNORE INTO windows_visibility_queue(media_id) SELECT m.id FROM media m WHERE ${notQueued} AND (${tracked('m')} OR (${enabled} AND (EXISTS(SELECT 1 FROM hidden_media h WHERE h.media_id=m.id) OR ${tagHiddenSql()})));END;`);
 }
 for(const operation of ['INSERT','DELETE']){
  const row=operation==='INSERT'?'NEW':'OLD';db.exec(`CREATE TRIGGER IF NOT EXISTS queue_windows_tag_edges_${operation.toLowerCase()} AFTER ${operation} ON tag_edges BEGIN INSERT OR IGNORE INTO windows_visibility_queue(media_id) SELECT DISTINCT m.id FROM media m JOIN media_tags mt ON mt.media_id=m.id JOIN (${tagFamilySql}) family ON family.id=mt.tag_id WHERE ${notQueued} AND family.ancestor=${row}.child_id AND (${enabled} OR ${tracked('m')});END;`);
 }
}
