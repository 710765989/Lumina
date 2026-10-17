import { z } from 'zod';

const rootPath = z.string().min(1).max(4096);
const rootId = z.string().min(1).max(128);
const mediaId = z.string().min(1).max(128);
const albumId = z.string().min(1).max(128);

export const libraryCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('health') }),
  z.object({ type: z.literal('roots.list') }),
  z.object({ type: z.literal('roots.addAndScan'), absolutePath: rootPath, label: z.string().max(200).optional() }),
  z.object({ type: z.literal('roots.scan'), id: rootId }),
  z.object({ type: z.literal('roots.setEnabled'), id: rootId, enabled: z.boolean() }),
  z.object({ type: z.literal('roots.remove'), id: rootId }),
  z.object({ type: z.literal('media.list'), includeHidden: z.boolean().optional(), limit: z.number().int().positive().max(1000).optional(), offset: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('media.search'), query: z.string().max(200), includeHidden: z.boolean().optional(), limit: z.number().int().positive().max(1000).optional() }),
  z.object({ type: z.literal('media.hide'), id: mediaId }),
  z.object({ type: z.literal('media.unhide'), id: mediaId }),
  z.object({ type: z.literal('media.removeFromIndex'), id: mediaId }),
  z.object({ type: z.literal('albums.list') }),
  z.object({ type: z.literal('albums.create'), name: z.string().min(1).max(200), description: z.string().max(2000).optional() }),
  z.object({ type: z.literal('albums.update'), id: albumId, name: z.string().min(1).max(200).optional(), description: z.string().max(2000).optional() }),
  z.object({ type: z.literal('albums.delete'), id: albumId }),
  z.object({ type: z.literal('albums.media'), id: albumId, includeHidden: z.boolean().optional(), limit: z.number().int().positive().max(1000).optional(), offset: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('albums.addMedia'), id: albumId, mediaIds: z.array(mediaId).max(1000) }),
  z.object({ type: z.literal('albums.removeMedia'), id: albumId, mediaIds: z.array(mediaId).max(1000) }),
  z.object({ type: z.literal('albums.setCover'), id: albumId, mediaId: mediaId.nullable() }),
  z.object({ type: z.literal('media.setTags'), id: mediaId, tagNames: z.array(z.string().max(100)).max(100) }),
  z.object({ type: z.literal('media.addTag'), id: mediaId, tagName: z.string().min(1).max(100) }),
  z.object({ type: z.literal('media.removeTag'), id: mediaId, tagName: z.string().min(1).max(100) }),
  z.object({ type: z.literal('tags.list') }),
]);

export type LibraryCommand = z.infer<typeof libraryCommandSchema>;
