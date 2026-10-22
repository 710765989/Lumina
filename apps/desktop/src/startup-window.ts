import {BrowserWindow,ipcMain} from 'electron';
import {readFileSync} from 'node:fs';
import path from 'node:path';

export type StartupStatus={phase:'data'|'thumbnails'|'ready'|'error';message?:string;completed?:number;total?:number};

const html=(icon:string)=>`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>光匣 Lumina · 正在启动</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f6f8fc;color:#24364f;font:13px 'Segoe UI','Microsoft YaHei',sans-serif;user-select:none}.card{height:100vh;padding:30px 32px;border:1px solid #dfe8f5;border-radius:12px;-webkit-app-region:drag}.brand{display:flex;align-items:center;gap:12px}.mark{display:block;width:42px;height:42px;object-fit:contain;border-radius:0;background:transparent}.brand strong{font-size:21px}.brand small{margin-left:8px;color:#8394ab;font-size:13px}.close{position:absolute;right:12px;top:9px;width:28px;height:28px;border:0;background:transparent;color:#7d8fa7;font-size:20px;-webkit-app-region:no-drag;cursor:pointer}.close:hover{background:#e7edf6;border-radius:6px}.status{display:flex;gap:10px;align-items:center;margin-top:25px;min-height:22px}.spinner{width:14px;height:14px;border:2px solid #d7e4f8;border-top-color:#2c73df;border-radius:50%;animation:spin .8s linear infinite}.hint{margin:10px 0 0 24px;color:#8192aa;font-size:12px;line-height:1.6}.error .spinner{display:none}.error #message{color:#536d91}.error .hint{margin-left:0}.actions{display:flex;justify-content:flex-end;margin-top:18px;gap:8px;-webkit-app-region:no-drag}button{font:inherit;cursor:pointer}.retry{border:0;background:#2c73df;color:white;padding:7px 16px;border-radius:7px}.exit{border:1px solid #d9e4f3;background:white;color:#617692;padding:7px 16px;border-radius:7px}[hidden]{display:none!important}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none}}</style>
<main class="card"><button class="close" aria-label="退出启动">×</button><div class="brand"><img class="mark" src="data:image/png;base64,${icon}" alt=""><div><strong>光匣</strong><small>Lumina</small></div></div><div class="status" role="status"><span class="spinner"></span><span id="message">正在读取图库索引…</span></div><p class="hint" id="hint">准备好后自动进入图库</p><div class="actions" hidden><button class="exit">退出</button><button class="retry">重试</button></div></main>
<script>const api=window.lumina;api.onStartupStatus(value=>{const failed=value.phase==='error';document.body.classList.toggle('error',failed);document.querySelector('#message').textContent=failed?'暂时无法打开图库':value.message||(value.phase==='thumbnails'?'正在准备首屏缩略图…':'正在读取图库索引…');document.querySelector('#hint').textContent=failed?(value.message||'请重试，或退出后重新打开。'):value.total?('已准备 '+value.completed+' / '+value.total+' 项'):'准备好后自动进入图库';document.querySelector('.actions').hidden=!failed;});document.querySelector('.retry').onclick=()=>api.startupAction('retry');document.querySelector('.exit').onclick=document.querySelector('.close').onclick=()=>api.startupAction('quit');</script></html>`;

export function createStartupWindow(preload:string,onRetry:()=>void,onQuit:()=>void){
 const iconFile=path.join(path.dirname(preload),'renderer','lumina-album-icon-256.png');
 const window=new BrowserWindow({icon:iconFile,width:400,height:250,show:false,frame:false,resizable:false,maximizable:false,minimizable:false,backgroundColor:'#f6f8fc',title:'光匣 Lumina · 正在启动',webPreferences:{preload,contextIsolation:true,nodeIntegration:false}});
 let current:StartupStatus={phase:'data'},closing=false;
 const update=(value:StartupStatus)=>{current=value;if(!window.isDestroyed())window.webContents.send('lumina:startup-status',value);};
 const action=(event:Electron.IpcMainEvent,value:unknown)=>{if(event.sender!==window.webContents)return;if(value==='quit')onQuit();else if(value==='retry'&&current.phase==='error'){update({phase:'data'});onRetry();}};
 ipcMain.on('lumina:startup-action',action);
 window.once('ready-to-show',()=>{if(!window.isDestroyed())window.show();});
 window.webContents.on('did-finish-load',()=>update(current));
 window.on('closed',()=>{ipcMain.removeListener('lumina:startup-action',action);if(!closing)onQuit();});
 const icon=readFileSync(iconFile).toString('base64');
 void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html(icon))}`).catch(()=>{if(!window.isDestroyed())window.show();});
 return {window,update,close:()=>{closing=true;if(!window.isDestroyed())window.destroy();}};
}
