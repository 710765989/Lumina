import {t} from './i18n';
import {useEffect,useRef,useState} from 'react';
import {ActionButton} from './ActionControls';
import {MediaThumbnail} from './MediaThumbnail';
import {mediaAnimationProps} from './media-animation';
import {useMediaActivity} from './MediaActivity';
import {countryName,type Media} from './media-types';
import {PlaceCoverLoader,type CoverSnapshot} from './place-cover-loader';
import type {CollectionSort} from './CollectionMediaView';
type CoverSort=Pick<CollectionSort,'sortBy'|'sort'>;
const sortNames={fileTime:'文件修改时间',capturedAt:'拍摄时间（缺失时按文件修改时间）',name:'文件名',size:'文件大小'};

const coverLoader=new PlaceCoverLoader(async item=>{
 const url=await window.lumina.thumbnail(item.id);
 await new Promise<void>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve();image.onerror=()=>reject(Error("缩略图无法显示"));image.src=url;});
 return url;
});
export type PlaceEntry={country:string;region:string;city:string;count:number;samples:Media[];years:Record<string,number>;coverRevision?:string};
function PlaceCover({place,sortBy,sort}:{place:PlaceEntry}&CoverSort){
 const active=useMediaActivity(),ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 const key=JSON.stringify([place.country,place.region,place.city,sortBy,sort,place.coverRevision??[place.count,place.samples.map(item=>[item.id,item.fingerprint])]]);
 const [result,setResult]=useState<{key:string;state:CoverSnapshot}>();
 useEffect(()=>{const node=ref.current;if(!node||!active)return;const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{rootMargin:'180px'});observer.observe(node);return()=>observer.disconnect();},[active]);
 useEffect(()=>{if(!active||!visible)return;return coverLoader.watch(key,{samples:place.samples,count:place.count,page:cursor=>window.lumina.command({type:'geo.coverCandidates',country:place.country,region:place.region,city:place.city,sortBy,sort,cursor,limit:24})},state=>setResult({key,state}));},[active,visible,key]);
 const cover=result?.key===key?result.state:undefined;
 return <div className="album-cover geo-cover geo-mosaic" title={t("封面与地点内排序一致：按{0}{1}，跳过隐藏和无法显示的项目，取前4张可用照片", [t(sortNames[sortBy]), sort==='desc'?t("倒序"):t("正序")])} data-cover-count={cover?.items.length??0} ref={ref}>{cover?.items.map(row=><div className="geo-mosaic-cell" key={row.item.id}><MediaThumbnail id={row.item.id} kind={row.item.kind} source={row.url} {...mediaAnimationProps(row.item)}/></div>)}{!cover?.items.length&&<div className="geo-cover-placeholder geo-cover-unavailable"><small>{cover?.error?t("封面候选加载失败"):cover?.done?t("暂无可用封面"):t("正在加载封面…")}</small>{(cover?.done||cover?.error)&&<ActionButton type="button" className="ghost" onClick={event=>{event.stopPropagation();coverLoader.retry(key);}}>{t("重试封面")}</ActionButton>}</div>}{Boolean(cover?.items.length)&&cover?.error&&<ActionButton type="button" className="ghost geo-cover-continue" onClick={event=>{event.stopPropagation();coverLoader.retry(key);}}>{t("继续加载封面")}</ActionButton>}</div>;
}
export function GeographyCards({places,onOpen,sortBy,sort}:{places:PlaceEntry[];onOpen:(value:{country:string;region:string;city:string})=>void}&CoverSort){
 return <div className="place-tree">{[...new Set(places.map(entry=>entry.country))].map(country=><details open key={country}><summary>{countryName(country)} · {places.filter(entry=>entry.country===country).reduce((sum,entry)=>sum+entry.count,0)}{t("项")}</summary>
  {[...new Set(places.filter(entry=>entry.country===country).map(entry=>entry.region))].map(region=><details key={region} open><summary>{region||t("地区未标注")}</summary><div className="album-card-grid place-card-grid">{places.filter(entry=>entry.country===country&&entry.region===region).map(entry=>{const open=()=>onOpen({country,region,city:entry.city});return <article key={entry.city} className="album-cover-card list-card clickable place-card" tabIndex={0} role="button" aria-label={t("查看地点 {0}", [entry.city])} onClick={open} onKeyDown={event=>{if(event.target===event.currentTarget&&['Enter',' '].includes(event.key)){event.preventDefault();open();}}}>
   <PlaceCover place={entry} sortBy={sortBy} sort={sort}/><div className="album-caption"><div className="album-card-heading"><strong>{entry.city}</strong></div><p title={Object.entries(entry.years).map(([year,count])=>t("{0}年 {1}项", [year, count])).join(' / ')}>{Object.keys(entry.years).sort().join(' / ')}{t("年")}</p><small>{entry.count}{t("项")}</small></div>
  </article>;})}</div></details>)}
 </details>)}</div>;
}
