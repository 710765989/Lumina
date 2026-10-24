import {t,formatMonth,formatMonthShort} from './i18n';
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
  return <aside className="library-time-axis" aria-label={t("图库时间轴")}><strong>{t("时间轴")}</strong>{anchor && <ActionButton className="axis-reset" onClick={onReset}>{t("回到起点")}</ActionButton>}<span className="axis-position">{formatMonth(current)}</span><div className="axis-body"><div className="axis-months">{months.map(row=><ActionButton className={row.month===anchor?'active':''} aria-label={t("跳转到 {0}", [row.month])} title={t("{0} · {1} 项", [row.month, row.count])} key={row.month} onClick={()=>{position(months.indexOf(row));commit(true);}}><span>{row.month.slice(0,4)}</span><small>{formatMonthShort(row.month)}</small></ActionButton>)}</div><input type="range" className="axis-range" aria-label={t("时间轴快速定位")} aria-valuetext={t("{0} · {1} 项", [formatMonth(current), months[cursor]?.count??0])} min="0" max={Math.max(0,months.length-1)} step="1" value={cursor} onChange={event=>{position(Number(event.target.value));commit();}} onPointerUp={()=>commit(true)} onKeyUp={event=>{if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key))commit(true);}}/></div></aside>;
}
