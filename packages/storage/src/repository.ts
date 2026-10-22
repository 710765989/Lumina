import {tagHiddenSql} from './visibility.js';
import {directoryTagInUse,saveDirectoryConfiguration,directoryContains,directoryRuleContext,applyDirectoryRules} from './directory-rules.js';
import {mediaOrder,type MediaSortBy} from './media-sort.js';
import { ancestorTagIds, descendantTagIds, tagFamilySql, inheritTagAncestors, tagHierarchy, exclusiveTagBranch, setTagParents } from './tag-hierarchy.js';
import { randomUUID,randomInt } from 'node:crypto';
import path from 'node:path';
import {tagColors} from '@lumina/contracts';
import type { MediaKind, MediaRecord } from '@lumina/contracts';
import type { LuminaDatabase } from './index.js';
import { albumMatchSql, albumRule, albumMembers, albumContains, reconcileAllCovers,applyOrdinaryAlbumTags } from './organization.js';

export interface LibraryRootRecord {
  id: string;
  absolutePath: string;
  label: string;
  enabled: boolean;
}

export interface AlbumRecord {
  isFolder?:boolean;
  parentId?:string|null;
  id: string;
  name: string;
  description: string;
  coverMode: 'auto' | 'manual';
  manualCoverMediaId: string | null;
  kind?: 'ordinary' | 'smart';
  rule?: import('@lumina/contracts').SmartRule;
}

export interface MediaListItem extends MediaRecord {
  hidden: boolean;
  metadata: Record<string, unknown>;
}

type MediaRow = {
  id: string;
  absolute_path: string;
  kind: MediaKind;
  size_bytes: number;
  modified_at_ms: number;
  captured_at_ms: number | null;
  fingerprint: string;
  hidden: number;
  metadata_json: string;
};

export type {MediaSortBy} from './media-sort.js';

function toMedia(row: MediaRow): MediaListItem {
  return {
    id: row.id,
    absolutePath: row.absolute_path,
    kind: row.kind,
    sizeBytes: row.size_bytes,
    modifiedAtMs: row.modified_at_ms,
    capturedAtMs: row.captured_at_ms,
    fingerprint: row.fingerprint,
    hidden: row.hidden === 1,
    metadata: JSON.parse(row.metadata_json ?? '{}'),
  };
}

export function addLibraryRoot(db: LuminaDatabase, absolutePath: string, label = absolutePath): LibraryRootRecord {
  const id = randomUUID();
  db.prepare(`INSERT INTO library_roots(id, absolute_path, label)
    VALUES (?, ?, ?)
    ON CONFLICT(absolute_path) DO UPDATE SET label=excluded.label, enabled=1, updated_at=CURRENT_TIMESTAMP`)
    .run(id, absolutePath, label);
  const root = db.prepare(`SELECT id, absolute_path as absolutePath, label, enabled
    FROM library_roots WHERE absolute_path=?`).get(absolutePath) as LibraryRootRecord;
  return {...root,enabled:Boolean(root.enabled)};
}

export function listLibraryRoots(db: LuminaDatabase): LibraryRootRecord[] {
  return (db.prepare(`SELECT id, absolute_path as absolutePath, label, enabled
    FROM library_roots ORDER BY label COLLATE NOCASE, id`).all() as LibraryRootRecord[]).map(root=>({...root,enabled:Boolean(root.enabled)}));
}

export function setLibraryRootEnabled(db: LuminaDatabase, id: string, enabled: boolean): void {
  db.prepare('UPDATE library_roots SET enabled=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(enabled ? 1 : 0, id);
  refreshMediaStats(db);
}

export function removeLibraryRoot(db: LuminaDatabase, id: string): number {
  const root = db.prepare('SELECT absolute_path as absolutePath FROM library_roots WHERE id=?').get(id) as { absolutePath: string } | undefined;
  if (!root) return 0;
  const tx = db.transaction(() => {
    saveDirectoryConfiguration(db,id,{rules:[],autoAlbums:false,hierarchy:false});
    const rootMatch = `replace(absolute_path, char(92), char(47)) = replace(?, char(92), char(47))`;
    const descendantMatch = `replace(absolute_path, char(92), char(47)) LIKE rtrim(replace(?, char(92), char(47)), char(47)) || char(47) || '%'`;
    const media = (db.prepare(`SELECT id,absolute_path AS absolutePath FROM media WHERE (${rootMatch} OR ${descendantMatch}) AND id NOT IN(SELECT media_id FROM trash_entries)`).all(root.absolutePath, root.absolutePath) as Array<{ id: string;absolutePath:string }>).filter(item=>directoryContains(root.absolutePath,item.absolutePath));
    const others=listLibraryRoots(db).filter(row=>row.id!==id),context=directoryRuleContext(db),removed:string[]=[];
    const removeSearch = db.prepare('DELETE FROM media_fts WHERE media_id=?');
    for (const item of media) {if(others.some(other=>directoryContains(other.absolutePath,item.absolutePath))){applyDirectoryRules(db,item.id,item.absolutePath,context);continue;}removeSearch.run(item.id);removed.push(item.id);}
    db.prepare('DELETE FROM media WHERE id IN(SELECT value FROM json_each(?))').run(JSON.stringify(removed));
    db.prepare('DELETE FROM library_roots WHERE id=?').run(id);
    db.prepare('DELETE FROM settings WHERE key=?').run(`directory-paths:${id}`);
    refreshMediaStats(db);
    return removed.length;
  });
  return tx();
}

function enabledRootClause(alias = 'm', includeBlocked = false): string {
  return `NOT EXISTS(SELECT 1 FROM trash_entries x WHERE x.media_id=${alias}.id)
    AND NOT EXISTS(SELECT 1 FROM media_details unavailable WHERE unavailable.media_id=${alias}.id AND unavailable.missing=1)
    ${includeBlocked ? '' : `AND NOT ${tagHiddenSql(alias)}`}
    AND NOT EXISTS (SELECT 1 FROM library_roots disabled_root
    WHERE disabled_root.enabled=0
      AND (replace(${alias}.absolute_path, char(92), char(47)) = replace(disabled_root.absolute_path, char(92), char(47))
        OR replace(${alias}.absolute_path, char(92), char(47)) LIKE rtrim(replace(disabled_root.absolute_path, char(92), char(47)), char(47)) || char(47) || '%'))`;
}

export function syncMediaSearchIndex(db: LuminaDatabase, record: MediaRecord): void {
  db.prepare('DELETE FROM media_fts WHERE media_id=?').run(record.id);
  db.prepare('INSERT INTO media_fts(media_id, searchable) VALUES (?, ?)').run(
    record.id,
    `${record.absolutePath} ${record.kind}`,
  );
}

export function listMedia(db: LuminaDatabase, options: { includeHidden?: boolean; kind?: 'photo' | 'video'; sort?: 'asc' | 'desc'; sortBy?: MediaSortBy; limit?: number; offset?: number } = {}): MediaListItem[] {
  const includeHidden = options.includeHidden ?? false;
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const offset = Math.max(0, options.offset ?? 0);
  const hiddenClause = includeHidden ? '' : 'AND h.media_id IS NULL';
  const kindClause = options.kind ? 'AND m.kind=?' : '';
  const order = mediaOrder(options.sortBy, options.sort);
  const rows = db.prepare(`SELECT m.id, m.absolute_path, m.kind, m.size_bytes, m.modified_at_ms, m.captured_at_ms,
    m.fingerprint, COALESCE((SELECT metadata_json FROM media_details d WHERE d.media_id=m.id),'{}') AS metadata_json, CASE WHEN h.media_id IS NULL THEN 0 ELSE 1 END AS hidden
    FROM media m LEFT JOIN hidden_media h ON h.media_id=m.id
    WHERE m.kind <> 'unknown' AND ${enabledRootClause('m',includeHidden)} ${hiddenClause} ${kindClause}
    ORDER BY ${order} LIMIT ? OFFSET ?`).all(...(options.kind ? [options.kind, limit, offset] : [limit, offset])) as MediaRow[];
  return rows.map(toMedia);
}

type MediaStats = { total: number; photo: number; video: number; totalSizeBytes: number; photoSizeBytes: number; videoSizeBytes: number };

export function refreshMediaStats(db: LuminaDatabase): MediaStats {
  const row = db.prepare(`SELECT COUNT(*) AS total, SUM(m.size_bytes) AS total_size_bytes,
    SUM(CASE WHEN m.kind='photo' THEN 1 ELSE 0 END) AS photo,
    SUM(CASE WHEN m.kind='video' THEN 1 ELSE 0 END) AS video,
    SUM(CASE WHEN m.kind='photo' THEN m.size_bytes ELSE 0 END) AS photo_bytes,
    SUM(CASE WHEN m.kind='video' THEN m.size_bytes ELSE 0 END) AS video_bytes
    FROM media m
    WHERE m.kind IN ('photo', 'video') AND ${enabledRootClause()}`).get() as { total: number; total_size_bytes: number | null; photo: number | null; video: number | null; photo_bytes: number | null; video_bytes: number | null };
  const stats = { total: Number(row.total), photo: Number(row.photo ?? 0), video: Number(row.video ?? 0), totalSizeBytes: Number(row.total_size_bytes ?? 0), photoSizeBytes: Number(row.photo_bytes ?? 0), videoSizeBytes: Number(row.video_bytes ?? 0) };
  db.prepare(`INSERT INTO settings(key, value_json) VALUES ('media_stats', ?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`).run(JSON.stringify(stats));
  return stats;
}

export function getMediaStats(db: LuminaDatabase): MediaStats {
  const cached = db.prepare("SELECT value_json as valueJson FROM settings WHERE key='media_stats'").get() as { valueJson: string } | undefined;
  if (cached) {
    try {
      const stats = JSON.parse(cached.valueJson) as MediaStats;
      if (Number.isFinite(stats.total) && Number.isFinite(stats.photo) && Number.isFinite(stats.video) && Number.isFinite(stats.totalSizeBytes) && Number.isFinite(stats.photoSizeBytes) && Number.isFinite(stats.videoSizeBytes)) return stats;
    } catch { /* rebuild invalid cache */ }
  }
  return refreshMediaStats(db);
}

export function getMediaById(db: LuminaDatabase, mediaId: string, includeHidden=false): MediaListItem | undefined {
  const row = db.prepare(`SELECT m.id, m.absolute_path, m.kind, m.size_bytes, m.modified_at_ms, m.captured_at_ms,
    m.fingerprint, COALESCE((SELECT metadata_json FROM media_details d WHERE d.media_id=m.id),'{}') AS metadata_json, CASE WHEN h.media_id IS NULL THEN 0 ELSE 1 END AS hidden
    FROM media m LEFT JOIN hidden_media h ON h.media_id=m.id WHERE m.id=? AND m.kind <> 'unknown' AND ${enabledRootClause('m',includeHidden)}`).get(mediaId) as MediaRow | undefined;
  return row ? toMedia(row) : undefined;
}

export type MediaSearchOptions = { query?:string;hiddenOnly?:boolean;albumId?:string;tagId?:string; timeBeforeMs?:number;timeFromMs?:number; untaggedOnly?:boolean;excludeUntagged?:boolean; fileNames?: string[];excludeFileNames?:string[];extensions?:string[]; tagNames?: string[]; excludeTagNames?: string[]; includeHidden?: boolean; kind?: 'photo' | 'video'; sort?: 'asc' | 'desc'; sortBy?: MediaSortBy; limit?: number; offset?: number };
function mediaSearchSql(db:LuminaDatabase,query: string, options: MediaSearchOptions) {
  const clauses: string[] = []; const parameters: (string | number)[] = [];
  if(options.albumId){const match=albumMatchSql(db,options.albumId);clauses.push(match.where);parameters.push(...match.parameters);}
  if(options.tagId){clauses.push(`m.id IN(SELECT mt.media_id FROM media_tags mt JOIN (${tagFamilySql}) family ON family.id=mt.tag_id WHERE family.ancestor=?)`);parameters.push(options.tagId);}
  const fileName = "COALESCE(NULLIF(m.file_name,''),m.absolute_path)";
  const like = (value: string) => `%${value.replace(/[\\%_]/gu, '\\$&')}%`;
  const tagMatch = `EXISTS(SELECT 1 FROM media_tags mt JOIN (${tagFamilySql}) family ON family.id=mt.tag_id JOIN tags t ON t.id=family.ancestor LEFT JOIN tag_options o ON o.tag_id=t.id WHERE mt.media_id=m.id AND (t.name=? COLLATE NOCASE OR (t.english_name<>'' AND t.english_name=? COLLATE NOCASE) OR EXISTS(SELECT 1 FROM json_each(COALESCE(o.aliases_json,'[]')) a WHERE a.value=? COLLATE NOCASE)))`;
  for (const name of options.fileNames ?? []) { const phonetic=/^[a-z\d ._-]+$/iu.test(name) && /[a-z]/iu.test(name);clauses.push(phonetic?`(${fileName} LIKE ? ESCAPE '\\' OR lumina_matches(${fileName},?))`:`${fileName} LIKE ? ESCAPE '\\'`); parameters.push(like(name.trim()));if(phonetic)parameters.push(name.trim()); }
  for (const name of options.excludeFileNames ?? []) { const phonetic=/^[a-z\d ._-]+$/iu.test(name) && /[a-z]/iu.test(name);clauses.push(phonetic?`NOT (${fileName} LIKE ? ESCAPE '\\' OR lumina_matches(${fileName},?))`:`${fileName} NOT LIKE ? ESCAPE '\\'`);parameters.push(like(name.trim()));if(phonetic)parameters.push(name.trim()); }
  const extensions=[...new Set((options.extensions??[]).map(extension=>extension.trim().replace(/^\*?\./u,'').toLowerCase()))];
  if(extensions.length){clauses.push(`(${extensions.map(()=>`lower(substr(${fileName},-length(?)))=?`).join(' OR ')})`);for(const extension of extensions)parameters.push(`.${extension}`,`.${extension}`);}
  for (const name of options.tagNames ?? []) { clauses.push(tagMatch); parameters.push(name.trim(),name.trim(),name.trim()); }
  for (const name of options.excludeTagNames ?? []) { clauses.push(`NOT ${tagMatch}`); parameters.push(name.trim(),name.trim(),name.trim()); }
  if(options.untaggedOnly)clauses.push('NOT EXISTS(SELECT 1 FROM media_tags any_tag WHERE any_tag.media_id=m.id)');
  if(options.excludeUntagged)clauses.push('EXISTS(SELECT 1 FROM media_tags any_tag WHERE any_tag.media_id=m.id)');
  const time=options.sortBy==='capturedAt'?'COALESCE(m.captured_at_ms,m.modified_at_ms)':'m.modified_at_ms';
  if(options.timeBeforeMs!==undefined){clauses.push(`${time}<?`);parameters.push(options.timeBeforeMs);}
  if(options.timeFromMs!==undefined){clauses.push(`${time}>=?`);parameters.push(options.timeFromMs);}
  const normalized = query.trim();
  if (normalized) {
    const matchQuery = normalized.split(/\s+/u).map((token) => token.replace(/[^\p{L}\p{N}_]/gu,'')).filter(Boolean).map((token) => `"${token}"*`).join(' AND ');
    clauses.push(`(${fileName} LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM media_tags mt JOIN tags t ON t.id=mt.tag_id LEFT JOIN tag_options o ON o.tag_id=t.id WHERE mt.media_id=m.id AND (t.name LIKE ? ESCAPE '\\' OR t.english_name LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM json_each(COALESCE(o.aliases_json,'[]')) a WHERE a.value LIKE ? ESCAPE '\\'))) ${matchQuery ? 'OR m.id IN(SELECT media_id FROM media_fts WHERE media_fts MATCH ?)' : ''})`);
    parameters.push(like(normalized),like(normalized),like(normalized),like(normalized)); if (matchQuery) parameters.push(matchQuery);
    if(/^[a-z\d ._-]+$/iu.test(normalized) && /[a-z]/iu.test(normalized)){const literal=clauses.pop()!;clauses.push(`(${literal} OR lumina_matches(${fileName},?) OR EXISTS(SELECT 1 FROM media_tags mt JOIN tags t ON t.id=mt.tag_id WHERE mt.media_id=m.id AND lumina_matches(t.name,?)))`);parameters.push(normalized,normalized);}
  }
  if (options.kind) { clauses.push('m.kind=?'); parameters.push(options.kind); }
  if(options.hiddenOnly)clauses.push(`(h.media_id IS NOT NULL OR ${tagHiddenSql()})`);
  else if (!options.includeHidden) clauses.push('h.media_id IS NULL');
  return { sql: `FROM media m LEFT JOIN hidden_media h ON h.media_id=m.id
    WHERE m.kind IN ('photo','video') AND ${enabledRootClause('m',Boolean(options.hiddenOnly))} ${clauses.map((clause) => `AND ${clause}`).join(' ')}
    ORDER BY ${mediaOrder(options.sortBy,options.sort)}`, parameters };
}

const formatLists=new WeakMap<LuminaDatabase,Map<boolean,{revision:string;formats:string[]}>>();
export function libraryFormats(db:LuminaDatabase,hiddenOnly=false):string[]{
  // In-memory index query only. Repeated menu opens reuse the result; both local
  // mutations and commits from another connection invalidate it immediately.
  const revision=`${(db.prepare('SELECT total_changes() AS count').get() as {count:number}).count}:${db.pragma('data_version',{simple:true})}`;
  let lists=formatLists.get(db);if(!lists){lists=new Map();formatLists.set(db,lists);}
  const cached=lists.get(hiddenOnly);if(cached?.revision===revision)return [...cached.formats];
  const source=mediaSearchSql(db,'',{hiddenOnly,includeHidden:hiddenOnly}),sql=source.sql.slice(0,source.sql.lastIndexOf('ORDER BY'));
  const formats=new Set<string>();
  // Do not decode media or consult metadata.format: the filter searches the
  // actual filename suffix (e.g. jpg and jpeg are separate searchable formats).
  for(const row of db.prepare(`SELECT COALESCE(NULLIF(m.file_name,''),m.absolute_path) AS name ${sql}`).iterate(...source.parameters) as Iterable<{name:string}>){
    const suffix=path.win32.extname(row.name).slice(1).toLowerCase();if(/^[a-z0-9]{1,20}$/u.test(suffix))formats.add(suffix);
  }
  const result=[...formats].sort();lists.set(hiddenOnly,{revision,formats:result});return [...result];
}

export function mediaTimeline(db:LuminaDatabase,query:string,options:MediaSearchOptions={}){
  const source=mediaSearchSql(db,query,{...options,includeHidden:Boolean(options.hiddenOnly),timeBeforeMs:undefined,timeFromMs:undefined});const sql=source.sql.slice(0,source.sql.lastIndexOf('ORDER BY'));const time=options.sortBy==='capturedAt'?'COALESCE(m.captured_at_ms,m.modified_at_ms)':'m.modified_at_ms';
  return (db.prepare(`SELECT strftime('%Y-%m',${time}/1000,'unixepoch','localtime') AS month,COUNT(*) AS count ${sql} GROUP BY month ORDER BY month ${options.sort==='asc'?'ASC':'DESC'}`).all(...source.parameters) as {month:string|null;count:number}[]).filter((row):row is {month:string;count:number}=>Boolean(row.month));
}

export function searchMediaStats(db:LuminaDatabase,query:string,options:MediaSearchOptions={}){
  const source=mediaSearchSql(db,query,{...options,includeHidden:Boolean(options.hiddenOnly)});const sql=source.sql.slice(0,source.sql.lastIndexOf('ORDER BY'));
  return db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(m.kind='photo'),0) AS photo,COALESCE(SUM(m.kind='video'),0) AS video,COALESCE(SUM(m.size_bytes),0) AS totalSizeBytes ${sql}`).get(...source.parameters);
}

export function searchMedia(db: LuminaDatabase, query: string, options: MediaSearchOptions = {}): MediaListItem[] {
  const {sql,parameters} = mediaSearchSql(db,query,options);
  const rows = db.prepare(`SELECT m.id,m.absolute_path,m.kind,m.size_bytes,m.modified_at_ms,m.captured_at_ms,m.fingerprint,
    COALESCE((SELECT metadata_json FROM media_details d WHERE d.media_id=m.id),'{}') AS metadata_json, CASE WHEN h.media_id IS NULL THEN 0 ELSE 1 END AS hidden ${sql} LIMIT ? OFFSET ?`)
    .all(...parameters,Math.max(1,Math.min(options.limit ?? 200,1000)),Math.max(0,options.offset ?? 0)) as MediaRow[];
  return rows.map(toMedia);
}

export function searchMediaIds(db: LuminaDatabase, query: string, options: MediaSearchOptions = {}): string[] {
  const {sql,parameters} = mediaSearchSql(db,query,options);
  return (db.prepare(`SELECT m.id ${sql}`).all(...parameters) as {id:string}[]).map((row)=>row.id);
}

export function tagMediaIds(db: LuminaDatabase, id: string,options:{sortBy?:MediaSortBy;sort?:'asc'|'desc'}={}): string[] {
  return (db.prepare(`SELECT m.id FROM media m LEFT JOIN hidden_media h ON h.media_id=m.id
    WHERE m.id IN(SELECT mt.media_id FROM media_tags mt JOIN (${tagFamilySql}) family ON family.id=mt.tag_id WHERE family.ancestor=?) AND m.kind IN('photo','video') AND h.media_id IS NULL AND ${enabledRootClause()}
    ORDER BY ${mediaOrder(options.sortBy,options.sort)}`).all(id) as {id:string}[]).map((row)=>row.id);
}

export function hideMedia(db: LuminaDatabase, mediaId: string): void {
  changeVisibility(db,mediaId,()=>{db.prepare('DELETE FROM tag_visibility_exceptions WHERE media_id=?').run(mediaId);db.prepare('INSERT OR IGNORE INTO hidden_media(media_id) VALUES (?)').run(mediaId);});
}

export function unhideMedia(db: LuminaDatabase, mediaId: string,tagIds:readonly string[]=[]): void {
  changeVisibility(db,mediaId,()=>{db.prepare('DELETE FROM hidden_media WHERE media_id=?').run(mediaId);if(tagIds.length)db.prepare(`INSERT OR IGNORE INTO tag_visibility_exceptions(media_id,tag_id) SELECT ?,o.tag_id FROM tag_options o WHERE o.blocked=1 AND o.tag_id IN(SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM media_tags mt JOIN (${tagFamilySql}) family ON family.id=mt.tag_id WHERE mt.media_id=? AND family.ancestor=o.tag_id)`).run(mediaId,JSON.stringify(tagIds),mediaId);});
}
function changeVisibility(db:LuminaDatabase,id:string,mutate:()=>void){
 db.transaction(()=>{const eligible=db.prepare(`SELECT m.kind,m.size_bytes AS bytes FROM media m WHERE m.id=? AND ${enabledRootClause()}`),before=eligible.get(id) as {kind:string;bytes:number}|undefined;mutate();const after=eligible.get(id) as typeof before;
  if(Boolean(before)===Boolean(after))return;
  const saved=db.prepare("SELECT value_json AS value FROM settings WHERE key='media_stats'").get() as {value:string}|undefined;if(!saved){refreshMediaStats(db);return;}
  let stats:MediaStats;try{stats=JSON.parse(saved.value);if(!['total','photo','video','totalSizeBytes','photoSizeBytes','videoSizeBytes'].every(key=>Number.isFinite((stats as any)[key])))throw Error();}catch{refreshMediaStats(db);return;}
  const delta=after?1:-1,row=(after??before)!;stats.total+=delta;stats.totalSizeBytes+=delta*row.bytes;if(row.kind==='photo'){stats.photo+=delta;stats.photoSizeBytes+=delta*row.bytes;}else{stats.video+=delta;stats.videoSizeBytes+=delta*row.bytes;}
  db.prepare("UPDATE settings SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE key='media_stats'").run(JSON.stringify(stats));
 })();
}
/** Recalculate only media associated with the changed label, never the whole library. */
export function changeTagVisibility(db:LuminaDatabase,tagId:string,mutate:()=>void){
 db.transaction(()=>{
  const count=db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(m.kind='photo'),0) AS photo,COALESCE(SUM(m.kind='video'),0) AS video,COALESCE(SUM(m.size_bytes),0) AS totalSizeBytes,COALESCE(SUM(CASE WHEN m.kind='photo' THEN m.size_bytes ELSE 0 END),0) AS photoSizeBytes,COALESCE(SUM(CASE WHEN m.kind='video' THEN m.size_bytes ELSE 0 END),0) AS videoSizeBytes FROM media m WHERE m.id IN(SELECT mt.media_id FROM media_tags mt JOIN (${tagFamilySql}) family ON family.id=mt.tag_id WHERE family.ancestor=?) AND m.kind IN('photo','video') AND ${enabledRootClause()}`);
  const before=count.get(tagId) as MediaStats;mutate();const after=count.get(tagId) as MediaStats;
  const saved=db.prepare("SELECT value_json AS value FROM settings WHERE key='media_stats'").get() as {value:string}|undefined;
  if(!saved){refreshMediaStats(db);return;}let stats:MediaStats;try{stats=JSON.parse(saved.value);for(const key of Object.keys(before) as (keyof MediaStats)[]){if(!Number.isFinite(stats[key]))throw Error();stats[key]+=after[key]-before[key];}}catch{refreshMediaStats(db);return;}
  db.prepare("UPDATE settings SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE key='media_stats'").run(JSON.stringify(stats));
 })();
}

/** Remove an item from Lumina's index while leaving the user's file untouched. */
export function removeMediaFromIndex(db: LuminaDatabase, mediaId: string): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM media_fts WHERE media_id=?').run(mediaId);
    db.prepare('DELETE FROM media WHERE id=?').run(mediaId);
    refreshMediaStats(db);
  });
  tx();
}

export function createAlbum(db: LuminaDatabase, name: string, description = ''): AlbumRecord {
  name = validateAlbumName(db, name);
  const id = randomUUID();
  db.prepare('INSERT INTO albums(id, name, description) VALUES (?, ?, ?)').run(id, name.trim(), description.trim());
  return getAlbum(db, id)!;
}

export function getAlbum(db: LuminaDatabase, id: string): AlbumRecord | undefined {
  return db.prepare(`SELECT id, name, description, cover_mode as coverMode,
    manual_cover_media_id as manualCoverMediaId,parent_id AS parentId,is_folder AS isFolder FROM albums WHERE id=?`).get(id) as AlbumRecord | undefined;
}

export function listAlbums(db: LuminaDatabase): AlbumRecord[] {
  return db.prepare(`SELECT id, name, description, cover_mode as coverMode,
    manual_cover_media_id as manualCoverMediaId,parent_id AS parentId,is_folder AS isFolder FROM albums ORDER BY updated_at DESC, id`).all() as AlbumRecord[];
}

export function updateAlbum(db: LuminaDatabase, id: string, changes: { name?: string; description?: string }): void {
  if (!getAlbum(db, id)) throw new Error('相册不存在，请刷新后重试');
  const name = changes.name === undefined ? undefined : validateAlbumName(db, changes.name, id);
  db.transaction(() => {
    if (name !== undefined) db.prepare('UPDATE albums SET name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, id);
    if (changes.description !== undefined) db.prepare('UPDATE albums SET description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(changes.description.trim(), id);
  })();
}

function validateAlbumName(db: LuminaDatabase, name: string, exceptId = ''): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 200) throw new Error('请输入 1–200 个字符的相册名称');
  if (db.prepare('SELECT id FROM albums WHERE name=? COLLATE NOCASE AND id<>?').get(trimmed, exceptId)) throw new Error('相册名称已存在');
  return trimmed;
}

export function deleteAlbum(db: LuminaDatabase, id: string): void {
  db.transaction(()=>{const album=getAlbum(db,id);if(!album)return;db.prepare('UPDATE albums SET parent_id=? WHERE parent_id=?').run(album.parentId??null,id);db.prepare('DELETE FROM albums WHERE id=?').run(id);})();
}

export function addMediaToAlbum(db: LuminaDatabase, albumId: string, mediaIds: string[]): number {
  if(getAlbum(db,albumId)?.isFolder)throw new Error('文件夹用于组织相册，请选择普通相册加入媒体');
  if (albumRule(db, albumId)) throw new Error('智能相册由标签规则自动整理，不能手动加入');
  const insert = db.prepare('INSERT OR IGNORE INTO album_media(album_id, media_id) VALUES (?, ?)');
  let added = 0;
  const tx = db.transaction((ids: string[]) => { for (const mediaId of ids){added += Number(insert.run(albumId, mediaId).changes);db.prepare('UPDATE directory_album_media SET owned=0 WHERE album_id=? AND media_id=?').run(albumId,mediaId);}applyOrdinaryAlbumTags(db,albumId,ids); });
  tx(mediaIds);
  return added;
}

export function removeMediaFromAlbum(db: LuminaDatabase, albumId: string, mediaIds: string[]): number {
  const remove = db.prepare('DELETE FROM album_media WHERE album_id=? AND media_id=?');
  let removed = 0;
  const tx = db.transaction((ids: string[]) => { for (const mediaId of ids) removed += Number(remove.run(albumId, mediaId).changes); });
  tx(mediaIds);
  return removed;
}

export function listAlbumMedia(db:LuminaDatabase,albumId:string,options:MediaSearchOptions={}):MediaListItem[]{return searchMedia(db,options.query??'',{...options,albumId,sortBy:options.sortBy??'capturedAt'});}

export function setAlbumCover(db: LuminaDatabase, albumId: string, mediaId: string | null): void {
  if (mediaId !== null && !albumContains(db, albumId,mediaId)) throw new Error('请从当前相册内选择可见的媒体作为封面');
  if (mediaId === null) {
    db.prepare("UPDATE albums SET cover_mode='auto', manual_cover_media_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(albumId);
    return;
  }
  db.prepare("UPDATE albums SET cover_mode='manual', manual_cover_media_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(mediaId, albumId);
}

export function findTag(db:LuminaDatabase,name:string):{id:string;name:string;englishName:string}|undefined{
  const direct=db.prepare('SELECT id,name,english_name AS englishName FROM tags WHERE name=? COLLATE NOCASE').get(name.trim()) as {id:string;name:string;englishName:string}|undefined;if(direct)return direct;
  const rows=db.prepare("SELECT t.id,t.name,t.english_name AS englishName FROM tags t LEFT JOIN tag_options o ON o.tag_id=t.id WHERE (t.english_name<>'' AND t.english_name=? COLLATE NOCASE) OR EXISTS(SELECT 1 FROM json_each(COALESCE(o.aliases_json,'[]')) a WHERE a.value=? COLLATE NOCASE)").all(name.trim(),name.trim()) as {id:string;name:string;englishName:string}[];
  if(rows.length>1)throw new Error('多个标签使用了该英文名或别名，请选择具体标签');return rows[0];
}
export function createTag(db: LuminaDatabase, name: string, source:'user'|'directory'='user'): string {
  const original=name.trim();let candidate=original,canonical=findTag(db,candidate),suffix=1;
  while(canonical){const row=db.prepare('SELECT source FROM tag_options WHERE tag_id=?').get(canonical.id) as {source:string}|undefined;const directory=row?.source==='directory';
    if(directory===(source==='directory'))return canonical.id;
    if(source==='user')throw new Error('该名称已用于目录标签，请使用其他普通标签名称');
    candidate=`${original.slice(0,90)}（目录${suffix===1?'':suffix}）`;suffix++;canonical=findTag(db,candidate);
  }
  name=candidate;
  return db.transaction(()=>{const id=randomUUID();
    const inserted=db.prepare('INSERT INTO tags(id,name,english_name) VALUES(?,?,?) ON CONFLICT(name) DO NOTHING').run(id,name.trim(),/\p{Script=Han}/u.test(name)?'':name.trim());
    if(inserted.changes)db.prepare('INSERT INTO tag_options(tag_id,color,source) VALUES(?,?,?)').run(id,tagColors[randomInt(tagColors.length)]!.value,source);
    return String((db.prepare('SELECT id FROM tags WHERE name=?').get(name.trim()) as {id:string}).id);
  })();
}

export function deleteTag(db: LuminaDatabase, tagId: string, deleteChildren=false): void {
  db.transaction(() => {
    if(directoryTagInUse(db,tagId))throw new Error('该标签用于目录规则，请先在目录设置中移除规则');
    if(!db.prepare('SELECT id FROM tags WHERE id=?').get(tagId))throw new Error('标签不存在');
    const tree=tagHierarchy(db),targets=deleteChildren?exclusiveTagBranch(db,tagId):[tagId];if(targets.some(id=>directoryTagInUse(db,id)))throw new Error('子标签用于目录规则，请先解除目录规则');
    if(!deleteChildren){const parents=tree.find(row=>row.id===tagId)!.parentIds;for(const child of tree.filter(row=>row.parentIds.includes(tagId)))setTagParents(db,child.id,[...child.parentIds.filter(parent=>parent!==tagId),...parents]);}
    for (const row of db.prepare('SELECT album_id,rule_json FROM smart_albums').all() as { album_id: string; rule_json: string }[]) {
      const rule = JSON.parse(row.rule_json) as import('@lumina/contracts').SmartRule;
      rule.tags = rule.tags.filter((id) => !targets.includes(id)); rule.notTags = rule.notTags.filter((id) => !targets.includes(id));
      db.prepare('UPDATE smart_albums SET rule_json=? WHERE album_id=?').run(JSON.stringify(rule), row.album_id);
    }
    for(const id of targets.reverse())db.prepare('DELETE FROM tags WHERE id=?').run(id);inheritTagAncestors(db);reconcileAllCovers(db);
  })();
}

export function renameTag(db: LuminaDatabase, tagId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) throw new Error('请输入 1–100 个字符的标签名称');
  if (!db.prepare('SELECT id FROM tags WHERE id=?').get(tagId)) throw new Error('标签不存在，请刷新后重试');
  if (db.prepare('SELECT id FROM tags WHERE name=? COLLATE NOCASE AND id<>?').get(trimmed, tagId)) throw new Error('标签名称已存在');
  if (db.prepare("SELECT t.id FROM tags t JOIN tag_options o ON o.tag_id=t.id,json_each(o.aliases_json) a WHERE t.id<>? AND a.value=? COLLATE NOCASE").get(tagId,trimmed)) throw new Error('该名称已是其他标签的别名');
  db.prepare('UPDATE tags SET name=? WHERE id=?').run(trimmed, tagId);
}

export function listTagMedia(db:LuminaDatabase,tagId:string,options:MediaSearchOptions={}):MediaListItem[]{return searchMedia(db,options.query??'',{...options,tagId});}

export function setMediaTags(db: LuminaDatabase, mediaId: string, tagNames: string[]): void {
  const names = [...new Set(tagNames.map((name) => name.trim()).filter(Boolean))];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM media_tags WHERE media_id=?').run(mediaId);db.prepare('DELETE FROM media_tag_origins WHERE media_id=?').run(mediaId);
    for (const name of names) {addTagToMedia(db,mediaId,name);}
    for(const row of db.prepare('SELECT tag_id AS id FROM directory_media_tags WHERE media_id=?').all(mediaId) as {id:string}[]){db.prepare('INSERT OR IGNORE INTO media_tags(media_id,tag_id) VALUES(?,?)').run(mediaId,row.id);db.prepare("INSERT OR IGNORE INTO media_tag_origins(media_id,tag_id,source) VALUES(?,?,'directory')").run(mediaId,row.id);}inheritTagAncestors(db,mediaId);
  });
  tx();
}

export function addTagToMedia(db: LuminaDatabase, mediaId: string, tagName: string): void {
  const tagId = createTag(db, tagName);
  const recent = db.prepare("SELECT value_json FROM settings WHERE key='recent-tags'").get() as {value_json:string}|undefined;
  const previous: string[] = recent ? JSON.parse(recent.value_json) : [];
  if (previous[0] !== tagId) db.prepare("INSERT INTO settings(key,value_json) VALUES('recent-tags',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").run(JSON.stringify([tagId,...previous.filter((id)=>id!==tagId)].slice(0,100)));
  const insert=db.prepare('INSERT OR IGNORE INTO media_tags(media_id,tag_id) VALUES(?,?)');for(const ancestor of ancestorTagIds(db,tagId)){const direct=db.prepare('SELECT 1 FROM media_tags WHERE media_id=? AND tag_id=?').get(mediaId,ancestor);insert.run(mediaId,ancestor);if(ancestor!==tagId && !direct)db.prepare("INSERT OR IGNORE INTO media_tag_origins(media_id,tag_id,source) VALUES(?,?,'ancestor')").run(mediaId,ancestor);}
  db.prepare("INSERT INTO media_tag_origins(media_id,tag_id,source) VALUES(?,?,'user') ON CONFLICT(media_id,tag_id) DO UPDATE SET source='user'").run(mediaId,tagId);
}

export function removeTagFromMedia(db: LuminaDatabase, mediaId: string, tagName: string): void {
  const tag=findTag(db,tagName);if(tag){if(db.prepare('SELECT 1 FROM directory_media_tags WHERE media_id=? AND tag_id=?').get(mediaId,tag.id))throw new Error('该标签由目录规则提供，请在目录设置中修改');const children=descendantTagIds(db,tag.id).filter((id)=>id!==tag.id);if(children.some((id)=>db.prepare('SELECT 1 FROM media_tags WHERE media_id=? AND tag_id=?').get(mediaId,id)))throw new Error('该父标签由子标签自动包含，请先移除对应子标签');db.prepare('DELETE FROM media_tag_origins WHERE media_id=? AND tag_id=?').run(mediaId,tag.id);}
  if(tag)db.prepare('DELETE FROM media_tags WHERE media_id=? AND tag_id=?').run(mediaId,tag.id);inheritTagAncestors(db,mediaId);
}

export function listMediaTags(db: LuminaDatabase, mediaId: string): Array<{ id: string; name: string;englishName:string }> {
  return db.prepare(`SELECT DISTINCT t.id,t.name,t.english_name AS englishName FROM media_tags mt JOIN (${tagFamilySql}) family ON family.id=mt.tag_id JOIN tags t ON t.id=family.ancestor
    WHERE mt.media_id=? ORDER BY t.name COLLATE NOCASE, t.id`).all(mediaId) as Array<{ id: string; name: string;englishName:string }>;
}

export function listTags(db: LuminaDatabase): Array<{ id: string; name: string }> {
  return db.prepare('SELECT id,name,english_name AS englishName FROM tags ORDER BY name COLLATE NOCASE, id').all() as Array<{ id: string; name: string }>;
}

// Directory tagging includes indexed hidden/disabled media, but never recycle entries.
const rootMediaScope=`FROM media m JOIN library_roots r ON r.id=? WHERE m.kind IN('photo','video')
  AND (lower(replace(m.absolute_path,char(92),'/'))=lower(replace(r.absolute_path,char(92),'/'))
    OR instr(lower(replace(m.absolute_path,char(92),'/')),lower(rtrim(replace(r.absolute_path,char(92),'/'),'/'))||'/')=1)
  AND NOT EXISTS(SELECT 1 FROM trash_entries x WHERE x.media_id=m.id)
  AND NOT EXISTS(SELECT 1 FROM media_details d WHERE d.media_id=m.id AND d.missing=1)`;
export function rootMediaIds(db:LuminaDatabase,rootId:string):string[]{
  if(!db.prepare('SELECT 1 FROM library_roots WHERE id=?').get(rootId))throw new Error('图库目录不存在');
  return (db.prepare(`SELECT m.id ${rootMediaScope} ORDER BY m.id`).all(rootId) as {id:string}[]).map(row=>row.id);
}
export function rootContainsMedia(db:LuminaDatabase,rootId:string,mediaId:string){return Boolean(db.prepare(`SELECT 1 ${rootMediaScope} AND m.id=?`).get(rootId,mediaId));}
