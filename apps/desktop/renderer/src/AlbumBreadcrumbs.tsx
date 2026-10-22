import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ActionButton} from './ActionControls';
import {createPortal} from 'react-dom';
import {useDismissableLayer} from './useDismissableLayer';
type Ancestor={id:string;name:string;parentId?:string|null};
export function albumTrail(albums:Ancestor[],activeId:string){
 const byId=new Map(albums.map(album=>[album.id,album])),seen=new Set<string>(),trail:Ancestor[]=[];
 let current=byId.get(activeId);
 while(current&&!seen.has(current.id)){seen.add(current.id);trail.unshift(current);current=current.parentId?byId.get(current.parentId):undefined;}
 return trail;
}
export function AlbumBreadcrumbs({albums,activeId,onNavigate}:{albums:Ancestor[];activeId:string;onNavigate:(id:string)=>void}){
 const trail=useMemo(()=>albumTrail(albums,activeId),[albums,activeId]),nav=useRef<HTMLElement>(null),[count,setCount]=useState(5);
 useLayoutEffect(()=>{
  const node=nav.current;if(!node)return;
  const fit=()=>{const context=document.createElement('canvas').getContext('2d');if(!context)return;context.font=getComputedStyle(node).font;let width=0,fitCount=0;const available=node.clientWidth-36;
   for(const item of trail.slice(-5).reverse()){const next=Math.min(160,context.measureText(item.name).width+18)+(fitCount?16:0);if(fitCount&&width+next>available)break;width+=next;fitCount++;}setCount(Math.max(1,fitCount));};
  fit();const observer=new ResizeObserver(fit);observer.observe(node);return()=>observer.disconnect();
 },[trail]);
 const shown=trail.slice(-count),hidden=trail.slice(0,-shown.length);
 return <nav ref={nav} className="album-breadcrumbs" aria-label="相册路径" title={trail.map(item=>item.name).join(' / ')}>
  {hidden.length>0&&<><AncestorMenu items={hidden} onNavigate={onNavigate}/><span aria-hidden="true">/</span></>}
  {shown.map((item,index)=><span className="album-breadcrumb-part" key={item.id}>{index>0&&<span aria-hidden="true">/</span>}{item.id===activeId?<span className="album-breadcrumb-current" aria-current="page" title={item.name}>{item.name}</span>:<ActionButton className="ghost" title={item.name} onClick={()=>onNavigate(item.id)}>{item.name}</ActionButton>}</span>)}
 </nav>;
}

function AncestorMenu({items,onNavigate}:{items:Ancestor[];onNavigate:(id:string)=>void}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 useDismissableLayer(open,()=>setOpen(false),[trigger,menu]);
 useLayoutEffect(()=>{
  if(!open||!menu.current||!trigger.current)return;
  const popup=menu.current,anchor=trigger.current.getBoundingClientRect(),rect=popup.getBoundingClientRect();
  popup.style.left=`${Math.max(8,Math.min(anchor.left,innerWidth-rect.width-8))}px`;
  popup.style.top=`${Math.max(8,Math.min(anchor.bottom+6,innerHeight-rect.height-8))}px`;
  popup.querySelector<HTMLButtonElement>('button')?.focus();
  const dismiss=()=>setOpen(false),scrolled=(event:Event)=>{if(event.target instanceof Node&&popup.contains(event.target))return;dismiss();};window.addEventListener('resize',dismiss);window.addEventListener('scroll',scrolled,true);
  return()=>{window.removeEventListener('resize',dismiss);window.removeEventListener('scroll',scrolled,true);};
 },[open]);
 return <><ActionButton ref={trigger} className="ghost album-ancestor-trigger" aria-label="前面的相册层级" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>…⌄</ActionButton>{open&&createPortal(<div ref={menu} className="album-ancestor-menu" role="menu" aria-label="前面的相册层级" onKeyDown={event=>{
  const buttons=Array.from(menu.current!.querySelectorAll('button')),index=buttons.indexOf(event.target as HTMLButtonElement);
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus();}
 }}>{items.map(item=><ActionButton key={item.id} className="ghost" role="menuitem" title={item.name} onClick={()=>{setOpen(false);onNavigate(item.id);}}>{item.name}</ActionButton>)}</div>,document.body)}</>;
}
