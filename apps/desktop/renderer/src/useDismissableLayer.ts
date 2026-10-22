import {useEffect,useRef} from 'react';

// Portal popups and their trigger are one interaction region. Moving focus or
// pressing elsewhere dismisses the layer, including events stopped by a child.
export function useDismissableLayer(open:boolean,onDismiss:()=>void,regions:ReadonlyArray<{readonly current:HTMLElement|null}>){
  const latest=useRef({onDismiss,regions});latest.current={onDismiss,regions};
  useEffect(()=>{
    if(!open)return;
    const outside=(event:Event)=>{const target=event.target;if(target instanceof Node && !latest.current.regions.some((region)=>region.current?.contains(target)))latest.current.onDismiss();};
    const blur=()=>latest.current.onDismiss();
    document.addEventListener('pointerdown',outside,true);
    document.addEventListener('focusin',outside,true);
    window.addEventListener('blur',blur);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',outside,true);window.removeEventListener('blur',blur);};
  },[open]);
}
