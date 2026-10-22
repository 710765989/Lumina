import {ActionButton} from './ActionControls';
import {tagLabel} from '@lumina/contracts';
import {userErrorMessage} from './user-error';
import { useEffect, useState } from 'react';
import { useModalEscape } from './useModalEscape';
import { bytesText, mediaName, type Media } from './media-types';
export function MediaDetailsDialog({ item, onClose }: { item: Media; onClose: () => void }) {
  const dialogRef=useModalEscape<HTMLElement>(onClose);
  const [detail, setDetail] = useState<any>(null); const [error, setError] = useState('');
  useEffect(() => { let active = true; void window.lumina.command({ type: 'media.details', id: item.id }).then((value) => { if (active) setDetail(value); }).catch((reason) => setError(userErrorMessage(reason))); return () => { active = false; }; }, [item.id]);
  const metadata = detail?.metadata ?? {};
  const rows = [['文件名', mediaName(item)], ['原始路径', item.absolutePath], ['媒体类型', item.kind === 'video' ? '视频' : '照片'], ['文件大小', bytesText(item.sizeBytes)], ['修改时间', new Date(item.modifiedAtMs).toLocaleString()], ['拍摄时间', detail?.capturedAtMs ? new Date(detail.capturedAtMs).toLocaleString() : '未知'], ['分辨率', metadata.width ? `${metadata.width} × ${metadata.height}` : '未知'], ['相机 / 镜头', [metadata.camera || '未知',metadata.lens || '未知'].join(' / ')], ['拍摄参数', `ISO ${metadata.iso ?? '未知'} · f/${metadata.aperture ?? '未知'} · ${metadata.exposure ?? '未知'}s · ${metadata.focalLength ?? '未知'}mm`], ['标签', detail?.tags?.map((tag: any) => tagLabel(tag)).join(' · ') || '无'], ['相册', detail?.albums?.map((album: any) => album.name).join(' · ') || '无'], ['地点', [metadata.country,metadata.region,metadata.city].filter(Boolean).join(' / ') || '无位置信息']];
  return <div className="dialog-backdrop" onClick={onClose}><section ref={dialogRef} className="tag-dialog media-details-dialog" role="dialog" aria-label="媒体详情" onClick={(event) => event.stopPropagation()}><div className="dialog-head"><strong>媒体详情</strong><ActionButton className="icon-button" aria-label="关闭详情" onClick={onClose}>×</ActionButton></div><div className="library-fields">{rows.map(([label, value]) => <div className="detail-item" key={label}><label>{label}</label><strong>{value}</strong></div>)}{error && <p className="form-error">{error}</p>}</div><div className="dialog-footer library-dialog-actions"><ActionButton className="ghost" onClick={() => window.lumina.native({ action: 'show-file', mediaIds: [item.id] }).catch((reason) => setError(userErrorMessage(reason)))}>在资源管理器中打开</ActionButton><ActionButton className="primary" onClick={onClose}>关闭</ActionButton></div></section></div>;
}
