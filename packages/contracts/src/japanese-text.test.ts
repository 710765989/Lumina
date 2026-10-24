import {it,expect} from 'vitest';
import {toHiragana,kanaToRomaji,normalizeRomaji} from './japanese-text.js';
import {matchesSearch,rememberJapaneseReadings} from './search-text.js';
it('converts kana including voiced marks, combinations, small tsu and long vowels',()=>{
 expect(toHiragana('ｼｬｼﾝ')).toBe('しゃしん');expect(kanaToRomaji('シャシン')).toBe('shashin');expect(kanaToRomaji('ガッコウ')).toBe('gakkou');expect(kanaToRomaji('スーパー')).toBe('suupaa');expect(kanaToRomaji('しんよう')).toBe("shin'you");expect(normalizeRomaji('がっこう')).toBe('がっこう');expect(normalizeRomaji('TŌKYŌ')).toBe('tokyo');
});
it('keeps language search projections isolated and invalidates cached kanji readings',()=>{
 expect(matchesSearch('人像','ren','zh-CN')).toBe(true);expect(matchesSearch('人像','ren','en')).toBe(false);expect(matchesSearch('人像','ren','ja')).toBe(false);
 expect(matchesSearch('写真','shashin','ja')).toBe(false);rememberJapaneseReadings([{text:'写真',reading:'しゃしん'}]);
 for(const query of ['shashin','しゃしん','シャシン','写真'])expect(matchesSearch('写真',query,'ja')).toBe(true);
 expect(matchesSearch('写真','shashin','en')).toBe(false);expect(matchesSearch('がっこう','がっこう','ja')).toBe(true);expect(matchesSearch('学校','gakkou','zh-CN')).toBe(false);
 rememberJapaneseReadings([{text:'学校',reading:'がっこう'}]);expect(matchesSearch('学校','gakko','ja')).toBe(true);expect(matchesSearch('写真','xie','ja')).toBe(false);
});
