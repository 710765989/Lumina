import path from 'node:path';
import {lstat} from 'node:fs/promises';
import type {LuminaDatabase} from '@lumina/storage';
export type CacheEntry={file:string;name:string;bytes:number;stamp:string;revision:number};
const readyKey=(root:string)=>'cache-inventory-ready:'+path.resolve(root);
const revision=(db:LuminaDatabase)=>(db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS next FROM cache_inventory').get() as {next:number}).next;
export function inventoryReady(db:LuminaDatabase,root:string){return Boolean(db.prepare('SELECT 1 FROM settings WHERE key=?').get(readyKey(root)));}
export function inventoryEntries(db:LuminaDatabase,root:string){return db.prepare('SELECT file_path AS file,file_name AS name,size_bytes AS bytes,stamp,revision FROM cache_inventory WHERE root=? AND present=1').all(root) as CacheEntry[];}
export function forgetCache(db:LuminaDatabase,file:string){if(!db.open)return;db.prepare("INSERT INTO cache_inventory(file_path,root,file_name,size_bytes,stamp,revision,present) VALUES(?,?,?,0,'',?,0) ON CONFLICT(file_path) DO UPDATE SET present=0,revision=excluded.revision").run(file,path.dirname(file),path.basename(file),revision(db));}
const remembering=new WeakMap<LuminaDatabase,Map<string,Promise<void|null>>>();
export async function rememberCache(db:LuminaDatabase,root:string,file:string){
 let pending=remembering.get(db);if(!pending){pending=new Map();remembering.set(db,pending);}const key=JSON.stringify([root,file]),existing=pending.get(key);if(existing)return existing;
 const request=recordCache(db,root,file);pending.set(key,request);
 try{return await request;}finally{if(pending.get(key)===request)pending.delete(key);}
}
async function recordCache(db:LuminaDatabase,root:string,file:string){
 const info=await lstat(file).catch(error=>{if(error.code==='ENOENT'){forgetCache(db,file);return null;}throw error;});if(!info?.isFile()||info.isSymbolicLink())return;
 const stamp=`${info.size}:${info.mtimeMs}:${info.ino}`,previous=db.prepare('SELECT stamp,present FROM cache_inventory WHERE file_path=?').get(file) as {stamp:string;present:number}|undefined;
 if(previous?.present&&previous.stamp===stamp)return;
 db.prepare('INSERT INTO cache_inventory(file_path,root,file_name,size_bytes,stamp,revision,present) VALUES(?,?,?,?,?,?,1) ON CONFLICT(file_path) DO UPDATE SET root=excluded.root,size_bytes=excluded.size_bytes,stamp=excluded.stamp,revision=excluded.revision,present=1').run(file,root,path.basename(file),info.size,stamp,revision(db));
}
export function inventoryCheckpoint(db:LuminaDatabase){return revision(db)-1;}
export function saveInventory(db:LuminaDatabase,root:string,entries:Omit<CacheEntry,'revision'>[],checkpoint:number){
 db.transaction(()=>{
  const seen=new Set(entries.map(entry=>entry.file)),current=db.prepare('SELECT file_path AS file,revision FROM cache_inventory WHERE root=?').all(root) as {file:string;revision:number}[],rev=revision(db);
  const upsert=db.prepare('INSERT INTO cache_inventory(file_path,root,file_name,size_bytes,stamp,revision,present) VALUES(?,?,?,?,?,?,1) ON CONFLICT(file_path) DO UPDATE SET size_bytes=excluded.size_bytes,stamp=excluded.stamp,present=1,revision=excluded.revision WHERE cache_inventory.revision<=?');
  for(const entry of entries)upsert.run(entry.file,root,entry.name,entry.bytes,entry.stamp,rev,checkpoint);
  for(const row of current)if(row.revision<=checkpoint&&!seen.has(row.file))db.prepare('DELETE FROM cache_inventory WHERE file_path=?').run(row.file);
  db.prepare('INSERT OR REPLACE INTO settings(key,value_json) VALUES(?,?)').run(readyKey(root),'true');
 })();
}
export function moveInventory(db:LuminaDatabase,id:string,source:string,target:string){
 const ready=inventoryReady(db,source);
 db.prepare("UPDATE cache_inventory SET root=?,file_path=(SELECT output FROM job_items WHERE task_id=? AND file_path=cache_inventory.file_path),stamp=(SELECT json_extract(fingerprint,'$.target') FROM job_items WHERE task_id=? AND file_path=cache_inventory.file_path),revision=? WHERE root=? AND EXISTS(SELECT 1 FROM job_items WHERE task_id=? AND file_path=cache_inventory.file_path AND status='completed')").run(target,id,id,revision(db),source,id);
 if(ready)db.prepare('INSERT OR REPLACE INTO settings(key,value_json) VALUES(?,?)').run(readyKey(target),'true');
}
