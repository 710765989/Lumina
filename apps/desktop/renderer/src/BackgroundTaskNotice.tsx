import {cacheMoveProgress} from './cache-move-progress';
import {ActionButton} from './ActionControls';
import {useEffect,useRef,useState} from 'react';

type Started={id:string;kind:string;began:number};
type Notice={id:string;text:string;status:'running'|'success'|'error'|'paused'|'cancelled'};
const labels:Record<string,string>={'cache-move':'移动缓存',import:'导入媒体','cache-cleanup':'清理缓存','directory-rules':'目录规则整理',thumbnail:'生成缩略图',tags:'编辑标签',delete:'删除',restore:'还原',purge:'清理回收站',visibility:'更新隐藏状态',export:'导出',duplicates:'重复检测',similar:'相似检测',geo:'地理整理'};
export async function startBackgroundJob(request:{type:'jobs.start';kind:string;[key:string]:unknown}){
  const job=await window.lumina.command(request);
  window.dispatchEvent(new CustomEvent('lumina-job-started',{detail:{id:job.id,kind:request.kind,began:Date.now()}}));
  return job;
}
export function BackgroundTaskNotice({onOpen}:{onOpen:(id:string)=>void}){
  const [notice,setNotice]=useState<Notice|null>(null);const tasks=useRef(new Map<string,Started>());
  useEffect(()=>{
    let disposed=false,running=false;
    const publish=(value:Notice)=>{if(!disposed)setNotice((current)=>current?.id===value.id && current.text===value.text && current.status===value.status?current:value);};
    const poll=async()=>{if(running || !tasks.current.size)return;running=true;try{for(const task of [...tasks.current.values()]){
      try{const job=await window.lumina.command({type:'jobs.result',id:task.id,limit:1});if(disposed)return;const label=labels[task.kind]??'任务';
        if(!job.active && ['completed','failed','cancelled'].includes(job.status)){
          tasks.current.delete(task.id);if(task.kind==='cache-cleanup')window.dispatchEvent(new CustomEvent('lumina-cache-cleared'));
          publish({id:task.id,status:job.status==='completed'?'success':job.status==='failed'?'error':'cancelled',text:job.status==='completed'?`${label}成功 · ${job.counts?.completed??job.processed} 项`:job.status==='failed'?`${label}完成 · ${job.counts?.completed??0} 项成功，${job.counts?.failed??0} 项失败`:`${label}已取消 · 已处理 ${job.processed}/${job.total} 项`});
        }else if(Date.now()-task.began>=250){
          const state=job.status==='paused'?'已暂停':job.status==='queued'?'已加入处理队列':'正在后台处理';
          publish({id:task.id,status:job.status==='paused'?'paused':'running',text:task.kind==='cache-move'?`${cacheMoveProgress(job).text}${!job.committed?' · 新预览暂时等待':''}`:`${label}${state} · ${job.processed}/${job.total} 项 · ${Math.round(job.processed/Math.max(1,job.total)*100)}%`});
        }
      }catch{ /* The persisted task remains available in task status; retry polling. */ }
    }}finally{running=false;}};
    const started=(event:Event)=>{const task=(event as CustomEvent<Started>).detail;tasks.current.set(task.id,task);void poll();};
    window.addEventListener('lumina-job-started',started);const timer=window.setInterval(()=>void poll(),500);
    return()=>{disposed=true;window.removeEventListener('lumina-job-started',started);window.clearInterval(timer);};
  },[]);
  useEffect(()=>{if(!notice || notice.status==='running' || notice.status==='paused')return;const timer=window.setTimeout(()=>setNotice((current)=>current===notice?null:current),notice.status==='error'?8000:4000);return()=>window.clearTimeout(timer);},[notice]);
  if(!notice)return null;
  return <div className={`background-task-notice task-${notice.status}`} role="status" aria-live="polite"><span>{notice.text}</span><ActionButton className="ghost" onClick={()=>onOpen(notice.id)}>查看进度</ActionButton><ActionButton className="task-notice-close" aria-label="关闭任务提示" onClick={()=>setNotice(null)}>×</ActionButton></div>;
}
