import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { mediaColumns, readMediaRows, visibleSql, type LuminaDatabase, type OrganizedMedia } from '@lumina/storage';
import { hashFile } from './file-operations.js';
import { similarGroups, type SimilarityLevel } from './similarity.js';
type Duplicate=OrganizedMedia & {contentHash:string};
export function duplicateGroups(db:LuminaDatabase):Duplicate[][] {
  const rows=readMediaRows(db.prepare(`SELECT ${mediaColumns},d.content_hash AS contentHash FROM media m JOIN media_details d ON d.media_id=m.id
    WHERE ${visibleSql()} AND d.hash_fingerprint=m.fingerprint AND d.content_hash IN
      (SELECT content_hash FROM media_details WHERE content_hash IS NOT NULL GROUP BY content_hash HAVING COUNT(*)>1)
    ORDER BY d.content_hash,m.created_at,m.id`).all()) as Duplicate[];
  const groups=new Map<string,Duplicate[]>();for(const row of rows){const group=groups.get(row.contentHash)??[];group.push(row);groups.set(row.contentHash,group);}
  return [...groups.values()].filter((group)=>group.length>1);
}
export function duplicateCleanup(db:LuminaDatabase,keepIds:string[],hash?:string,removeIds?:string[]) {
  const input=new Set(keepIds);const current=duplicateGroups(db).filter((group)=>!hash || group[0]!.contentHash===hash);
  if(keepIds.some((id)=>!current.some((group)=>group.some((media)=>media.id===id))))throw new Error('重复检测结果已变化，请刷新后重新选择保留项');
  const selected=removeIds===undefined?undefined:new Set(removeIds);if(removeIds?.some(id=>!current.some(group=>group.some(media=>media.id===id))))throw new Error('勾选项目已变化，请刷新后重新选择');
  const groups=current.map((group)=>{
    const chosen=group.filter((media)=>input.has(media.id));if(chosen.length>1)throw new Error('每个重复组请选择一个保留项');
    const preferred=chosen[0]??group[0]!;const remove=group.filter(media=>selected?selected.has(media.id):media.id!==preferred.id);const removed=new Set(remove.map(media=>media.id));const retained=group.filter(media=>!removed.has(media.id));const keep=retained.find(media=>media.id===preferred.id)??retained[0]??null;return {hash:group[0]!.contentHash,keep,retained,remove};
  }).filter(group=>group.remove.length>0);
  const revision=createHash('sha256').update(JSON.stringify(groups.map((group)=>({keep:group.keep?.id??null,remove:group.remove.map(media=>media.id),items:[...group.retained,...group.remove].map((media)=>[media.id,media.fingerprint])})))).digest('hex');
  return {groups,revision,emptyGroups:groups.filter(group=>!group.retained.length).length,keepCount:groups.reduce((sum,group)=>sum+group.retained.length,0),mediaIds:groups.flatMap((group)=>group.remove.map((media)=>media.id)),sizeBytes:groups.reduce((sum,group)=>sum+group.remove.reduce((total,media)=>total+media.sizeBytes,0),0)};
}
export async function validateDuplicateCleanup(db:LuminaDatabase,keepIds:string[],revision:string,hash?:string,signal?:AbortSignal,removeIds?:string[],allowDeleteAll=false) {
  const preview=duplicateCleanup(db,keepIds,hash,removeIds);
  if(preview.revision!==revision || !preview.mediaIds.length)throw new Error('重复检测结果已变化，请关闭确认框并重新预览');
  if(preview.emptyGroups && !allowDeleteAll)throw new Error('包含整组删除，请先确认这些组将不保留任何文件');
  for(const group of preview.groups){if(signal?.aborted)throw new Error('已取消，未执行');
    const keep=group.keep;if(!keep)continue;const before=await stat(keep.absolutePath);
    if(!before.isFile() || before.size!==keep.sizeBytes || Math.abs(before.mtimeMs-keep.modifiedAtMs)>1 || await hashFile(keep.absolutePath,signal)!==group.hash)throw new Error('拟保留的原文件已变化，请重新扫描和检测后再清理');
    const after=await stat(keep.absolutePath);if(before.ino!==after.ino || before.dev!==after.dev || before.size!==after.size || before.mtimeMs!==after.mtimeMs)throw new Error('保留文件正在变化，未开始清理');
  }
  return {ok:true};
}

export async function similarCleanup(db:LuminaDatabase,level:SimilarityLevel,keepLargest:boolean,removeIds?:string[]) {
  const result=await similarGroups(db,level);
  const selected=removeIds===undefined?undefined:new Set(removeIds);const available=new Set(result.groups.flatMap(group=>group.items.map(media=>media.id)));if(removeIds?.some(id=>!available.has(id)))throw new Error('勾选项目已变化，请刷新后重新选择');
  const groups=result.groups.map((group)=>{
    const ordered=[...group.items].sort((a,b)=>b.sizeBytes-a.sizeBytes || b.width*b.height-a.width*a.height || a.id.localeCompare(b.id));
    const preferred=keepLargest?ordered[0]!:group.items.find((media)=>media.id===group.representativeId)!;
    const remove=group.items.filter(media=>removeIds===undefined?media.id!==preferred.id:selected!.has(media.id) && (!keepLargest || media.id!==preferred.id));
    const removed=new Set(remove.map(media=>media.id));const retained=group.items.filter(media=>!removed.has(media.id));const keep=retained.find(media=>media.id===preferred.id)??retained[0]??null;
    return {hash:group.representativeId,keep,retained,remove};
  }).filter((group)=>group.remove.length>0);
  const revision=createHash('sha256').update(JSON.stringify({level,keepLargest,removeIds:removeIds?.slice().sort(),groups:groups.map((group)=>({keep:group.keep?.id??null,items:[...group.retained,...group.remove].map((media)=>[media.id,media.fingerprint])}))})).digest('hex');
  return {groups,revision,emptyGroups:groups.filter(group=>!group.retained.length).length,keepCount:groups.reduce((sum,group)=>sum+group.retained.length,0),mediaIds:groups.flatMap((group)=>group.remove.map((media)=>media.id)),sizeBytes:groups.reduce((sum,group)=>sum+group.remove.reduce((total,media)=>total+media.sizeBytes,0),0)};
}
export async function validateSimilarCleanup(db:LuminaDatabase,level:SimilarityLevel,keepLargest:boolean,revision:string,removeIds?:string[],signal?:AbortSignal,allowDeleteAll=false) {
  const preview=await similarCleanup(db,level,keepLargest,removeIds);
  if(preview.revision!==revision || !preview.mediaIds.length)throw new Error('相似检测结果已变化，请关闭确认框并重新预览');
  if(preview.emptyGroups && !allowDeleteAll)throw new Error('包含整组删除，请先确认这些组将不保留任何文件');
  for(const group of preview.groups){if(signal?.aborted)throw new Error('已取消，未执行');const keep=group.keep;if(!keep)continue;const info=await stat(keep.absolutePath);if(!info.isFile() || info.size!==keep.sizeBytes || Math.abs(info.mtimeMs-keep.modifiedAtMs)>1 || !keep.contentHash || await hashFile(keep.absolutePath,signal)!==keep.contentHash)throw new Error('拟保留的文件已变化，请重新运行检测后再删除相似文件');const after=await stat(keep.absolutePath);if(info.ino!==after.ino || info.dev!==after.dev || info.size!==after.size || info.mtimeMs!==after.mtimeMs)throw new Error('保留文件正在变化，未开始清理');}
  return {ok:true};
}
