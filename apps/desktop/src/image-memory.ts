export type ImageResources={images:{size:number;liveSize:number;count:number}};
type Options={resources:()=>ImageResources;residentBytes:()=>Promise<number>;clear:()=>void;now?:()=>number;delay?:number;cooldown?:number};

// Trim Blink's unused in-memory resources only after a substantial view change
// and under measured pressure. This never clears the HTTP/disk media cache.
export function createImageMemoryCleanup(options:Options){
 let timer:ReturnType<typeof setTimeout>|undefined,clearedAt=-Infinity,running=false,disposed=false,requests=0,trims=0,lastReason='';
 const now=options.now??Date.now;
 async function check(reason:string){
  if(disposed||running||now()-clearedAt<(options.cooldown??3000))return false;
  running=true;
  try{
   const usage=options.resources(),unused=Math.max(0,usage.images.size-usage.images.liveSize);
   if(unused<32*1024*1024&&await options.residentBytes()<384*1024*1024)return false;
   if(disposed)return false;
   options.clear();clearedAt=now();trims++;lastReason=reason;return true;
  }catch{return false;}finally{running=false;}
 }
 return {
  request(reason:string){if(disposed)return;requests++;clearTimeout(timer);const delay=Math.max(options.delay??900,(options.cooldown??3000)-(now()-clearedAt));timer=setTimeout(()=>{timer=undefined;void check(reason);},delay);},
  stats(){return {...options.resources(),requests,trims,lastReason};},
  dispose(){disposed=true;clearTimeout(timer);timer=undefined;},
 };
}
