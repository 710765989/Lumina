import {Worker} from 'node:worker_threads';
import path from 'node:path';
import {rememberJapaneseReadings,toHiragana} from '@lumina/contracts';
export type Reading={text:string;reading:string};
// Only the small reading cache survives idle periods. Release the dictionary's
// decompressed arrays and tokenizer by terminating its isolated worker.
export class JapaneseReadings {
 private cache=new Map<string,string>();private pending=new Map<string,Promise<Reading>>();
 private worker?:Worker;private idle?:ReturnType<typeof setTimeout>;private sequence=0;private closed=false;
 private requests=new Map<number,{resolve:(rows:Reading[])=>void;reject:(error:Error)=>void;timeout:ReturnType<typeof setTimeout>}>();
 constructor(private workerFile=process.env.LUMINA_JAPANESE_WORKER??path.join(path.dirname(process.argv[1]??'').replace(/app\.asar(?=[\\/]|$)/u,'app.asar.unpacked'),'japanese-worker.cjs'),private idleMs=15000){}
 private release(){clearTimeout(this.idle);const worker=this.worker;this.worker=undefined;void worker?.terminate();}
 private fail(error:Error){for(const request of this.requests.values()){clearTimeout(request.timeout);request.reject(error);}this.requests.clear();this.release();}
 private start(){if(this.worker)return this.worker;const worker=new Worker(this.workerFile,{workerData:{dictionary:path.join(path.dirname(this.workerFile),'japanese-dict')}});this.worker=worker;
  worker.on('message',({id,rows,error}:{id:number;rows:Reading[];error?:string})=>{const request=this.requests.get(id);if(!request)return;clearTimeout(request.timeout);this.requests.delete(id);if(error)request.reject(new Error(error));else request.resolve(rows);if(!this.requests.size){this.idle=setTimeout(()=>this.release(),this.idleMs);this.idle.unref();}});
  worker.on('error',()=>{if(this.worker===worker)this.fail(new Error('日语读音词典加载失败，请重新安装软件后重试。'));});
  worker.on('exit',code=>{if(this.worker===worker){this.worker=undefined;if(this.requests.size)this.fail(new Error('日语读音处理已停止，请重试。'));}});return worker;
 }
 private batch(texts:string[]):Promise<Reading[]>{clearTimeout(this.idle);return new Promise((resolve,reject)=>{const id=++this.sequence;try{const worker=this.start(),timeout=setTimeout(()=>this.fail(new Error('日语读音处理超时，请重试。')),60000);this.requests.set(id,{resolve,reject,timeout});worker.postMessage({id,texts});}catch(error){reject(error);}});}
 async read(texts:readonly string[]):Promise<Reading[]>{
  if(this.closed)throw new Error('日语读音处理已关闭');
  const unique=[...new Set(texts)],missing=unique.filter(text=>!this.cache.has(text)&&!this.pending.has(text));
  const kana=missing.filter(text=>!/[\p{Script=Han}]/u.test(text));for(const text of kana)this.cache.set(text,toHiragana(text));
  const kanji=missing.filter(text=>/[\p{Script=Han}]/u.test(text));
  for(let at=0;at<kanji.length;at+=500){const batch=kanji.slice(at,at+500),work=this.batch(batch).then(rows=>{for(const row of rows){if(this.cache.size>=60000)this.cache.delete(this.cache.keys().next().value!);this.cache.set(row.text,row.reading);}rememberJapaneseReadings(rows);return new Map(rows.map(row=>[row.text,row]));});for(const text of batch){const item=work.then(rows=>rows.get(text)!).finally(()=>this.pending.delete(text));this.pending.set(text,item);}}
  const rows=await Promise.all(unique.map(async text=>this.pending.get(text)?await this.pending.get(text)!:{text,reading:this.cache.get(text)!}));rememberJapaneseReadings(rows);return rows;
 }
 close(){this.closed=true;this.fail(new Error('日语读音处理已关闭'));this.cache.clear();}
}
