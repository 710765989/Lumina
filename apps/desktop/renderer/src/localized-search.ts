import {useEffect,useState} from 'react';
import {matchesSearch as match,rememberJapaneseReadings,toHiragana} from '@lumina/contracts';
import {getLanguage} from './i18n';
import {useLanguage} from './LanguageSettings';
import type {Tag} from './media-types';
const cache=new Map<string,string>(),pending=new Map<string,Promise<{text:string;reading:string}>>();
export function matchesSearch(text:string,query:string){return match(text,query,getLanguage());}
export async function japaneseReading(text:string):Promise<string>{
 if(!/\p{Script=Han}/u.test(text))return toHiragana(text);
 if(cache.has(text))return cache.get(text)!;
 await prepareJapaneseReadings([text]);
 return cache.get(text)??text;
}
async function prepareJapaneseReadings(texts:string[]){
 const missing=[...new Set(texts)].filter(text=>/\p{Script=Han}/u.test(text)&&!cache.has(text)&&!pending.has(text));
 for(let i=0;i<missing.length;i+=500){const batch=missing.slice(i,i+500),work=window.lumina.command({type:'text.japaneseReadings',texts:batch}) as Promise<{text:string;reading:string}[]>;const ready=work.then(rows=>{rememberJapaneseReadings(rows);for(const row of rows){if(cache.size>=60000)cache.delete(cache.keys().next().value!);cache.set(row.text,row.reading);}return new Map(rows.map(row=>[row.text,row]));});
  for(const text of batch){const item=ready.then(rows=>rows.get(text)!).finally(()=>pending.delete(text));pending.set(text,item);}
 }
 await Promise.all(texts.map(text=>pending.get(text)).filter(Boolean));
}
// A revision changes memoized suggestion lists when asynchronous kanji readings
// arrive. Language changes also invalidate them, without rescanning the library.
export function useTagSearch(tags:Tag[]){
 const language=useLanguage(),[revision,setRevision]=useState(0);
 useEffect(()=>{if(language!=='ja')return;let valid=true;const texts=tags.flatMap(tag=>[tag.name,tag.path??'',tag.englishName??'',...(tag.aliases??[])]);void prepareJapaneseReadings(texts).then(()=>{if(valid)setRevision(value=>value+1);}).catch(()=>{});return()=>{valid=false;};},[tags,language]);
 return `${language}:${revision}`;
}
