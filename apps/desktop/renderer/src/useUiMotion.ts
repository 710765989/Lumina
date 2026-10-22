import {useEffect} from 'react';
// An explicit app choice wins; a first-run default follows the OS preference.
export const uiMotionEnabled=()=>{
 const preference=localStorage.getItem('lumina.ui.animations');
 return preference==='on'||preference!=='off'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};
export const uiMotionFps=():30|60=>localStorage.getItem('lumina.ui.motionFps')==='30'?30:60;
export function setUiMotion(enabled:boolean){localStorage.setItem('lumina.ui.animations',enabled?'on':'off');document.documentElement.dataset.motion=enabled?'on':'off';window.dispatchEvent(new Event('lumina-motion-changed'));}
export function setUiMotionFps(fps:30|60){localStorage.setItem('lumina.ui.motionFps',String(fps));document.documentElement.dataset.motionFps=String(fps);window.dispatchEvent(new Event('lumina-motion-changed'));}
export function useUiMotion(){useEffect(()=>{
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 const update=(event?:StorageEvent)=>{if(event?.key&&!['lumina.ui.animations','lumina.ui.motionFps'].includes(event.key))return;document.documentElement.dataset.motion=uiMotionEnabled()?'on':'off';document.documentElement.dataset.motionFps=String(uiMotionFps());window.dispatchEvent(new Event('lumina-motion-changed'));};
 const systemChanged=()=>update();update();window.addEventListener('storage',update);reduced.addEventListener('change',systemChanged);
 return()=>{window.removeEventListener('storage',update);reduced.removeEventListener('change',systemChanged);};
},[]);}
