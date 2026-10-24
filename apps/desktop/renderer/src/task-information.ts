import {t,getLanguage} from './i18n';
type TaskLike={kind:string;total:number;payloadJson?:string|null;options?:Record<string,any>;info?:{tagPath?:string;rootPath?:string;scopeCount?:number;selectedCount?:number;scopeLabel?:string}};
export function taskInformation(task:TaskLike){
  let payload:any={};try{payload=JSON.parse(task.payloadJson??'{}')??{};}catch{}
  const options=task.options??payload.options??payload;const info=task.info??payload.info??{};const total=task.total??0;
  if(task.kind==='import')return {title:t("导入媒体"),description:t("复制 {0} 项媒体到「{1}」；保留来源文件和目录层级，{2}。", [total, options.directory??'', options.conflictPolicy==='overwrite'?t("按确认覆盖同名文件"):options.conflictPolicy==='skip'?t("跳过同名文件"):t("同名内容不同则自动改名")])};
  if(task.kind==='cache-move')return {title:t("移动媒体缓存"),description:t("从「{0}」移动到「{1}」；校验成功后切换，保留原媒体和数据库。", [payload.source??options.sourceDirectory??t("旧记录未保存来源目录"), payload.target??options.directory??''])};
  if(task.kind==='cache-cleanup')return {title:t("清理缓存"),description:t("范围：{0}；核对并清理 {1} 个缓存文件。保留原媒体与索引；已更新、正在生成或被占用的文件会跳过。", [info.scopeLabel??t("缓存目录"), total])};
  if(task.kind==='directory-rules')return {title:t("目录规则整理"),description:t("目录：{0}；递归应用 {1} 条目录标签规则{2}{3}{4}。", [payload.root??options.absolutePath??'', (options.rules??[]).length, (options.rules??[]).length?`（${options.rules.slice(0,3).map((rule:any)=>rule.name).join('、')}${options.rules.length>3?t("等"):''}）`:'', options.autoAlbums?t("，并自动创建相册"):'', options.hierarchy?t("（保留目录层级）"):''])};
  if(task.kind==='tags'){const name=info.tagPath??options.tagName;const action=options.tagAction==='remove'?'移除':'新增';return {title:t("标签编辑 · {0}", [t(action)]),description:t("{0}标签：{1}；对 {2} 项媒体{3}标签{4}。", [info.rootPath?t("目录：{0}（含子目录）；", [info.rootPath]):'', name?`「${name}」`:t("旧记录未保存标签名称"), total, t(action), action==='新增'?t("，子标签会自动包含祖先标签"):''])};}
  if(task.kind==='duplicates')return {title:t("完全重复检测"),description:t("{0}同大小候选 {1} 项，逐项计算 SHA-256 核验内容。大小不同的文件不进入内容核验。", [Number.isFinite(info.scopeCount)?t("预筛范围 {0} 项；", [info.scopeCount]):t("旧记录未保存预筛前数量；"), total])};
  if(task.kind==='similar')return {title:t("相似照片检测"),description:t("为 {0} 张照片提取视觉特征并比较相似度；视频不参与。", [total])};
  if(task.kind==='delete')return {title:options.deleteMode==='permanent'?t("永久删除媒体"):options.deleteMode==='system'?t("移入 Windows 回收站"):t("移入软件回收站"),description:t("处理 {0} 项媒体{1}。", [total, options.cleanup?t("，按确认计划删除勾选文件{0}", [options.cleanup.allowDeleteAll?t("，包含已确认的整组删除"):'']):''])};
  if(task.kind==='restore')return {title:t("还原媒体"),description:t("还原 {0} 项到{1}，不覆盖同名文件。", [total, options.directory?`「${options.directory}」`:t("原始位置")])};
  if(task.kind==='purge')return {title:t("清理回收站"),description:t("永久删除 {0} 项回收站文件。", [total])};
  if(task.kind==='visibility'&&options.syncOnly)return {title:t("同步 Windows 隐藏属性{0}", [options.hidden===false?t(" · 取消隐藏"):options.hidden===true?t(" · 隐藏"):'']),description:t("按当前手动隐藏、标签规则及单张显示例外，更新 {0} 项媒体的 Windows 隐藏属性；保留其他属性，取消隐藏恢复软件修改前的状态。", [total])};
  if(task.kind==='visibility')return {title:options.hidden===false?t("取消隐藏媒体"):t("隐藏媒体"),description:t("更新 {0} 项媒体的隐藏状态。", [total])};
  if(task.kind==='export')return {title:t("导出媒体副本"),description:t("导出 {0} 项到「{1}」；{2}{3}{4}。", [total, options.directory??t("旧记录未保存目录"), ({original:t("保留原文件名"),date:t("按拍摄时间命名"),custom:t("自定义前缀 {0}", [options.prefix??''])})[options.naming as 'original'|'date'|'custom']??t("原始命名"), options.stripGps?t("；移除GPS"):'', options.xmp?t("；导出XMP"):''])};
  if(task.kind==='geo')return {title:t("更新足迹"),description:t("为 {0} 张照片补全足迹地点；不创建标签或相册，优先复用已保存的 GPS，仅缺少元数据的旧项目补读原文件。", [total])};
  if(task.kind==='thumbnail')return {title:t("缩略图生成"),description:t("本批共 {0} 项媒体，文件与失败原因在详情中逐项保存。", [total])};
  if(task.kind==='video-preview'&&payload.checkpoint)return {title:t("生成兼容视频预览"),description:t("{0}；已完成 {1}/{2} 秒。关闭媒体后暂停，重新打开继续；当前未完成片段会重新生成。", [payload.phase??t("兼容视频准备"), Math.floor(payload.checkpoint.offset??0), Math.ceil(payload.checkpoint.duration??0)])};
  if(task.kind==='scan')return {title:options.incremental?t("目录增量更新"):t("目录扫描"),description:t("目录：{0}；{1} 项待扫描。扫描明细目前仅记录失败文件。", [options.root??t("旧记录未保存目录"), total])};
  return {title:task.kind==='thumbnail'?t("生成缩略图"):task.kind==='video-preview'?t("生成兼容视频预览"):task.kind,description:t("处理 {0} 项媒体。", [total])};
}
export function taskDate(value?:string){if(!value)return t("旧记录未保存");const date=new Date(/[TZ]/u.test(value)?value:value.replace(' ','T')+'Z');return Number.isNaN(date.getTime())?value:date.toLocaleString(getLanguage(),{hour12:false});}
