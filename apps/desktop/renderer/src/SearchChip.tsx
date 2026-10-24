import {t} from './i18n';
import {ActionButton} from './ActionControls';
export function SearchChip({label,value,onRemove}:{label:string;value:string;onRemove:()=>void}){
 return <span className="search-chip" title={t(label)}><span className="search-chip-text">{t(label)}</span><ActionButton aria-label={t("删除搜索条件 {0}", [value])} onClick={event=>{event.stopPropagation();onRemove();}}>×</ActionButton></span>;
}
