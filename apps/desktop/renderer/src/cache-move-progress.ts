import {t} from './i18n';
type MoveProgress={status:string;active?:boolean;committed?:boolean;processed:number;total:number;phase?:string;phaseProcessed?:number;phaseTotal?:number;payloadJson?:string|null};
export function cacheMoveProgress(job:MoveProgress){
 let payload:{phase?:string;cleanupProcessed?:number;cleanupTotal?:number}={};
 try{payload=JSON.parse(job.payloadJson??'{}');}catch{/* Older records may lack a payload. */}
 const cleanup=job.committed??['cleanup','done'].includes(payload.phase??'');
 const complete=!job.active&&job.status==='completed';
 const processed=cleanup?(job.phaseProcessed??payload.cleanupProcessed??0):job.processed;
 const total=cleanup?(job.phaseTotal??payload.cleanupTotal??job.total):job.total;
 const ratio=total>0?Math.min(1,Math.max(0,processed/total)):0;
 const percent=complete?100:Math.min(99,Math.floor(cleanup?50+ratio*49:ratio*50));
 const label=complete?t("缓存迁移完成"):cleanup?t("第 2/2 步 · 清理旧缓存"):t("第 1/2 步 · 复制并校验");
 return {percent,processed,total,text:t("{0} · {1}/{2} 个{3}", [label, processed, total, complete?'':t(" · 总进度 {0}%", [percent])])};
}
