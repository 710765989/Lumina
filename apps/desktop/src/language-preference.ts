import {readFileSync} from 'node:fs';
import path from 'node:path';
export type UiLanguage='zh-CN'|'en'|'ja';
export function readLanguagePreference(userPreference:string,installationDirectory?:string):UiLanguage {
 const candidates=[userPreference,...(installationDirectory?[path.join(installationDirectory,'installation-language.json')]:[])];
 for(const file of candidates)try{const value=JSON.parse(readFileSync(file,'utf8')).language;if(['zh-CN','en','ja'].includes(value))return value;}catch{/* Missing/invalid files fall through to the next preference. */}
 return 'zh-CN';
}
