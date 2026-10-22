import {createRequire} from 'node:module';
import {mkdir,writeFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../apps/desktop/node_modules/sharp');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-zoom-memory');
const deadline=setTimeout(()=>void desktop.close(),240000),samples=[];
page.setDefaultTimeout(20000);const home=page.locator('.library-content'),cdp=await page.context().newCDPSession(page);
async function measure(phase){
 const processes=await desktop.evaluate(({app})=>app.getAppMetrics().map(row=>({type:row.type,workingSetMiB:Math.round(row.memory.workingSetSize/1024),privateMiB:Math.round(row.memory.privateBytes/1024)})));
 const heap=await cdp.send('Runtime.getHeapUsage'),dom=await cdp.send('Memory.getDOMCounters');
 const ui=await page.evaluate(()=>({images:document.images.length,cards:document.querySelectorAll('[data-media-id]').length,moving:document.querySelectorAll('[data-layout-moving]').length,animations:[...document.querySelectorAll('.grouped-media-row')].reduce((sum,node)=>sum+node.getAnimations().length,0),resources:window.lumina.imageMemoryUsage?.()}));
 const sample={phase,processes,heapMiB:Math.round(heap.usedSize/1024/1024),dom,ui};samples.push(sample);console.log(JSON.stringify(sample));await writeFile(path.join(qaRoot,'memory.json'),JSON.stringify(samples,null,2));return sample;
}
async function cacheSnapshot(){const cache=(await command({type:'cache.settings'})).directory,result={};for(const name of await readdir(cache)){const info=await stat(path.join(cache,name));if(info.isFile())result[name]=[info.size,info.mtimeMs];}return result;}
try{
 await command({...await command({type:'organization.settings'}),type:'organization.configure',watch:false});
 await page.evaluate(()=>{localStorage.setItem('lumina.ui.animations','on');window.dispatchEvent(new StorageEvent('storage',{key:'lumina.ui.animations'}));});
 const root=path.join(qaRoot,'photos');await mkdir(root);const original=await sharp({create:{width:1920,height:1440,channels:3,background:'#7596bb'}}).jpeg().toBuffer();
 for(let i=0;i<180;i++)await writeFile(path.join(root,`zoom-${String(i).padStart(3,'0')}.jpg`),original);
 await command({type:'roots.addAndScan',absolutePath:root});await page.keyboard.press('F5');await home.locator('.page-summary').filter({hasText:'180 项'}).waitFor();await home.locator('h2').hover();
 // Warm each canonical thumbnail once; later changes must not create files.
 const media=await command({type:'media.list',limit:200});for(let offset=0;offset<media.length;offset+=8)await Promise.all(media.slice(offset,offset+8).map(item=>page.evaluate(id=>window.lumina.thumbnail(id),item.id)));
 await page.waitForTimeout(1000);const cacheBefore=await cacheSnapshot();await measure('ready');
 for(let round=0;round<5;round++){
  await home.getByLabel('缩略图大小',{exact:true}).evaluate(async(input,round)=>{
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
   for(let i=0;i<140;i++){const phase=i%70,value=Math.round(110+(phase<35?phase:70-phase)*6);setter.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,20));}
  },round);await measure(`continuous-${round+1}`);
 }
 if(process.argv.includes('--soak'))for(let gesture=0;gesture<10;gesture++){
  await home.getByLabel('缩略图大小',{exact:true}).evaluate(async(input,gesture)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(let i=0;i<30;i++){setter.call(input,String(Math.round(110+(gesture%2?29-i:i)*7)));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,20));}},gesture);
  await page.waitForTimeout(750);if(gesture%5===4)await measure(`separate-gestures-${gesture+1}`);
 }
 await page.waitForTimeout(6000);const idle=await measure('idle');assert.equal(idle.ui.moving,0);assert.equal(idle.ui.animations,0);assert.deepEqual(await cacheSnapshot(),cacheBefore);assert.deepEqual(errors,[]);
 if(!process.argv.includes('--baseline')){const first=samples[1].processes.find(row=>row.type==='Tab').workingSetMiB,last=samples.at(-2).processes.find(row=>row.type==='Tab').workingSetMiB;assert(last-first<200,`continuous growth ${last-first} MiB`);assert(idle.processes.find(row=>row.type==='Tab').workingSetMiB<550);assert(idle.processes.reduce((sum,row)=>sum+row.workingSetMiB,0)<900);}
 await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,errors,samples,cacheUnchanged:true},null,2));console.log(JSON.stringify({ok:true,qaRoot}));
}catch(error){console.error('QA ROOT '+qaRoot);await writeFile(path.join(qaRoot,'failure.txt'),String(error));throw error;}finally{clearTimeout(deadline);await desktop.close();}
