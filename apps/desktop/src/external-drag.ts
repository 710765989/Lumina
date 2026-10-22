export type ExternalDragRequest = { mediaIds: string[]; includeHidden: boolean };
export type DeliveredFile = { absolutePath: string };

export function parseExternalDrag(input: unknown): ExternalDragRequest {
  // Accept the original array call as well as the scoped request from newer renderers.
  const value = Array.isArray(input) ? { mediaIds: input } : input;
  if (!value || typeof value !== 'object') throw new Error('请选择需要拖出的媒体');
  const { mediaIds, includeHidden } = value as Record<string, unknown>;
  if (!Array.isArray(mediaIds) || !mediaIds.length || mediaIds.length > 10000 ||
      !mediaIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128) ||
      (includeHidden !== undefined && typeof includeHidden !== 'boolean')) {
    throw new Error('拖出媒体参数无效，一次最多选择10000项');
  }
  return { mediaIds: [...new Set(mediaIds)], includeHidden: includeHidden === true };
}

export function createExternalDragController(deliver: (request: ExternalDragRequest) => Promise<DeliveredFile[]>) {
  const active = new Set<number>();
  return async (ownerId: number, input: unknown, start: (files: string[]) => void|Promise<void>) => {
    const request = parseExternalDrag(input);
    if (active.has(ownerId)) throw new Error('正在准备拖出，请稍后再试');
    active.add(ownerId);
    try {
      const items = await deliver(request);
      if (items.length !== request.mediaIds.length || items.some(item => !item.absolutePath)) {
        throw new Error('部分媒体已不可用，请刷新后重试');
      }
      const files = [...new Set(items.map(item => item.absolutePath))];
      await start(files);
      // A returned native drag is not proof that the receiving app copied the files.
      return { count: files.length };
    } finally {
      active.delete(ownerId);
    }
  };
}
