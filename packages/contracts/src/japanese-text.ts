// Kana conversion is small and synchronous; kanji readings come from the local
// tokenizer worker. Never interpret Japanese kanji as Mandarin pinyin.
export function toHiragana(text:string):string{return text.normalize('NFKC').replace(/[ァ-ヶ]/gu,c=>String.fromCharCode(c.charCodeAt(0)-0x60));}
const rows=[
 'あ:a い:i う:u え:e お:o か:ka き:ki く:ku け:ke こ:ko が:ga ぎ:gi ぐ:gu げ:ge ご:go',
 'さ:sa し:shi す:su せ:se そ:so ざ:za じ:ji ず:zu ぜ:ze ぞ:zo た:ta ち:chi つ:tsu て:te と:to',
 'だ:da ぢ:ji づ:zu で:de ど:do な:na に:ni ぬ:nu ね:ne の:no は:ha ひ:hi ふ:fu へ:he ほ:ho',
 'ば:ba び:bi ぶ:bu べ:be ぼ:bo ぱ:pa ぴ:pi ぷ:pu ぺ:pe ぽ:po ま:ma み:mi む:mu め:me も:mo',
 'や:ya ゆ:yu よ:yo ら:ra り:ri る:ru れ:re ろ:ro わ:wa ゐ:wi ゑ:we を:wo ん:n ゔ:vu',
 'ぁ:a ぃ:i ぅ:u ぇ:e ぉ:o ゃ:ya ゅ:yu ょ:yo ゎ:wa ゕ:ka ゖ:ke',
 'きゃ:kya きゅ:kyu きょ:kyo ぎゃ:gya ぎゅ:gyu ぎょ:gyo しゃ:sha しゅ:shu しょ:sho しぇ:she',
 'じゃ:ja じゅ:ju じょ:jo じぇ:je ちゃ:cha ちゅ:chu ちょ:cho ちぇ:che ぢゃ:ja ぢゅ:ju ぢょ:jo',
 'にゃ:nya にゅ:nyu にょ:nyo ひゃ:hya ひゅ:hyu ひょ:hyo びゃ:bya びゅ:byu びょ:byo ぴゃ:pya ぴゅ:pyu ぴょ:pyo',
 'みゃ:mya みゅ:myu みょ:myo りゃ:rya りゅ:ryu りょ:ryo ふぁ:fa ふぃ:fi ふぇ:fe ふぉ:fo ふゅ:fyu',
 'うぃ:wi うぇ:we うぉ:wo てぃ:ti でぃ:di とぅ:tu どぅ:du てゅ:tyu でゅ:dyu つぁ:tsa つぃ:tsi つぇ:tse つぉ:tso',
 'ゔぁ:va ゔぃ:vi ゔぇ:ve ゔぉ:vo ゔゅ:vyu いぇ:ye すぃ:si ずぃ:zi くぁ:kwa くぃ:kwi くぇ:kwe くぉ:kwo',
];
const kana=new Map(rows.flatMap(row=>row.split(' ').map(pair=>pair.split(':') as [string,string])));
export function kanaToRomaji(value:string):string {
 const text=toHiragana(value).toLowerCase();let result='';
 for(let i=0;i<text.length;i++){
  const char=text[i]!;
  if(char==='っ'){const next=kana.get(text.slice(i+1,i+3))??kana.get(text[i+1]??'')??'';result+=next.startsWith('ch')?'t':/^[bcdfghjklmpqrstvwxyz]/u.test(next)?next[0]:'';continue;}
  if(char==='ー'){result+=result.match(/[aeiou]$/u)?.[0]??'';continue;}
  const pair=kana.get(text.slice(i,i+2));const next=pair??kana.get(char);
  if(next){if(char==='ん'&&/^[aiueoy]/u.test(kana.get(text[i+1]??'')??''))result+="n'";else result+=next;if(pair)i++;}else result+=char;
 }
 return result;
}
export function romanizedKeys(text:string):string[]{const full=kanaToRomaji(text),plain=full.replace(/'/gu,'');return [...new Set([full,plain,plain.replace(/ou|oo/gu,'o').replace(/uu/gu,'u').replace(/([aeiou])\1/gu,'$1')])];}
export function normalizeRomaji(value:string):string{return value.normalize('NFKC').replace(/[āīūēōĀĪŪĒŌ]/gu,char=>char.normalize('NFD')[0]!).toLowerCase();}
