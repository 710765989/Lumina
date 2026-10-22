import { watch, type FSWatcher } from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import { listLibraryRoots, settings, type LuminaDatabase } from '@lumina/storage';
import { scanDirectory,mediaKindFromPath } from './index.js';

export class RootWatcher {
  private watchers = new Map<string, FSWatcher>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private scanning = new Set<string>();
  private dirty = new Set<string>();
  private changes = new Map<string,Set<string>>();
  private retryTimer?: ReturnType<typeof setInterval>;
  private started = false;private lastScan=new Map<string,number>();
  constructor(private db: LuminaDatabase, private notify: () => void,private ignored:string[]=[] ) {}
  private ignoredChange:(file:string)=>boolean=()=>false;
  setIgnored(roots:string[]){this.ignored=roots;}
  ignoreChanges(check:(file:string)=>boolean){this.ignoredChange=check;}
  start() { this.started = true; this.sync(); this.retryTimer = setInterval(() => this.sync(), 15000); this.retryTimer.unref(); }
  sync() {
    if (!this.started) return;
    const roots = settings(this.db).watch ? listLibraryRoots(this.db).filter((root) => root.enabled) : [];
    for (const [id, watcher] of this.watchers) if (!roots.some((root) => root.id === id)) { watcher.close(); this.watchers.delete(id); const timer = this.timers.get(id); if (timer) clearTimeout(timer); this.timers.delete(id); }
    for (const root of roots) {
      if (this.watchers.has(root.id)) continue;
      try {
        const watcher = watch(root.absolutePath, { recursive: true }, async(event, filename) => {
          if(!this.started||!this.db.open)return;
          if (!filename || /(?:^|[\\/])\.lumina-(?:trash|export-)/u.test(String(filename))) return;
          if(event==='change' && mediaKindFromPath(String(filename))==='unknown')return;
          const changed=path.resolve(root.absolutePath,String(filename));if(this.ignoredChange(changed))return;if(this.ignored.some(directory=>{const relative=path.relative(directory,changed);return relative===''||relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);}))return;
          if(event==='change'){
            const known=this.db.prepare('SELECT size_bytes AS bytes,modified_at_ms AS modified FROM media WHERE absolute_path=?').get(changed) as {bytes:number;modified:number}|undefined;
            if(known)try{const current=await stat(changed);if(current.isFile()&&current.size===known.bytes&&Math.abs(current.mtimeMs-known.modified)<1)return;}catch{/* Removal or an offline path is handled by the normal incremental scan. */}
            if(!this.started)return;
          }
          const paths=this.changes.get(root.id)??new Set<string>();paths.add(changed);this.changes.set(root.id,paths);
          const timer = this.timers.get(root.id); if (timer) clearTimeout(timer);
          const next = setTimeout(() => { this.timers.delete(root.id); void this.scan(root.id, root.absolutePath); }, Math.max(1500,(this.lastScan.get(root.id)??0)+5000-Date.now())); next.unref(); this.timers.set(root.id, next);
        });
        watcher.on('error', () => { watcher.close(); this.watchers.delete(root.id); this.notify(); }); this.watchers.set(root.id, watcher);
      } catch { /* Disconnected roots are retained and retried on reconnection. */ }
    }
  }
  private async scan(id: string, directory: string) {
    if(!this.started)return;
    if (this.scanning.has(id)) { this.dirty.add(id); return; }
    if (!listLibraryRoots(this.db).some((root) => root.id === id && root.enabled)) return;
    const task=this.db.prepare("SELECT status FROM tasks WHERE kind='scan' AND status IN('running','paused','queued') AND json_extract(payload_json,'$.root')=? ORDER BY created_at DESC LIMIT 1").get(directory) as {status:string}|undefined;
    if(task){this.dirty.add(id);if(task.status==='running'){const timer=setTimeout(()=>void this.scan(id,directory),1000);timer.unref();}return;}
    const changedPaths=[...(this.changes.get(id)??[])];this.changes.delete(id);if(!changedPaths.length)return;
    this.scanning.add(id);this.lastScan.set(id,Date.now());
    try { await scanDirectory(this.db, directory, { rootId: id, notify: this.notify, changedPaths }); } catch { this.notify(); }
    finally { this.scanning.delete(id); if (this.dirty.delete(id)) void this.scan(id, directory); }
  }
  close() { this.started = false; if (this.retryTimer) clearInterval(this.retryTimer); for (const watcher of this.watchers.values()) watcher.close(); for (const timer of this.timers.values()) clearTimeout(timer); this.watchers.clear(); this.timers.clear();this.changes.clear();this.dirty.clear();this.lastScan.clear(); }
}
