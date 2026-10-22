import {ThumbnailMemory} from './thumbnail-memory.js';
const thumbnailMemory=new ThumbnailMemory();
import {PreviewRequests} from './preview-requests.js';
const previewRequests=new PreviewRequests();
import { app, BrowserWindow, dialog, ipcMain, protocol, shell, nativeImage, screen, powerMonitor,clipboard } from 'electron';
import { copyWindowsFiles,readWindowsFileList } from './windows-clipboard.js';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile, unlink } from 'node:fs/promises';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {restoreWindowState,saveWindowState} from './window-state.js';
import {createExternalDragController,parseExternalDrag} from './external-drag.js';
import {createMediaDragIcon} from './drag-icon.js';
import {createStartupWindow,type StartupStatus} from './startup-window.js';

// Explicit automation override allows testing the actual packaged EXE without
// opening or migrating a user's existing library. Normal launches never set it.
if(process.env.LUMINA_TEST_USER_DATA){
  if(!path.isAbsolute(process.env.LUMINA_TEST_USER_DATA))throw new Error('测试数据目录必须是绝对路径');
  app.setPath('userData',process.env.LUMINA_TEST_USER_DATA);
}
if(!app.requestSingleInstanceLock())app.exit(0);
app.on('second-instance',()=>{const window=startupScreen?.window??mainWindow;if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus();}});

protocol.registerSchemesAsPrivileged([{ scheme: 'lumina-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };
let core: ChildProcessWithoutNullStreams | undefined;
const pending = new Map<string, Pending>();
const mainDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow:BrowserWindow|undefined;
let startupScreen:ReturnType<typeof createStartupWindow>|undefined;
function writeLog(message: string): void {
  try { appendFileSync(path.join(app.getPath('userData'), 'lumina-main.log'), `${new Date().toISOString()} ${message}\n`); } catch { /* diagnostics must not stop the app */ }
}

function startCoreHost(): void {
  if (core) return;
  const workspace = path.resolve(app.getAppPath(), '..', '..');
  const packaged = app.isPackaged;
  const command = packaged ? process.execPath : (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  const args = packaged ? [path.join(app.getAppPath(), 'dist', 'core-host.cjs'), '--stdio'] : ['--filter', '@lumina/core-host', 'start:stdio'];
  writeLog(`start core packaged=${packaged} command=${command} args=${JSON.stringify(args)}`);
  core = spawn(command, args, {
    cwd: packaged ? path.dirname(process.execPath) : workspace,
    env: { ...process.env,LUMINA_DEFAULT_CACHE_DIR:process.env.LUMINA_TEST_USER_DATA?path.join(process.env.LUMINA_TEST_USER_DATA,'media-cache'):path.join(packaged?path.dirname(process.execPath):app.getAppPath(),'cache','media'),LUMINA_IMPORT_INBOX:path.join(app.getPath('userData'),'import-inbox'), ...(packaged ? { ELECTRON_RUN_AS_NODE: '1', LUMINA_FFMPEG_PATH: path.join(app.getAppPath().replace(/app\.asar$/u, 'app.asar.unpacked'), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') } : {}), LUMINA_DB_PATH: path.join(app.getPath('userData'), 'data', 'lumina.db') },
    windowsHide: true,
  });
  core.stderr.on('data', (chunk) => writeLog(`core stderr: ${String(chunk).trim()}`));
  core.on('error', (error) => {writeLog(`core error: ${error.message}`);for(const item of pending.values())item.reject(error);pending.clear();core=undefined;});
  const lines = createInterface({ input: core.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    let response: { requestId?: string; ok: boolean; data?: unknown; error?: string; event?: string; hostRequestId?: string; path?: string };
    try { response = JSON.parse(line) as { requestId?: string; ok: boolean; data?: unknown; error?: string }; }
    catch (error) { writeLog(`core response parse failed: ${error instanceof Error ? error.message : String(error)}`); return; }
    if (response.event === 'library-changed') { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('lumina:library-changed'); return; }
    if (response.event === 'system-trash' && response.hostRequestId && response.path) {
      const requestId = response.hostRequestId;
      void shell.trashItem(response.path).then(() => core?.stdin.write(`${JSON.stringify({ hostResponseId: requestId, ok: true })}\n`))
        .catch((error) => core?.stdin.write(`${JSON.stringify({ hostResponseId: requestId, ok: false, error: String(error) })}\n`)); return;
    }
    if (!response.requestId) { writeLog('core response missing requestId'); return; }
    const item = pending.get(response.requestId);
    if (!item) return;
    pending.delete(response.requestId);
    if (response.ok) item.resolve(response.data);
    else {writeLog(`core command failed: ${response.error??'Unknown error'}`);item.reject(new Error(response.error ?? 'Core command failed'));}
  });
  core.on('exit', (code, signal) => {
    writeLog(`core exit code=${code} signal=${signal ?? ''}`);
    const error = new Error('Lumina core host exited');
    for (const item of pending.values()) item.reject(error);
    pending.clear();
    core = undefined;
  });
}

function sendCommand(command: unknown): Promise<unknown> {
  startCoreHost();
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    core!.stdin.write(`${JSON.stringify({ requestId, command })}\n`);
  });
}

function mediaContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic',
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

async function mediaFileResponse(filePath: string, rangeHeader: string | null, type?:string): Promise<Response> {
  const file = await stat(filePath);
  const contentType = type??mediaContentType(filePath);
  const commonHeaders = { 'content-type': contentType, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  if (!rangeHeader) {
    return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
      headers: { ...commonHeaders, 'content-length': String(file.size) },
    });
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${file.size}` } });
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${file.size}` } });
    start = Math.max(0, file.size - suffixLength);
    end = file.size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : file.size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= file.size || end < start) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${file.size}` } });
  }
  end = Math.min(end, file.size - 1);
  const length = end - start + 1;
  return new Response(Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream, {
    status: 206,
    headers: { ...commonHeaders, 'content-length': String(length), 'content-range': `bytes ${start}-${end}/${file.size}` },
  });
}

function registerMediaProtocol(): void {
  protocol.handle('lumina-media', async (request) => {
    try {
      const url = new URL(request.url);
      const kind = url.hostname;
      const mediaId = decodeURIComponent(url.pathname.slice(1));
      if (!mediaId || !['thumbnail', 'original', 'preview', 'playback', 'hover'].includes(kind)) return new Response('Invalid media URL', { status: 400 });
      if (kind === 'hover') {
        const result=await sendCommand({type:'media.hoverPreview',id:mediaId,session:url.searchParams.get('session')}) as {cachePath:string};
        return mediaFileResponse(result.cachePath,request.headers.get('range'));
      }
      if (kind === 'playback') {
        const result = await sendCommand({ type: 'media.compatibilityPath', id: mediaId,session:url.searchParams.get('session')??undefined }) as { cachePath: string };
        return mediaFileResponse(result.cachePath, request.headers.get('range'));
      }
      if (kind === 'preview') {
        const fullSize=url.searchParams.get('full')==='1',retry=url.searchParams.get('retry'),token=Number(retry)>0?`${url.searchParams.get('session')??''}:${retry}`:undefined;
        const result=await previewRequests.load(`${mediaId}/${fullSize}`,token,regenerate=>sendCommand({type:'media.previewPath',id:mediaId,fullSize,regenerate}) as Promise<{cachePath:string}>);
        return mediaFileResponse(result.cachePath,request.headers.get('range'));
      }
      if (kind === 'thumbnail') {
        const result = await sendCommand({ type: 'media.thumbnail', id: mediaId, width: 480, height: 320 }) as { cachePath: string };
        const bytes = await thumbnailMemory.read(result.cachePath);
        return new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': url.searchParams.has('v')?'public, max-age=31536000, immutable':'no-store' } });
      }
      const result = await sendCommand({ type: 'media.filePath', id: mediaId }) as { absolutePath: string; kind: string;contentType?:string };
      if (result.kind === 'video') return mediaFileResponse(result.absolutePath, request.headers.get('range'));
      if (result.kind !== 'photo') return new Response('Unsupported media preview', { status: 415 });
      return mediaFileResponse(result.absolutePath,request.headers.get('range'),result.contentType);
    } catch (error) {
      writeLog(`media protocol failed: ${error instanceof Error ? error.message : String(error)}`);
      return new Response('Media not available', { status: 404 });
    }
  });
}

const viewerWindows=new Set<number>();
const displayOrigins=new Map<number,{bounds:Electron.Rectangle;maximized:boolean}>();
function createWindow(): void {
  let loaded=false,prepared=false,shown=false,loadFailed=false;
  const showMain=()=>{if(shown||!loaded||!prepared||window.isDestroyed())return;shown=true;if(remembered.maximized)window.maximize();window.webContents.setBackgroundThrottling(true);window.show();window.focus();startupScreen?.close();startupScreen=undefined;writeLog('startup main shown');};
  startupScreen=createStartupWindow(path.join(mainDirectory,'preload.cjs'),()=>{if(window.isDestroyed())return;if(loadFailed||window.webContents.isCrashed()){loadFailed=false;void window.webContents.reload();}else window.webContents.send('lumina:startup-retry');},()=>app.quit());
  const stateFile=path.join(app.getPath('userData'),'window-state.json');
  const displays=screen.getAllDisplays(),primary=screen.getPrimaryDisplay();
  let remembered=restoreWindowState(stateFile,[primary,...displays.filter(display=>display.id!==primary.id)].map(display=>display.workArea));
  const window = new BrowserWindow({
    ...remembered.bounds,show:false,minWidth:Math.min(1120,remembered.bounds.width),minHeight:Math.min(720,remembered.bounds.height),backgroundColor: '#f6f8fc',
    icon: path.join(mainDirectory, 'renderer', 'lumina-album-icon-256.png'),
    title: '光匣 Lumina', titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#ffffff', symbolColor: '#5d6c7b', height: 48 },
    webPreferences: { preload: path.join(mainDirectory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false,backgroundThrottling:false },
  });
  mainWindow=window;
  const progress=(event:Electron.IpcMainEvent,value:StartupStatus)=>{if(event.sender!==window.webContents||shown||!value||!['data','thumbnails','ready','error'].includes(value.phase))return;const status={...value,message:typeof value.message==='string'?value.message.slice(0,200):undefined};writeLog(`startup ${JSON.stringify(status)}`);if(status.phase==='ready'){prepared=true;showMain();}else startupScreen?.update(status);};
  ipcMain.on('lumina:startup',progress);
  window.once('ready-to-show',()=>{loaded=true;showMain();});
  // Windows may round outer bounds differently while creating a scaled window.
  // Correct the requested size against the measured result to avoid growth on restart.
  const requested={...remembered.bounds};
  for(let attempt=0;attempt<3;attempt++){
    const actual=window.getBounds(),dx=actual.width-remembered.bounds.width,dy=actual.height-remembered.bounds.height;
    if(Math.abs(dx)<=1 && Math.abs(dy)<=1)break;
    requested.width-=dx;requested.height-=dy;window.setBounds(requested);
  }
  let timer:ReturnType<typeof setTimeout>|undefined;
  const persist=()=>{if(!shown || window.isDestroyed() || window.isMinimized() || window.isFullScreen() || displayOrigins.has(window.id))return;remembered={bounds:window.getNormalBounds(),maximized:window.isMaximized()};try{saveWindowState(stateFile,remembered);}catch(error){writeLog(`window state save failed: ${String(error)}`);}};
  const queuePersist=()=>{clearTimeout(timer);timer=setTimeout(persist,300);};
  window.on('resize',queuePersist);window.on('move',queuePersist);window.on('maximize',queuePersist);window.on('unmaximize',queuePersist);
  window.on('close',()=>{clearTimeout(timer);persist();});
  window.on('closed',()=>{clearTimeout(timer);ipcMain.removeListener('lumina:startup',progress);mainWindow=undefined;startupScreen?.close();startupScreen=undefined;});
  window.removeMenu();
  window.on('app-command',(event,command)=>{const action=command==='browser-backward'?'back':command==='browser-forward'?'forward':command==='browser-refresh'?'refresh':null;if(action){event.preventDefault();window.webContents.send('lumina:app-shortcut',action);}});
  window.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown' && input.key==='F5'){event.preventDefault();if(!input.isAutoRepeat)window.webContents.send('lumina:app-shortcut','refresh');return;}if(input.type==='keyDown' && input.key==='Escape' && viewerWindows.has(window.id)){event.preventDefault();window.webContents.send('lumina:viewer-escape');}});
  window.on('closed',()=>viewerWindows.delete(window.id));
  window.webContents.on('console-message', (_event, _level, message, line, source) => writeLog(`renderer ${source}:${line} ${message}`));
  window.webContents.on('did-finish-load', () => writeLog('renderer did-finish-load'));
  window.webContents.on('dom-ready', () => writeLog('renderer dom-ready'));
  window.webContents.on('did-fail-load', (_event, code, description, url,mainFrame) => {writeLog(`renderer did-fail-load code=${code} description=${description} url=${url}`);if(mainFrame&&!shown&&code!==-3){loadFailed=true;startupScreen?.update({phase:'error',message:'界面加载失败，请重试或退出后重新打开。'});}});
  window.webContents.on('render-process-gone',()=>{if(!shown){loadFailed=true;startupScreen?.update({phase:'error',message:'界面初始化中断，请重试。'});}});
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL).catch((error) => writeLog(`loadURL failed: ${error instanceof Error ? error.message : String(error)}`));
  else void window.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html')).catch((error) => writeLog(`loadFile failed: ${error instanceof Error ? error.message : String(error)}`));
}

app.whenReady().then(() => {
  writeLog('app ready');
  mkdirSync(path.join(app.getPath('userData'), 'data'), { recursive: true });
  registerMediaProtocol();
  ipcMain.handle('lumina:command', (_event, command: unknown) => { writeLog(`ipc command ${JSON.stringify(command)}`); return sendCommand(command); });
  ipcMain.handle('lumina:memory-pressure',event=>{if(event.sender!==mainWindow?.webContents)return 0;const pid=event.sender.getOSProcessId();return (app.getAppMetrics().find(row=>row.pid===pid)?.memory.workingSetSize??0)*1024;});
  ipcMain.handle('lumina:thumbnail', async (_event, input: string|{mediaId:string;retry?:boolean}) => {
    const mediaId=typeof input==='string'?input:input.mediaId,retry=typeof input==='string'?false:input.retry===true;
    const result = await sendCommand({ type: 'media.thumbnail', id: mediaId, retry, width: 480, height: 320 }) as { cachePath: string };
    return `lumina-media://thumbnail/${encodeURIComponent(mediaId)}?v=${encodeURIComponent(path.basename(result.cachePath))}`;
  });
  ipcMain.handle('lumina:pick-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('lumina:pick-import',async(_event,kind:unknown)=>{
    if(kind!=='files'&&kind!=='folders')throw new Error('无效的导入方式');
    const result=await dialog.showOpenDialog({title:kind==='files'?'选择导入的照片或视频':'批量选择导入文件夹',properties:kind==='files'?['openFile','multiSelections']:['openDirectory','multiSelections']});
    return result.canceled?[]:result.filePaths;
  });
  ipcMain.handle('lumina:clipboard-import',async()=>{
    const files=await readWindowsFileList();if(files.length)return files;
    const image=clipboard.readImage();if(image.isEmpty())return [];
    const bytes=image.toPNG();if(bytes.length>32*1024*1024)throw new Error('剪贴板图片超过32MB，请保存为文件后导入');
    const inbox=path.join(app.getPath('userData'),'import-inbox');mkdirSync(inbox,{recursive:true});const file=path.join(inbox,`lumina-clipboard-${randomUUID()}.png`);await writeFile(file,bytes,{flag:'wx'});return [file];
  });
  ipcMain.handle('lumina:native', async (_event, input: { action?: string; mediaIds?: unknown; directory?: unknown; displayId?:unknown; dimmed?:unknown; color?:unknown }) => {
    const owner=BrowserWindow.fromWebContents(_event.sender);
    if(input.action==='dim-window-controls'){if(typeof input.dimmed!=='boolean')throw new Error('无效的窗口状态');if(owner){if(input.dimmed)viewerWindows.add(owner.id);else viewerWindows.delete(owner.id);}return {ok:true};}
    if(input.action==='window-controls-style'){
      if(typeof input.color!=='string' || !/^#[0-9a-f]{6}$/iu.test(input.color))throw new Error('无效的窗口颜色');
      const rgb=[1,3,5].map(index=>parseInt((input.color as string).slice(index,index+2),16));
      const light=rgb[0]!*.2126+rgb[1]!*.7152+rgb[2]!*.0722>145;
      if(owner && process.platform==='win32')owner.setTitleBarOverlay({color:input.color,symbolColor:light?'#5d6c7b':'#dce5f2',height:48});
      return {ok:true};
    }
    if(input.action==='idle-state')return {seconds:powerMonitor.getSystemIdleTime(),focused:owner?.isFocused() && owner.isVisible()};
    if(input.action==='displays')return screen.getAllDisplays().map((display)=>({id:display.id,label:display.label || `${display.size.width} × ${display.size.height}`,primary:display.id===screen.getPrimaryDisplay().id}));
    if(input.action==='move-display') {
      const target=screen.getAllDisplays().find((display)=>display.id===input.displayId);if(!owner || !target)throw new Error('显示器已断开，请重新选择');
      if(!displayOrigins.has(owner.id))displayOrigins.set(owner.id,{bounds:owner.getBounds(),maximized:owner.isMaximized()});
      if(owner.isMaximized())owner.unmaximize();owner.setBounds(target.bounds);return {ok:true};
    }
    if(input.action==='restore-display') {
      if(owner){const original=displayOrigins.get(owner.id);if(original){displayOrigins.delete(owner.id);owner.setBounds(original.bounds);if(original.maximized)owner.maximize();}}return {ok:true};
    }
    if(input.action==='pick-music') {
      const result=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'背景音乐',extensions:['mp3','wav','ogg','m4a','flac']}]});if(result.canceled || !result.filePaths[0])return null;
      const file=result.filePaths[0];if((await stat(file)).size>64*1024*1024)throw new Error('请选择 64 MB 以内的背景音乐');
      const mime=({'.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4','.flac':'audio/flac'} as Record<string,string>)[path.extname(file).toLowerCase()];if(!mime)throw new Error('不支持的音乐格式');
      const bytes=await readFile(file);await writeFile(path.join(app.getPath('userData'),'slideshow-music.json'),JSON.stringify({file}));
      return {name:path.basename(file),url:`data:${mime};base64,${bytes.toString('base64')}`};
    }
    if(input.action==='last-music') {
      try {const {file}=JSON.parse(await readFile(path.join(app.getPath('userData'),'slideshow-music.json'),'utf8'));if(typeof file!=='string' || !path.isAbsolute(file))return null;
        const mime=({'.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4','.flac':'audio/flac'} as Record<string,string>)[path.extname(file).toLowerCase()];if(!mime || (await stat(file)).size>64*1024*1024)return null;
        return {name:path.basename(file),url:`data:${mime};base64,${(await readFile(file)).toString('base64')}`};
      }catch{return null;}
    }
    if(input.action==='forget-music'){await unlink(path.join(app.getPath('userData'),'slideshow-music.json')).catch(()=>{});return {ok:true};}
    if (input.action === 'pick-subtitle') {
      const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '字幕', extensions: ['vtt','srt'] }] });
      if (result.canceled || !result.filePaths[0]) return null;
      const file=result.filePaths[0];if((await stat(file)).size>8*1024*1024)throw new Error('字幕文件过大，请选择 8 MB 以内的文本字幕');
      const bytes=await readFile(file);let text=bytes.toString('utf8').replace(/^\uFEFF/u,'');if(text.includes('\uFFFD'))text=new TextDecoder('gb18030').decode(bytes);
      if(path.extname(file).toLowerCase()==='.srt')text='WEBVTT\n\n'+text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/gu,'$1.$2');
      return `data:text/vtt;base64,${Buffer.from(text,'utf8').toString('base64')}`;
    }
    if (input.action === 'open-export') {
      if (typeof input.directory !== 'string' || !(await stat(input.directory)).isDirectory()) throw new Error('导出目录不可用');
      const error = await shell.openPath(input.directory); if (error) throw new Error(error); return { ok: true };
    }
    if (!Array.isArray(input.mediaIds) || !input.mediaIds.length || input.mediaIds.length > 10000 || !input.mediaIds.every((id) => typeof id === 'string' && id.length <= 128)) throw new Error('媒体参数无效');
    if (input.action === 'open-original' || input.action === 'show-file') {
      const result = await sendCommand({ type: 'media.filePath', id: input.mediaIds[0] }) as { absolutePath: string };
      if (input.action === 'show-file') shell.showItemInFolder(result.absolutePath);
      else { const error = await shell.openPath(result.absolutePath); if (error) throw new Error(error); } return { ok: true };
    }
    if (input.action !== 'copy' && input.action !== 'copy-original') throw new Error('不支持的操作');
    const media = await sendCommand({ type: 'media.delivery', mediaIds: input.mediaIds }) as Array<{ id: string; kind: string; absolutePath: string }>;
    let imagePath: string | undefined;
    if (input.action === 'copy' && media.length === 1 && media[0]!.kind === 'photo') imagePath = (await sendCommand({ type: 'media.previewPath', id: media[0]!.id }) as { cachePath: string }).cachePath;
    await copyWindowsFiles(media.map((item) => item.absolutePath), imagePath); return { ok: true };
  });
  const externalDrag=createExternalDragController(request=>sendCommand({type:'media.delivery',...request}) as Promise<Array<{absolutePath:string}>>);
  ipcMain.handle('lumina:drag', (event,input:unknown) => {
    if(!BrowserWindow.fromWebContents(event.sender) || event.senderFrame!==event.sender.mainFrame)throw new Error('无法从此窗口拖出媒体');
    return externalDrag(event.sender.id,input,async files=>{
      // Reuse the shared thumbnail cache, including video posters. A slow or
      // missing thumbnail must not hold up dragging the original files.
      const thumbnail=await Promise.race([
        sendCommand({type:'media.thumbnail',id:parseExternalDrag(input).mediaIds[0]}).then(value=>nativeImage.createFromPath((value as {cachePath:string}).cachePath)).catch(()=>undefined),
        new Promise<undefined>(resolve=>{const timer=setTimeout(()=>resolve(undefined),200);timer.unref();}),
      ]);
      if(event.sender.isDestroyed())throw new Error('拖出窗口已关闭');
      const icon=createMediaDragIcon(thumbnail,files.length);
      event.sender.startDrag({file:files[0]!,files,icon});
    });
  });
  try { createWindow(); } catch (error) { writeLog(`createWindow failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => core?.kill());
