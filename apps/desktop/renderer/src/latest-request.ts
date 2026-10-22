// Keep one request in flight, replacing intermediate pending positions.
export function latestRequest<T>(run:(value:T)=>Promise<void>){
 let running=false,pending:{value:T}|undefined;
 async function drain(){if(running)return;running=true;try{while(pending){const next=pending.value;pending=undefined;await run(next);}}finally{running=false;}}
 return (value:T)=>{pending={value};return drain();};
}
export function timelinePosition(months:{month:string;count:number}[],anchor:string|null,sort:'asc'|'desc'){
 let start=0;if(anchor)for(const row of months){if(sort==='asc'?row.month>=anchor:row.month<=anchor)break;start+=row.count;}
 const total=months.reduce((sum,row)=>sum+row.count,0);
 if(!anchor)return {start,total,bounds:{}};
 const [year,month]=anchor.split('-').map(Number);
 return {start,total,bounds:sort==='asc'?{timeFromMs:new Date(year!,month!-1,1).getTime()}:{timeBeforeMs:new Date(year!,month!,1).getTime()}};
}
