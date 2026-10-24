import type {LuminaDatabase} from './index.js';

function directoryType(db:LuminaDatabase,id:string){
 const row=db.prepare("SELECT COALESCE(o.source,'user') AS source FROM tags t LEFT JOIN tag_options o ON o.tag_id=t.id WHERE t.id=?").get(id) as {source:string}|undefined;
 if(!row)throw new Error('标签不存在');
 return row.source==='directory';
}
export function assertSameTagType(db:LuminaDatabase,id:string,others:string[],action:'parent'|'merge'){
 const directory=directoryType(db,id);
 for(const other of new Set(others))if(directoryType(db,other)!==directory)throw new Error(action==='merge'?'目录标签和普通标签不能合并':'目录标签和普通标签不能建立父子关系');
}
