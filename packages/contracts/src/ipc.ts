import { z } from 'zod';

const rootPath = z.string().min(1).max(4096);
const rootId = z.string().min(1).max(128);
const mediaId = z.string().min(1).max(128);
const albumId = z.string().min(1).max(128);
const taskId = z.string().min(1).max(128);
const tagId = z.string().min(1).max(128);
const mediaFilter = z.enum(['photo', 'video']);
const mediaSort = z.enum(['asc', 'desc']);
const mediaSortBy = z.enum(['fileTime', 'addedAt', 'capturedAt', 'name', 'size']);

const fileExtension=z.string().trim().transform(value=>value.replace(/^\*?\./u,'').toLowerCase()).pipe(z.string().regex(/^[a-z0-9]{1,20}$/u,'请输入有效的文件后缀'));
const collectionSearch={timeFromMs:z.number().finite().optional(),timeBeforeMs:z.number().finite().optional(),searchLanguage:z.enum(['zh-CN','en','ja']).optional(),query:z.string().max(200).default(''),fileNames:z.array(z.string().max(200)).max(20).optional(),excludeFileNames:z.array(z.string().max(200)).max(20).optional(),extensions:z.array(fileExtension).max(20).optional(),tagNames:z.array(z.string().max(100)).max(20).optional(),excludeTagNames:z.array(z.string().max(100)).max(20).optional(),untaggedOnly:z.boolean().optional(),excludeUntagged:z.boolean().optional()};

export const libraryCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('health') }),
  z.object({ type: z.literal('roots.list') }),
  z.object({type:z.literal('roots.preview'),absolutePath:rootPath,id:rootId.optional(),refresh:z.boolean().optional()}),
  z.object({type:z.literal('roots.configuration'),id:rootId}),
  z.object({type:z.literal('roots.configure'),absolutePath:rootPath,id:rootId.optional(),label:z.string().trim().min(1).max(200),autoAlbums:z.boolean(),hierarchy:z.boolean(),rules:z.array(z.object({relativePath:z.string().max(4096),name:z.string().trim().min(1).max(100)})).max(5000)}),
  z.object({type:z.literal('media.cardTags'),mediaIds:z.array(mediaId).max(300)}),
  z.object({type:z.literal('roots.mediaIds'),id:rootId}),
  z.object({ type: z.literal('roots.addAndScan'), absolutePath: rootPath, label: z.string().max(200).optional() }),
  z.object({ type: z.literal('roots.scan'), id: rootId }),
  z.object({ type: z.literal('roots.setEnabled'), id: rootId, enabled: z.boolean() }),
  z.object({ type: z.literal('roots.remove'), id: rootId }),
  z.object({ type: z.literal('media.list'), includeHidden: z.boolean().optional(), kind: mediaFilter.optional(), sort: mediaSort.optional(), sortBy: mediaSortBy.optional(), limit: z.number().int().positive().max(1000).optional(), offset: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('media.search'), hiddenOnly:z.boolean().optional(), searchLanguage:z.enum(['zh-CN','en','ja']).optional(), query: z.string().max(200), fileNames: z.array(z.string().max(200)).max(20).optional(), excludeFileNames: z.array(z.string().trim().min(1).max(200)).max(20).optional(), extensions: z.array(fileExtension).max(20).optional(), tagNames: z.array(z.string().max(100)).max(20).optional(), excludeTagNames: z.array(z.string().max(100)).max(20).optional(),untaggedOnly:z.boolean().optional(),excludeUntagged:z.boolean().optional(),timeBeforeMs:z.number().finite().optional(),timeFromMs:z.number().finite().optional(), includeHidden: z.boolean().optional(), kind: mediaFilter.optional(), sort: mediaSort.optional(), sortBy: mediaSortBy.optional(), limit: z.number().int().positive().max(1000).optional(), offset: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('media.timeline'), hiddenOnly:z.boolean().optional(), searchLanguage:z.enum(['zh-CN','en','ja']).optional(), query: z.string().max(200), fileNames: z.array(z.string().max(200)).max(20).optional(), excludeFileNames: z.array(z.string().trim().min(1).max(200)).max(20).optional(), extensions: z.array(fileExtension).max(20).optional(), tagNames: z.array(z.string().max(100)).max(20).optional(), excludeTagNames: z.array(z.string().max(100)).max(20).optional(),untaggedOnly:z.boolean().optional(),excludeUntagged:z.boolean().optional(),timeBeforeMs:z.number().finite().optional(),timeFromMs:z.number().finite().optional(), includeHidden: z.boolean().optional(), kind: mediaFilter.optional(), sort: mediaSort.optional(), sortBy: mediaSortBy.optional(), limit: z.number().int().positive().max(1000).optional(), offset: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('media.hide'), id: mediaId }),
  z.object({ type: z.literal('media.unhide'), id: mediaId,tagIds:z.array(tagId).max(1000).optional() }),
  z.object({ type:z.literal('media.hiddenReasons'),mediaIds:z.array(mediaId).min(1).max(100000) }),
  z.object({ type: z.literal('media.removeFromIndex'), id: mediaId }),
  z.object({ type: z.literal('media.stats') }),
  z.object({type:z.literal('media.formats'),hiddenOnly:z.boolean().default(false)}),
  z.object({ type:z.literal('media.filteredStats'),hiddenOnly:z.boolean().optional(),searchLanguage:z.enum(['zh-CN','en','ja']).optional(),query:z.string().max(200).default(''),fileNames:z.array(z.string().max(200)).max(20).optional(),excludeFileNames:z.array(z.string().max(200)).max(20).optional(),extensions:z.array(fileExtension).max(20).optional(),tagNames:z.array(z.string().max(100)).max(20).optional(),excludeTagNames:z.array(z.string().max(100)).max(20).optional(),untaggedOnly:z.boolean().optional(),excludeUntagged:z.boolean().optional(),timeBeforeMs:z.number().finite().optional(),timeFromMs:z.number().finite().optional(),kind:mediaFilter.optional() }),
  z.object({ type: z.literal('media.playlist'), source: z.discriminatedUnion('scope', [
    z.object({ scope: z.literal('library'), hiddenOnly:z.boolean().optional(), searchLanguage:z.enum(['zh-CN','en','ja']).optional(), query: z.string().max(200).default(''), fileNames: z.array(z.string().max(200)).max(20).optional(), excludeFileNames: z.array(z.string().trim().min(1).max(200)).max(20).optional(), extensions: z.array(fileExtension).max(20).optional(), tagNames: z.array(z.string().max(100)).max(20).optional(), excludeTagNames: z.array(z.string().max(100)).max(20).optional(),untaggedOnly:z.boolean().optional(),excludeUntagged:z.boolean().optional(),timeBeforeMs:z.number().finite().optional(),timeFromMs:z.number().finite().optional(), kind: mediaFilter.optional(), sort: mediaSort.optional(), sortBy: mediaSortBy.optional() }),
    z.object({ scope: z.literal('album'),...collectionSearch,sortBy:mediaSortBy.optional(),sort:mediaSort.optional(), id: albumId }),
    z.object({ scope: z.literal('tag'),...collectionSearch,sortBy:mediaSortBy.optional(),sort:mediaSort.optional(), id: tagId }),
  ]) }),
  z.object({ type: z.literal('media.playbackItems'),includeHidden:z.boolean().optional(), mediaIds: z.array(mediaId).max(31) }),
  z.object({ type: z.literal('albums.list') }),
  z.object({ type: z.literal('albums.create'), name: z.string().min(1).max(200), description: z.string().max(2000).optional() }),
  z.object({ type: z.literal('albums.update'), id: albumId, name: z.string().min(1).max(200).optional(), description: z.string().max(2000).optional() }),
  z.object({ type: z.literal('albums.delete'), id: albumId }),
  z.object({type:z.literal('albums.filteredStats'),id:albumId,...collectionSearch}),
  z.object({ type: z.literal('albums.media'),...collectionSearch,sortBy:mediaSortBy.optional(),sort:mediaSort.optional(), id: albumId, includeHidden: z.boolean().optional(), limit: z.number().int().positive().max(1000).optional(), offset: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('albums.addMedia'), id: albumId, mediaIds: z.array(mediaId).max(1000) }),
  z.object({ type: z.literal('albums.removeMedia'), id: albumId, mediaIds: z.array(mediaId).max(1000) }),
  z.object({ type: z.literal('albums.setCover'), id: albumId, mediaId: mediaId.nullable() }),
  z.object({ type: z.literal('media.setTags'), id: mediaId, tagNames: z.array(z.string().max(100)).max(100) }),
  z.object({ type: z.literal('media.tags'), id: mediaId }),
  z.object({ type: z.literal('media.addTag'), id: mediaId, tagName: z.string().min(1).max(100) }),
  z.object({ type: z.literal('media.removeTag'), id: mediaId, tagName: z.string().min(1).max(100) }),
  z.object({ type: z.literal('media.thumbnail'), id: mediaId, retry: z.boolean().default(false), width: z.number().int().positive().max(1600).optional(), height: z.number().int().positive().max(1600).optional() }),
  z.object({ type: z.literal('media.filePath'), id: mediaId }),
  z.object({ type: z.literal('tags.list') }),
  z.object({ type: z.literal('tags.create'), name: z.string().trim().min(1).max(100), parentId:mediaId.nullable().default(null),parentIds:z.array(tagId).max(100).optional(),englishName:z.string().trim().max(100).optional() }),
  z.object({ type: z.literal('tags.rename'), id: tagId, name: z.string().trim().min(1).max(100) }),
  z.object({ type: z.literal('tags.delete'), id: tagId, deleteChildren:z.boolean().default(false),mode:z.enum(['reference','tag']).default('tag'),parentId:tagId.nullable().optional() }),
  z.object({type:z.literal('tags.filteredStats'),id:tagId,...collectionSearch}),
  z.object({ type: z.literal('tags.media'),...collectionSearch,sortBy:mediaSortBy.optional(),sort:mediaSort.optional(), id: tagId, limit: z.number().int().positive().max(1000).optional(), offset: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('tasks.list'), limit: z.number().int().positive().max(200).optional() }),
  z.object({ type: z.literal('tasks.retryThumbnail'), id: taskId }),
]);

export type LibraryCommand = z.infer<typeof libraryCommandSchema>;
