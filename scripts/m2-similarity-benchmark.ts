import {performance} from 'node:perf_hooks';
import {mkdir,writeFile} from 'node:fs/promises';
import {groupSimilar} from '../packages/core/src/similarity.js';
let seed=710765989;const word=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0).toString(16).padStart(8,'0');};
const candidates=Array.from({length:100000},(_,index)=>({id:String(index),absolutePath:`synthetic/${index}.jpg`,fingerprint:String(index),kind:'photo',hidden:false,sizeBytes:1000,modifiedAtMs:1,capturedAtMs:null,metadata:{},hash:`${word()}${word()}`.replace(/^./u,(digit)=>(parseInt(digit,16)&7).toString(16)),gradient:`${word()}${word()}`,colors:Buffer.alloc(48,120).toString('base64'),width:640,height:400}));
let ticks=0;const timer=setInterval(()=>ticks++,20);const start=performance.now();
try{
  const groups=await groupSimilar(candidates,'standard');
  const result={syntheticDescriptors:candidates.length,level:'standard',groupingMs:Math.round(performance.now()-start),groups:groups.length,eventLoopTicks:ticks,heapMiB:Math.round(process.memoryUsage().heapUsed/1048576),scope:'Synthetic feature grouping only; not real photo accuracy, decode throughput or full 100k media acceptance.'};
  if(!ticks)throw new Error('Grouping did not yield to the event loop');await mkdir('build-staging',{recursive:true});await writeFile('build-staging/m2-similarity-performance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{clearInterval(timer);}
