import {t,translateMessage} from './i18n';
import {ActionButton,ActionForm} from './ActionControls';
import {userErrorMessage} from './user-error';
import { useEffect, useState } from 'react';
import { useModalEscape } from './useModalEscape';

type Album = { id: string; name: string; description: string };

export function LibraryFormDialog({ title, initialName = '', initialDescription, nameLabel, maxLength, onClose, onSave }: {
  title: string; initialName?: string; initialDescription?: string; nameLabel: string; maxLength: number;
  onClose: () => void; onSave: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useModalEscape<HTMLFormElement>(onClose, saving);
  return <div className="dialog-backdrop" onClick={() => { if (!saving) onClose(); }}>
    <ActionForm ref={dialogRef} className="tag-dialog library-form" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} onSubmit={async (event) => {
      event.preventDefault();
      if (saving) return;
      if (!name.trim()) { setError(t("请输入{0}", [nameLabel])); return; }
      setSaving(true); setError('');
      try { await onSave(name.trim(), description.trim()); onClose(); }
      catch (reason) { setError(userErrorMessage(reason)); }
      finally { setSaving(false); }
    }}>
      <div className="dialog-head"><strong>{title}</strong><ActionButton type="button" className="icon-button" disabled={saving} aria-label={t("关闭")} onClick={onClose}>×</ActionButton></div>
      <div className="library-fields">
        <label>{nameLabel}<input autoFocus value={name} maxLength={maxLength} disabled={saving} onChange={(event) => setName(event.target.value)} placeholder={t("输入{0}", [nameLabel])} /></label>
        {initialDescription !== undefined && <label>{t("相册描述")}<textarea value={description} maxLength={2000} disabled={saving} onChange={(event) => setDescription(event.target.value)} placeholder={t("添加描述（可选）")} rows={3} /></label>}
        {error && <p className="form-error" role="alert">{translateMessage(error)}</p>}
      </div>
      <div className="dialog-footer library-dialog-actions"><ActionButton type="button" className="ghost" disabled={saving} onClick={onClose}>{t("取消")}</ActionButton><ActionButton type="submit" className="primary" disabled={saving}>{saving ? t("保存中…") : t("保存")}</ActionButton></div>
    </ActionForm>
  </div>;
}

export function AlbumPickerDialog({ albums, mediaCount, onClose, onSave }: {
  albums: Album[]; mediaCount: number; onClose: () => void; onSave: (ids: string[]) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useModalEscape<HTMLFormElement>(onClose, saving);
  return <div className="dialog-backdrop" onClick={() => { if (!saving) onClose(); }}><ActionForm ref={dialogRef} className="tag-dialog" role="dialog" aria-modal="true" aria-label={t("加入相册")} onClick={(event) => event.stopPropagation()} onSubmit={async (event) => {
    event.preventDefault(); if (saving || !selectedIds.length) return;
    setSaving(true); setError('');
    try { await onSave(selectedIds); onClose(); }
    catch (reason) { setError(userErrorMessage(reason)); }
    finally { setSaving(false); }
  }}><div className="dialog-head"><div><strong>{t("加入相册")}</strong><p>{t("将")}{mediaCount}{t("项媒体加入所选相册")}</p></div><ActionButton type="button" className="icon-button" disabled={saving} onClick={onClose} aria-label={t("关闭")}>×</ActionButton></div>
    <div className="album-picker-list">{albums.map((album) => <label key={album.id} className="album-picker-item"><input type="checkbox" disabled={saving} checked={selectedIds.includes(album.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, album.id] : current.filter((id) => id !== album.id))} /><span><strong>{album.name}</strong><small>{album.description || t("暂无描述")}</small></span></label>)}</div>
    {error && <p className="form-error" role="alert">{translateMessage(error)}</p>}
    <div className="dialog-footer library-dialog-actions"><ActionButton type="button" className="ghost" disabled={saving} onClick={onClose}>{t("取消")}</ActionButton><ActionButton type="submit" className="primary" disabled={saving || !selectedIds.length}>{saving ? t("加入中…") : t("加入相册")}</ActionButton></div>
  </ActionForm></div>;
}

export function LibraryConfirmDialog({ title, description, onClose, onConfirm, confirmLabel=t("确认删除") }: {
  title: string; description: string; onClose: () => void; onConfirm: () => Promise<void>; confirmLabel?:string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useModalEscape<HTMLElement>(onClose, busy);
  return <div className="dialog-backdrop" onClick={() => { if (!busy) onClose(); }}><section ref={dialogRef} className="tag-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
    <div className="dialog-head"><strong>{title}</strong></div><div className="library-fields"><p className="dialog-description">{description}</p>{error && <p className="form-error" role="alert">{translateMessage(error)}</p>}</div>
    <div className="dialog-footer library-dialog-actions"><ActionButton className="ghost" disabled={busy} onClick={onClose}>{t("取消")}</ActionButton><ActionButton className="ghost" disabled={busy} onClick={async () => {
      setBusy(true); setError(''); try { await onConfirm(); onClose(); } catch (reason) { setError(userErrorMessage(reason)); } finally { setBusy(false); }
    }}>{busy ? t("处理中…") : confirmLabel}</ActionButton></div>
  </section></div>;
}
