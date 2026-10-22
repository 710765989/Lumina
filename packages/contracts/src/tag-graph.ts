export type TagNode={id:string;name:string;englishName?:string;parentId?:string|null;parentIds?:string[]};
export function tagParents(tag:TagNode):string[]{return tag.parentIds??(tag.parentId?[tag.parentId]:[]);}
export function tagLabel(tag:{name:string;englishName?:string}):string{
  const english=tag.englishName?.trim();return english && english.toLocaleLowerCase()!==tag.name.trim().toLocaleLowerCase()?`${tag.name}（${english}）`:tag.name;
}
// All paths must remain acyclic and at most five levels, including shared branches.
export function describeTagGraph<T extends TagNode>(tags:T[]){
  const byId=new Map(tags.map(tag=>[tag.id,tag]));const memo=new Map<string,{depth:number;path:string}>();const visiting=new Set<string>();
  function describe(id:string):{depth:number;path:string}{
    const cached=memo.get(id);if(cached)return cached;
    if(visiting.has(id))throw new Error('不能把标签移到自己或子标签下');
    const tag=byId.get(id);if(!tag)throw new Error('父标签不存在');visiting.add(id);
    const parents=tagParents(tag).map(describe);const depth=1+Math.max(0,...parents.map(row=>row.depth));
    if(depth>5)throw new Error('标签层级最多为 5 级');
    const path=parents.length?`${parents[0]!.path} / ${tagLabel(tag)}`:tagLabel(tag);const result={depth,path};memo.set(id,result);visiting.delete(id);return result;
  }
  const children=new Map<string,Set<string>>();for(const tag of tags)for(const parent of tagParents(tag)){const group=children.get(parent)??new Set();group.add(tag.id);children.set(parent,group);}
  return tags.map(tag=>({...tag,parentIds:tagParents(tag),parentId:tagParents(tag)[0]??null,...describe(tag.id),childCount:children.get(tag.id)?.size??0}));
}
export function tagDescendants(tags:TagNode[],id:string):Set<string>{
  const result=new Set([id]);const children=new Map<string,string[]>();for(const tag of tags)for(const parent of tagParents(tag))children.set(parent,[...(children.get(parent)??[]),tag.id]);
  const pending=[id];while(pending.length)for(const child of children.get(pending.pop()!)??[])if(!result.has(child)){result.add(child);pending.push(child);}return result;
}
export function tagOccurrences<T extends TagNode>(tags:T[]){
  const children=new Map<string|null,T[]>();for(const tag of tags)for(const parent of tagParents(tag).length?tagParents(tag):[null]){const group=children.get(parent)??[];group.push(tag);children.set(parent,group);}
  const result:Array<T&{parentId:string|null;path:string;pathIds:string[];key:string;depth:number}>=[];
  function visit(parent:string|null,path:string[],ids:string[]){for(const tag of children.get(parent)??[]){if(ids.includes(tag.id) || ids.length>=5)continue;const next=[...path,tagLabel(tag)],nextIds=[...ids,tag.id];result.push({...tag,parentId:parent,path:next.join(' / '),pathIds:nextIds,key:nextIds.join('/'),depth:nextIds.length});visit(tag.id,next,nextIds);}}
  visit(null,[],[]);return result;
}
