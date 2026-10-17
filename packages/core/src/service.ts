import {
  libraryCommandSchema,
  type LibraryCommand,
} from '@lumina/contracts';
import {
  addLibraryRoot,
  addTagToMedia,
  addMediaToAlbum,
  createAlbum,
  createTag,
  deleteAlbum,
  deleteTag,
  getAlbum,
  hideMedia,
  listAlbumMedia,
  listAlbums,
  listLibraryRoots,
  listMedia,
  removeLibraryRoot,
  removeTagFromMedia,
  removeMediaFromAlbum,
  removeMediaFromIndex,
  searchMedia,
  setAlbumCover,
  setLibraryRootEnabled,
  setMediaTags,
  listTags,
  type LuminaDatabase,
  unhideMedia,
  updateAlbum,
} from '@lumina/storage';
import { addAndScanLibraryRoot, getHealth, scanDirectory } from './index.js';

export class LibraryService {
  constructor(private readonly db: LuminaDatabase) {}

  async handle(input: unknown): Promise<unknown> {
    const command: LibraryCommand = libraryCommandSchema.parse(input);
    switch (command.type) {
      case 'health': return getHealth(this.db);
      case 'roots.list': return listLibraryRoots(this.db);
      case 'roots.addAndScan': return addAndScanLibraryRoot(this.db, command.absolutePath, command.label);
      case 'roots.scan': {
        const root = listLibraryRoots(this.db).find((item) => item.id === command.id);
        if (!root) throw new Error(`Library root not found: ${command.id}`);
        return { root, ...(await scanDirectory(this.db, root.absolutePath)) };
      }
      case 'roots.setEnabled': setLibraryRootEnabled(this.db, command.id, command.enabled); return { ok: true };
      case 'roots.remove': removeLibraryRoot(this.db, command.id); return { ok: true };
      case 'media.list': return listMedia(this.db, command);
      case 'media.search': return searchMedia(this.db, command.query, command);
      case 'media.hide': hideMedia(this.db, command.id); return { ok: true };
      case 'media.unhide': unhideMedia(this.db, command.id); return { ok: true };
      case 'media.removeFromIndex': removeMediaFromIndex(this.db, command.id); return { ok: true };
      case 'albums.list': return listAlbums(this.db);
      case 'albums.create': return createAlbum(this.db, command.name, command.description);
      case 'albums.update': updateAlbum(this.db, command.id, command); return getAlbum(this.db, command.id);
      case 'albums.delete': deleteAlbum(this.db, command.id); return { ok: true };
      case 'albums.media': return listAlbumMedia(this.db, command.id, command);
      case 'albums.addMedia': return { added: addMediaToAlbum(this.db, command.id, command.mediaIds) };
      case 'albums.removeMedia': return { removed: removeMediaFromAlbum(this.db, command.id, command.mediaIds) };
      case 'albums.setCover': setAlbumCover(this.db, command.id, command.mediaId); return getAlbum(this.db, command.id);
      case 'media.setTags': setMediaTags(this.db, command.id, command.tagNames); return { ok: true };
      case 'media.addTag': addTagToMedia(this.db, command.id, command.tagName); return { ok: true };
      case 'media.removeTag': removeTagFromMedia(this.db, command.id, command.tagName); return { ok: true };
      case 'tags.list': return listTags(this.db);
      default: return command satisfies never;
    }
  }
}

export { createTag, deleteTag };
