import type {Media} from './media-types';
export type CoverCursor={value:number|string;id:string};
export type CoverSnapshot={items:{item:Media;url:string}[];done:boolean;error:boolean};
type Source={samples:Media[];count:number;page:(cursor?:CoverCursor)=>Promise<{items:Media[];hasMore:boolean}>};
type Entry=Source & CoverSnapshot & {queue:Media[];index:number;hasMore:boolean;cursor?:CoverCursor;listeners:Set<(state:CoverSnapshot)=>void>;running?:Promise<void>};

// Only a bounded page of metadata and four successful thumbnails are retained.
// The cursor advances after failures too, so unsupported files cannot trap a cover.
export class PlaceCoverLoader {
 private entries=new Map<string,Entry>();
 constructor(private load:(item:Media)=>Promise<string>,private maxEntries=64){}
 watch(key:string,source:Source,listener:(state:CoverSnapshot)=>void){
  let entry=this.entries.get(key);
  if(!entry){entry={...source,items:[],done:false,error:false,queue:source.samples,index:0,hasMore:source.count>source.samples.length,listeners:new Set()};this.entries.set(key,entry);}
  else {this.entries.delete(key);this.entries.set(key,entry);}
  entry.listeners.add(listener);listener(this.snapshot(entry));this.run(entry);this.prune();
  return ()=>{entry!.listeners.delete(listener);this.prune();};
 }
 retry(key:string){const entry=this.entries.get(key);if(!entry||entry.running)return;if(entry.error)entry.error=false;else Object.assign(entry,{items:[],done:false,error:false,queue:entry.samples,index:0,hasMore:entry.count>entry.samples.length,cursor:undefined});this.emit(entry);this.run(entry);}
 private snapshot(entry:Entry):CoverSnapshot{return {items:[...entry.items],done:entry.done,error:entry.error};}
 private emit(entry:Entry){const state=this.snapshot(entry);for(const listener of entry.listeners)listener(state);}
 private run(entry:Entry){
  if(entry.running||entry.done||entry.error||!entry.listeners.size)return;
  entry.running=(async()=>{
   while(entry.listeners.size&&entry.items.length<4){
    if(entry.index>=entry.queue.length){
     if(!entry.hasMore){entry.done=true;break;}
     try{const page=await entry.page(entry.cursor);entry.queue=page.items;entry.index=0;entry.hasMore=page.hasMore;if(!page.items.length){entry.done=true;break;}}
     catch{entry.error=true;break;}
     if(!entry.listeners.size)break;
    }
    const item=entry.queue[entry.index++]!;
    try{const url=await this.load(item);entry.items.push({item,url});}catch{/* Skip an unavailable candidate and keep searching this place. */}
    entry.cursor={value:item.coverSortValue??item.modifiedAtMs,id:item.id};
    if(entry.items.length===4||entry.index>=entry.queue.length&&!entry.hasMore)entry.done=true;
    this.emit(entry);if(entry.done)break;
   }
   this.emit(entry);
  })().finally(()=>{entry.running=undefined;this.prune();if(entry.listeners.size&&!entry.done&&!entry.error)this.run(entry);});
 }
 private prune(){for(const [key,entry] of this.entries){if(this.entries.size<=this.maxEntries)break;if(!entry.running&&!entry.listeners.size)this.entries.delete(key);}}
}
