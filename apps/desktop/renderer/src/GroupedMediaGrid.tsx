import {t,formatMonth} from './i18n';
import { useEffect, useMemo, type MouseEvent } from 'react';
import { MediaThumbnail } from './MediaThumbnail';
import { mediaAnimationProps } from './media-animation';

type Media = { id: string; absolutePath: string; kind: string; hidden: boolean; sizeBytes: number; modifiedAtMs: number; metadata?: Record<string, any> };

type GroupedMediaGridProps = {
  items: Media[];
  thumbnails: Record<string, string>;
  selected: Set<string>;
  onToggle: (id: string, event: MouseEvent<HTMLElement>) => void;
  onOpen: (item: Media) => void;
  onContextMenu: (item: Media, event: MouseEvent<HTMLElement>) => void;
  onVisible: (items: Media[]) => void;
};

function fileName(filePath: string): string { return filePath.split(/[\\/]/u).pop() ?? filePath; }

export function GroupedMediaGrid({ items, thumbnails, selected, onToggle, onOpen, onContextMenu, onVisible }: GroupedMediaGridProps) {
  const groups = useMemo(() => {
    const grouped = new Map<string, Media[]>();
    for (const item of items) {
      const date = new Date(item.modifiedAtMs);
      const key = Number.isNaN(date.getTime()) ? '未知时间' : `${date.getFullYear()}年${date.getMonth() + 1}月`;
      const group = grouped.get(key) ?? [];
      group.push(item);
      grouped.set(key, group);
    }
    return [...grouped.entries()].map(([label, group]) => ({ label, items: group }));
  }, [items]);

  useEffect(() => {
    if (items.length) onVisible(items);
  }, [items, onVisible]);

  return <div className="grouped-media-scroll">
    {groups.map((group) => <section className="media-month-group" key={group.label}>
      <div className="media-month-heading"><h3>{formatMonth(group.label)}</h3><span>{group.items.length}{t("项")}</span></div>
      <div className="media-grid">
        {group.items.map((item) => <article
          className={selected.has(item.id) ? 'media-card selected' : 'media-card'}
          key={item.id}
          onClick={(event) => onToggle(item.id, event)}
          onDoubleClick={() => onOpen(item)}
          onContextMenu={(event) => onContextMenu(item, event)}
        >
          <div className="media-placeholder">
            <MediaThumbnail id={item.id} kind={item.kind} source={thumbnails[item.id]} {...mediaAnimationProps(item)} />
          </div>
          <div className="media-meta"><strong>{fileName(item.absolutePath)}</strong><small>{item.kind === 'video' ? t("视频") : t("照片")}</small></div>
        </article>)}
      </div>
    </section>)}
  </div>;
}
