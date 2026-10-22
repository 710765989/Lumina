import { useEffect, useRef } from 'react';
export function useModalEscape<T extends HTMLElement>(onClose: () => void,busy=false) {
  const ref=useRef<T>(null);
  useEffect(()=>{const handler=(event:KeyboardEvent)=>{
    if(event.key!=='Escape'||!ref.current)return;
    if(event.target instanceof HTMLElement&&event.target.matches('[role="combobox"][aria-expanded="true"]'))return;
    const dialogs=Array.from(document.querySelectorAll('[role="dialog"]'));
    if(dialogs.at(-1)!==ref.current)return;
    event.preventDefault();event.stopImmediatePropagation();if(!busy)onClose();
  };window.addEventListener('keydown',handler,true);return()=>window.removeEventListener('keydown',handler,true);},[onClose,busy]);
  return ref;
}
