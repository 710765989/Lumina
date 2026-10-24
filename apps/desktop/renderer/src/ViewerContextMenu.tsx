import {t} from './i18n';
import {ActionButton} from './ActionControls';
import {useLayoutEffect,useRef,type KeyboardEvent} from 'react';
import {useDismissableLayer} from './useDismissableLayer';

export type ViewerMenuAction={label:string;run?:()=>void;disabled?:boolean;danger?:boolean;children?:ViewerMenuAction[]};
export function ViewerContextMenu({x,y,actions,onClose}:{x:number;y:number;actions:ViewerMenuAction[];onClose:()=>void}){
  const root=useRef<HTMLDivElement>(null);
  useDismissableLayer(true,onClose,[root]);
  useLayoutEffect(()=>{const node=root.current;if(!node)return;const rect=node.getBoundingClientRect();const left=Math.max(8,Math.min(x,innerWidth-rect.width-8));node.style.left=`${left}px`;node.style.top=`${Math.max(8,Math.min(y,innerHeight-rect.height-8))}px`;node.dataset.left=String(left+rect.width+230>innerWidth);node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});},[x,y]);
  function keyboard(event:KeyboardEvent){
    const target=event.target as HTMLButtonElement,level=target.closest('.viewer-menu-level');if(!level)return;
    const buttons=Array.from(level.querySelectorAll<HTMLButtonElement>(':scope>button,:scope>.viewer-menu-group>button')).filter(button=>!button.disabled),at=buttons.indexOf(target);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(at+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();}
    if(event.key==='ArrowRight'){event.preventDefault();target.parentElement?.querySelector<HTMLButtonElement>('.viewer-submenu button:not(:disabled)')?.focus();}
    if(event.key==='ArrowLeft'){event.preventDefault();level.parentElement?.querySelector<HTMLButtonElement>(':scope>button')?.focus();}
  }
  function entries(rows:ViewerMenuAction[]){return rows.map(action=>action.children?<div className="viewer-menu-group" key={action.label} onMouseEnter={event=>{const menu=event.currentTarget.querySelector<HTMLElement>('.viewer-submenu');if(menu){menu.style.top='0px';const rect=menu.getBoundingClientRect();if(rect.bottom>innerHeight-8)menu.style.top=`${innerHeight-8-rect.bottom}px`;}}}><ActionButton type="button" role="menuitem" aria-label={t(action.label)} aria-haspopup="menu">{t(action.label)}<span>›</span></ActionButton><div className="viewer-submenu viewer-menu-level" role="menu">{entries(action.children)}</div></div>:<ActionButton type="button" role="menuitem" key={action.label} disabled={action.disabled} className={action.danger?'danger':''} onClick={()=>{onClose();action.run?.();}}>{t(action.label)}</ActionButton>);}
  return <div ref={root} className="viewer-context-menu viewer-menu-level" role="menu" aria-label={t("媒体浏览菜单")} style={{left:x,top:y}} onKeyDown={keyboard} onContextMenu={event=>{event.preventDefault();event.stopPropagation();}}>{entries(actions)}</div>;
}
