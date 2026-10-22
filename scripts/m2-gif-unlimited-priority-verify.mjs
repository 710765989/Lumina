import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),ffmpeg=require('../apps/desktop/node_modules/ffmpeg-static');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-gif-unlimited-priority');
const deadline=setTimeout(()=>void desktop.close(),120000),checks=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
page.setDefaultTimeout(20000);
const home=page.locator('.library-content'),nav=name=>page.locator('.sidebar .nav-item').filter({hasText:name}).click();
async function settings(maxBytes,count){await page.evaluate(value=>{localStorage.setItem('lumina.gif.autoplay',JSON.stringify(value));window.dispatchEvent(new StorageEvent('storage',{key:'lumina.gif.autoplay'}));},{maxBytes,count});}
async function size(value){await home.getByLabel('缩略图大小',{exact:true}).evaluate((input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);}
async function fixture(file,dimensions){await new Promise((resolve,reject)=>{const child=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i',`testsrc=size=${dimensions}:rate=4:duration=0.5`,'-frames:v','2','-loop','0',file],{windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('fixture generation failed')));});}
function rankVisible(){const viewport=document.querySelector('.library-content .grouped-media-scroll').getBoundingClientRect();return [...document.querySelectorAll('.library-content [data-media-id]')].map(card=>{const image=card.querySelector('.media-placeholder>img');if(!image)return null;const r=image.getBoundingClientRect(),area=Math.max(0,Math.min(r.bottom,viewport.bottom,innerHeight)-Math.max(r.top,viewport.top,0))*Math.max(0,Math.min(r.right,viewport.right,innerWidth)-Math.max(r.left,viewport.left,0));const complete=r.top>=Math.max(0,viewport.top)-1&&r.left>=Math.max(0,viewport.left)-1&&r.bottom<=Math.min(innerHeight,viewport.bottom)+1&&r.right<=Math.min(innerWidth,viewport.right)+1;return {id:card.dataset.mediaId,area,complete,top:r.top,left:r.left,active:!!card.querySelector('canvas.thumbnail-animated-photo.ready')};}).filter(row=>row&&row.area>0).sort((a,b)=>Number(b.complete)-Number(a.complete)||Math.round(b.area)-Math.round(a.area)||a.top-b.top||a.left-b.left);}
try{
 await command({...(await command({type:'organization.settings'})),type:'organization.configure',watch:false});
 await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.getTitle().includes('Lumina')).setBounds({width:1800,height:1500}));
 const root=path.join(qaRoot,'fixtures');await mkdir(root);const small=path.join(root,'small.gif');await fixture(small,'96x64');const bytes=await readFile(small);for(let i=0;i<19;i++)await writeFile(path.join(root,`small-${i}.gif`),bytes);
 const padded=path.join(root,'over-10mb.gif');await writeFile(padded,bytes);await appendFile(padded,Buffer.alloc(11*1024*1024));
 const high=path.join(root,'high.gif');await fixture(high,'2000x2000');const highBytes=await readFile(high);for(let i=0;i<2;i++)await writeFile(path.join(root,`high-${i}.gif`),highBytes);
 await command({type:'roots.addAndScan',absolutePath:root});const media=await command({type:'media.list',limit:100});assert.equal(media.length,24);for(const item of media)await command({type:'media.animation',id:item.id});
 await nav('常规');const sizeSetting=page.getByLabel('GIF 自动播放文件大小上限',{exact:true}),countSetting=page.getByLabel('GIF 同时自动播放数量',{exact:true});await sizeSetting.selectOption('0');await countSetting.selectOption('0');assert.equal(await sizeSetting.locator('option:checked').textContent(),'不限制');assert.equal(await countSetting.locator('option:checked').textContent(),'不限制');
 await nav('图库');await page.keyboard.press('F5');await home.locator('.page-summary').filter({hasText:'24 项'}).waitFor();await home.getByLabel('视图切换',{exact:true}).selectOption('immersive');await size(110);await home.locator('h2').hover();
 await page.waitForFunction(()=>document.querySelectorAll('.library-content canvas.thumbnail-animated-photo.ready').length===24);
 pass('真实设置提供不限制大小和数量，24个可见GIF全部播放，包含超过10MB和3个高分辨率GIF');
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.startup==='ready');await nav('常规');assert.equal(await sizeSetting.inputValue(),'0');assert.equal(await countSetting.inputValue(),'0');await nav('图库');await home.locator('canvas.thumbnail-animated-photo.ready').first().waitFor();
 pass('无限制设置在重新加载后保留');
 await settings(10*1024*1024,16);await page.waitForFunction(()=>document.querySelectorAll('.library-content canvas.thumbnail-animated-photo.ready').length===16);
 const protectedIds=media.filter(item=>item.absolutePath.includes('high')||item.absolutePath===padded).map(item=>item.id);for(const id of protectedIds)assert.equal(await home.locator(`[data-media-id="${id}"] canvas.thumbnail-animated-photo.ready`).count(),0);
 pass('恢复有限设置立即恢复大小、数量和单项内存限制');
 await settings(0,2);await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.getTitle().includes('Lumina')).setBounds({width:1100,height:760}));await size(220);await home.locator('h2').hover();
 async function verifyRank(label){await page.waitForFunction(`(${rankVisible.toString()})().filter(row=>row.active).length===2 && (${rankVisible.toString()})().slice(0,2).every(row=>row.active)`);const rows=await page.evaluate(rankVisible);assert(rows.length>2);assert(rows.slice(0,2).every(row=>row.active));pass(label);return rows;}
 await verifyRank('初始按可视面积分配播放名额，面积相同从上到下');
 for(const [top,label] of [[180,'下滑后完整可见GIF优先，底部残留不抢占'],[95,'向上返回重新分配名额，不受原挂载顺序影响'],[0,'回到顶部优先恢复上方可见GIF']]){await home.locator('.grouped-media-scroll').evaluate((node,top)=>{node.scrollTop=top;node.dispatchEvent(new Event('scroll',{bubbles:true}));},top);await verifyRank(label);}
 await nav('常规');await home.waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelectorAll('canvas.thumbnail-animated-photo.ready').length===0);pass('离开图库停止播放并释放预览');
 assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot,count:checks.length}));
}catch(error){await writeFile(path.join(qaRoot,'ranking-failure.json'),JSON.stringify(await page.evaluate(rankVisible).catch(()=>[]),null,2));await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});console.error('QA ROOT',qaRoot);throw error;}finally{clearTimeout(deadline);await desktop.close();}
