import type { LuminaDatabase } from './index.js';
import {describeTagGraph,tagParents,type TagNode} from '@lumina/contracts';

export const tagFamilySql = `WITH RECURSIVE family(ancestor,id) AS (
  SELECT id,id FROM tags UNION SELECT f.ancestor,e.child_id FROM family f JOIN tag_edges e ON e.parent_id=f.id
) SELECT ancestor,id FROM family`;
export function descendantTagIds(db:LuminaDatabase,id:string):string[]{return (db.prepare(`SELECT id FROM (${tagFamilySql}) WHERE ancestor=?`).all(id) as {id:string}[]).map(row=>row.id);}
export function ancestorTagIds(db:LuminaDatabase,id:string):string[]{return (db.prepare(`WITH RECURSIVE ancestors(id) AS (SELECT id FROM tags WHERE id=? UNION SELECT e.parent_id FROM ancestors a JOIN tag_edges e ON e.child_id=a.id) SELECT id FROM ancestors`).all(id) as {id:string}[]).map(row=>row.id);}
export function tagHierarchy(db:LuminaDatabase){
  const rows=db.prepare('SELECT id,name,english_name AS englishName FROM tags ORDER BY name COLLATE NOCASE,id').all() as {id:string;name:string;englishName:string}[];
  const edges=db.prepare('SELECT parent_id AS parentId,child_id AS childId FROM tag_edges ORDER BY parent_id').all() as {parentId:string;childId:string}[];
  const parents=new Map<string,string[]>();for(const edge of edges)parents.set(edge.childId,[...(parents.get(edge.childId)??[]),edge.parentId]);
  return describeTagGraph(rows.map(row=>({...row,parentIds:parents.get(row.id)??[]})));
}
export function inheritTagAncestors(db:LuminaDatabase,mediaScope?:string|readonly string[]){
  if(Array.isArray(mediaScope) && !mediaScope.length)return;
  const scope=typeof mediaScope==='string'?' AND media_id=?':mediaScope?' AND media_id IN(SELECT value FROM json_each(?))':'';
  const parameters=mediaScope?[typeof mediaScope==='string'?mediaScope:JSON.stringify(mediaScope)]:[];
  db.prepare(`DELETE FROM media_tags WHERE EXISTS(SELECT 1 FROM media_tag_origins o WHERE o.media_id=media_tags.media_id AND o.tag_id=media_tags.tag_id AND o.source='ancestor')${scope}`).run(...parameters);
  db.prepare(`DELETE FROM media_tag_origins WHERE source='ancestor'${scope}`).run(...parameters);
  // Seed from the affected media instead of expanding the entire tag graph per file.
  const inherited=mediaScope?`WITH RECURSIVE inherited(media_id,tag_id) AS (
    SELECT media_id,tag_id FROM media_tags WHERE ${typeof mediaScope==='string'?'media_id=?':'media_id IN(SELECT value FROM json_each(?))'}
    UNION SELECT i.media_id,e.parent_id FROM inherited i JOIN tag_edges e ON e.child_id=i.tag_id
  ) SELECT media_id,tag_id FROM inherited`:`SELECT DISTINCT mt.media_id,f.ancestor FROM media_tags mt JOIN (${tagFamilySql}) f ON f.id=mt.tag_id WHERE f.ancestor<>f.id`;
  const inserted=db.prepare(`INSERT OR IGNORE INTO media_tags(media_id,tag_id) ${inherited}
    RETURNING media_id AS mediaId,tag_id AS tagId`).all(...parameters) as {mediaId:string;tagId:string}[];
  const origin=db.prepare("INSERT OR IGNORE INTO media_tag_origins(media_id,tag_id,source) VALUES(?,?,'ancestor')");
  for(const row of inserted)origin.run(row.mediaId,row.tagId);
}

export function setTagParents(db:LuminaDatabase,id:string,parentIds:string[]){
  return db.transaction(()=>{
    const tree=tagHierarchy(db);if(!tree.some(row=>row.id===id))throw new Error('标签不存在');const parents=[...new Set(parentIds)].sort();
    const previous=tree.find(row=>row.id===id)!.parentIds;if(JSON.stringify(previous)===JSON.stringify(parents))return;
    describeTagGraph(tree.map(row=>row.id===id?{...row,parentIds:parents}:row));
    const descendants=descendantTagIds(db,id);const affected=(db.prepare('SELECT DISTINCT media_id AS id FROM media_tags WHERE tag_id IN(SELECT value FROM json_each(?))').all(JSON.stringify(descendants)) as {id:string}[]).map(row=>row.id);
    db.prepare('DELETE FROM tag_edges WHERE child_id=?').run(id);const insert=db.prepare('INSERT INTO tag_edges(parent_id,child_id) VALUES(?,?)');for(const parent of parents)insert.run(parent,id);
    inheritTagAncestors(db,affected);
  })();
}
export function reparentTag(db:LuminaDatabase,id:string,parentId:string|null){return setTagParents(db,id,parentId?[parentId]:[]);}
export function addTagReference(db:LuminaDatabase,id:string,parentId:string){const tag=tagHierarchy(db).find(row=>row.id===id);if(!tag)throw new Error('标签不存在');return setTagParents(db,id,[...tag.parentIds,parentId]);}
export function moveTagReference(db:LuminaDatabase,id:string,fromParentId:string|null,parentId:string|null){
  if(db.prepare('SELECT 1 FROM directory_rules WHERE tag_id=?').get(id))throw new Error('目录标签的层级由目录规则管理，请在目录设置中修改');
  const tag=tagHierarchy(db).find(row=>row.id===id);if(!tag)throw new Error('标签不存在');
  if(fromParentId?!tag.parentIds.includes(fromParentId):tag.parentIds.length>0)throw new Error('标签引用已变化，请刷新后重试');
  return setTagParents(db,id,[...tag.parentIds.filter(parent=>parent!==fromParentId),...(parentId?[parentId]:[])]);
}
export function removeTagReference(db:LuminaDatabase,id:string,parentId:string){
  if(db.prepare('SELECT 1 FROM directory_edges WHERE parent_id=? AND child_id=?').get(parentId,id))throw new Error('该引用由目录规则管理，请在目录设置中修改');
  const tag=tagHierarchy(db).find(row=>row.id===id);if(!tag)throw new Error('标签不存在');if(!tag.parentIds.includes(parentId))throw new Error('标签引用已不存在');
  return setTagParents(db,id,tag.parentIds.filter(parent=>parent!==parentId));
}
// A shared descendant is never included in cascade deletion while an outside parent survives.
export function exclusiveTagBranch(db:LuminaDatabase,id:string):string[]{
  const tree=tagHierarchy(db),descendants=new Set(descendantTagIds(db,id)),deleted=new Set([id]);let changed=true;
  while(changed){changed=false;for(const row of tree)if(descendants.has(row.id) && !deleted.has(row.id) && row.parentIds.length && row.parentIds.every(parent=>deleted.has(parent))){deleted.add(row.id);changed=true;}}
  return [...deleted];
}
export function tagDeletionPreview(db:LuminaDatabase,id:string){
  const tree=tagHierarchy(db),tag=tree.find(row=>row.id===id);if(!tag)throw new Error('标签不存在');const ids=descendantTagIds(db,id),exclusive=exclusiveTagBranch(db,id);
  const rules=db.prepare('SELECT rule_json AS rule FROM smart_albums').all() as {rule:string}[];
  const countAlbums=(targets:string[])=>rules.filter(row=>{const rule=JSON.parse(row.rule);return [...rule.tags,...rule.notTags].some((item:string)=>targets.includes(item));}).length;
  return {tag,parents:tree.filter(row=>tag.parentIds.includes(row.id)),children:tree.filter(row=>row.id!==id && ids.includes(row.id)),exclusiveChildren:tree.filter(row=>row.id!==id && exclusive.includes(row.id)),sharedChildren:tree.filter(row=>ids.includes(row.id) && !exclusive.includes(row.id)),smartAlbums:countAlbums([id]),cascadeSmartAlbums:countAlbums(exclusive),mediaCount:(db.prepare('SELECT COUNT(DISTINCT media_id) AS total FROM media_tags WHERE tag_id=?').get(id) as {total:number}).total};
}
