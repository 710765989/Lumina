import {app} from 'electron';
import {writeFileSync,mkdirSync,renameSync} from 'node:fs';
import path from 'node:path';
import {readLanguagePreference,type UiLanguage} from './language-preference.js';
let current:UiLanguage|undefined;
const file=()=>path.join(app.getPath('userData'),'ui-language.json');
export function nativeLanguage():UiLanguage {
 if(current)return current;
 return current=readLanguagePreference(file(),app.isPackaged?path.dirname(process.execPath):undefined);
}
export function saveNativeLanguage(language:unknown){
 if(!['zh-CN','en','ja'].includes(String(language)))throw Error('Invalid UI language');
 mkdirSync(path.dirname(file()),{recursive:true});
 const temporary=file()+'.tmp';writeFileSync(temporary,JSON.stringify({language}));renameSync(temporary,file());current=language as UiLanguage;
}
const texts:Record<string,[string,string]>={
 '光匣 Lumina · 正在启动':['Lumina · Starting','Lumina · 起動中'],
 '光匣':['Lumina','Lumina'],
 '正在读取图库索引…':['Reading library index…','ライブラリの登録情報を読み込み中…'],
 '正在准备首屏缩略图…':['Preparing visible thumbnails…','最初のサムネイルを準備中…'],
 '准备好后自动进入图库':['The library will open when ready','準備ができ次第、ライブラリを開きます'],
 '暂时无法打开图库':['Unable to open the library','ライブラリを開けません'],
 '请重试，或退出后重新打开。':['Try again, or quit and reopen.','再試行するか、終了して再び開いてください。'],
 '退出启动':['Quit startup','起動を終了'],
 '退出':['Quit','終了'],
 '重试':['Retry','再試行'],
 '已准备 ':['Prepared ','準備済み '],
 ' 项':[' items',' 項目'],
 '界面加载失败，请重试或退出后重新打开。':['The interface could not load. Retry or restart the app.','画面を読み込めませんでした。再試行するか再起動してください。'],
 '界面初始化中断，请重试。':['Interface initialization stopped. Try again.','画面の初期化が中断されました。再試行してください。'],
 '选择导入的照片或视频':['Choose photos or videos to import','取り込む写真や動画を選択'],
 '批量选择导入文件夹':['Choose folders to import','取り込むフォルダーを選択'],
 '背景音乐':['Background music','BGM'],
 '字幕':['Subtitles','字幕'],
};
export function nativeText(key:string){const language=nativeLanguage();return language==='zh-CN'?key:texts[key]?.[language==='en'?0:1]??key;}
export function localizeStartupHtml(html:string){
 if(nativeLanguage()==='zh-CN')return html;
 // All replacements are fixed application copy, never filenames or user input.
 for(const key of Object.keys(texts).sort((a,b)=>b.length-a.length))html=html.replaceAll(key,nativeText(key));
 html=html.replace('<small>Lumina</small>','');
 return html.replace('lang="zh-CN"',`lang="${nativeLanguage()}"`);
}
