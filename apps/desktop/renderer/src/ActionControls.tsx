import {forwardRef,useEffect,useRef,useState,type ButtonHTMLAttributes,type FormHTMLAttributes} from 'react';
import {createActionLock} from './action-lock';
import {userErrorMessage} from './user-error';
function useActionLock(){
 const [busy,setBusy]=useState(false),mounted=useRef(true);
 const [lock]=useState(()=>createActionLock(value=>{if(mounted.current)setBusy(value);}));
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 function run(action:()=>unknown){try{const result=lock.run(action);if(result && typeof (result as Promise<unknown>).catch==='function')void (result as Promise<unknown>).catch(error=>window.dispatchEvent(new CustomEvent('lumina-action-error',{detail:userErrorMessage(error)})));}catch(error){window.dispatchEvent(new CustomEvent('lumina-action-error',{detail:userErrorMessage(error)}));}}
 return {busy,locked:()=>lock.busy,run};
}
export const ActionButton=forwardRef<HTMLButtonElement,ButtonHTMLAttributes<HTMLButtonElement>>(function ActionButton({onClick,disabled,...props},ref){
 const action=useActionLock();
 return <button {...props} ref={ref} data-action-guard="button" disabled={disabled || action.busy} aria-busy={action.busy || props['aria-busy']} onClick={event=>{if(disabled || action.locked()){event.preventDefault();event.stopPropagation();return;}action.run(()=>onClick?.(event));}}/>;
});
export const ActionForm=forwardRef<HTMLFormElement,FormHTMLAttributes<HTMLFormElement>>(function ActionForm({onSubmit,...props},ref){
 const action=useActionLock();
 return <form {...props} ref={ref} data-action-guard="form" aria-busy={action.busy || props['aria-busy']} onSubmit={event=>{if(!onSubmit)return;event.preventDefault();if(action.locked()){event.stopPropagation();return;}action.run(()=>onSubmit(event));}}/>;
});
