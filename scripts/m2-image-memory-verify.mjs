import {createRequire} from 'node:module';
import {mkdir,writeFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../apps/desktop/node_modules/sharp');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-image-memory');
page.setDefaultTimeout(20000);const deadline=setTimeout(()=>void desktop.close(),180000),samples=[],checks=[];
const home=page.locator('.library-content'),nav=name=>page.locator('.sidebar .nav-item').filter({hasText:name}).click();
const cdp=await page.context().newCDPSession(page);
async function measure(phase){
 const processes=await desktop.evaluate(({app})=>app.getAppMetrics().map(row=>({type:row.type,pid:row.pid,workingSetMiB:Math.round(row.memory.workingSetSize/1024),privateMiB:Math.round(row.memory.privateBytes/1024)})));
 const heap=await cdp.send('Runtime.getHeapUsage'),dom=await cdp.send('Memory.getDOMCounters');
 const ui=await page.evaluate(()=>({activePage:document.querySelector('.sidebar .nav-item.active')?.textContent,images:document.images.length,hiddenImages:[...document.images].filter(img=>img.closest('[hidden]')).length,hiddenSources:[...document.images].filter(img=>img.closest('[hidden]')&&img.hasAttribute('src')).length,resources:window.lumina.imageMemoryUsage?.(),moving:document.querySelectorAll('[data-layout-moving]').length,animations:document.getAnimations().filter(item=>item.playState==='running').length}));
 const result={phase,processes,heapMiB:Math.round(heap.usedSize/1024/1024),dom,ui};samples.push(result);await writeFile(path.join(qaRoot,'memory.json'),JSON.stringify(samples,null,2));console.log(JSON.stringify(result));return result;
}
async function settled(){await page.waitForTimeout(1000);}
try{
 await command({...await command({type:'organization.settings'}),type:'organization.configure',watch:false});await page.emulateMedia({reducedMotion:'no-preference'});
 const root=path.join(qaRoot,'photos');await mkdir(root);const original=await sharp({create:{width:4096,height:3072,channels:3,background:'#75a6dd'}}).jpeg().toBuffer();
 for(let i=0;i<48;i++)await writeFile(path.join(root,`large-${String(i).padStart(3,'0')}.jpg`),original);
 await command({type:'roots.addAndScan',absolutePath:root});await page.keyboard.press('F5');await home.locator('.page-summary').filter({hasText:'48 项'}).waitFor();await settled();await measure('gallery-ready');
 await home.locator('[data-media-id]').first().dblclick();await page.locator('.viewer-photo.ready').waitFor();
 for(let i=0;i<35;i++){
  const previous=await page.locator('.viewer-head>strong').innerText();await page.keyboard.press('ArrowRight');await page.waitForFunction(previous=>document.querySelector('.viewer-head>strong')?.textContent!==previous&&document.querySelector('.viewer-photo.ready')?.complete,previous);
  if(i%10===9)await measure(`viewer-${i+1}`);
 }
 await measure('viewer-before-close');await page.keyboard.press('Escape');await page.locator('.media-viewer').waitFor({state:'hidden'});await settled();await measure('gallery-after-close');
 await home.getByLabel('缩略图大小',{exact:true}).evaluate(async input=>{for(let i=0;i<48;i++){const value=110+(i%2?47-i:48+i)%42*5;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(requestAnimationFrame);}});
 await settled();const galleryAfter=await measure('gallery-after-zoom');assert.equal(galleryAfter.ui.moving,0);checks.push('布局动画结束后临时图层标记归零');
 await nav('常规');await settled();await measure('empty-page-1s');await page.waitForTimeout(8000);const idle=await measure('empty-page-9s');assert(idle.ui.activePage.includes('常规'),`unexpected page ${idle.ui.activePage}`);assert(idle.ui.hiddenImages>0);assert.equal(idle.ui.hiddenSources,0);assert(idle.ui.resources.trims>0);const peak=Math.max(...samples.flatMap(row=>row.processes.filter(p=>p.type==='Tab').map(p=>p.workingSetMiB)));const idleRenderer=idle.processes.find(p=>p.type==='Tab').workingSetMiB;assert(idleRenderer<peak*.8,`idle ${idleRenderer} MiB / peak ${peak} MiB`);checks.push('隐藏页面释放所有图片来源，闲置后渲染进程较峰值回落至少20%');
 const cache=(await command({type:'cache.settings'})).directory,cacheBefore={};for(const name of await readdir(cache)){const info=await stat(path.join(cache,name));if(info.isFile())cacheBefore[name]={size:info.size,mtime:info.mtimeMs};}
 await nav('图库');await home.locator('[data-media-id]').first().waitFor();await settled();await measure('gallery-returned');
 const cacheAfter={};for(const name of await readdir(cache)){const info=await stat(path.join(cache,name));if(info.isFile())cacheAfter[name]={size:info.size,mtime:info.mtimeMs};}assert.deepEqual(cacheAfter,cacheBefore);checks.push('返回图库复用磁盘缓存，不删除或重建缩略图和预览');
 await home.locator('[data-media-id]').first().dblclick();await page.locator('.viewer-photo.ready').waitFor();for(let i=0;i<22;i++){const previous=await page.locator('.viewer-head>strong').innerText();await page.keyboard.press('ArrowRight');await page.waitForFunction(previous=>document.querySelector('.viewer-head>strong')?.textContent!==previous&&document.querySelector('.viewer-photo.ready')?.complete,previous);}await measure('round2-peak');await page.keyboard.press('Escape');await nav('常规');await page.waitForTimeout(5000);const round2=await measure('round2-idle');assert(round2.ui.activePage.includes('常规'));assert.equal(round2.ui.hiddenSources,0);assert(round2.processes.find(p=>p.type==='Tab').workingSetMiB<400);checks.push('再次浏览22张大图后，后台页面无图片来源，渲染内存回落到400MiB以内');await page.screenshot({path:path.join(qaRoot,'idle-settings.png')});
 assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,samples,checks,errors,idle},null,2));console.log(JSON.stringify({ok:true,qaRoot,checks}));
}catch(error){console.error('QA ROOT '+qaRoot);await writeFile(path.join(qaRoot,'failure.txt'),String(error));throw error;}finally{clearTimeout(deadline);await desktop.close();}
