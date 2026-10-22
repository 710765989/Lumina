import {createImageMemoryCleanup} from './image-memory.js';
import { contextBridge, ipcRenderer,webUtils,webFrame } from 'electron';
import {singleFlight} from './single-flight.js';
const invokeOnce=singleFlight();
const invoke=(channel:string,input?:unknown)=>invokeOnce(channel+':'+JSON.stringify(input),()=>ipcRenderer.invoke(channel,input));

const imageMemory=createImageMemoryCleanup({resources:()=>webFrame.getResourceUsage(),residentBytes:async()=>Number(await invoke('lumina:memory-pressure')),clear:()=>webFrame.clearCache()});
window.addEventListener('unload',()=>imageMemory.dispose(),{once:true});
contextBridge.exposeInMainWorld('lumina', {
  releaseImageMemory:(reason:string)=>imageMemory.request(reason),
  imageMemoryUsage:()=>imageMemory.stats(),
  startup:(status:unknown)=>ipcRenderer.send('lumina:startup',status),
  startupAction:(action:'retry'|'quit')=>ipcRenderer.send('lumina:startup-action',action),
  onStartupStatus:(callback:(status:any)=>void)=>{const listener=(_event:unknown,status:unknown)=>callback(status);ipcRenderer.on('lumina:startup-status',listener);return()=>ipcRenderer.removeListener('lumina:startup-status',listener);},
  onStartupRetry:(callback:()=>void)=>{const listener=()=>callback();ipcRenderer.on('lumina:startup-retry',listener);return()=>ipcRenderer.removeListener('lumina:startup-retry',listener);},
  command: (command: unknown) => invoke('lumina:command', command),
  thumbnail: (mediaId: string,retry=false) => invoke('lumina:thumbnail', {mediaId,retry}) as Promise<string>,
  mediaUrl: (kind: 'thumbnail' | 'original' | 'preview' | 'playback' | 'hover', mediaId: string) => `lumina-media://${kind}/${encodeURIComponent(mediaId)}`,
  pickFolder: () => invoke('lumina:pick-folder') as Promise<string | null>,
  pickImport:(kind:'files'|'folders')=>invoke('lumina:pick-import',kind) as Promise<string[]>,
  clipboardFiles:()=>invoke('lumina:clipboard-import') as Promise<string[]>,
  filePaths:(files:File[])=>files.map(file=>webUtils.getPathForFile(file)).filter(Boolean),
  onViewerEscape: (callback:()=>void)=>{const listener=()=>callback();ipcRenderer.on('lumina:viewer-escape',listener);return()=>ipcRenderer.removeListener('lumina:viewer-escape',listener);},
  onAppShortcut:(callback:(action:'back'|'forward'|'refresh')=>void)=>{const listener=(_event:unknown,action:'back'|'forward'|'refresh')=>callback(action);ipcRenderer.on('lumina:app-shortcut',listener);return()=>ipcRenderer.removeListener('lumina:app-shortcut',listener);},
  native: (input: unknown) => invoke('lumina:native', input),
  startDrag: (mediaIds: string[], options?: {includeHidden?:boolean}) => invoke('lumina:drag', {mediaIds,includeHidden:options?.includeHidden ?? false}) as Promise<{count:number}>,
  onLibraryChanged: (callback: () => void) => { const listener = () => callback(); ipcRenderer.on('lumina:library-changed', listener); return () => ipcRenderer.removeListener('lumina:library-changed', listener); },
});
