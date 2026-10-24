import {catalog} from './locales/catalog';
import {extraMessages} from './locales/extra';
import {backendMessages} from './locales/backend';
Object.assign(catalog,backendMessages,extraMessages);

export type Language = 'zh-CN' | 'en' | 'ja';
export const languages: readonly {value:Language;label:string}[] = [
  {value:'zh-CN',label:'简体中文'}, {value:'en',label:'English'}, {value:'ja',label:'日本語'},
];
const storageKey='lumina.ui.language';
const subscribers=new Set<()=>void>();
export function normalizeLanguage(value:unknown):Language {
  return value==='en'||value==='ja'?value:'zh-CN';
}
function readLanguage():Language {try{return normalizeLanguage(localStorage.getItem(storageKey));}catch{return 'zh-CN';}}
let language:Language=readLanguage();
export const getLanguage=()=>language;
export function subscribeLanguage(listener:()=>void){subscribers.add(listener);return()=>{subscribers.delete(listener);};}
function applyLanguage(value:Language){
  language=value;messageCache.clear();
  if(typeof document!=='undefined'){
    document.documentElement.lang=value;
    document.documentElement.dataset.language=value;
    document.documentElement.style.setProperty('--tag-drop-label',JSON.stringify(t('放置标签引用')));
    document.documentElement.style.setProperty('--tag-copy-label',JSON.stringify(t('＋ 复制标签引用')));
  }
  for(const notify of subscribers)notify();
}
export function setLanguage(value:Language){
  const next=normalizeLanguage(value);
  // Commit storage first; never silently claim a preference was saved if storage fails.
  localStorage.setItem(storageKey,next);
  applyLanguage(next);
  if(typeof window!=='undefined')void window.lumina?.native({action:'set-language',language:next}).catch(()=>{});
}
export function t(key:string,values:readonly unknown[]=[]):string {
  const entry=catalog[key]??catalog[key.trim()];
  const translated=language==='zh-CN'?key:entry?.[language==='en'?0:1]??key;
  return values.length?translated.replace(/\{(\d+)\}/gu,(match,index)=>Number(index)<values.length?String(values[Number(index)]??''):match):translated;
}
export function formatMonth(value:string):string {
  if(language==='zh-CN')return value;
  const match=/^(\d{4})(?:年|-)(\d{1,2})月?$/u.exec(value);
  return match?new Intl.DateTimeFormat(language,{year:'numeric',month:'long'}).format(new Date(Number(match[1]),Number(match[2])-1,1)):t(value);
}
export function formatMonthShort(value:string):string {
  const match=/^(\d{4})-(\d{1,2})$/u.exec(value);
  if(!match)return value;
  return language==='en'?new Intl.DateTimeFormat('en',{month:'short'}).format(new Date(Number(match[1]),Number(match[2])-1,1)):`${Number(match[2])}月`;
}

// Localize messages received from the core without changing persisted data.
// Only callers displaying application messages use this; names/paths never do.
const messageCache=new Map<string,string>();
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const patterns=Object.keys(catalog).filter(key=>/\{\d+\}/u.test(key))
  .map(key=>({key,weight:key.replace(/\{\d+\}/gu,'').length}))
  .sort((a,b)=>b.weight-a.weight)
  .map(({key})=>{const indices:number[]=[];let previous=0,pattern='';for(const match of key.matchAll(/\{(\d+)\}/gu)){pattern+=escape(key.slice(previous,match.index))+'([\\s\\S]*?)';indices.push(Number(match[1]));previous=match.index!+match[0].length;}return {key,indices,regex:new RegExp('^'+pattern+escape(key.slice(previous))+'$','u')};});
const sourceByTranslation=new Map<string,string>();
const translatedPatterns:{key:string;indices:number[];regex:RegExp}[]=[];
for(const [key,values] of Object.entries(catalog))for(const value of values){
  sourceByTranslation.set(value,key);
  if(!/\{\d+\}/u.test(value))continue;
  const indices:number[]=[];let previous=0,pattern='';
  for(const match of value.matchAll(/\{(\d+)\}/gu)){pattern+=escape(value.slice(previous,match.index))+'([\\s\\S]*?)';indices.push(Number(match[1]));previous=match.index!+match[0].length;}
  translatedPatterns.push({key,indices,regex:new RegExp('^'+pattern+escape(value.slice(previous))+'$','u')});
}
translatedPatterns.sort((a,b)=>b.key.replace(/\{\d+\}/gu,'').length-a.key.replace(/\{\d+\}/gu,'').length);
export function sourceMessage(value:string):string {
  if(catalog[value])return value;
  const source=sourceByTranslation.get(value);if(source)return source;
  for(const {key,indices,regex} of translatedPatterns){const match=regex.exec(value);if(!match)continue;const values:string[]=[];indices.forEach((index,at)=>{values[index]=match[at+1];});return key.replace(/\{(\d+)\}/gu,(slot,index)=>values[Number(index)]??slot);}
  return value;
}
export function translateMessage(value:string|null|undefined):string {
  if(!value)return '';
  value=sourceMessage(value);
  if(language==='zh-CN')return value;
  if(catalog[value])return t(value);
  const known=messageCache.get(value);if(known!==undefined)return known;
  let result=value;
  for(const {key,indices,regex} of patterns){const match=regex.exec(value);if(!match)continue;const values:unknown[]=[];indices.forEach((index,at)=>{values[index]=match[at+1];});result=t(key,values);break;}
  if(messageCache.size>=256)messageCache.delete(messageCache.keys().next().value!);
  messageCache.set(value,result);return result;
}
export async function initializeLanguage(){
  let stored:string|null=null;try{stored=localStorage.getItem(storageKey);}catch{}
  if(stored&&['zh-CN','en','ja'].includes(stored))applyLanguage(normalizeLanguage(stored));
  else {
    try{const preference=await window.lumina?.native({action:'get-language'});applyLanguage(normalizeLanguage(preference?.language));}catch{applyLanguage('zh-CN');}
    try{localStorage.setItem(storageKey,language);}catch{}
  }
  if(typeof window!=='undefined'){
    const storage=(event:StorageEvent)=>{if(event.key===storageKey)applyLanguage(readLanguage());};
    window.addEventListener('storage',storage);
    void window.lumina?.native({action:'set-language',language}).catch(()=>{});
    return()=>window.removeEventListener('storage',storage);
  }
  return()=>{};
}
