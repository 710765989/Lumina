import {t} from './i18n';
import type {MediaFilters} from './CollectionSearch';
import {userErrorMessage} from './user-error';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Media } from './media-types';

export type PlaybackSource = MediaFilters & ({ scope:'album'|'tag'; id:string;sortBy?:'fileTime'|'capturedAt'|'name'|'size';sort?:'asc'|'desc' } | {
  scope:'library'; hiddenOnly?:boolean;query:string;timeBeforeMs?:number;timeFromMs?:number;untaggedOnly?:boolean;excludeUntagged?:boolean; fileNames?:string[];excludeFileNames?:string[];extensions?:string[]; tagNames?:string[]; excludeTagNames?:string[];
  kind?:'photo'|'video'; sort?:'asc'|'desc'; sortBy?:'fileTime'|'addedAt'|'capturedAt'|'name'|'size';
});

// Keep only IDs for the full query and at most 21 nearby media records.
// The gallery retains its own page boundaries and scroll position.
export function usePlayback(item:Media, items:Media[], source:PlaybackSource|undefined, onChange:(item:Media)=>void, revision=0) {
  const key=JSON.stringify({source:source ?? null,revision});
  const [playlist,setPlaylist]=useState<{key:string;ids:string[]}|null>(null);
  const [nearby,setNearby]=useState<Media[]>([]);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const [moving,setMoving]=useState(false);
  const pending=useRef(false);const version=useRef(0);
  const cached=useRef(new Map<string,Media>());
  const loaded=useMemo(()=>new Map(items.map((media)=>[media.id,media])),[items]);
  const fallback=useMemo(()=>items.map((media)=>media.id),[items]);
  const ids=source && playlist?.key===key ? playlist.ids : fallback;
  const ready=!source || playlist?.key===key;
  const index=ids.indexOf(item.id);
  useEffect(()=>{
    const generation=++version.current;let valid=true;
    cached.current.clear();setNearby([]);setError('');pending.current=false;setMoving(false);
    if(source){setPlaylist(null);void window.lumina.command({type:'media.playlist',source:JSON.parse(key).source}).then((result:string[])=>{
      if(valid && version.current===generation)setPlaylist({key,ids:result});
    }).catch((reason)=>{if(valid)setError(t("读取播放列表失败：{0}", [userErrorMessage(reason)]));});}
    return()=>{valid=false;version.current++;};
  },[key,retry]);
  useEffect(()=>{
    if(!ready || index<0)return;
    let valid=true;const generation=version.current;
    const wanted=ids.slice(Math.max(0,index-10),index+11);
    const missing=wanted.filter((id)=>id!==item.id && !loaded.has(id) && !cached.current.has(id));
    void (missing.length ? window.lumina.command({type:'media.playbackItems',includeHidden:source?.scope==='library' && source.hiddenOnly,mediaIds:missing}) : Promise.resolve([])).then((rows:Media[])=>{
      if(!valid || generation!==version.current)return;
      const next=new Map(rows.map((media)=>[media.id,media]));
      const records=wanted.map((id)=>id===item.id ? item : loaded.get(id) ?? next.get(id) ?? cached.current.get(id)).filter((media):media is Media=>Boolean(media));
      cached.current=new Map(records.map((media)=>[media.id,media]));setNearby(records);
    }).catch((reason)=>{if(valid)setError(t("读取胶片预览失败：{0}", [userErrorMessage(reason)]));});
    return()=>{valid=false;};
  },[ids,index,ready,loaded,item]);

  async function goTo(target:number,step=1) {
    if(pending.current || !ready)return;
    const generation=version.current;pending.current=true;setMoving(true);setError('');
    try {
      // A snapshot can outlive an external deletion. Skip unavailable IDs.
      for(let current=target;current>=0 && current<ids.length;current+=step) {
        const id=ids[current]!;
        const rows:Media[]=source ? await window.lumina.command({type:'media.playbackItems',includeHidden:source?.scope==='library' && source.hiddenOnly,mediaIds:[id]}) : [loaded.get(id)].filter((media):media is Media=>Boolean(media));
        if(generation!==version.current)return;
        const next=rows[0];
        if(next){onChange(next);return;}
      }
      setError(t("后续媒体已移除或不可用，请刷新图库后重试"));
    } catch(reason) {if(generation===version.current)setError(t("切换媒体失败：{0}", [userErrorMessage(reason)]));}
    finally {if(generation===version.current){pending.current=false;setMoving(false);}}
  }
  return {ids,index,ready,moving,nearby,error,goTo,retry:()=>setRetry((value)=>value+1)};
}
