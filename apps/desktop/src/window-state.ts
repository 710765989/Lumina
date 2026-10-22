import {readFileSync,writeFileSync,renameSync} from 'node:fs';

type Bounds={x:number;y:number;width:number;height:number};
export type WindowState={bounds:Bounds;maximized:boolean};
export function restoreWindowState(file:string,workAreas:Bounds[]):WindowState{
 const primary=workAreas[0]??{x:0,y:0,width:1920,height:1080};
 let saved:Partial<WindowState>={};try{saved=JSON.parse(readFileSync(file,'utf8'));}catch{}
 const bounds=saved?.bounds;const valid=bounds && ['x','y','width','height'].every(key=>Number.isFinite(bounds[key as keyof Bounds])) && bounds.width>=400 && bounds.height>=300 && bounds.width<=20000 && bounds.height<=20000;
 const area=valid?workAreas.find(area=>Math.min(bounds.x+bounds.width,area.x+area.width)-Math.max(bounds.x,area.x)>=128 && Math.min(bounds.y+bounds.height,area.y+area.height)-Math.max(bounds.y,area.y)>=80)??primary:primary;
 const width=Math.min(area.width,Math.max(Math.min(1120,area.width),valid?bounds.width:1200));
 const height=Math.min(area.height,Math.max(Math.min(720,area.height),valid?bounds.height:800));
 const x=valid?Math.max(area.x,Math.min(bounds.x,area.x+area.width-width)):area.x+Math.round((area.width-width)/2);
 const y=valid?Math.max(area.y,Math.min(bounds.y,area.y+area.height-height)):area.y+Math.round((area.height-height)/2);
 return {bounds:{x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)},maximized:Boolean(valid && saved.maximized===true)};
}
export function saveWindowState(file:string,state:WindowState){
 const temporary=file+'.tmp';writeFileSync(temporary,JSON.stringify(state));renameSync(temporary,file);
}
