import {t,translateMessage,getLanguage} from './i18n';
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
  const rows = [[t("文件名"), mediaName(item)], [t("原始路径"), item.absolutePath], [t("媒体类型"), item.kind === 'video' ? t("视频") : t("照片")], [t("文件大小"), bytesText(item.sizeBytes)], [t("修改时间"), new Date(item.modifiedAtMs).toLocaleString(getLanguage())], [t("拍摄时间"), detail?.capturedAtMs ? new Date(detail.capturedAtMs).toLocaleString(getLanguage()) : t("未知")], [t("分辨率"), metadata.width ? `${metadata.width} × ${metadata.height}` : t("未知")], [t("相机 / 镜头"), [metadata.camera || t("未知"),metadata.lens || t("未知")].join(' / ')], [t("拍摄参数"), `ISO ${metadata.iso ?? t("未知")} · f/${metadata.aperture ?? t("未知")} · ${metadata.exposure ?? t("未知")}s · ${metadata.focalLength ?? t("未知")}mm`], [t("标签"), detail?.tags?.map((tag: any) => tagLabel(tag)).join(' · ') || t("无")], [t("相册"), detail?.albums?.map((album: any) => album.name).join(' · ') || t("无")], [t("地点"), [metadata.country,metadata.region,metadata.city].filter(Boolean).join(' / ') || t("无位置信息")]];
  return <div className="dialog-backdrop" onClick={onClose}><section ref={dialogRef} className="tag-dialog media-details-dialog" role="dialog" aria-label={t("媒体详情")} onClick={(event) => event.stopPropagation()}><div className="dialog-head"><strong>{t("媒体详情")}</strong><ActionButton className="icon-button" aria-label={t("关闭详情")} onClick={onClose}>×</ActionButton></div><div className="library-fields">{rows.map(([label, value]) => <div className="detail-item" key={label}><label>{t(label)}</label><strong>{value}</strong></div>)}{error && <p className="form-error">{translateMessage(error)}</p>}</div><div className="dialog-footer library-dialog-actions"><ActionButton className="ghost" onClick={() => window.lumina.native({ action: 'show-file', mediaIds: [item.id] }).catch((reason) => setError(userErrorMessage(reason)))}>{t("在资源管理器中打开")}</ActionButton><ActionButton className="primary" onClick={onClose}>{t("关闭")}</ActionButton></div></section></div>;
}
