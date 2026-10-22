import {useEffect,useRef,type MutableRefObject} from 'react';
type Props={editMode:boolean;active:boolean;items:{id:string}[];selected:Set<string>;onSelect:(ids:Set<string>)=>void;anchor:MutableRefObject<string|null>;cursor:MutableRefObject<string|null>;loadMore:()=>Promise<void>;loadPrevious?:()=>Promise<void>;isLoading:()=>boolean;hasPrevious?:boolean;hasMore:boolean;view:string;queryKey:string;request:Record<string,any>};
export function useHomeKeyboard(props:Props){
  const latest=useRef(props);latest.current=props;const generation=useRef(0);const shiftBase=useRef<{anchor:string;ids:Set<string>}|null>(null);
  useEffect(()=>{props.cursor.current=null;generation.current++;shiftBase.current=null;},[props.queryKey]);
  useEffect(()=>{const keydown=(event:KeyboardEvent)=>{
    const p=latest.current,target=event.target as HTMLElement;if(!p.active || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) || event.altKey || event.metaKey || target.closest('input,textarea,select,button,[contenteditable=true],[role=listbox]') || document.querySelector('[role=dialog]'))return;
    event.preventDefault();if(event.repeat && event.ctrlKey && event.shiftKey && ['ArrowUp','ArrowDown'].includes(event.key))return;const version=++generation.current;void (async()=>{
      let current=latest.current;let items=current.items;if(!items.length)return;
      const focused=target.closest<HTMLElement>('[data-media-id]')?.dataset.mediaId;const cursor=current.cursor.current??focused??[...current.selected].at(-1)??null;
      const index=cursor?items.findIndex(item=>item.id===cursor):-1;
      if(event.ctrlKey && event.shiftKey && ['ArrowUp','ArrowDown'].includes(event.key)){
        if(event.repeat)return;const {type,offset,limit,timeBeforeMs,timeFromMs,...scope}=current.request;
        const ids:string[]=await window.lumina.command({type:'media.playlist',source:{...scope,scope:'library',query:scope.query??''}});if(version!==generation.current || !latest.current.active)return;const at=cursor?ids.indexOf(cursor):event.key==='ArrowUp'?ids.length-1:0;if(at<0)return;
        const range=event.key==='ArrowUp'?ids.slice(0,at+1):ids.slice(at);const next=new Set(current.selected);for(const id of range){if(current.editMode && next.has(id))next.delete(id);else next.add(id);}current.onSelect(next);if(!current.anchor.current)current.anchor.current=cursor??ids[at]!;window.dispatchEvent(new CustomEvent('lumina-home-reveal',{detail:cursor??ids[at]!}));return;
      }
      const row=document.querySelector<HTMLElement>((current.request.hiddenOnly?'.hidden-content':'.library-content')+' .grouped-media-row');const columns=current.view==='list'?1:Math.max(1,Number(row?.parentElement?.dataset.columns)||(row?getComputedStyle(row).gridTemplateColumns.split(' ').length:1));
      const step=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:event.key==='ArrowUp'?-columns:columns;let next=index<0?0:index+step;
      if((next>=items.length && current.hasMore) || (next<0 && index>=0 && current.hasPrevious && current.loadPrevious)){
        const oldId=items[Math.max(0,index)]!.id;
        // A pointer/scroll event may already be fetching a page. Wait for that
        // operation, then read committed React props before resolving the ID.
        while(latest.current.isLoading()){await new Promise(requestAnimationFrame);if(version!==generation.current)return;}
        await new Promise(requestAnimationFrame);if(version!==generation.current)return;
        current=latest.current;items=current.items;next=items.findIndex(item=>item.id===oldId)+step;
        const previous=next<0,first=items[0]?.id,length=items.length;
        if(previous && current.hasPrevious && current.loadPrevious)await current.loadPrevious();
        else if(next>=length && current.hasMore)await current.loadMore();
        if(next<0 || next>=length){
          // IPC can settle before React commits the prepended/appended items.
          for(let frame=0;frame<120;frame++){
            await new Promise(requestAnimationFrame);if(version!==generation.current)return;
            const committed=latest.current.items;
            if(previous?committed[0]?.id!==first:committed.length>length)break;
          }
        }
        current=latest.current;items=current.items;next=items.findIndex(item=>item.id===oldId)+step;
      }
      next=Math.max(0,Math.min(items.length-1,next));const id=items[next]?.id;if(!id || version!==generation.current)return;
      if(event.shiftKey){const anchor=current.anchor.current??cursor??id;current.anchor.current=anchor;const start=items.findIndex(item=>item.id===anchor);const range=items.slice(Math.min(start<0?next:start,next),Math.max(start<0?next:start,next)+1).map(item=>item.id);if(current.editMode){if(shiftBase.current?.anchor!==anchor)shiftBase.current={anchor,ids:new Set(current.selected)};const next=new Set(shiftBase.current.ids);for(const id of range){if(next.has(id))next.delete(id);else next.add(id);}current.onSelect(next);}else current.onSelect(new Set(event.ctrlKey?[...current.selected,...range]:range));}
      else if(!event.ctrlKey){shiftBase.current=null;current.anchor.current=id;current.onSelect(new Set([id]));}
      current.cursor.current=id;window.dispatchEvent(new CustomEvent('lumina-home-reveal',{detail:id}));
    })().catch(()=>{});
  };const endRange=(event:KeyboardEvent|MouseEvent)=>{if(event.type==='mousedown' || 'key' in event && event.key==='Shift')shiftBase.current=null;};window.addEventListener('keydown',keydown);window.addEventListener('keyup',endRange);window.addEventListener('mousedown',endRange);return()=>{window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',endRange);window.removeEventListener('mousedown',endRange);};},[]);
}
