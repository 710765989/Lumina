import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {matchesSearch} from '@lumina/contracts';
import {ActionButton} from './ActionControls';
import {useDismissableLayer} from './useDismissableLayer';
import type {Tag} from './media-types';
import {directoryTagSuggestion} from './directory-tag-input';

export function DirectoryTagInput({label,names,tags,disabled,onChange,onDraftChange}:{label:string;names:string[];tags:Tag[];disabled:boolean;onChange:(names:string[])=>void;onDraftChange:(query:string)=>void}){
  const [query,setQuery]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(0),[position,setPosition]=useState({left:0,top:0,width:260,maxHeight:240});
  const root=useRef<HTMLDivElement>(null),field=useRef<HTMLInputElement>(null),popup=useRef<HTMLDivElement>(null),listId=useId();
  useDismissableLayer(open,()=>setOpen(false),[root,popup]);
  const options=useMemo(()=>{
    const selected=new Set(names.map(name=>name.toLocaleLowerCase()));
    const rows=tags.filter(tag=>tag.directory&&!selected.has(tag.name.toLocaleLowerCase())&&(!query.trim()||[tag.name,tag.englishName??'',tag.path??'',...(tag.aliases??[])].some(value=>matchesSearch(value,query.trim())))).slice(0,10).map(tag=>({name:tag.name,label:`▱ ${tag.path??tag.name}`,create:false}));
    const typed=query.trim(),candidate=directoryTagSuggestion(typed,tags);if(typed&&!selected.has(candidate.toLocaleLowerCase())&&!rows.some(row=>row.name===candidate))rows.push({name:candidate,label:candidate===typed?`＋ 新建目录标签「${candidate}」`:`已有同名普通标签，使用「${candidate}」`,create:true});
    return rows;
  },[names,tags,query]);
  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
  useEffect(()=>{setActive(0);},[query]);
  useLayoutEffect(()=>{
    if(!open)return;
    const locate=()=>{const bounds=root.current?.getBoundingClientRect();if(!bounds)return;const width=Math.min(420,Math.max(260,bounds.width)),below=innerHeight-bounds.bottom-12,height=Math.min(240,Math.max(40,options.length*36+10)),above=below<Math.min(150,height)&&bounds.top>below;setPosition({left:Math.max(8,Math.min(bounds.left,innerWidth-width-8)),top:above?Math.max(8,bounds.top-height-6):bounds.bottom+6,width,maxHeight:above?Math.min(240,bounds.top-14):Math.max(70,below)});};
    locate();const scroll=(event:Event)=>{if(event.target instanceof Node&&popup.current?.contains(event.target))return;setOpen(false);};window.addEventListener('resize',locate);window.addEventListener('scroll',scroll,true);return()=>{window.removeEventListener('resize',locate);window.removeEventListener('scroll',scroll,true);};
  },[open,options.length]);
  function add(name:string){if(disabled||!name.trim())return;name=directoryTagSuggestion(name,tags);if(!names.some(value=>value.toLocaleLowerCase()===name.toLocaleLowerCase()))onChange([...names,name.trim()]);setQuery('');onDraftChange('');setOpen(false);setActive(0);field.current?.focus();}
  return <div ref={root} className="directory-tag-input">
    {names.map(name=><span className="directory-tag-chip" key={name} title={name}>{name}<ActionButton type="button" disabled={disabled} aria-label={`移除目录标签 ${name}`} onClick={()=>onChange(names.filter(value=>value!==name))}>×</ActionButton></span>)}
    <input ref={field} role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open&&!disabled&&options.length>0} aria-controls={listId} aria-activedescendant={open&&options.length?`${listId}-${Math.min(active,options.length-1)}`:undefined} value={query} maxLength={100} placeholder={names.length?'继续添加标签…':'搜索或输入标签…'} disabled={disabled} onFocus={()=>{setOpen(true);setActive(0);}} onClick={()=>setOpen(true)} onChange={event=>{setQuery(event.target.value);onDraftChange(event.target.value);setOpen(true);}} onKeyDown={event=>{
      if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);setActive(index=>options.length?(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length:0);}
      if(event.key==='Enter'){event.preventDefault();event.stopPropagation();const row=open?options[Math.min(active,options.length-1)]:undefined;add(row?.name??query.trim());}
    }}/>
    {!disabled&&open&&options.length>0&&createPortal(<div ref={popup} id={listId} role="listbox" aria-label={`${label}建议`} className="search-tag-suggestions directory-tag-suggestions" style={{position:'fixed',...position}}>{options.map((row,index)=><ActionButton type="button" key={row.name} id={`${listId}-${index}`} role="option" aria-selected={index===active} className={index===active?'active':''} title={row.label} onMouseEnter={()=>setActive(index)} onMouseDown={event=>event.preventDefault()} onClick={()=>add(row.name)}>{row.label}</ActionButton>)}</div>,document.body)}
  </div>;
}
