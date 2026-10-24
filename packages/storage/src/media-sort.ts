export type MediaSortBy = 'fileTime' | 'addedAt' | 'capturedAt' | 'name' | 'size';

export function mediaSortValue(sortBy:MediaSortBy):string {
  const columns: Record<MediaSortBy, string> = {
    fileTime: 'm.modified_at_ms',
    // Keep addedAt as a compatibility alias for older clients.
    addedAt: 'm.created_at',
    capturedAt: 'COALESCE(m.captured_at_ms, m.modified_at_ms)',
    name: "COALESCE(NULLIF(m.file_name,''),m.absolute_path) COLLATE NOCASE",
    size: 'm.size_bytes',
  };
  return columns[sortBy];
}
export function mediaOrder(sortBy: MediaSortBy | undefined, direction: 'asc' | 'desc' | undefined): string {
  // Keep the legacy `sort`-only API ordering by modified time while new callers
  // New clients use the explicit file-time default. The renderer always supplies sortBy.
  const field = sortBy ?? (direction ? 'capturedAt' : 'fileTime');
  const order = direction === 'asc' ? 'ASC' : 'DESC';
  return `${mediaSortValue(field)} ${order}, m.id ASC`;
}

