import {t,translateMessage} from './i18n';
import {useEffect,useRef,useState} from 'react';
import {ActionButton} from './ActionControls';
import {bytesText} from './media-types';
import {userErrorMessage} from './user-error';

export function FirstLibraryCache({libraryPath,disabled,onChange}:{libraryPath:string;disabled:boolean;onChange:(value:{ready:boolean;directory?:string})=>void}){
 const [settings,setSettings]=useState<{directory:string;setupRequired:boolean}|null>(null),[directory,setDirectory]=useState(''),[space,setSpace]=useState<number>(),[checking,setChecking]=useState(false),[error,setError]=useState('');
 const request=useRef(0),latest=useRef(onChange);latest.current=onChange;
 async function verify(value:string){
  const version=++request.current;setDirectory(value);setSpace(undefined);setChecking(true);setError('');
  try{const preview=await window.lumina.command({type:'cache.setupPreview',directory:value,libraryPath});if(version===request.current){setDirectory(preview.directory);setSpace(preview.freeBytes);}}
  catch(reason){if(version===request.current)setError(userErrorMessage(reason));}
  finally{if(version===request.current)setChecking(false);}
 }
 useEffect(()=>{
  let valid=true;
  const load=()=>{setSettings(null);void window.lumina.command({type:'cache.settings'}).then(value=>{if(!valid)return;setSettings(value);if(value.setupRequired)void verify(value.directory);}).catch(reason=>{if(valid)setError(userErrorMessage(reason));});};
  load();window.addEventListener('lumina-cache-location-changed',load);
  return()=>{valid=false;request.current++;window.removeEventListener('lumina-cache-location-changed',load);};
 },[libraryPath]);
 useEffect(()=>{latest.current({ready:Boolean(settings&&(!settings.setupRequired||!checking&&space!==undefined&&!error)),directory:settings?.setupRequired&&space!==undefined&&!error?directory:undefined});},[settings,directory,space,checking,error]);
 if(settings&&!settings.setupRequired)return null;
 return <section className="first-library-cache" aria-label={t("首次设置缓存目录")}><div><strong>{t("确认缓存目录")}</strong><p>{t("先确定缩略图和预览的保存位置，再开始扫描。后续图库沿用此位置，可在常规设置中迁移。")}</p></div><div className="import-path-row"><input aria-label={t("首次媒体缓存路径")} readOnly value={directory} title={directory} placeholder={t("正在读取缓存位置…")}/><ActionButton type="button" className="ghost" disabled={disabled||checking||!settings} onClick={async()=>{try{const selected=await window.lumina.pickFolder();if(selected)await verify(selected);}catch(reason){setError(userErrorMessage(reason));}}}>{t("选择缓存目录")}</ActionButton></div>{checking||!settings&&!error?<small role="status">{t("正在检查缓存目录…")}</small>:space!==undefined&&!error?<small role="status">{t("磁盘可用空间：")}{bytesText(space)}{t("· 确认添加后开始使用此位置")}</small>:null}{error&&<p className="form-error" role="alert">{translateMessage(error)}</p>}</section>;
}
