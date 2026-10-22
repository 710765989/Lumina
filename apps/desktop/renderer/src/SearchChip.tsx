import {ActionButton} from './ActionControls';
export function SearchChip({label,value,onRemove}:{label:string;value:string;onRemove:()=>void}){
 return <span className="search-chip" title={label}><span className="search-chip-text">{label}</span><ActionButton aria-label={`删除搜索条件 ${value}`} onClick={event=>{event.stopPropagation();onRemove();}}>×</ActionButton></span>;
}
