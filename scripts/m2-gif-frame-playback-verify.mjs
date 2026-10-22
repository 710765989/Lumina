import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),ffmpeg=require('../apps/desktop/node_modules/ffmpeg-static');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-gif-frame-playback');
page.setDefaultTimeout(15000);const deadline=setTimeout(()=>void desktop.close(),120000),checks=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
const home=page.locator('.library-content'),nav=name=>page.locator('.sidebar .nav-item').filter({hasText:name}).click();
async function settings(maxBytes,count){await page.evaluate(value=>{localStorage.setItem('lumina.gif.autoplay',JSON.stringify(value));window.dispatchEvent(new StorageEvent('storage',{key:'lumina.gif.autoplay'}));},{maxBytes,count});}
try{
 assert.equal(await page.evaluate(()=>typeof ImageDecoder),'function','Packaged Chromium must support ImageDecoder');
 await page.evaluate(()=>{
  const Original=globalThis.ImageDecoder,counters={decoders:0,frames:0,peakFrames:0,decoded:0};globalThis.__animationQA=counters;
  function Tracked(options){const decoder=new Original(options);counters.decoders++;const decode=decoder.decode.bind(decoder),close=decoder.close.bind(decoder);let closed=false;
   decoder.decode=async options=>{const result=await decode(options);counters.decoded++;counters.frames++;counters.peakFrames=Math.max(counters.peakFrames,counters.frames);const release=result.image.close.bind(result.image);let released=false;result.image.close=()=>{if(!released){released=true;counters.frames--;}release();};return result;};
   decoder.close=()=>{if(!closed){closed=true;counters.decoders--;}close();};return decoder;
  }Tracked.isTypeSupported=Original.isTypeSupported.bind(Original);globalThis.ImageDecoder=Tracked;
 });
 await command({...(await command({type:'organization.settings'})),type:'organization.configure',watch:false});const root=path.join(qaRoot,'fixtures');await mkdir(root);
 const first=path.join(root,'long-303-frames.gif');await new Promise((resolve,reject)=>{const child=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=300x200:rate=10:duration=30.3','-frames:v','303','-loop','0',first],{windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('fixture generation failed')));});
 const bytes=await readFile(first);assert(bytes.length<2*1024*1024,'Long-frame fixture must stay below the default compressed-size limit');for(let i=0;i<9;i++)await writeFile(path.join(root,`copy-${i}.gif`),bytes);
 const larger=path.join(root,'larger.gif');await writeFile(larger,bytes);await appendFile(larger,Buffer.alloc(2*1024*1024));
 await command({type:'roots.addAndScan',absolutePath:root});const media=await command({type:'media.list',limit:100}),item=media.find(row=>row.absolutePath===first),big=media.find(row=>row.absolutePath===larger),metadata=await command({type:'media.animation',id:item.id});assert.equal(metadata.frames,303);assert(metadata.width*metadata.height*metadata.frames*4>32*1024*1024);
 await page.keyboard.press('F5');await home.locator('.page-summary').filter({hasText:'11 项'}).waitFor();await home.getByLabel('视图切换',{exact:true}).selectOption('immersive');await home.getByLabel('缩略图大小',{exact:true}).evaluate(input=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'110');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});await home.locator('h2').hover();
 await page.waitForFunction(()=>document.querySelectorAll('.library-content canvas.thumbnail-animated-photo.ready').length===8);const canvas=home.locator('canvas.thumbnail-animated-photo.ready').first();const before=await canvas.screenshot();let changed=false;for(let i=0;i<6;i++){await page.waitForTimeout(130);if(!(await canvas.screenshot()).equals(before)){changed=true;break;}}assert(changed,'A long GIF must visibly animate without hover');assert.equal(await home.locator('img.thumbnail-animated-photo').count(),0);
 pass('小于2MB、303帧且旧算法估算超过32MB的GIF不悬停也会真实播放');
 const old=await home.locator('.media-placeholder>img').first().getAttribute('src');const dimensions=await canvas.evaluate(node=>({w:node.width,h:node.height}));assert(dimensions.w<=480&&dimensions.h<=320);assert(await page.evaluate(()=>globalThis.__animationQA.frames===0&&globalThis.__animationQA.peakFrames<=8));assert.equal(await home.locator('.media-placeholder>img').first().getAttribute('src'),old);
 pass('自动预览使用小画布逐帧绘制并关闭输出帧，原静态缩略图保持不变');
 const bigCanvas=home.locator(`[data-media-id="${big.id}"] canvas.thumbnail-animated-photo.ready`);assert.equal(await bigCanvas.count(),0);await settings(10*1024*1024,16);await bigCanvas.waitFor();await page.waitForFunction(()=>document.querySelectorAll('.library-content canvas.thumbnail-animated-photo.ready').length===11);await settings(512*1024,2);const expected=bytes.length<=512*1024?2:0;await page.waitForFunction(count=>document.querySelectorAll('.library-content canvas.thumbnail-animated-photo.ready').length===count,expected);await settings(2*1024*1024,3);await page.waitForFunction(()=>document.querySelectorAll('.library-content canvas.thumbnail-animated-photo.ready').length===3);
 pass('大小和数量设置即时控制逐帧自动预览，超出大小的GIF保持静态');
 const memory=[];
 if(process.argv.includes('--soak')){
  await settings(2*1024*1024,8);await page.waitForFunction(()=>document.querySelectorAll('.library-content canvas.thumbnail-animated-photo.ready').length===8);
  for(let i=0;i<8;i++){memory.push(await desktop.evaluate(({app})=>app.getAppMetrics().filter(row=>row.type==='Tab').map(row=>({workingSetKiB:row.memory.workingSetSize,privateKiB:row.memory.privateBytes,cpu:row.cpu.percentCPUUsage}))));assert.equal(await page.evaluate(()=>globalThis.__animationQA.frames),0);if(i<7)await page.waitForTimeout(5000);}
  const first=memory[0].reduce((sum,row)=>sum+row.workingSetKiB,0),peak=Math.max(...memory.map(sample=>sample.reduce((sum,row)=>sum+row.workingSetKiB,0)));
  assert(peak-first<192*1024,`Renderer working set grew by ${Math.round((peak-first)/1024)} MiB`);
  pass('8份303帧长GIF持续播放35秒，帧及时释放且渲染进程没有按全部帧持续积累内存');
 }
 await nav('常规');await home.waitFor({state:'hidden'});await page.waitForFunction(()=>globalThis.__animationQA.decoders===0&&globalThis.__animationQA.frames===0);const decoded=await page.evaluate(()=>globalThis.__animationQA.decoded);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>globalThis.__animationQA.decoded),decoded);
 pass('离开图库释放解码器与输出帧，停止后续解码，不在后台继续播放');
 const counts=(await command({type:'tasks.list',limit:200})).filter(task=>task.kind==='scan').length;await nav('图库');await home.locator('canvas.thumbnail-animated-photo.ready').first().waitFor();assert.equal((await command({type:'tasks.list',limit:200})).filter(task=>task.kind==='scan').length,counts);
 pass('返回图库恢复自动播放，不新增扫盘任务或另一套缩略图缓存');
 assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,errors,memory,fixture:{bytes:bytes.length,...metadata}},null,2));console.log(JSON.stringify({ok:true,qaRoot,count:checks.length,memory}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});console.error('QA ROOT',qaRoot);throw error;}finally{clearTimeout(deadline);await desktop.close();}
