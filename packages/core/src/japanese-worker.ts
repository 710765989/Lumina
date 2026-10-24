import {parentPort,workerData} from 'node:worker_threads';
import kuromoji from 'kuromoji';
import {toHiragana} from '@lumina/contracts';
const tokenizer=new Promise<{tokenize(text:string):{surface_form:string;reading?:string}[]}>((resolve,reject)=>kuromoji.builder({dicPath:workerData.dictionary}).build((error,result)=>error?reject(error):resolve(result)));
parentPort!.on('message',async({id,texts}:{id:number;texts:string[]})=>{
 try{const parser=await tokenizer;parentPort!.postMessage({id,rows:texts.map(text=>({text,reading:toHiragana(parser.tokenize(text).map(token=>token.reading&&token.reading!=='*'?token.reading:token.surface_form).join(''))}))});}
 catch{parentPort!.postMessage({id,error:'日语读音词典加载失败，请重新安装软件后重试。'});}
});
