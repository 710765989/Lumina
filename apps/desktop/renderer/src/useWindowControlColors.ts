import {useEffect} from 'react';

// Native caption buttons sit above the DOM. Match the layers painted beneath
// them without changing their hit targets or the window's native behavior.
export function useWindowControlColors() {
  useEffect(()=>{
    let frame=0,last='';
    const update=()=>{
      frame=0;
      let color=[255,255,255];
      for(const node of document.elementsFromPoint(innerWidth-2,24).reverse()){
        const background=getComputedStyle(node).backgroundColor;
        const parts=background.match(/[\d.]+/gu)?.map(Number);
        if(!parts || parts.length<3)continue;
        const alpha=parts[3]??1;
        color=color.map((channel,index)=>channel*(1-alpha)+parts[index]!*alpha);
      }
      const hex='#'+color.map(channel=>Math.round(channel).toString(16).padStart(2,'0')).join('');
      if(last===hex)return;last=hex;
      void window.lumina.native({action:'window-controls-style',color:hex}).catch(()=>{});
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    const observer=new MutationObserver(schedule);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','open']});
    window.addEventListener('resize',schedule);document.addEventListener('fullscreenchange',schedule);schedule();
    return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);document.removeEventListener('fullscreenchange',schedule);};
  },[]);
}
