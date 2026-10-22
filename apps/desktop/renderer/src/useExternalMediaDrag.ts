import { useEffect, useRef, type DragEvent, type MouseEvent } from 'react';
import { userErrorMessage } from './user-error';

export function useExternalMediaDrag({selected,onSelectMany,includeHidden=false,enabled=true}:{
  selected:Set<string>;onSelectMany?:(ids:Set<string>)=>void;includeHidden?:boolean;enabled?:boolean;
}) {
  const busy=useRef(false),suppressClick=useRef(false);
  useEffect(()=>{
    const nextGesture=()=>{suppressClick.current=false;};
    window.addEventListener('pointerdown',nextGesture,true);
    return()=>window.removeEventListener('pointerdown',nextGesture,true);
  },[]);
  function start(event:DragEvent<HTMLElement>,id:string){
    event.preventDefault();event.stopPropagation();
    if(!enabled || (event.target as HTMLElement).closest('button,input,textarea,select,a'))return;
    suppressClick.current=true;
    if(busy.current)return;
    const ids=selected.has(id)?[...selected]:[id];
    if(!selected.has(id))onSelectMany?.(new Set(ids));
    event.dataTransfer.effectAllowed='copy';
    window.dispatchEvent(new CustomEvent('lumina-media-drag-start',{detail:id}));
    busy.current=true;
    void window.lumina.startDrag(ids,{includeHidden}).catch(reason=>{
      window.dispatchEvent(new CustomEvent('lumina-media-drag-failed'));
      window.dispatchEvent(new CustomEvent('lumina-action-error',{detail:userErrorMessage(reason)}));
    }).finally(()=>{busy.current=false;});
  }
  function click(event:MouseEvent<HTMLElement>){
    if(!suppressClick.current)return;
    suppressClick.current=false;event.preventDefault();event.stopPropagation();
  }
  return {enabled,start,click};
}
