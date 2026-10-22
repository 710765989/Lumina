export function directoryLeafName(value:string){
  return value.split(/[\\/]/u).filter(Boolean).at(-1)??'';
}
export function directoryTagNames(rules:readonly {relativePath:string;name:string}[]){
  const result:Record<string,string[]>={};
  for(const rule of rules){const names=result[rule.relativePath]??=[];if(!names.includes(rule.name))names.push(rule.name);}
  return result;
}
export function directoryTagSuggestion(name:string,tags:readonly {name:string;directory?:boolean;englishName?:string;aliases?:string[]}[]){
  const original=name.trim();let candidate=original,suffix=1;
  const find=(value:string)=>tags.find(tag=>[tag.name,tag.englishName??'',...(tag.aliases??[])].some(item=>item&&item.toLocaleLowerCase()===value.toLocaleLowerCase()));
  let existing=find(candidate);
  while(existing&&!existing.directory){candidate=`${original.slice(0,90)}（目录${suffix===1?'':suffix}）`;suffix++;existing=find(candidate);}
  return existing?.name??candidate;
}
