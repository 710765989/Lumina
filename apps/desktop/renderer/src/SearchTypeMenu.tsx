import {t} from './i18n';
import {ActionButton} from './ActionControls';
import {useLayoutEffect,useRef,useState} from 'react';
export type SearchType='tag'|'excludeTag'|'file'|'excludeFile'|'extension';
export const searchTypeLabels:Record<SearchType,string>={tag:'标签包含',excludeTag:'标签排除',file:'文件名包含',excludeFile:'文件名不包含',extension:'文件格式'};
export function normalizeExtension(value:string){return value.trim().replace(/^\*?\./u,'').toLowerCase();}
export function extensionSuggestions(value:string,formats:readonly string[]){
  const common=[...new Set(formats.map(normalizeExtension).filter(ext=>/^[a-z0-9]{1,20}$/u.test(ext)))].sort();
  const typed=normalizeExtension(value);
  const matches=common.filter(ext=>!typed||ext.startsWith(typed));
  // Put an exact typed suffix first so Enter never silently selects a longer match.
  if(typed){if(!/^[a-z0-9]{1,20}$/u.test(typed))return [];matches.splice(0,matches.length,typed,...matches.filter(ext=>ext!==typed));}
  return matches.map(ext=>({value:`.${ext}`,label:common.includes(ext)?`.${ext}`:t("搜索后缀 .{0}", [ext])}));
}
export function useSearchTypes(choose:(type:SearchType)=>void,presence:(tagged:boolean)=>void){
  const [top,setTop]=useState(0),[sub,setSub]=useState(0),[expanded,setExpanded]=useState(false);
  function reset(){setTop(0);setSub(0);setExpanded(false);}
  function select(at:number){setExpanded(false);if(top===0){if(at<2)choose(at===0?'tag':'excludeTag');else presence(at===2);}else if(top===1)choose(at===0?'file':'excludeFile');else choose('extension');}
  function key(key:string){
    if(key==='Escape' && expanded){setExpanded(false);return true;}
    if(key==='ArrowLeft' && expanded){setExpanded(false);return true;}
    if(key==='ArrowDown'||key==='ArrowUp'){const step=key==='ArrowDown'?1:-1;if(expanded)setSub(value=>{const size=top===0?4:top===1?2:1;return (value+step+size)%size;});else setTop(value=>(value+step+3)%3);return true;}
    if(key==='Enter'||key==='ArrowRight'){if(top===2){if(key==='Enter')choose('extension');}else if(expanded){if(key==='Enter')select(sub);}else {setExpanded(true);setSub(0);}return true;}return false;
  }
  return {top,sub,expanded,setTop,setSub,setExpanded,reset,select,key,choose};
}
export function SearchTypeMenu({state}:{state:ReturnType<typeof useSearchTypes>}){
  const root=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{const node=root.current,menu=node?.querySelector<HTMLElement>('.search-tag-mode-menu');if(node&&menu){menu.dataset.side=node.getBoundingClientRect().right+menu.offsetWidth>innerWidth-8?'left':'right';}},[state.expanded,state.top]);
  return <div ref={root} className="search-mode-menu" role="listbox" aria-label={t("搜索类型")} onClick={event=>event.stopPropagation()} onKeyDown={event=>{if(state.key(event.key)){event.preventDefault();event.stopPropagation();}}}>
    {([[t("标签"),[t("包含"),t("排除"),t("有"),t("无")]],[t("文件名"),[t("包含"),t("不包含")]],[t("文件格式"),[]]] as const).map(([label,children],at)=><div className="search-type-tag" key={label} onMouseEnter={()=>{state.setTop(at);state.setExpanded(children.length>0);state.setSub(0);}}><ActionButton type="button" role="option" aria-label={t(label)} aria-selected={state.top===at} aria-expanded={state.expanded&&state.top===at} className={state.top===at?'active':''} onClick={()=>{state.setTop(at);state.setExpanded(children.length>0);state.setSub(0);if(!children.length)state.choose('extension');}}>{t(label)}{children.length>0&&<span>›</span>}</ActionButton>{state.expanded&&state.top===at&&children.length>0&&<div className="search-tag-mode-menu" role="listbox" aria-label={t("{0}条件", [label])}>{children.map((child,index)=><ActionButton type="button" role="option" aria-selected={state.sub===index} className={state.sub===index?'active':''} key={child} onMouseEnter={()=>state.setSub(index)} onClick={()=>state.select(index)}>{t(child)}</ActionButton>)}</div>}</div>)}
  </div>;
}
