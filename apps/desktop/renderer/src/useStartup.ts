import {userErrorMessage} from './user-error';
import {useEffect,useRef} from 'react';

// Wait for this viewport only. A cold or unavailable thumbnail must not prevent
// the library from opening indefinitely, and scrolling stays lazy afterwards.
export function useStartup(dataReady:boolean,error:string){
 const finished=useRef(false);
 useEffect(()=>{if(!finished.current)window.lumina.startup({phase:error?'error':'data',message:error||undefined});},[error]);
 useEffect(()=>{
  if(!dataReady||error||finished.current)return;
  let stopped=false;
  async function prepare(){
   await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
   const viewport=document.querySelector<HTMLElement>('.library-content .grouped-media-scroll');
   const bounds=viewport?.getBoundingClientRect();
   const cards=bounds?Array.from(viewport!.querySelectorAll<HTMLElement>('[data-media-id]')).filter(card=>{const rect=card.getBoundingClientRect();return rect.bottom>bounds.top&&rect.top<bounds.bottom&&rect.right>bounds.left&&rect.left<bounds.right;}):[];
   const began=performance.now();let previous=-1;
   while(!stopped){
    const completed=cards.filter(card=>{const image=card.querySelector<HTMLImageElement>('.media-placeholder>img:not(.thumbnail-animated-photo)');return image?image.complete&&image.naturalWidth>0:Boolean(card.querySelector('.thumbnail-fallback')?.textContent?.includes('失败'));}).length;
    if(completed!==previous){previous=completed;window.lumina.startup({phase:'thumbnails',completed,total:cards.length});}
    if(completed===cards.length||performance.now()-began>=8000){finished.current=true;document.documentElement.dataset.startup='ready';window.lumina.startup({phase:'ready',completed,total:cards.length});return;}
    await new Promise(resolve=>setTimeout(resolve,60));
   }
  }
  void prepare().catch(reason=>{if(!stopped)window.lumina.startup({phase:'error',message:userErrorMessage(reason)});});
  return()=>{stopped=true;};
 },[dataReady,error]);
}
