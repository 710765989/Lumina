import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),ffmpeg=require('../apps/desktop/node_modules/ffmpeg-static');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-gif-album-search');
const deadline=setTimeout(()=>void desktop.close(),120000),checks=[];
page.setDefaultTimeout(15000);
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const nav=name=>page.locator('.sidebar .nav-item').filter({hasText:name}).click();
const host=()=>page.locator('.page-host:not([hidden])');
async function generate(args){await new Promise((resolve,reject)=>{const child=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error',...args],{windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('测试媒体生成失败')));});}
async function preferences(maxBytes,count){await page.evaluate(value=>{localStorage.setItem('lumina.gif.autoplay',JSON.stringify(value));window.dispatchEvent(new StorageEvent('storage',{key:'lumina.gif.autoplay'}));}, {maxBytes,count});}
try{
 await command({...(await command({type:'organization.settings'})),type:'organization.configure',watch:false});
 const root=path.join(qaRoot,'相册样本');await mkdir(path.join(root,'匹配子相册'),{recursive:true});
 const first=path.join(root,'只匹配媒体.gif');await generate(['-f','lavfi','-i','testsrc=size=96x64:rate=4:duration=1','-loop','0',first]);
 const bytes=await readFile(first),large=path.join(root,'large.gif');await writeFile(large,bytes);await appendFile(large,Buffer.alloc(3*1024*1024));
 await writeFile(path.join(root,'匹配子相册','child.gif'),bytes);
 const video=path.join(root,'video.webm');await generate(['-f','lavfi','-i','testsrc=size=96x64:rate=6:duration=2','-c:v','libvpx-vp9','-pix_fmt','yuv420p','-an',video]);
 const setup=await command({type:'roots.configure',absolutePath:root,label:'相册样本',autoAlbums:true,hierarchy:true,rules:[]});
 if(setup.taskId){for(let i=0;i<500;i++){const job=await command({type:'jobs.result',id:setup.taskId});if(!job.active && job.status==='completed')break;if(job.status==='failed')throw Error(JSON.stringify(job));await page.waitForTimeout(20);}}
 const media=await command({type:'media.list',limit:100}),gif=media.find(row=>row.absolutePath===first),big=media.find(row=>row.absolutePath===large),webm=media.find(row=>row.absolutePath===video);
 assert(gif && big && webm);assert.equal(webm.kind,'video');await command({type:'media.addTag',id:gif.id,tagName:'只匹配标签'});
 await page.keyboard.press('F5');const home=page.locator('.library-content');await home.locator('.page-summary').filter({hasText:'4 项'}).waitFor();await home.getByLabel('视图切换',{exact:true}).selectOption('immersive');await home.locator('h2').hover();
 const bigAnimation=home.locator(`[data-media-id="${big.id}"] .thumbnail-animated-photo.ready`);
 await home.locator(`[data-media-id="${gif.id}"] .thumbnail-animated-photo.ready`).waitFor();assert.equal(await bigAnimation.count(),0);
 await preferences(10*1024*1024,8);await bigAnimation.waitFor();
 await preferences(512*1024,1);await bigAnimation.waitFor({state:'detached'});await page.waitForFunction(()=>document.querySelectorAll('.library-content .thumbnail-animated-photo.ready').length===1);
 pass('已显示的 GIF 随大小和数量限制即时启停，无需切页或滚动');
 await preferences(10*1024*1024,8);await home.locator('h2').hover();assert.equal(await home.locator('video').count(),0);await home.locator(`[data-media-id="${webm.id}"]`).hover();await home.locator('.thumbnail-hover-video.ready').waitFor();assert(await home.locator('video').evaluate(node=>node.muted && node.loop));await home.locator('h2').hover();await home.locator('video').waitFor({state:'detached'});
 pass('WebM 保持视频类型，仅悬停时静音循环播放，移开释放播放器');
 await nav('相册');await home.waitFor({state:'hidden'});const search=host().getByRole('textbox',{name:'搜索相册',exact:true});await search.waitFor();
 await search.fill('只匹配媒体');await host().getByRole('status').filter({hasText:'没有匹配的相册'}).waitFor();assert.equal(await host().locator('[data-media-id],.album-cover-card,.collection-media-browser').count(),0);assert.equal(await page.locator('[data-media-id]:visible').count(),0);
 await search.fill('只匹配标签');assert.equal(await host().locator('.album-cover-card').count(),0);
 pass('相册首页不会把文件名或媒体标签匹配到的单个媒体混入结果');
 await search.fill('匹配子相册');await host().locator('.album-cover-card').filter({hasText:'匹配子相册'}).waitFor();assert.equal(await host().locator('.album-cover-card').count(),1);assert.equal(await host().locator('.album-cover-card').first().getAttribute('data-album-id'),(await command({type:'albums.list'})).find(row=>row.name==='匹配子相册').id);
 await search.fill('相册样本');await host().locator('.album-card-title').filter({hasText:'相册样本'}).click();await host().locator('h2').filter({hasText:'相册样本'}).waitFor();await host().getByLabel('子相册',{exact:true}).getByRole('button').filter({hasText:'匹配子相册'}).waitFor();assert.equal(await host().getByLabel('子相册',{exact:true}).getByRole('button').count(),1);
 pass('搜索返回真实相册；打开结果后仅列出直接子相册，首页关键词不影响相册内部');
 await host().getByLabel('搜索当前媒体',{exact:true}).waitFor();await host().locator('.thumbnail-animated-photo.ready').first().waitFor();assert.equal(await search.count(),0);
 pass('进入相册后的媒体搜索独立显示，GIF 也能在相册内自动播放');
 await page.screenshot({path:path.join(qaRoot,'album-browser.png')});assert.deepEqual(errors,[]);
 await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot,count:checks.length}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});console.error('QA ROOT',qaRoot);throw error;}finally{clearTimeout(deadline);await desktop.close();}
