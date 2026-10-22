import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../packages/core/node_modules/sharp'),{_electron:electron}=require(process.env.LUMINA_PLAYWRIGHT_PATH||'playwright'),{buildSync}=require('../apps/desktop/node_modules/esbuild');
const stage=path.resolve(process.argv[2]),qaRoot=path.resolve(process.env.LUMINA_QA_ROOT||'build-staging',`m2-startup-${Date.now()}`),checks=[];
await mkdir(qaRoot,{recursive:true});const pass=name=>{checks.push(name);console.log('PASS '+name);};
const seeded=await launchIsolated(stage,'m2-startup-seed');const userData=path.join(seeded.qaRoot,'user-data'),photos=path.join(seeded.qaRoot,'photos');await mkdir(photos);
await seeded.command({...(await seeded.command({type:'organization.settings'})),type:'organization.configure',watch:false});
for(let index=0;index<60;index++)await sharp({create:{width:200,height:150,channels:3,background:{r:index*3,g:120,b:200}}}).jpeg().toFile(path.join(photos,`photo-${index}.jpg`));
await seeded.command({type:'roots.addAndScan',absolutePath:photos});const records=await seeded.command({type:'media.list'}),cached=[];
for(const record of records)cached.push(await seeded.command({type:'media.thumbnail',id:record.id}));
for(let n=0;n<300;n++){const tasks=await seeded.command({type:'tasks.list',limit:200});if(!tasks.some(task=>task.kind==='thumbnail'&&['queued','running'].includes(task.status)))break;await new Promise(resolve=>setTimeout(resolve,30));}
await seeded.page.waitForFunction(()=>Array.from(document.querySelectorAll('.library-content .media-placeholder>img')).every(image=>image.complete&&image.naturalWidth>0));
const cacheBefore=await Promise.all(cached.map(async item=>({file:item.cachePath,mtime:(await stat(item.cachePath)).mtimeMs}))),scans=(await seeded.command({type:'tasks.list',limit:200})).filter(task=>task.kind==='scan').length;
await writeFile(path.join(qaRoot,'cache-before.json'),JSON.stringify(cacheBefore,null,2));await seeded.desktop.close();for(const item of cacheBefore)assert.equal((await stat(item.file)).mtimeMs,item.mtime,'cache changed while closing seed');await writeFile(path.join(userData,'window-state.json'),JSON.stringify({bounds:{x:60,y:60,width:1200,height:760},maximized:true}));

async function launch(label,options={}){
 const folder=path.join(qaRoot,label);await mkdir(folder);const main=path.join(folder,'app-main.cjs'),wrapper=path.join(folder,'main.cjs');
 buildSync({entryPoints:[path.join(stage,'dist/main.js')],outfile:main,bundle:true,platform:'node',format:'cjs',external:['electron'],define:{'import.meta.url':JSON.stringify(pathToFileURL(path.join(stage,'dist/main.js')).href)}});
 const data=options.seeded?userData:path.join(folder,'user-data');
 await writeFile(wrapper,`const {app,ipcMain,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(data)});app.setAppPath(${JSON.stringify(stage)});Object.defineProperty(app,'isPackaged',{value:true});globalThis.qaStartup=[];let blocked=true;const original=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,callback)=>original(channel,async(event,command)=>{if(channel==='lumina:command'&&command?.type==='roots.list'&&blocked){blocked=false;await new Promise(resolve=>setTimeout(resolve,${options.delay??1500}));${options.fail?"throw new Error('隔离测试：图库读取暂时失败');":''}}return callback(event,command);});ipcMain.on('lumina:startup',(event,status)=>globalThis.qaStartup.push({...status,mainVisible:BrowserWindow.fromWebContents(event.sender)?.isVisible(),at:Date.now()}));require(${JSON.stringify(main)});`);
 const env={...process.env,LUMINA_TEST_USER_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
 const desktop=await electron.launch({executablePath:path.resolve('apps/desktop/node_modules/electron/dist/electron.exe'),args:[wrapper],env,timeout:20000});
 let splash;for(let n=0;n<100;n++){splash=desktop.windows().find(page=>page.url().startsWith('data:text/html'));if(splash)break;await new Promise(resolve=>setTimeout(resolve,20));}assert(splash,'missing splash');
 await splash.getByRole('status').waitFor();return {desktop,splash};
}
async function mainReady(desktop){for(let n=0;n<300;n++){for(const page of desktop.windows()){if(await page.locator('.app-header').count().catch(()=>0)){if(await page.evaluate(()=>document.documentElement.dataset.startup==='ready')){await page.waitForTimeout(80);return page;}}}await new Promise(resolve=>setTimeout(resolve,40));}throw new Error('main did not become ready');}
async function visibility(desktop){return desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(window=>({title:window.getTitle(),visible:window.isVisible(),url:window.webContents.getURL(),maximized:window.isMaximized()})));}
let active;
try{
 active=await launch('cached',{seeded:true});let windows=await visibility(active.desktop);assert(windows.some(window=>window.url.startsWith('data:')&&window.visible));assert(windows.some(window=>window.title==='光匣 Lumina'&&!window.visible));await active.splash.screenshot({path:path.join(qaRoot,'startup-loading.png')});pass('loading window is visible while the saved maximized main window stays hidden during delayed index reads');
 let page=await mainReady(active.desktop);windows=await visibility(active.desktop);assert.equal(windows.length,1);assert(windows[0].visible&&windows[0].maximized);const phases=await active.desktop.evaluate(()=>globalThis.qaStartup);const ready=phases.find(row=>row.phase==='ready');assert(ready.total>0);assert.equal(ready.completed,ready.total);assert.equal(ready.mainVisible,false);pass('the main window appears only after first-viewport cached thumbnails load, and restores maximization');
 assert.equal((await page.evaluate(()=>window.lumina.command({type:'tasks.list',limit:200}))).filter(task=>task.kind==='scan').length,scans);for(const item of cacheBefore)assert.equal((await stat(item.file)).mtimeMs,item.mtime);pass('reopening an existing library reuses cached thumbnails without rescanning or rewriting them');
 await active.desktop.close();active=null;
 active=await launch('failure',{fail:true});await active.splash.locator('body.error').waitFor();windows=await visibility(active.desktop);assert(windows.some(window=>window.title==='光匣 Lumina'&&!window.visible));await active.splash.getByText('隔离测试：图库读取暂时失败',{exact:true}).waitFor();await active.splash.screenshot({path:path.join(qaRoot,'startup-error-retry.png')});pass('initialization errors keep the main window hidden and show a readable retry screen');
 await active.splash.getByRole('button',{name:'重试',exact:true}).click();page=await mainReady(active.desktop);assert.equal((await visibility(active.desktop)).length,1);assert.equal(await page.locator('.library-content .empty').count(),1);pass('retry recovers from a failed initial query and an empty library opens without waiting for thumbnails');
 await active.desktop.close();active=null;
 active=await launch('quit',{delay:10000});const closed=active.desktop.waitForEvent('close',{timeout:10000});await active.splash.getByRole('button',{name:'退出启动',exact:true}).click();await closed;active=null;pass('closing the loading window exits cleanly instead of leaving a hidden main window');
 await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,boundary:'Only generated QA databases, cached thumbnails and injected startup failures. The actual user library is not opened.'},null,2));console.log(JSON.stringify({ok:true,qaRoot,count:checks.length}));
}catch(error){if(active)for(const page of active.desktop.windows())await page.screenshot({path:path.join(qaRoot,`failure-${Date.now()}.png`)}).catch(()=>{});console.error('QA ROOT '+qaRoot);throw error;}finally{if(active)await active.desktop.close();}
