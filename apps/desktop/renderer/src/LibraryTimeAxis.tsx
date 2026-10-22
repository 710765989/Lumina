import {ActionButton} from './ActionControls';
import {useEffect,useRef,useState} from 'react';
export type TimelineMonth={month:string;count:number};
export function LibraryTimeAxis({months,anchor,onJump,onReset}:{months:TimelineMonth[];anchor:string|null;onJump:(month:string)=>void;onReset:()=>void}){
  const [cursor,setCursor]=useState(0);const cursorRef=useRef(0);const timer=useRef<ReturnType<typeof setTimeout>>();const jump=useRef(onJump);jump.current=onJump;
  useEffect(()=>{const index=Math.max(0,months.findIndex(row=>row.month===anchor));setCursor(index);cursorRef.current=index;},[anchor,months]);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  function position(value:number){cursorRef.current=value;setCursor(value);}
  function commit(immediate=false){const month=months[cursorRef.current]?.month;if(!month)return;clearTimeout(timer.current);if(immediate)jump.current(month);else timer.current=setTimeout(()=>jump.current(month),120);}
  if(!months.length)return null;const current=months[cursor]?.month??months[0]!.month;
  return <aside className="library-time-axis" aria-label="图库时间轴"><strong>时间轴</strong>{anchor && <ActionButton className="axis-reset" onClick={onReset}>回到起点</ActionButton>}<span className="axis-position">{current.replace('-','年')}月</span><div className="axis-body"><div className="axis-months">{months.map(row=><ActionButton className={row.month===anchor?'active':''} aria-label={`跳转到 ${row.month}`} title={`${row.month} · ${row.count} 项`} key={row.month} onClick={()=>{position(months.indexOf(row));commit(true);}}><span>{row.month.slice(0,4)}</span><small>{Number(row.month.slice(5))}月</small></ActionButton>)}</div><input type="range" className="axis-range" aria-label="时间轴快速定位" aria-valuetext={`${current} · ${months[cursor]?.count??0} 项`} min="0" max={Math.max(0,months.length-1)} step="1" value={cursor} onChange={event=>{position(Number(event.target.value));commit();}} onPointerUp={()=>commit(true)} onKeyUp={event=>{if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key))commit(true);}}/></div></aside>;
}
