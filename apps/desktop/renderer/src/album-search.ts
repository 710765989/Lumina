import type { Album } from './media-types';

export function filterAlbums(albums: Album[], query: string, parentId: string | null) {
  // The overview searches albums; a selected album lists only its direct children.
  const term = parentId ? '' : query.trim().toLocaleLowerCase();
  return albums.filter((album) => {
    if (album.coverMode !== 'auto' && album.coverMode !== 'manual') return false;
    if (album.hiddenByVisibility) return false;
    if (!term) return (album.parentId ?? null) === parentId;
    return `${album.name}\n${album.description}`.toLocaleLowerCase().includes(term);
  });
}
