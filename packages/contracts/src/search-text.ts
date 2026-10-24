import { pinyin } from 'pinyin-pro';
import {toHiragana,romanizedKeys,normalizeRomaji} from './japanese-text.js';
export type SearchLanguage='zh-CN'|'en'|'ja';
const readings=new Map<string,string>();
export function rememberJapaneseReadings(rows:readonly {text:string;reading:string}[]){for(const row of rows){if(readings.get(row.text.toLocaleLowerCase())!==row.reading)keys.delete('ja\0'+row.text.toLocaleLowerCase());if(readings.size>=60000)readings.delete(readings.keys().next().value!);readings.set(row.text.toLocaleLowerCase(),row.reading);}}

const keys = new Map<string, string[]>();
export function searchKeys(text: string,language:SearchLanguage='zh-CN'): string[] {
  const normalized = text.toLocaleLowerCase();
  if(language==='en')return [normalized];
  const cacheKey=language+'\0'+normalized;
  const cached = keys.get(cacheKey);
  if (cached) return cached;
  if(language==='ja'){const reading=readings.get(normalized)??text;const result=[...new Set([normalized,toHiragana(normalized),toHiragana(reading.toLocaleLowerCase()),...romanizedKeys(reading)])];if(keys.size>=60000)keys.delete(keys.keys().next().value!);keys.set(cacheKey,result);return result;}
  const parts = /\p{Script=Han}/u.test(normalized) ? pinyin(normalized, { toneType: 'none', type: 'array', nonZh: 'consecutive' }) : [];
  const result = [normalized, parts.join(''), parts.map((part) => /^\p{Script=Han}$/u.test(part) ? part : part[0] ?? '').join('')];
  // Keep literal non-Chinese runs in initials (e.g. IMG2026 + 人像).
  if (parts.length) result.push(pinyin(normalized, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }).join(''));
  if (keys.size >= 60000) keys.delete(keys.keys().next().value!);
  keys.set(cacheKey, result);
  return result;
}
export function matchesSearch(text: string, query: string,language:SearchLanguage='zh-CN'): boolean {
  const input = query.trim().toLocaleLowerCase();
  if(!input||text.toLocaleLowerCase().includes(input))return true;
  const candidate=language==='ja'?normalizeRomaji(toHiragana(input)):input;
  return searchKeys(text,language).some((key) => key.includes(candidate));
}
