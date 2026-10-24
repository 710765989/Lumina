import {setAlbumParent} from './album-management.js';
import {assertSameTagType} from './tag-types.js';
import {tagHiddenSql} from './visibility.js';
import {directoryTagInUse} from './directory-rules.js';
import {mediaOrder,type MediaSortBy} from './media-sort.js';
import { tagFamilySql, tagHierarchy, descendantTagIds, setTagParents, inheritTagAncestors } from './tag-hierarchy.js';
import { createHash, randomUUID } from 'node:crypto';
import type { SmartRule } from '@lumina/contracts';
import type { LuminaDatabase } from './index.js';

export type OrganizedMedia = { id: string; absolutePath: string; kind: string; sizeBytes: number; modifiedAtMs: number; capturedAtMs: number | null; fingerprint: string; hidden: boolean; metadata: Record<string, any> };
export const mediaColumns = `m.id, m.absolute_path AS absolutePath, m.kind, m.size_bytes AS sizeBytes,
  m.modified_at_ms AS modifiedAtMs, m.captured_at_ms AS capturedAtMs, m.fingerprint,
  EXISTS(SELECT 1 FROM hidden_media h WHERE h.media_id=m.id) AS hidden,
  COALESCE((SELECT metadata_json FROM media_details d WHERE d.media_id=m.id), '{}') AS metadataJson`;

export function visibleSql(alias = 'm', includeHidden = false): string {
  return `${alias}.kind IN ('photo','video')
    AND NOT EXISTS(SELECT 1 FROM media_details unavailable WHERE unavailable.media_id=${alias}.id AND unavailable.missing=1)
    AND NOT EXISTS(SELECT 1 FROM trash_entries x WHERE x.media_id=${alias}.id)
    AND NOT EXISTS(SELECT 1 FROM library_roots r WHERE r.enabled=0 AND
      (replace(${alias}.absolute_path,char(92),'/')=replace(r.absolute_path,char(92),'/') OR
       replace(${alias}.absolute_path,char(92),'/') LIKE rtrim(replace(r.absolute_path,char(92),'/'),'/') || '/%'))
    ${includeHidden ? '' : `AND NOT EXISTS(SELECT 1 FROM hidden_media h WHERE h.media_id=${alias}.id)
      AND NOT ${tagHiddenSql(alias)}`}`;
}

export function readMediaRows(rows: unknown[]): OrganizedMedia[] {
  return (rows as any[]).map(({ metadataJson, ...row }) => ({ ...row, hidden: Boolean(row.hidden), metadata: JSON.parse(metadataJson ?? '{}') }));
}
export function rawMedia(db: LuminaDatabase, id: string): OrganizedMedia | undefined {
  return readMediaRows(db.prepare(`SELECT ${mediaColumns} FROM media m WHERE m.id=?`).all(id))[0];
}
export function settings(db: LuminaDatabase) {
  const row = db.prepare("SELECT value_json FROM settings WHERE key='organization'").get() as { value_json: string } | undefined;
  return { retentionDays: 30 as number | null, expiryAction: 'system' as 'system' | 'permanent', watch: true, deleteMode: 'software' as 'software' | 'system' | 'permanent', syncHidden: false, idleSlideshowMinutes:0, ...(row ? JSON.parse(row.value_json) : {}) };
}
export function saveSettings(db: LuminaDatabase, value: unknown): void {
  db.prepare("INSERT INTO settings(key,value_json) VALUES('organization',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").run(JSON.stringify(value));
}
export function logOrganization(db: LuminaDatabase, action: string, detail: unknown) {
  db.prepare('INSERT INTO organization_log(action,detail_json) VALUES(?,?)').run(action, JSON.stringify(detail));
}
export function albumRule(db: LuminaDatabase, id: string): SmartRule | undefined {
  const row = db.prepare('SELECT rule_json FROM smart_albums WHERE album_id=?').get(id) as { rule_json: string } | undefined;
  return row ? JSON.parse(row.rule_json) : undefined;
}
export function validateRule(db: LuminaDatabase, rule: SmartRule) {
  if (!rule.tags.length) throw new Error('智能相册至少需要一个标签');
  if (rule.tags.some((id) => rule.notTags.includes(id))) throw new Error('相同标签不能同时包含和排除');
  for (const id of [...rule.tags, ...rule.notTags]) if (!db.prepare('SELECT id FROM tags WHERE id=?').get(id)) throw new Error('规则中的标签已删除，请重新选择');
}
function ruleWhere(rule: SmartRule) {
  const tags = [...new Set(rule.tags)];
  const parameters = [...tags, ...rule.notTags, ...rule.excludedMediaIds];
  const positive = !tags.length ? '0' : `m.id IN(SELECT mt.media_id FROM media_tags mt JOIN (${tagFamilySql}) family ON family.id=mt.tag_id WHERE family.ancestor IN(${tags.map(() => '?').join(',')}) GROUP BY mt.media_id ${rule.relation === 'AND' ? `HAVING COUNT(DISTINCT family.ancestor)=${tags.length}` : ''})`;
  const negative = rule.notTags.length ? `AND m.id NOT IN(SELECT mt.media_id FROM media_tags mt JOIN (${tagFamilySql}) family ON family.id=mt.tag_id WHERE family.ancestor IN(${rule.notTags.map(() => '?').join(',')}))` : '';
  const excluded = rule.excludedMediaIds.length ? `AND m.id NOT IN(${rule.excludedMediaIds.map(() => '?').join(',')})` : '';
  return { where: `${positive} ${negative} ${excluded}`, parameters };
}
export function ruleMembers(db: LuminaDatabase, rule: SmartRule, limit?: number, offset = 0, photoFirst = false,order?:{sortBy?:MediaSortBy;sort?:'asc'|'desc'}): OrganizedMedia[] {
  if (!rule.tags.length) return [];
  const { where, parameters } = ruleWhere(rule);
  return readMediaRows(db.prepare(`SELECT ${mediaColumns} FROM media m WHERE ${visibleSql()}
    AND ${where} ORDER BY ${photoFirst ? "(m.kind='photo') DESC," : ''} ${mediaOrder(order?.sortBy??'capturedAt',order?.sort)} ${limit === undefined ? '' : 'LIMIT ? OFFSET ?'}`).all(...parameters,...(limit === undefined ? [] : [limit,offset])));
}
export function albumMembers(db: LuminaDatabase, id: string, limit?: number, offset = 0, photoFirst = false,order?:{sortBy?:MediaSortBy;sort?:'asc'|'desc'}): OrganizedMedia[] {
  const rule = albumRule(db, id);
  if (rule) return ruleMembers(db, rule,limit,offset,photoFirst,order);
  return readMediaRows(db.prepare(`SELECT ${mediaColumns} FROM media m JOIN album_media a ON a.media_id=m.id
    WHERE a.album_id=? AND ${visibleSql()} ORDER BY ${photoFirst ? "(m.kind='photo') DESC," : ''} ${mediaOrder(order?.sortBy??'capturedAt',order?.sort)} ${limit === undefined ? '' : 'LIMIT ? OFFSET ?'}`).all(id,...(limit === undefined ? [] : [limit,offset])));
}
export function albumContains(db: LuminaDatabase, id: string, mediaId: string, includeHidden = false) {
  const rule = albumRule(db,id); const match = rule ? ruleWhere(rule) : { where: 'm.id IN(SELECT media_id FROM album_media WHERE album_id=?)', parameters: [id] };
  return Boolean(db.prepare(`SELECT 1 FROM media m WHERE m.id=? AND ${visibleSql('m',includeHidden)} AND ${match.where}`).get(mediaId,...match.parameters));
}
export function albumMemberIds(db: LuminaDatabase, id: string,order?:{sortBy?:MediaSortBy;sort?:'asc'|'desc'}): string[] {
  const rule = albumRule(db,id);
  const match = rule ? ruleWhere(rule) : { where: 'm.id IN(SELECT media_id FROM album_media WHERE album_id=?)', parameters: [id] };
  return (db.prepare(`SELECT m.id FROM media m WHERE ${visibleSql()} AND ${match.where}
    ORDER BY ${mediaOrder(order?.sortBy??'capturedAt',order?.sort)}`).all(...match.parameters) as {id:string}[]).map((row)=>row.id);
}
export function albumCandidates(db:LuminaDatabase,id:string,query:string,limit:number,offset:number,rule?:SmartRule) {
  const current=rule ?? albumRule(db,id); if(current)validateRule(db,current);
  const match=current ? ruleWhere(current) : {where:'m.id IN(SELECT media_id FROM album_media WHERE album_id=?)',parameters:[id]};
  const name=`%${query.replace(/[\\%_]/gu,'\\$&')}%`;
  const date=`%${query.replace(/[年/月.]/gu,'-').replace(/日$/u,'').replace(/[\\%_]/gu,'\\$&')}%`;
  return readMediaRows(db.prepare(`SELECT ${mediaColumns} FROM media m WHERE ${visibleSql()} AND ${match.where}
    AND (?='' OR COALESCE(NULLIF(m.file_name,''),m.absolute_path) LIKE ? ESCAPE '\\' OR
      strftime('%Y-%m-%d',COALESCE(m.captured_at_ms,m.modified_at_ms)/1000,'unixepoch','localtime') LIKE ? ESCAPE '\\')
    ORDER BY COALESCE(m.captured_at_ms,m.modified_at_ms) DESC,m.id LIMIT ? OFFSET ?`).all(...match.parameters,query,name,date,limit,offset));
}
export function albumMatchSql(db:LuminaDatabase,id:string){const rule=albumRule(db,id);return rule?ruleWhere(rule):{where:'m.id IN(SELECT media_id FROM album_media WHERE album_id=?)',parameters:[id]};}
export function albumSummary(db: LuminaDatabase, id: string) {
  const rule = albumRule(db,id); const match = rule ? ruleWhere(rule) : { where: 'm.id IN(SELECT media_id FROM album_media WHERE album_id=?)', parameters: [id] };
  const result=db.prepare(`SELECT COUNT(*) AS mediaCount,COALESCE(SUM(m.size_bytes),0) AS sizeBytes FROM media m WHERE ${visibleSql()} AND ${match.where}`).get(...match.parameters) as { mediaCount: number; sizeBytes: number };
  const hiddenByVisibility=Boolean(rule && result.mediaCount===0 && db.prepare(`SELECT 1 FROM media m WHERE m.kind IN('photo','video') AND ${match.where} LIMIT 1`).get(...match.parameters));
  return {...result,hiddenByVisibility};
}
export function rulePreview(db: LuminaDatabase, id: string | undefined, rule: SmartRule) {
  validateRule(db, rule);
  const next = ruleMembers(db, rule); const previous = id ? albumMembers(db, id) : [];
  const nextIds = new Set(next.map((item) => item.id)); const previousIds = new Set(previous.map((item) => item.id));
  const added = next.filter((item) => !previousIds.has(item.id)); const removed = previous.filter((item) => !nextIds.has(item.id));
  const revision = createHash('sha256').update(JSON.stringify({ rule, next: [...nextIds], previous: [...previousIds] })).digest('hex');
  const manual = id ? (db.prepare('SELECT manual_cover_media_id AS id FROM albums WHERE id=?').get(id) as { id: string | null } | undefined)?.id : null;
  return { total: next.length, added: added.length, removed: removed.length, addedSamples: added.slice(0, 5), removedSamples: removed.slice(0, 5), samples: next.slice(0, 5), revision, coverRetained: !manual || nextIds.has(manual) };
}
export function saveSmartAlbum(db: LuminaDatabase, changes: { id?: string; name: string; description: string; rule: SmartRule; revision: string; coverMediaId?: string | null;parentId?:string|null }) {
  const { id = randomUUID(), name, description, rule, revision } = changes;
  return db.transaction(() => {
    if (rulePreview(db, changes.id, rule).revision !== revision) throw new Error('匹配结果已变化，请重新计算变更预览');
    if (db.prepare('SELECT id FROM albums WHERE name=? COLLATE NOCASE AND id<>?').get(name.trim(), id)) throw new Error('相册名称已存在');
    if (changes.id && !albumRule(db, id)) throw new Error('该相册不是智能相册');
    db.prepare(`INSERT INTO albums(id,name,description) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,updated_at=CURRENT_TIMESTAMP`).run(id, name.trim(), description.trim());
    db.prepare("INSERT INTO smart_albums(album_id,rule_json) VALUES(?,?) ON CONFLICT(album_id) DO UPDATE SET rule_json=excluded.rule_json,source='user'").run(id, JSON.stringify(rule));
    if (changes.coverMediaId !== undefined) {
      const valid = changes.coverMediaId !== null && albumContains(db,id,changes.coverMediaId);
      db.prepare('UPDATE albums SET cover_mode=?,manual_cover_media_id=? WHERE id=?').run(valid ? 'manual' : 'auto',valid ? changes.coverMediaId : null,id);
    }
    if(changes.parentId!==undefined)setAlbumParent(db,id,changes.parentId);
    reconcileCover(db, id);
    return { id };
  })();
}
export function saveOrdinaryAlbum(db: LuminaDatabase, changes: { id?: string; name: string; description: string; tagIds: string[]; coverMediaId?: string | null;parentId?:string|null }) {
  return db.transaction(() => {
    const id = changes.id ?? randomUUID();
    if (changes.id && !db.prepare('SELECT id FROM albums WHERE id=?').get(id)) throw new Error('相册不存在');
    if (albumRule(db,id)) throw new Error('智能相册需要编辑标签规则');
    if(changes.id && db.prepare('SELECT 1 FROM albums WHERE id=? AND is_folder=1').get(id))throw new Error('请使用编辑文件夹');
    if (db.prepare('SELECT id FROM albums WHERE name=? COLLATE NOCASE AND id<>?').get(changes.name.trim(),id)) throw new Error('相册名称已存在');
    for (const tag of changes.tagIds){if (!db.prepare('SELECT id FROM tags WHERE id=?').get(tag)) throw new Error('绑定标签已删除，请重新选择');if(db.prepare("SELECT 1 FROM tag_options WHERE tag_id=? AND source='directory'").get(tag))throw new Error('相册标签只能使用普通标签，目录标签请在目录设置中管理');}
    if (changes.coverMediaId && !albumContains(db,id,changes.coverMediaId)) throw new Error('封面已不在相册内，请重新选择');
    db.prepare('INSERT INTO albums(id,name,description) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,updated_at=CURRENT_TIMESTAMP').run(id,changes.name.trim(),changes.description.trim());
    db.prepare('DELETE FROM album_tags WHERE album_id=?').run(id);
    const insert = db.prepare('INSERT OR IGNORE INTO album_tags(album_id,tag_id) VALUES(?,?)'); for (const tag of changes.tagIds) insert.run(id,tag);
    if(changes.parentId!==undefined)setAlbumParent(db,id,changes.parentId);
    applyOrdinaryAlbumTags(db,id);
    if (changes.coverMediaId !== undefined) db.prepare('UPDATE albums SET cover_mode=?,manual_cover_media_id=? WHERE id=?').run(changes.coverMediaId ? 'manual' : 'auto',changes.coverMediaId,id);
    return { id };
  })();
}

// Album tags are an additive tag application, not a destructive synchronization.
// Unbinding/deleting an album must never remove a media's existing tags.
export function ordinaryAlbumTagIds(db:LuminaDatabase,albumId:string){
  return (db.prepare(`WITH RECURSIVE parents(id) AS (SELECT id FROM albums WHERE id=? UNION SELECT a.parent_id FROM albums a JOIN parents p ON a.id=p.id WHERE a.parent_id IS NOT NULL) SELECT DISTINCT tag_id AS id FROM album_tags WHERE album_id IN(SELECT id FROM parents) AND NOT EXISTS(SELECT 1 FROM tag_options o WHERE o.tag_id=album_tags.tag_id AND o.source='directory')`).all(albumId) as {id:string}[]).map(row=>row.id);
}
export function applyOrdinaryAlbumTags(db:LuminaDatabase,albumId:string,mediaIds?:readonly string[],knownTags?:readonly string[]){
  const tags=knownTags??ordinaryAlbumTagIds(db,albumId);
  if(!tags.length)return;
  const ids=mediaIds?[...new Set(mediaIds)]:(db.prepare(`WITH RECURSIVE children(id) AS (SELECT id FROM albums WHERE id=? UNION SELECT a.id FROM albums a JOIN children c ON a.parent_id=c.id) SELECT DISTINCT am.media_id AS id FROM album_media am WHERE am.album_id IN(SELECT id FROM children) AND NOT EXISTS(SELECT 1 FROM trash_entries t WHERE t.media_id=am.media_id)`).all(albumId) as {id:string}[]).map(row=>row.id);
  if(!ids.length)return;
  const scope=JSON.stringify(ids);
  for(const tag of tags){
    db.prepare('INSERT OR IGNORE INTO media_tags(media_id,tag_id) SELECT id,? FROM media WHERE id IN(SELECT value FROM json_each(?))').run(tag,scope);
    db.prepare("INSERT INTO media_tag_origins(media_id,tag_id,source) SELECT media_id,tag_id,'user' FROM media_tags WHERE tag_id=? AND media_id IN(SELECT value FROM json_each(?)) ON CONFLICT(media_id,tag_id) DO UPDATE SET source='user'").run(tag,scope);
  }
  inheritTagAncestors(db,ids);
}
export function reconcileCover(db: LuminaDatabase, id: string) {
  const row = db.prepare('SELECT manual_cover_media_id AS cover FROM albums WHERE id=?').get(id) as { cover: string | null } | undefined;
  if (row?.cover && albumContains(db,id,row.cover)) return rawMedia(db,row.cover) ?? null;
  if (row?.cover && !albumContains(db,id,row.cover,true)) db.prepare("UPDATE albums SET cover_mode='auto',manual_cover_media_id=NULL WHERE id=?").run(id);
  return albumMembers(db,id,1,0,true)[0] ?? null;
}
export function reconcileAllCovers(db: LuminaDatabase) {
  for (const row of db.prepare('SELECT id FROM albums WHERE manual_cover_media_id IS NOT NULL').all() as { id: string }[]) reconcileCover(db, row.id);
}
export function tagDetails(db: LuminaDatabase) {
  const hierarchy=tagHierarchy(db);
  const details=(db.prepare(`SELECT t.id,t.name,COALESCE(o.color,'#2b73df') AS color,COALESCE(o.group_name,'') AS "group",
    COALESCE(o.aliases_json,'[]') AS aliasesJson,COALESCE(o.blocked,0) AS blocked,COALESCE(o.source,'user') AS source,
    COALESCE(o.source='directory',0) AS directory,COALESCE(counts.total,0) AS count
    FROM tags t LEFT JOIN tag_options o ON o.tag_id=t.id LEFT JOIN (
      SELECT family.ancestor AS tagId,COUNT(DISTINCT mt.media_id) AS total FROM media_tags mt JOIN (${tagFamilySql}) family ON family.id=mt.tag_id
      WHERE NOT EXISTS(SELECT 1 FROM trash_entries x WHERE x.media_id=mt.media_id) GROUP BY family.ancestor
    ) counts ON counts.tagId=t.id ORDER BY t.name COLLATE NOCASE`).all() as any[])
    .map(({ aliasesJson, blocked,directory, ...row }) => ({ ...row, directory:Boolean(directory),blocked: Boolean(blocked), aliases: JSON.parse(aliasesJson) }));
  const byId=new Map(details.map((row)=>[row.id,row]));return hierarchy.map((node)=>({...byId.get(node.id),...node}));
}
export function mergePreview(db: LuminaDatabase, source: string, target: string) {
  if (source === target) throw new Error('请选择两个不同的标签');
  assertSameTagType(db,source,[target],'merge');
  if(descendantTagIds(db,source).includes(target))throw new Error('不能将父标签合并到其子标签');
  for (const id of [source, target]) if (!db.prepare('SELECT id FROM tags WHERE id=?').get(id)) throw new Error('标签不存在');
  const albums = (db.prepare('SELECT album_id,rule_json FROM smart_albums').all() as { album_id: string; rule_json: string }[])
    .filter((row) => { const rule: SmartRule = JSON.parse(row.rule_json); return [...rule.tags, ...rule.notTags].includes(source); });
  const conflicting = albums.filter((row) => {
    const rule: SmartRule = JSON.parse(row.rule_json);
    const tags = rule.tags.map((id) => id === source ? target : id); const not = rule.notTags.map((id) => id === source ? target : id);
    return tags.some((id) => not.includes(id));
  }).map((row) => row.album_id);
  const mediaIds = (db.prepare('SELECT media_id FROM media_tags WHERE tag_id=? ORDER BY media_id').all(source) as { media_id: string }[]).map((row) => row.media_id);
  const edges=db.prepare('SELECT parent_id,child_id FROM tag_edges ORDER BY parent_id,child_id').all();
  const revision = createHash('sha256').update(JSON.stringify({ source, target, albums, mediaIds,edges })).digest('hex');
  return { mediaCount: mediaIds.length, albumCount: albums.length, conflicting, revision };
}
export function mergeTags(db: LuminaDatabase, source: string, target: string, revision: string) {
  return db.transaction(() => {
    const preview = mergePreview(db, source, target);
    if(directoryTagInUse(db,source) || directoryTagInUse(db,target))throw new Error('目录标签请先解除目录规则再合并');
    if (preview.revision !== revision) throw new Error('影响范围已变化，请重新预览');
    if (preview.conflicting.length) throw new Error('合并会产生包含/排除冲突，请先修改智能相册规则');
    db.prepare('INSERT OR IGNORE INTO media_tags(media_id,tag_id) SELECT media_id,? FROM media_tags WHERE tag_id=?').run(target, source);
    db.prepare('INSERT OR IGNORE INTO album_tags(album_id,tag_id) SELECT album_id,? FROM album_tags WHERE tag_id=?').run(target,source);
    db.prepare("INSERT INTO media_tag_origins(media_id,tag_id,source) SELECT media_id,?,'user' FROM media_tags WHERE tag_id=? ON CONFLICT(media_id,tag_id) DO UPDATE SET source='user'").run(target,source);
    for (const row of db.prepare('SELECT album_id,rule_json FROM smart_albums').all() as any[]) {
      const rule: SmartRule = JSON.parse(row.rule_json);
      rule.tags = [...new Set(rule.tags.map((id) => id === source ? target : id))];
      rule.notTags = [...new Set(rule.notTags.map((id) => id === source ? target : id))];
      db.prepare('UPDATE smart_albums SET rule_json=? WHERE album_id=?').run(JSON.stringify(rule), row.album_id);
    }
    const sourceOptions = db.prepare('SELECT blocked,aliases_json FROM tag_options WHERE tag_id=?').get(source) as { blocked: number; aliases_json: string } | undefined;
    const targetOptions = db.prepare('SELECT aliases_json FROM tag_options WHERE tag_id=?').get(target) as { aliases_json: string } | undefined;
    const sourceName = (db.prepare('SELECT name FROM tags WHERE id=?').get(source) as { name: string }).name;
    const aliases = [...new Set([...JSON.parse(targetOptions?.aliases_json ?? '[]'), sourceName, ...JSON.parse(sourceOptions?.aliases_json ?? '[]')])];
    db.prepare('INSERT INTO tag_options(tag_id,aliases_json) VALUES(?,?) ON CONFLICT(tag_id) DO UPDATE SET aliases_json=excluded.aliases_json').run(target,JSON.stringify(aliases));
    if (sourceOptions?.blocked) db.prepare('INSERT INTO tag_options(tag_id,blocked) VALUES(?,1) ON CONFLICT(tag_id) DO UPDATE SET blocked=1').run(target);
    const tree=tagHierarchy(db),sourceNode=tree.find(row=>row.id===source)!,targetNode=tree.find(row=>row.id===target)!;
    setTagParents(db,target,[...targetNode.parentIds,...sourceNode.parentIds].filter(id=>id!==target && id!==source));
    if(sourceNode.rootReference||targetNode.rootReference)db.prepare('UPDATE tags SET root_reference=1 WHERE id=?').run(target);
    for(const row of tree.filter(row=>row.parentIds.includes(source)))setTagParents(db,row.id,[...row.parentIds.filter(id=>id!==source),target]);
    db.prepare('DELETE FROM tags WHERE id=?').run(source);
    inheritTagAncestors(db);
    logOrganization(db, 'tags.merge', { source, target, ...preview }); reconcileAllCovers(db);
    return preview;
  })();
}
export function updateMetadata(db: LuminaDatabase, id: string, changes: Record<string, unknown>) {
  const previous = rawMedia(db, id); if (!previous) throw new Error('媒体不存在');
  db.prepare(`INSERT INTO media_details(media_id,metadata_json) VALUES(?,?) ON CONFLICT(media_id) DO UPDATE SET metadata_json=excluded.metadata_json`).run(id, JSON.stringify({ ...previous.metadata, ...changes }));
}
