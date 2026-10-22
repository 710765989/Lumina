import {useEffect,useState} from 'react';

// Shared by library/album/tag search. Fetch only while the format picker is open;
// typing filters this tiny list locally rather than querying the index each time.
const pending=new Map<boolean,Promise<string[]>>();
function read(hiddenOnly:boolean){
 const existing=pending.get(hiddenOnly);if(existing)return existing;
 const request=window.lumina.command({type:'media.formats',hiddenOnly}) as Promise<string[]>;pending.set(hiddenOnly,request);
 const clear=()=>{if(pending.get(hiddenOnly)===request)pending.delete(hiddenOnly);};void request.then(clear,clear);return request;
}
export function useLibraryFormats(open:boolean,hiddenOnly=false){
 const [state,setState]=useState<{hiddenOnly:boolean;formats:string[]}>({hiddenOnly,formats:[]});
 useEffect(()=>{
  if(!open)return;let valid=true,timer:ReturnType<typeof setTimeout>|undefined;
  const refresh=()=>void read(hiddenOnly).then(formats=>{if(valid)setState({hiddenOnly,formats});}).catch(()=>{});
  refresh();const off=window.lumina.onLibraryChanged(()=>{clearTimeout(timer);timer=setTimeout(refresh,300);});
  return()=>{valid=false;clearTimeout(timer);off();};
 },[open,hiddenOnly]);
 return state.hiddenOnly===hiddenOnly?state.formats:[];
}
