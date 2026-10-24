import {useEffect,useState} from 'react';
import {t,translateMessage} from './i18n';
import {ActionButton} from './ActionControls';
import {useModalEscape} from './useModalEscape';
import {userErrorMessage} from './user-error';
type Preview={albums:{id:string;name:string;parentId:string|null}[];total:number;revision:string};
export function AlbumDeleteDialog({id,onClose,onDeleted}:{id:string;onClose:()=>void;onDeleted:(ids:string[])=>Promise<void>}){
 const [preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[epoch,setEpoch]=useState(0),[loading,setLoading]=useState(true),ref=useModalEscape<HTMLElement>(onClose,busy);
 useEffect(()=>{let valid=true;setLoading(true);setPreview(null);void window.lumina.command({type:'albums.deletePreview',id}).then(result=>{if(valid)setPreview(result);}).catch(reason=>{if(valid)setError(userErrorMessage(reason));}).finally(()=>{if(valid)setLoading(false);});return()=>{valid=false;};},[id,epoch]);
 const root=preview?.albums.find(album=>album.id===id);
 return <div className="dialog-backdrop" onClick={()=>{if(!busy)onClose();}}><section ref={ref} className="tag-dialog" role="dialog" aria-modal="true" aria-label={t('删除相册')} onClick={event=>event.stopPropagation()}>
  <div className="dialog-head"><strong>{t('删除相册')}</strong><ActionButton className="icon-button" disabled={busy} aria-label={t('关闭')} onClick={onClose}>×</ActionButton></div>
  <div className="library-fields">
   {loading?<p role="status">{t('正在读取删除范围…')}</p>:root?<><p>{t('将删除「{0}」及其全部下级相册，共 {1} 个。',[root.name,preview!.total])}</p><div className="album-delete-list">{preview!.albums.map(album=><div key={album.id}>{album.id===id?'▱ ':'↳ '}{album.name}</div>)}</div><p className="dialog-hint">{t('只删除以上相册和相册关系，不删除原照片、视频或标签。')}</p><p className="dialog-hint">{t('独立创建的相册会保留，即使使用相同目录或媒体。')}</p></>:<p>{t('相册不存在')}</p>}
   {error&&<p className="form-error" role="alert">{translateMessage(error)}</p>}
  </div>
  <div className="dialog-footer library-dialog-actions"><ActionButton className="ghost" disabled={busy} onClick={onClose}>{t('取消')}</ActionButton>{error&&<ActionButton className="ghost" disabled={busy||loading} onClick={()=>{setError('');setEpoch(value=>value+1);}}>{t('刷新删除范围')}</ActionButton>}<ActionButton className="primary" disabled={busy||loading||!root||Boolean(error)} onClick={async()=>{if(!preview||busy)return;setBusy(true);setError('');try{const result=await window.lumina.command({type:'albums.delete',id,revision:preview.revision});await onDeleted(result.deletedIds);onClose();}catch(reason){setError(userErrorMessage(reason));}finally{setBusy(false);}}}>{busy?t('正在删除…'):t('确认删除')}</ActionButton></div>
 </section></div>;
}
