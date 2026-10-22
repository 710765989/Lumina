import {forgetCache} from './cache-inventory.js';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {rm} from 'node:fs/promises';
import {rawMedia,type LuminaDatabase} from '@lumina/storage';
import type {MediaRecord} from '@lumina/contracts';
import {removeMediaThumbnails,thumbnailCachePath} from './thumbnail.js';
type CacheMedia=Pick<MediaRecord,'id'|'fingerprint'>;

function cacheNames(media:CacheMedia){return [false,true].map(full=>`preview-${createHash('sha256').update(`${media.id}:${media.fingerprint}:preview-v1:${full?'full':'screen'}`).digest('hex')}.png`).concat(['h264-v1','hover-v1'].map(version=>`playback-${createHash('sha256').update(`${media.id}:${media.fingerprint}:${version}`).digest('hex')}.mp4`));}
function validName(name:string){return /^(?:preview-[a-f0-9]{64}\.png|playback-[a-f0-9]{64}\.mp4|[\w-]+-[a-f0-9]{16}\.jpg)$/u.test(name);}
export function registerMediaCache(db:LuminaDatabase,id:string,target:string){
 const name=path.basename(target);if(!validName(name) || !rawMedia(db,id))return;
 const key=`media-cache:${id}`,saved=db.prepare('SELECT value_json AS value FROM settings WHERE key=?').get(key) as {value:string}|undefined;
 const names:string[]=saved?JSON.parse(saved.value):[];if(names.includes(name))return;
 db.prepare('INSERT INTO settings(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').run(key,JSON.stringify([...names,name]));
}

// Persist deletion-specific work. No recursive cache scan or synchronous cleanup
// in the UI deletion path; locked files remain queued for the next startup.
export class MediaCacheCleanup{
 private timer?:ReturnType<typeof setTimeout>;private work?:Promise<void>;private closed=false;private rerun=false;private suspended=false;
 constructor(private db:LuminaDatabase,private root?:string){}
 setRoot(root:string){this.root=root;}
 async suspend(){this.suspended=true;clearTimeout(this.timer);this.timer=undefined;if(this.work)await this.work;}
 resume(){this.suspended=false;this.schedule();}
 start(){this.closed=false;this.schedule();}
 close(){this.closed=true;clearTimeout(this.timer);this.timer=undefined;}
 enqueue(media:CacheMedia){
  if(!this.root)return;this.closed=false;if(this.work)this.rerun=true;
  const saved=this.db.prepare('SELECT value_json AS value FROM settings WHERE key=?').get(`media-cache:${media.id}`) as {value:string}|undefined;
  const names=[...new Set([...(saved?JSON.parse(saved.value) as string[]:[]),...cacheNames(media),path.basename(thumbnailCachePath(this.root,media))])].filter(validName);
  this.db.prepare('INSERT INTO settings(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').run(`cache-cleanup:${media.id}`,JSON.stringify({id:media.id,names}));
  this.db.prepare('DELETE FROM settings WHERE key=?').run(`media-cache:${media.id}`);this.schedule();
 }
 private schedule(){if(this.timer || this.suspended || this.closed || !this.db.open || !this.root)return;this.timer=setTimeout(()=>{this.timer=undefined;void this.flush();},0);}
 async flush():Promise<void>{
  if(this.work)return this.work;if(this.suspended || this.closed || !this.db.open || !this.root)return;
  this.work=(async()=>{
   const rows=this.db.prepare("SELECT key,value_json AS value FROM settings WHERE key LIKE 'cache-cleanup:%'").all() as {key:string;value:string}[];
   for(const row of rows){if(this.closed || !this.db.open)return;const job=JSON.parse(row.value) as {id:string;names:string[]};
    try{
     if(!rawMedia(this.db,job.id)){await removeMediaThumbnails(this.root!,job.id,file=>forgetCache(this.db,file));for(const name of job.names)if(validName(name)){await rm(path.join(this.root!,name),{force:true});forgetCache(this.db,path.join(this.root!,name));}}
     if(!this.closed && this.db.open)this.db.prepare('DELETE FROM settings WHERE key=? AND value_json=?').run(row.key,row.value);
    }catch(error){if(!this.closed && this.db.open)this.db.prepare('UPDATE settings SET value_json=? WHERE key=? AND value_json=?').run(JSON.stringify({...job,error:(error as Error).message}),row.key,row.value);}
   }
  })().finally(()=>{this.work=undefined;if(this.rerun && !this.closed && this.db.open){this.rerun=false;this.schedule();}});return this.work;
 }
}
