import {t,translateMessage} from './i18n';
import {useState} from 'react';
import {ActionButton} from './ActionControls';
import {useModalEscape} from './useModalEscape';
import {userErrorMessage} from './user-error';
export type HiddenReason={ids:string[];byMedia:Record<string,string[]>;tags:{id:string;name:string;count:number}[];affected:number};
export function HiddenReasonDialog({reason,onClose,onShow,onEdit}:{reason:HiddenReason;onClose:()=>void;onShow:()=>Promise<void>;onEdit:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),ref=useModalEscape<HTMLElement>(onClose,busy);
 return <div className="dialog-backdrop"><section ref={ref} className="tag-dialog" role="dialog" aria-modal="true" aria-label={t("取消标签隐藏")}><div className="dialog-head"><strong>{t("这些媒体仍被标签隐藏")}</strong><ActionButton className="ghost" aria-label={t("关闭取消隐藏提示")} disabled={busy} onClick={onClose}>×</ActionButton></div><div className="library-fields"><p>{t("所选媒体中")}{reason.affected}{t("项受以下标签规则影响。仅取消手动隐藏仍不会显示。")}</p><div className="dialog-tag-list">{reason.tags.map(tag=><span className="dialog-tag" key={tag.id}>#{tag.name}<small>{tag.count}{t("项")}</small></span>)}</div><p className="dialog-hint">“{reason.ids.length===1?t("仅显示此项"):t("显示所选项")}{t("”保留标签，仅让这些媒体忽略上面列出的隐藏标签。以后新增其他隐藏标签仍会隐藏；停用目录、回收站和文件不可用状态不受影响。")}</p>{error&&<p className="form-error" role="alert">{translateMessage(error)}</p>}</div><div className="dialog-footer library-dialog-actions"><ActionButton className="ghost" disabled={busy} onClick={onClose}>{t("取消")}</ActionButton><ActionButton className="ghost" disabled={busy} onClick={onEdit}>{t("编辑标签")}</ActionButton><ActionButton className="primary" disabled={busy} onClick={async()=>{setBusy(true);try{await onShow();onClose();}catch(error){setError(userErrorMessage(error));}finally{setBusy(false);}}}>{busy?t("正在处理…"):reason.ids.length===1?t("仅显示此项"):t("显示所选项")}</ActionButton></div></section></div>;
}
