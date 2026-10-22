import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {LuminaDatabase} from './index.js';
import {createTag,createAlbum} from './repository.js';
import {ancestorTagIds,inheritTagAncestors,tagHierarchy} from './tag-hierarchy.js';
import {describeTagGraph} from '@lumina/contracts';
import {applyOrdinaryAlbumTags,ordinaryAlbumTagIds} from './organization.js';

export function relativeDirectory(value:string){
 const normalized=value.replaceAll('\\','/').replace(/^\.\/?$/u,'');
 if(path.isAbsolute(normalized) || path.win32.isAbsolute(normalized) || normalized.split('/').some(part=>part==='..' || part==='.' || !part && normalized!==''))throw new Error('子目录必须位于所选目录内');
 return normalized.replace(/\/$/u,'');
}
export function directoryContains(directory:string,file:string){const relative=path.relative(path.resolve(directory),path.resolve(file));return relative!== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);}
export type DirectoryOptions={autoAlbums:boolean;hierarchy:boolean;rules:{relativePath:string;name:string}[]};
// Preserve known empty directories without rewalking the filesystem on settings edits.
export function rememberDirectoryPaths(db:LuminaDatabase,rootId:string,paths:string[]){
 db.prepare('INSERT INTO settings(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').run(`directory-paths:${rootId}`,JSON.stringify([...new Set(paths.map(relativeDirectory))]));
}
export function knownDirectoryPaths(db:LuminaDatabase,rootId:string){
 const saved=db.prepare('SELECT value_json FROM settings WHERE key=?').get(`directory-paths:${rootId}`) as {value_json:string}|undefined;
 const paths=new Set<string>(['',...(saved?JSON.parse(saved.value_json) as string[]:[])]);
 for(const row of db.prepare('SELECT relative_path AS relativePath FROM directory_rules WHERE root_id=? UNION SELECT relative_path FROM directory_albums WHERE root_id=?').all(rootId,rootId) as {relativePath:string}[])paths.add(row.relativePath);
 return paths;
}
export function directoryConfiguration(db:LuminaDatabase,id:string){
 const options=db.prepare('SELECT auto_albums AS autoAlbums,hierarchy FROM directory_settings WHERE root_id=?').get(id) as {autoAlbums:number;hierarchy:number}|undefined;
 return {autoAlbums:Boolean(options?.autoAlbums),hierarchy:Boolean(options?.hierarchy),rules:db.prepare('SELECT r.relative_path AS relativePath,t.name,r.tag_id AS tagId FROM directory_rules r JOIN tags t ON t.id=r.tag_id WHERE r.root_id=? ORDER BY length(r.relative_path),r.relative_path').all(id)};
}
export function saveDirectoryConfiguration(db:LuminaDatabase,rootId:string,options:DirectoryOptions){
 return db.transaction(()=>{
  if(!db.prepare('SELECT 1 FROM library_roots WHERE id=?').get(rootId))throw new Error('图库目录不存在');
  const order=(a:{relativePath:string;name:string},b:{relativePath:string;name:string})=>a.relativePath.split('/').length-b.relativePath.split('/').length || a.relativePath.localeCompare(b.relativePath) || a.name.localeCompare(b.name);
  const rules=[...new Map(options.rules.map(row=>{const item={relativePath:relativeDirectory(row.relativePath),name:row.name.trim()};return [JSON.stringify([item.relativePath.toLowerCase(),item.name.toLowerCase()]),item] as const;})).values()].sort(order);
  const old=db.prepare('SELECT id,relative_path AS relativePath,tag_id AS tagId FROM directory_rules WHERE root_id=?').all(rootId) as {id:string;relativePath:string;tagId:string}[];
  const sameRules=JSON.stringify(rules)===JSON.stringify((directoryConfiguration(db,rootId).rules as {relativePath:string;name:string}[]).map(({relativePath,name})=>({relativePath,name})).sort(order));
  if(!sameRules){
  const oldIds=new Map(old.map(row=>[JSON.stringify([row.relativePath,row.tagId]),row.id]));
  db.prepare('DELETE FROM directory_rules WHERE root_id=?').run(rootId);
  for(const rule of rules){const id=createTag(db,rule.name,'directory');db.prepare('INSERT OR IGNORE INTO directory_rules(id,root_id,relative_path,tag_id) VALUES(?,?,?,?)').run(oldIds.get(JSON.stringify([rule.relativePath,id]))??randomUUID(),rootId,rule.relativePath,id);}
  // Reconcile only edges owned by directory configuration; manual references survive.
  const all=db.prepare('SELECT root_id AS rootId,relative_path AS relativePath,tag_id AS tagId FROM directory_rules ORDER BY length(relative_path),relative_path').all() as {rootId:string;relativePath:string;tagId:string}[];
  const desired=new Map<string,{parent:string;child:string}>();
  const byPath=new Map<string,typeof all>();for(const row of all){const key=row.rootId+'/'+row.relativePath.toLowerCase();byPath.set(key,[...(byPath.get(key)??[]),row]);}
  for(const row of all){let current=row.relativePath;while(current){current=path.posix.dirname(current);if(current==='.')current='';const parents=byPath.get(row.rootId+'/'+current.toLowerCase());if(parents){for(const parent of parents){if(parent.tagId===row.tagId)throw new Error('父子目录不能使用同一个标签');desired.set(parent.tagId+'/'+row.tagId,{parent:parent.tagId,child:row.tagId});}break;}}}
  const tracked=db.prepare('SELECT parent_id AS parent,child_id AS child,owned FROM directory_edges').all() as {parent:string;child:string;owned:number}[];
  for(const row of tracked)if(!desired.has(row.parent+'/'+row.child)){if(row.owned)db.prepare('DELETE FROM tag_edges WHERE parent_id=? AND child_id=?').run(row.parent,row.child);db.prepare('DELETE FROM directory_edges WHERE parent_id=? AND child_id=?').run(row.parent,row.child);}
  for(const row of desired.values()){const exists=Boolean(db.prepare('SELECT 1 FROM tag_edges WHERE parent_id=? AND child_id=?').get(row.parent,row.child));db.prepare('INSERT OR IGNORE INTO directory_edges(parent_id,child_id,owned) VALUES(?,?,?)').run(row.parent,row.child,exists?0:1);db.prepare('INSERT OR IGNORE INTO tag_edges(parent_id,child_id) VALUES(?,?)').run(row.parent,row.child);}
  describeTagGraph(tagHierarchy(db));inheritTagAncestors(db); // Reject cycles and more than five tag levels atomically.
  }
  if(!options.autoAlbums)db.prepare('UPDATE directory_album_media SET owned=0 WHERE album_id IN(SELECT album_id FROM directory_albums WHERE root_id=?)').run(rootId);
  else if(!options.hierarchy)db.prepare("UPDATE directory_album_media SET owned=0 WHERE album_id IN(SELECT album_id FROM directory_albums WHERE root_id=? AND relative_path<>'')").run(rootId);
  db.prepare('INSERT INTO directory_settings(root_id,auto_albums,hierarchy) VALUES(?,?,?) ON CONFLICT(root_id) DO UPDATE SET auto_albums=excluded.auto_albums,hierarchy=excluded.hierarchy').run(rootId,options.autoAlbums?1:0,options.autoAlbums && options.hierarchy?1:0);
  return directoryConfiguration(db,rootId);
 })();
}
export function directoryTagInUse(db:LuminaDatabase,id:string){return Boolean(db.prepare('SELECT 1 FROM directory_rules WHERE tag_id=?').get(id));}
export function directoryRuleContext(db:LuminaDatabase){const byDirectory=new Map<string,Set<string>>();for(const rule of db.prepare('SELECT l.absolute_path AS root,r.relative_path AS relativePath,r.tag_id AS tagId FROM directory_rules r JOIN library_roots l ON l.id=r.root_id').all() as {root:string;relativePath:string;tagId:string}[]){const key=path.resolve(rule.root,rule.relativePath).toLowerCase();const tags=byDirectory.get(key)??new Set<string>();tags.add(rule.tagId);byDirectory.set(key,tags);}return {byDirectory,
 rules:db.prepare('SELECT r.id,r.tag_id AS tagId,r.relative_path AS relativePath,l.absolute_path AS root FROM directory_rules r JOIN library_roots l ON l.id=r.root_id').all() as {id:string;tagId:string;relativePath:string;root:string}[],
 albums:db.prepare('SELECT s.root_id AS rootId,l.absolute_path AS root,l.label,s.hierarchy FROM directory_settings s JOIN library_roots l ON l.id=s.root_id WHERE s.auto_albums=1').all() as {rootId:string;root:string;label:string;hierarchy:number}[],
 albumChanges:false,albumCache:new Map<string,string>(),ancestors:new Map<string,string[]>(),albumTags:new Map<string,string[]>()
};}
type Context=ReturnType<typeof directoryRuleContext>;
function boundAlbum(db:LuminaDatabase,context:Context,root:Context['albums'][number],relative:string):string{
 const key=root.rootId+'/'+relative,cached=context.albumCache.get(key);if(cached)return cached;
 let row=db.prepare('SELECT album_id AS id FROM directory_albums WHERE root_id=? AND relative_path=?').get(root.rootId,relative) as {id:string}|undefined;
 if(!row){const base=relative?path.posix.basename(relative):root.label;let name=base;let suffix=2;while(db.prepare('SELECT 1 FROM albums WHERE name=? COLLATE NOCASE').get(name))name=`${base} (${suffix++})`;const album=createAlbum(db,name,`目录相册 · ${path.join(root.root,relative)}`);row={id:album.id};context.albumChanges=true;db.prepare('INSERT INTO directory_albums(root_id,relative_path,album_id) VALUES(?,?,?)').run(root.rootId,relative,row.id);}
 const parent=relative?boundAlbum(db,context,root,path.posix.dirname(relative)==='.'?'':path.posix.dirname(relative)):null;
 const actual=(db.prepare('SELECT parent_id AS parentId FROM albums WHERE id=?').get(row.id) as {parentId:string|null}).parentId;if(actual!==parent){db.prepare('UPDATE albums SET parent_id=? WHERE id=?').run(parent,row.id);context.albumChanges=true;}context.albumCache.set(key,row.id);return row.id;
}
export function applyDirectoryRules(db:LuminaDatabase,mediaId:string,file:string,context=directoryRuleContext(db),options:{tags?:boolean}={}){
 if(db.prepare('SELECT 1 FROM trash_entries WHERE media_id=?').get(mediaId))return;
 if(options.tags!==false){
 const tags=new Set<string>();let directory=path.dirname(path.resolve(file));while(true){for(const id of context.byDirectory.get(directory.toLowerCase())??[])tags.add(id);const parent=path.dirname(directory);if(parent===directory)break;directory=parent;}
 const previous=db.prepare('SELECT tag_id AS id FROM directory_media_tags WHERE media_id=?').all(mediaId) as {id:string}[];
 let changed=previous.length!==tags.size || previous.some(row=>!tags.has(row.id));
 for(const row of previous)if(!tags.has(row.id)){db.prepare("DELETE FROM media_tags WHERE media_id=? AND tag_id=? AND EXISTS(SELECT 1 FROM media_tag_origins o WHERE o.media_id=? AND o.tag_id=? AND o.source='directory')").run(mediaId,row.id,mediaId,row.id);db.prepare('DELETE FROM directory_media_tags WHERE media_id=? AND tag_id=?').run(mediaId,row.id);}
 for(const tagId of tags){const inserted=db.prepare('INSERT OR IGNORE INTO media_tags(media_id,tag_id) VALUES(?,?)').run(mediaId,tagId);changed ||= Boolean(inserted.changes);db.prepare("INSERT INTO media_tag_origins(media_id,tag_id,source) VALUES(?,?,'directory') ON CONFLICT(media_id,tag_id) DO UPDATE SET source=CASE WHEN source='ancestor' THEN 'directory' ELSE source END").run(mediaId,tagId);db.prepare('INSERT OR IGNORE INTO directory_media_tags(media_id,tag_id) VALUES(?,?)').run(mediaId,tagId);}
 if(changed){inheritTagAncestors(db,mediaId);}
 // Explicit parent references may have changed without changing the directory leaf.
 for(const id of tags){let ancestors=context.ancestors.get(id);if(!ancestors){ancestors=ancestorTagIds(db,id);context.ancestors.set(id,ancestors);}for(const ancestor of ancestors){const inserted=db.prepare('INSERT OR IGNORE INTO media_tags(media_id,tag_id) VALUES(?,?)').run(mediaId,ancestor);if(inserted.changes)db.prepare("INSERT OR IGNORE INTO media_tag_origins(media_id,tag_id,source) VALUES(?,?,'ancestor')").run(mediaId,ancestor);}}
 }
 const albums=new Set<string>();
 for(const root of context.albums)if(directoryContains(root.root,file)){albums.add(boundAlbum(db,context,root,''));if(root.hierarchy){let current=path.relative(root.root,path.dirname(file)).split(path.sep).join('/');while(current && current!=='.'){albums.add(boundAlbum(db,context,root,current));current=path.posix.dirname(current);}}}
 for(const row of db.prepare('SELECT album_id AS id,owned FROM directory_album_media WHERE media_id=?').all(mediaId) as {id:string;owned:number}[])if(!albums.has(row.id)){if(row.owned)db.prepare('DELETE FROM album_media WHERE media_id=? AND album_id=?').run(mediaId,row.id);db.prepare('DELETE FROM directory_album_media WHERE media_id=? AND album_id=?').run(mediaId,row.id);}
 for(const albumId of albums){const inserted=db.prepare('INSERT OR IGNORE INTO album_media(album_id,media_id) VALUES(?,?)').run(albumId,mediaId);db.prepare('INSERT OR IGNORE INTO directory_album_media(album_id,media_id,owned) VALUES(?,?,?)').run(albumId,mediaId,inserted.changes?1:0);let tags=context.albumTags.get(albumId);if(!tags){tags=ordinaryAlbumTagIds(db,albumId);context.albumTags.set(albumId,tags);}if(tags.length)applyOrdinaryAlbumTags(db,albumId,[mediaId],tags);}
}
export function mediaCardTags(db:LuminaDatabase,ids:string[]){
 const rows=db.prepare(`SELECT mt.media_id AS mediaId,t.id,t.name,t.english_name AS englishName,COALESCE(o.color,'#2b73df') AS color,COALESCE(o.source='directory',0) AS directory FROM media_tags mt JOIN tags t ON t.id=mt.tag_id LEFT JOIN tag_options o ON o.tag_id=t.id WHERE mt.media_id IN(SELECT value FROM json_each(?)) ORDER BY directory DESC,t.name`).all(JSON.stringify(ids)) as {mediaId:string;id:string;name:string;englishName:string;color:string;directory:number}[];
 const result:Record<string,typeof rows>={};for(const id of ids)result[id]=[];for(const row of rows)result[row.mediaId]!.push(row);return result;
}

export function ensureDirectoryAlbums(db:LuminaDatabase,rootId:string,paths:string[]){const context=directoryRuleContext(db),root=context.albums.find(row=>row.rootId===rootId);if(!root)return;db.transaction(()=>{boundAlbum(db,context,root,'');if(root.hierarchy)for(const relative of paths)boundAlbum(db,context,root,relativeDirectory(relative));})();return context.albumChanges;}
