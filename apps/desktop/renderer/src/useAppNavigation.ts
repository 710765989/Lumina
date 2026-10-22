import {useEffect,useLayoutEffect,useRef} from 'react';
export type AppPage='library'|'albums'|'tags'|'settings'|'trash'|'hidden'|'geo'|'duplicates';
type PageController={read:()=>unknown;restore:(location:any)=>void;refresh:()=>void|Promise<void>};
const pages=new Map<AppPage,PageController>(),pending=new Map<AppPage,unknown>();

export function usePageLocation<T>(page:AppPage,location:T,restore:(location:T)=>void,refresh:()=>void|Promise<void>){
  const latest=useRef({location,restore,refresh});latest.current={location,restore,refresh};
  useLayoutEffect(()=>{const controller:PageController={read:()=>latest.current.location,restore:value=>latest.current.restore(value),refresh:()=>latest.current.refresh()};pages.set(page,controller);if(pending.has(page)){const value=pending.get(page) as T;pending.delete(page);controller.restore(value);}return()=>{if(pages.get(page)===controller)pages.delete(page);};},[page]);
  const key=JSON.stringify(location);
  useEffect(()=>{window.dispatchEvent(new CustomEvent('lumina-location-changed',{detail:page}));},[page,key]);
}

type ViewerController={location:unknown;restore:(location:any)=>void|Promise<void>};
type Entry={page:AppPage;location:unknown;viewer:unknown};
export function useAppNavigation(page:AppPage,navigate:(page:AppPage)=>void,refresh:()=>void|Promise<void>,onError:(error:unknown)=>void,viewer?:ViewerController){
  const latest=useRef({page,navigate,refresh,onError,viewer});latest.current={page,navigate,refresh,onError,viewer};
  const state=useRef<{entries:Entry[];index:number;restoring:boolean}>({entries:[{page,location:null,viewer:null}],index:0,restoring:false});
  const frame=useRef<number>();
  function record(){
    if(state.current.restoring)return;
    const current=latest.current.page,entry={page:current,location:pages.get(current)?.read()??null,viewer:latest.current.viewer?.location??null},history=state.current,previous=history.entries[history.index]!;
    if(JSON.stringify(previous)===JSON.stringify(entry))return;
    const samePage=previous.page===entry.page && JSON.stringify(previous.location)===JSON.stringify(entry.location);
    // Changing the photo updates the current viewer entry; Back always returns
    // to the media page, never to the previous photo in the playback sequence.
    if(samePage && previous.viewer && entry.viewer){history.entries[history.index]=structuredClone(entry);return;}
    if(samePage && previous.viewer && !entry.viewer && history.index>0){const parent=history.entries[history.index-1]!;if(parent.page===entry.page && !parent.viewer && JSON.stringify(parent.location)===JSON.stringify(entry.location)){history.index--;return;}}
    history.entries=history.entries.slice(0,history.index+1);history.entries.push(structuredClone(entry));
    if(history.entries.length>100)history.entries.shift();history.index=history.entries.length-1;
  }
  function schedule(){if(state.current.restoring)return;cancelAnimationFrame(frame.current??0);frame.current=requestAnimationFrame(record);}
  const viewerKey=JSON.stringify(viewer?.location??null);
  useEffect(schedule,[page,viewerKey]);
  useEffect(()=>{
    let last:{action:string;source:string;time:number}|null=null;
    async function act(action:'back'|'forward'|'refresh',source:string){
      const now=performance.now();if(last?.action===action&&last.source!==source&&now-last.time<180)return;last={action,source,time:now};
      const dialog=document.querySelectorAll<HTMLElement>('[role=dialog]'),top=dialog.item(dialog.length-1);
      if(top && !top.classList.contains('media-viewer'))return;
      if(top && action==='refresh'){window.dispatchEvent(new CustomEvent('lumina-viewer-shortcut',{detail:action}));return;}
      if(action==='refresh'){void Promise.resolve().then(()=>{const controller=pages.get(latest.current.page);return controller?controller.refresh():latest.current.refresh();}).catch(reason=>latest.current.onError(reason));return;}
      record();const history=state.current,target=history.index+(action==='back'?-1:1);if(target<0||target>=history.entries.length||history.restoring)return;
      history.index=target;history.restoring=true;const entry=history.entries[target]!;latest.current.navigate(entry.page);
      const controller=pages.get(entry.page);if(controller)controller.restore(structuredClone(entry.location));else pending.set(entry.page,structuredClone(entry.location));
      try{await latest.current.viewer?.restore(structuredClone(entry.viewer));}catch(error){latest.current.onError(error);entry.viewer=null;}
      cancelAnimationFrame(frame.current??0);frame.current=requestAnimationFrame(()=>{frame.current=requestAnimationFrame(()=>{history.restoring=false;history.entries[history.index]={page:entry.page,location:structuredClone(pages.get(entry.page)?.read()??null),viewer:structuredClone(latest.current.viewer?.location??null)};});});
    }
    const native=window.lumina.onAppShortcut(action=>act(action,'native'));
    const key=(event:KeyboardEvent)=>{const action=event.key==='F5'?'refresh':event.altKey&&event.key==='ArrowLeft'?'back':event.altKey&&event.key==='ArrowRight'?'forward':null;if(action){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)act(action,'key');}};
    const down=(event:MouseEvent)=>{if(event.button===3||event.button===4){event.preventDefault();event.stopImmediatePropagation();act(event.button===3?'back':'forward','mouse');}};
    const block=(event:MouseEvent)=>{if(event.button===3||event.button===4){event.preventDefault();event.stopImmediatePropagation();}};
    window.addEventListener('keydown',key,true);window.addEventListener('mousedown',down,true);window.addEventListener('mouseup',block,true);window.addEventListener('auxclick',block,true);window.addEventListener('lumina-location-changed',schedule);
    return()=>{native();cancelAnimationFrame(frame.current??0);window.removeEventListener('keydown',key,true);window.removeEventListener('mousedown',down,true);window.removeEventListener('mouseup',block,true);window.removeEventListener('auxclick',block,true);window.removeEventListener('lumina-location-changed',schedule);};
  },[]);
}
