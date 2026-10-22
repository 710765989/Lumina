import {expect,it} from 'vitest';
import {filterAlbums} from '../apps/desktop/renderer/src/album-search';
import type {Album} from '../apps/desktop/renderer/src/media-types';

const albums=[
  {id:'root',name:'旅行',description:'海边照片',coverMode:'auto',hiddenByVisibility:false},
  {id:'child',name:'京都',description:'春季行程',coverMode:'auto',parentId:'root',hiddenByVisibility:false},
  {id:'hidden',name:'私人旅行',description:'',coverMode:'auto',hiddenByVisibility:true},
] as Album[];

it('searches visible albums by album name or description across levels',()=>{
  expect(filterAlbums(albums,'京都',null).map(album=>album.id)).toEqual(['child']);
  expect(filterAlbums(albums,'海边',null).map(album=>album.id)).toEqual(['root']);
  expect(filterAlbums(albums,'旅行',null).map(album=>album.id)).toEqual(['root']);
});

it('shows only direct children when the album search is empty',()=>{
  expect(filterAlbums(albums,'',null).map(album=>album.id)).toEqual(['root']);
  expect(filterAlbums(albums,'','root').map(album=>album.id)).toEqual(['child']);
});

it('does not mix media records into album search results or apply the overview query to children',()=>{
  const mixed=[...albums,{id:'media',name:'旅行.jpg',absolutePath:'C:/旅行.jpg',kind:'photo'}] as Album[];
  expect(filterAlbums(mixed,'旅行',null).map(album=>album.id)).toEqual(['root']);
  expect(filterAlbums(mixed,'旅行','root').map(album=>album.id)).toEqual(['child']);
});
