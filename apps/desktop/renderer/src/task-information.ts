type TaskLike={kind:string;total:number;payloadJson?:string|null;options?:Record<string,any>;info?:{tagPath?:string;rootPath?:string;scopeCount?:number;selectedCount?:number;scopeLabel?:string}};
export function taskInformation(task:TaskLike){
  let payload:any={};try{payload=JSON.parse(task.payloadJson??'{}')??{};}catch{}
  const options=task.options??payload.options??payload;const info=task.info??payload.info??{};const total=task.total??0;
  if(task.kind==='import')return {title:'导入媒体',description:`复制 ${total} 项媒体到「${options.directory??''}」；保留来源文件和目录层级，${options.conflictPolicy==='overwrite'?'按确认覆盖同名文件':options.conflictPolicy==='skip'?'跳过同名文件':'同名内容不同则自动改名'}。`};
  if(task.kind==='cache-move')return {title:'移动媒体缓存',description:`从「${payload.source??options.sourceDirectory??'旧记录未保存来源目录'}」移动到「${payload.target??options.directory??''}」；校验成功后切换，保留原媒体和数据库。`};
  if(task.kind==='cache-cleanup')return {title:'清理缓存',description:`范围：${info.scopeLabel??'缓存目录'}；核对并清理 ${total} 个缓存文件。保留原媒体与索引；已更新、正在生成或被占用的文件会跳过。`};
  if(task.kind==='directory-rules')return {title:'目录规则整理',description:`目录：${payload.root??options.absolutePath??''}；递归应用 ${(options.rules??[]).length} 条目录标签规则${(options.rules??[]).length?`（${options.rules.slice(0,3).map((rule:any)=>rule.name).join('、')}${options.rules.length>3?'等':''}）`:''}${options.autoAlbums?'，并自动创建相册':''}${options.hierarchy?'（保留目录层级）':''}。`};
  if(task.kind==='tags'){const name=info.tagPath??options.tagName;const action=options.tagAction==='remove'?'移除':'新增';return {title:`标签编辑 · ${action}`,description:`${info.rootPath?`目录：${info.rootPath}（含子目录）；`:''}标签：${name?`「${name}」`:'旧记录未保存标签名称'}；对 ${total} 项媒体${action}标签${action==='新增'?'，子标签会自动包含祖先标签':''}。`};}
  if(task.kind==='duplicates')return {title:'完全重复检测',description:`${Number.isFinite(info.scopeCount)?`预筛范围 ${info.scopeCount} 项；`:'旧记录未保存预筛前数量；'}同大小候选 ${total} 项，逐项计算 SHA-256 核验内容。大小不同的文件不进入内容核验。`};
  if(task.kind==='similar')return {title:'相似照片检测',description:`为 ${total} 张照片提取视觉特征并比较相似度；视频不参与。`};
  if(task.kind==='delete')return {title:options.deleteMode==='permanent'?'永久删除媒体':options.deleteMode==='system'?'移入 Windows 回收站':'移入软件回收站',description:`处理 ${total} 项媒体${options.cleanup?`，按确认计划删除勾选文件${options.cleanup.allowDeleteAll?'，包含已确认的整组删除':''}`:''}。`};
  if(task.kind==='restore')return {title:'还原媒体',description:`还原 ${total} 项到${options.directory?`「${options.directory}」`:'原始位置'}，不覆盖同名文件。`};
  if(task.kind==='purge')return {title:'清理回收站',description:`永久删除 ${total} 项回收站文件。`};
  if(task.kind==='visibility'&&options.syncOnly)return {title:`同步 Windows 隐藏属性${options.hidden===false?' · 取消隐藏':options.hidden===true?' · 隐藏':''}`,description:`按当前手动隐藏、标签规则及单张显示例外，更新 ${total} 项媒体的 Windows 隐藏属性；保留其他属性，取消隐藏恢复软件修改前的状态。`};
  if(task.kind==='visibility')return {title:options.hidden===false?'取消隐藏媒体':'隐藏媒体',description:`更新 ${total} 项媒体的隐藏状态。`};
  if(task.kind==='export')return {title:'导出媒体副本',description:`导出 ${total} 项到「${options.directory??'旧记录未保存目录'}」；${({original:'保留原文件名',date:'按拍摄时间命名',custom:`自定义前缀 ${options.prefix??''}`})[options.naming as 'original'|'date'|'custom']??'原始命名'}${options.stripGps?'；移除GPS':''}${options.xmp?'；导出XMP':''}。`};
  if(task.kind==='geo')return {title:'地理整理',description:`读取 ${total} 张照片的位置，整理地名、标签及智能相册。`};
  if(task.kind==='thumbnail')return {title:'缩略图生成',description:`本批共 ${total} 项媒体，文件与失败原因在详情中逐项保存。`};
  if(task.kind==='video-preview'&&payload.checkpoint)return {title:'生成兼容视频预览',description:`${payload.phase??'兼容视频准备'}；已完成 ${Math.floor(payload.checkpoint.offset??0)}/${Math.ceil(payload.checkpoint.duration??0)} 秒。关闭媒体后暂停，重新打开继续；当前未完成片段会重新生成。`};
  if(task.kind==='scan')return {title:options.incremental?'目录增量更新':'目录扫描',description:`目录：${options.root??'旧记录未保存目录'}；${total} 项待扫描。扫描明细目前仅记录失败文件。`};
  return {title:task.kind==='thumbnail'?'生成缩略图':task.kind==='video-preview'?'生成兼容视频预览':task.kind,description:`处理 ${total} 项媒体。`};
}
export function taskDate(value?:string){if(!value)return '旧记录未保存';const date=new Date(/[TZ]/u.test(value)?value:value.replace(' ','T')+'Z');return Number.isNaN(date.getTime())?value:date.toLocaleString('zh-CN',{hour12:false});}
