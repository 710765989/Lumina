import {t} from './i18n';
import { useEffect, useLayoutEffect,useMemo, useRef, useState, type MouseEvent } from 'react';
import {refreshAnimatedPreviewLayout} from './animated-previews';
import {bytesText} from './media-types';
import { MediaThumbnail } from './MediaThumbnail';
import { mediaAnimationProps } from './media-animation';
import {useExternalMediaDrag} from './useExternalMediaDrag';

type Media = { id: string; absolutePath: string; kind: string; hidden: boolean; sizeBytes: number; modifiedAtMs: number; metadata?: Record<string, any> };

type VirtualMediaGridProps = {
  items: Media[];
  thumbnails: Record<string, string>;
  selected: Set<string>;
  onSelectMany?: (ids:Set<string>)=>void;
  onToggle: (id: string, event: MouseEvent<HTMLElement>) => void;
  onOpen: (item: Media) => void;
  onContextMenu: (item: Media, event: MouseEvent<HTMLElement>) => void;
  onVisible: (items: Media[]) => void;
  onEndReached?: () => void;
};

const CARD_MIN_WIDTH = 165;
const GRID_GAP = 16;
const ROW_HEIGHT = 206;
const OVERSCAN_ROWS = 3;

function fileName(filePath: string): string { return filePath.split(/[\\/]/u).pop() ?? filePath; }

export function VirtualMediaGrid({ items, thumbnails, selected, onSelectMany,onToggle, onOpen, onContextMenu, onVisible, onEndReached }: VirtualMediaGridProps) {
  useLayoutEffect(refreshAnimatedPreviewLayout);
  const drag=useExternalMediaDrag({selected,onSelectMany});
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [columns, setColumns] = useState(4);
  const [viewportHeight, setViewportHeight] = useState(420);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const updateSize = () => {
      const width = element.clientWidth;
      if(!width || !element.clientHeight)return;
      setColumns(Math.max(1, Math.floor((width + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP))));
      setViewportHeight(element.clientHeight);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [items.length > 0]);

  const rowCount = Math.ceil(items.length / columns);
  const visibleStartRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const visibleEndRow = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS);
  const visibleItems = useMemo(() => {
    const start = visibleStartRow * columns;
    const end = Math.min(items.length, visibleEndRow * columns);
    return items.slice(start, end);
  }, [items, columns, visibleStartRow, visibleEndRow]);
  const visibleRows = useMemo(() => {
    const rows: Media[][] = [];
    for (let index = 0; index < visibleItems.length; index += columns) rows.push(visibleItems.slice(index, index + columns));
    return rows;
  }, [visibleItems, columns]);

  useEffect(() => {
    if (visibleItems.length) onVisible(visibleItems);
  }, [onVisible, visibleItems]);

  if (items.length === 0) return null;

  return <div
    ref={viewportRef}
    className="virtual-grid-viewport"
    onScroll={(event) => {
      const element = event.currentTarget;
      setScrollTop(element.scrollTop);
      if (onEndReached && element.scrollTop + element.clientHeight >= element.scrollHeight - ROW_HEIGHT * 2) onEndReached();
    }}
  >
    <div className="virtual-grid-canvas" style={{ height: Math.max(0, rowCount * ROW_HEIGHT - GRID_GAP) }}>
      {visibleRows.map((row, rowIndex) => <div
        className="virtual-grid-row"
        key={visibleStartRow + rowIndex}
        style={{
          top: (visibleStartRow + rowIndex) * ROW_HEIGHT,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}
      >
        {row.map((item) => <article
          className={selected.has(item.id) ? 'media-card selected' : 'media-card'}
          key={item.id}
          data-media-id={item.id}
          title={t("{0}\n文件大小：{1}", [fileName(item.absolutePath), bytesText(item.sizeBytes)])}
          draggable onDragStart={event=>drag.start(event,item.id)} onClickCapture={drag.click}
          onClick={(event) => onToggle(item.id, event)}
          onDoubleClick={() => onOpen(item)}
          onContextMenu={(event) => onContextMenu(item, event)}
        >
          <div className="media-placeholder">
            <MediaThumbnail id={item.id} kind={item.kind} source={thumbnails[item.id]} {...mediaAnimationProps(item)} />
          </div>
          <div className="media-meta"><strong>{fileName(item.absolutePath)}</strong></div>
        </article>)}
      </div>)}
    </div>
  </div>;
}
