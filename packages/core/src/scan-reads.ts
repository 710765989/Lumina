// Shared across scans: bound native metadata reads and expensive video probes.
function slots(limit:number){let active=0;const waiting:Array<()=>void>=[];return async<T>(work:()=>Promise<T>)=>{if(active<limit)active++;else await new Promise<void>(resolve=>waiting.push(resolve));try{return await work();}finally{const next=waiting.shift();if(next)next();else active--;}};}
const readSlot=slots(4),videoSlot=slots(2);
export const scanMetadataRead=<T>(video:boolean,work:()=>Promise<T>)=>readSlot(()=>video?videoSlot(work):work());

// A four-item lookahead keeps I/O busy while committing in original file order.
// Early exit drains already-started reads and never launches the remaining files.
export async function* orderedScanReads<T>(files:string[],read:(file:string)=>Promise<T>){
 type Result={filePath:string;value:T;error?:undefined}|{filePath:string;value?:undefined;error:unknown};
 const pending=new Map<number,Promise<Result>>();let cursor=0;
 const launch=()=>{while(cursor<files.length&&pending.size<4){const index=cursor++,filePath=files[index]!;pending.set(index,read(filePath).then(value=>({filePath,value}),error=>({filePath,error})));}};
 launch();try{for(let index=0;index<files.length;index++){const result=await pending.get(index)!;pending.delete(index);yield result;launch();}}finally{await Promise.all(pending.values());}
}
