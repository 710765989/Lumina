import {useLibraryFormats} from './useLibraryFormats';
import {SearchChip} from './SearchChip';
import {ActionButton} from './ActionControls';
import {useEffect,useMemo,useRef,useState} from 'react';
import {matchesSearch,tagLabel} from '@lumina/contracts';
import {useDismissableLayer} from './useDismissableLayer';
import type {Tag} from './media-types';
import {SearchTypeMenu,useSearchTypes,extensionSuggestions,normalizeExtension,type SearchType} from './SearchTypeMenu';
export type MediaFilters={query?:string;fileNames?:string[];excludeFileNames?:string[];extensions?:string[];tagNames?:string[];excludeTagNames?:string[];untaggedOnly?:boolean;excludeUntagged?:boolean};
type Mode=SearchType;
const modes:{type:Mode;label:string}[]=[{type:'tag',label:'标签包含'},{type:'excludeTag',label:'标签排除'},{type:'file',label:'文件名包含'},{type:'excludeFile',label:'文件名不包含'},{type:'extension',label:'文件格式'}];
type Chip={id:string;type:Mode;value:string;untagged?:boolean};
export function CollectionSearch({tags,onChange,hiddenOnly=false}:{hiddenOnly?:boolean;tags:Tag[];onChange:(value:MediaFilters)=>void}){
 const [chips,setChips]=useState<Chip[]>([]),[input,setInput]=useState(''),[mode,setMode]=useState<Mode|null>(null),[open,setOpen]=useState(false),[index,setIndex]=useState(0),[files,setFiles]=useState<{name:string;count:number}[]>([]),[recent,setRecent]=useState<string[]>([]);
 const formats=useLibraryFormats(open&&mode==='extension',hiddenOnly);
 const types=useSearchTypes(choose,tagged=>commit('无',true,tagged?'excludeTag':'tag'));
 const root=useRef<HTMLDivElement>(null),field=useRef<HTMLInputElement>(null),change=useRef(onChange);change.current=onChange;useDismissableLayer(open,()=>setOpen(false),[root]);
 const filters=useMemo(()=>{const result:MediaFilters={};if(!mode && input.trim())result.query=input.trim();for(const [key,type] of [['fileNames','file'],['excludeFileNames','excludeFile'],['extensions','extension'],['tagNames','tag'],['excludeTagNames','excludeTag']] as const){const values=chips.filter(chip=>chip.type===type&&!chip.untagged).map(chip=>chip.value);if(values.length)result[key]=values;}if(chips.some(chip=>chip.type==='tag'&&chip.untagged))result.untaggedOnly=true;if(chips.some(chip=>chip.type==='excludeTag'&&chip.untagged))result.excludeUntagged=true;return result;},[chips,input,mode]);
 useEffect(()=>{const timer=setTimeout(()=>change.current(filters),160);return()=>clearTimeout(timer);},[filters]);
 useEffect(()=>{void window.lumina.command({type:'tags.searchPreferences'}).then(result=>setRecent(result.order==='name'?[]:result.recentIds??[])).catch(()=>{});},[tags]);
 useEffect(()=>{let valid=true;setFiles([]);if(!['file','excludeFile'].includes(mode??'')||!input.trim())return;const timer=setTimeout(()=>{void window.lumina.command({type:'media.nameSuggestions',query:input.trim()}).then(result=>{if(valid)setFiles(result);}).catch(()=>{});},100);return()=>{valid=false;clearTimeout(timer);};},[mode,input]);
 const options=useMemo(()=>{if(mode==='extension')return extensionSuggestions(input,formats).map(row=>({...row,untagged:false}));if(mode==='file'||mode==='excludeFile'){if(!input.trim())return [];const result=files.map(file=>({value:file.name,label:file.count>1?`${file.name} · ${file.count} 项`:file.name,untagged:false}));if(!result.some(row=>row.value===input.trim()))result.push({value:input.trim(),label:`搜索${mode==='excludeFile'?'不包含':'包含'}“${input.trim()}”的文件`,untagged:false});return result;}
  const matching=tags.filter(tag=>!input.trim()||[tag.name,tag.englishName??'',tag.path??'',...(tag.aliases??[])].some(value=>matchesSearch(value,input))).sort((a,b)=>input.trim()?0:(recent.indexOf(a.id)<0?999:recent.indexOf(a.id))-(recent.indexOf(b.id)<0?999:recent.indexOf(b.id))).slice(0,10).map(tag=>({value:tag.name,label:`${tag.directory?'▱ ':'#'}${tag.path??tagLabel(tag)}`,untagged:false}));if(input.trim()&&!matching.length)matching.push({value:input.trim(),label:`#${input.trim()}（按名称搜索）`,untagged:false});return matching;
 },[files,tags,input,mode,recent,formats]);
 function focus(){requestAnimationFrame(()=>field.current?.focus());}
 function choose(type:Mode){types.reset();setMode(type);setInput('');setOpen(type==='extension');setIndex(0);focus();}
 function commit(value:string,untagged=false,override?:Mode){const type=override??mode;if(!value.trim()||!type)return;if(type==='extension'){const ext=normalizeExtension(value);if(!/^[a-z0-9]{1,20}$/u.test(ext))return;value=`.${ext}`;}types.reset();setChips(current=>current.length>=20?current:[...current,{id:crypto.randomUUID(),type,value:value.trim(),untagged}]);setInput('');setMode(null);setOpen(true);setIndex(0);focus();}
 return <div className="search-builder collection-search" ref={root}><span className="search-icon">⌕</span>{chips.map(chip=><SearchChip key={chip.id} label={chip.untagged?`标签：${chip.type==='tag'?'无':'有'}`:`${modes.find(mode=>mode.type===chip.type)!.label}：${chip.value}`} value={chip.value} onRemove={()=>setChips(current=>current.filter(row=>row.id!==chip.id))}/>)}<span className="search-input-wrap">{mode&&<span className="search-prefix">{modes.find(row=>row.type===mode)!.label}：</span>}<input aria-label="搜索当前媒体" ref={field} value={input} title={input||undefined} placeholder={mode?'输入后按回车':'搜索照片、视频或标签…'} onFocus={()=>{if(!mode){setOpen(true);setIndex(0);types.reset();}}} onClick={()=>{setOpen(true);if(!mode){setIndex(0);types.reset();}}} onChange={event=>{setInput(event.target.value);setOpen(true);setIndex(0);}} onKeyDown={event=>{
  if(!mode&&open&&types.key(event.key)){event.preventDefault();return;}
  if(event.key==='Escape'){event.preventDefault();setOpen(false);return;}
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setOpen(true);const count=options.length;setIndex(current=>count?(current+(event.key==='ArrowDown'?1:-1)+count)%count:0);return;}
  if(event.key==='Backspace'&&!input){event.preventDefault();types.reset();if(mode)setMode(null);else setChips(current=>current.slice(0,-1));setOpen(true);setIndex(0);return;}
  if(event.key==='Enter'){event.preventDefault();if(!mode){setOpen(true);types.key('Enter');}else if(open&&options.length){const option=options[Math.min(index,options.length-1)]!;commit(option.value,option.untagged);}else commit(input);}
 }}/>{open&&!mode&&<SearchTypeMenu state={types}/>}{open&&mode&&options.length>0&&<div className="search-tag-suggestions" role="listbox" aria-label={mode==='file'||mode==='excludeFile'?'文件名建议':mode==='extension'?'文件格式建议':'标签建议'}>{options.map((option,at)=><ActionButton role="option" aria-selected={at===index} className={at===index?'active':''} key={option.untagged?'__none':option.value} onClick={()=>commit(option.value,option.untagged)}>{option.label}</ActionButton>)}</div>}</span></div>;
}
