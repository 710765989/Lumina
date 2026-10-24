import {t} from './i18n';
import {describeTagGraph,tagOccurrences,tagParents,tagReferenceChange} from '@lumina/contracts';
import type {Tag} from './media-types';
export type TagDropPlan={id:string;fromParentId:string|null;parentId:string|null;copy:boolean;sourceKey:string;targetKey:string|null;newKey:string;parentIds:string[];rootReference:boolean};
export function planTagDrop(tags:Tag[],sourceKey:string,targetKey:string|null,copy:boolean):TagDropPlan|null{
 const rows=tagOccurrences(tags),source=rows.find(row=>row.key===sourceKey),target=targetKey?rows.find(row=>row.key===targetKey):undefined;
 if(!source)throw new Error("标签引用已变化，请刷新后重试");
 if(source.directory)throw new Error("目录标签的层级请在目录设置中修改");
 if(targetKey&&!target)throw new Error("目标标签已变化，请重新拖动");
 if(target?.directory)throw new Error("目录标签和普通标签不能建立父子关系");
 const next=tagReferenceChange(source,source.parentId,target?.id??null,copy);
 if(JSON.stringify([...tagParents(source)].sort())===JSON.stringify(next.parentIds)&&Boolean(source.rootReference)===next.rootReference)return null;
 describeTagGraph(tags.map(row=>row.id===source.id?{...row,...next}:row));
 return {id:source.id,fromParentId:source.parentId,parentId:target?.id??null,copy,sourceKey,targetKey,newKey:targetKey?`${targetKey}/${source.id}`:source.id,...next};
}
export function applyTagDrop(tags:Tag[],plan:TagDropPlan|null){return plan?describeTagGraph(tags.map(row=>row.id===plan.id?{...row,parentIds:plan.parentIds,rootReference:plan.rootReference}:row)):tags;}
export function tagDropRenderKey(key:string,plan:TagDropPlan|null){return plan&&!plan.copy&&(key===plan.newKey||key.startsWith(plan.newKey+'/'))?plan.sourceKey+key.slice(plan.newKey.length):key;}
