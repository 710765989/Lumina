import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../apps/desktop/node_modules/sharp');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-hidpi-motion');
const deadline=setTimeout(()=>void desktop.close(),120000),checks=[],samples={};page.setDefaultTimeout(15000);
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const nav=name=>page.locator('.sidebar .nav-item').filter({hasText:name}).click();
async function zoom(value){return page.evaluate(async value=>{
 const host=document.querySelector('.library-content .grouped-media-scroll'),node=[...host.querySelectorAll('[data-media-id]')].find(node=>{const r=node.getBoundingClientRect(),h=host.getBoundingClientRect();return r.top>=h.top&&r.bottom<h.bottom;}),input=document.querySelector('.library-content [aria-label="缩略图大小"]');
 const widths=[],old=node.getBoundingClientRect().width;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
 const start=performance.now();let animated=false;while(performance.now()-start<650){await new Promise(requestAnimationFrame);widths.push(node.getBoundingClientRect().width);animated||=node.closest('.grouped-media-row').getAnimations().length>0;}
 return {old,widths,animated,unique:new Set(widths.map(value=>Math.round(value*10))).size};
},value);}
try{
 await command({...await command({type:'organization.settings'}),type:'organization.configure',watch:false});
 const root=path.join(qaRoot,'photos');await mkdir(root);const bytes=await sharp({create:{width:600,height:400,channels:3,background:'#428edf'}}).jpeg().toBuffer();for(let i=0;i<40;i++)await writeFile(path.join(root,`${i}.jpg`),bytes);
 await command({type:'roots.addAndScan',absolutePath:root});await page.keyboard.press('F5');await page.locator('.page-summary').filter({hasText:'40 项'}).waitFor();
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{localStorage.removeItem('lumina.ui.animations');window.dispatchEvent(new StorageEvent('storage',{key:'lumina.ui.animations'}));});await page.waitForFunction(()=>document.documentElement.dataset.motion==='off');
 await nav('常规');const toggle=page.getByRole('checkbox',{name:'界面动画',exact:true});assert.equal(await toggle.isChecked(),false);pass('未设置软件偏好时跟随系统减少动态效果，界面开关准确显示关闭');
 await toggle.check();assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);await nav('图库');samples.enabled=await zoom(245);assert(samples.enabled.animated&&samples.enabled.unique>=8);pass('系统关闭动画时，软件内手动开启仍可看到连续弹簧缩放');
 const image=page.locator('.library-content .media-placeholder>img').first();await image.hover();await page.waitForTimeout(250);assert.notEqual(await image.evaluate(node=>getComputedStyle(node).transform),'none');pass('手动开启后，系统减少动态效果不再单独屏蔽图片悬停动画');
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.startup==='ready');assert.equal(await page.evaluate(()=>document.documentElement.dataset.motion),'on');samples.reopened=await zoom(170);assert(samples.reopened.animated&&samples.reopened.unique>=8);pass('重新打开后保留明确开启的选择，不被系统设置覆盖');
 await nav('常规');await toggle.uncheck();await nav('图库');samples.disabled=await zoom(260);assert.equal(samples.disabled.animated,false);pass('软件内关闭仍能完全停用布局动画');
 const brand=page.locator('.app-brand .brand-mark');await brand.waitFor();const header=await brand.evaluate(img=>({naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,cssWidth:img.getBoundingClientRect().width,dpr:devicePixelRatio}));assert.equal(header.naturalWidth,256);assert(header.naturalWidth>=header.cssWidth*header.dpr);await page.locator('.app-brand').screenshot({path:path.join(qaRoot,'header-hidpi.png')});pass('顶栏加载256像素素材，当前屏幕缩放下无需放大原图');
 // Read the final archive's startup module and adapt only its module format
 // for the debugger evaluation context, which cannot dynamically import ESM.
 const asar=createRequire(createRequire(require.resolve('../apps/desktop/node_modules/electron-builder')).resolve('app-builder-lib'))('@electron/asar'),{buildSync}=require('../apps/desktop/node_modules/esbuild');
 const startupModule=path.join(qaRoot,'startup-window.mjs'),startupFixture=path.join(qaRoot,'startup-window.cjs');
 await writeFile(startupModule,asar.extractFile(path.join(path.dirname(process.argv[2]),'resources/app.asar'),'dist/startup-window.js'));
 buildSync({entryPoints:[startupModule],outfile:startupFixture,bundle:true,platform:'node',format:'cjs',external:['electron']});
 await desktop.evaluate(({app},fixture)=>{
  const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),path=require('node:path');
  globalThis.__qaSplash=require(fixture).createStartupWindow(path.join(app.getAppPath(),'dist/preload.cjs'),()=>{},()=>{});
 },startupFixture);
 let splash;for(let n=0;n<100;n++){splash=desktop.windows().find(window=>window.url().startsWith('data:text/html'));if(splash)break;await page.waitForTimeout(20);}assert(splash);await splash.locator('.brand .mark').waitFor();
 const baselineDpr=await splash.evaluate(()=>devicePixelRatio);samples.icons=[];
 for(const scale of [1,1.5,2]){
  await desktop.evaluate(({},options)=>{const win=globalThis.__qaSplash.window;win.webContents.setZoomFactor(options.zoom);win.setContentSize(Math.round(400*options.zoom),Math.round(250*options.zoom));},{zoom:scale/baselineDpr});
  await splash.waitForTimeout(80);const icon=await splash.locator('.mark').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight,cssWidth:img.getBoundingClientRect().width,dpr:devicePixelRatio,loaded:img.complete}));assert.equal(icon.width,256);assert(icon.loaded&&icon.width>=icon.cssWidth*icon.dpr);samples.icons.push({scale,...icon});await splash.locator('.brand').screenshot({path:path.join(qaRoot,`startup-brand-${scale}x.png`)});const native=await desktop.evaluate(()=>globalThis.__qaSplash.window.webContents.capturePage().then(image=>image.toPNG().toString('base64')));await writeFile(path.join(qaRoot,`startup-window-${scale}x.png`),Buffer.from(native,'base64'));
 }
 pass('实际启动框在100%、150%、200%等效像素密度下均使用高清图，保持原42px显示大小');
 await desktop.evaluate(()=>globalThis.__qaSplash.close());assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,samples,header,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot,checks},null,2));
}catch(error){console.error('QA ROOT '+qaRoot);for(const window of desktop.windows())await window.screenshot({path:path.join(qaRoot,`failure-${Date.now()}.png`)}).catch(()=>{});throw error;}finally{clearTimeout(deadline);await desktop.close();}
