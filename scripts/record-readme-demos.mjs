import {createRequire} from 'node:module';
import {mkdir,writeFile,utimes} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';

// Records the actual application in an isolated profile with generated artwork.
// No personal media, database or network resources are used.
const require=createRequire(import.meta.url),sharp=require('../apps/desktop/node_modules/sharp');
const ffmpeg=require('../apps/desktop/node_modules/ffmpeg-static');
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(source,'docs/images');await mkdir(output,{recursive:true});
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'readme-demos');
const deadline=setTimeout(()=>void desktop.close(),180000),home=page.locator('.library-content');
page.setDefaultTimeout(20000);
const palettes=[['#e0f2ff','#82b6d5','#477ca1','#224d70'],['#fff0da','#e7bd8f','#b2827d','#654d69'],['#e6f2df','#9dc5ac','#538e84','#285b62'],['#efe8fa','#b3afd4','#7d85b7','#4b557c']];
async function capture(name,action){
 const directory=path.join(qaRoot,name);await mkdir(directory);const frames=[];let running=true;
 const recording=(async()=>{while(running){const started=Date.now(),file=path.join(directory,`frame-${String(frames.length).padStart(4,'0')}.png`);await page.screenshot({path:file,scale:'css'});frames.push({file,at:started});await page.waitForTimeout(Math.max(1,100-(Date.now()-started)));}})();
 try{await page.waitForTimeout(700);await action();await page.waitForTimeout(1000);}finally{running=false;await recording;}
 const concat=frames.map((frame,i)=>`file '${path.basename(frame.file)}'\nduration ${((frames[i+1]?.at??frame.at+100)-frame.at)/1000}\n`).join('')+`file '${path.basename(frames.at(-1).file)}'\n`;
 await writeFile(path.join(directory,'frames.txt'),concat);
 const destination=path.join(output,name+'.gif');
 await new Promise((resolve,reject)=>{const child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',path.join(directory,'frames.txt'),'-filter_complex','fps=12,scale=1080:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3','-loop','0',destination],{windowsHide:true});let error='';child.stderr.on('data',chunk=>error+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(error)));});
 console.log(JSON.stringify({demo:name,frames:frames.length,durationMs:frames.at(-1).at-frames[0].at,destination}));
 return {name,frames:frames.length,durationMs:frames.at(-1).at-frames[0].at};
}
try{
 await desktop.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(win=>win.getTitle().includes('Lumina'));win.setContentSize(1280,800);win.center();});
 await command({...(await command({type:'organization.settings'})),type:'organization.configure',watch:false});
 const root=path.join(qaRoot,'demo-media');await mkdir(root);
 const titles=['山间晨光','海边散步','远山落日','湖畔清晨','公路旅行','雨后森林','海岸晚霞','周末露营'];
 for(let i=0;i<32;i++){
  const [sky,far,near,front]=palettes[i%4],w=720,h=[480,600,450,540][i%4],sun=480+(i%5)*28;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 720 480" preserveAspectRatio="xMidYMid slice"><rect width="720" height="480" fill="${sky}"/><circle cx="${sun}" cy="110" r="44" fill="#fff9e6"/><path d="M0 290 L${100+i%3*50} 120 L300 305 L480 170 L720 300 V480 H0Z" fill="${far}"/><path d="M0 360 L180 245 L360 370 L560 230 L720 340 V480 H0Z" fill="${near}"/><path d="M0 415 Q180 ${290+i%4*30} 370 390 T720 370 V480 H0Z" fill="${front}"/><path d="M0 443 Q240 400 440 438 T720 420" fill="none" stroke="${sky}" stroke-opacity=".28" stroke-width="5"/></svg>`;
  const file=path.join(root,`${String(i+1).padStart(2,'0')}-${titles[i%8]}.jpg`);await writeFile(file,await sharp(Buffer.from(svg)).jpeg({quality:88}).toBuffer());const date=new Date(2026,9-Math.floor(i/12),21-i%12);await utimes(file,date,date);
 }
 await command({type:'roots.addAndScan',absolutePath:root});const media=await command({type:'media.list',limit:100,sortBy:'name',sort:'asc'});assert.equal(media.length,32);
 for(const [name,englishName] of [['旅行','Travel'],['风景','Landscape'],['收藏','Favorites']])await command({type:'tags.create',name,englishName});
 for(let i=0;i<media.length;i++){await command({type:'media.addTag',id:media[i].id,tagName:'风景'});if(i%2===0)await command({type:'media.addTag',id:media[i].id,tagName:'旅行'});if(i%5===0)await command({type:'media.addTag',id:media[i].id,tagName:'收藏'});}
 await Promise.all(media.map(item=>command({type:'media.thumbnail',id:item.id})));
 await page.evaluate(()=>{localStorage.setItem('lumina.ui.animations','on');window.dispatchEvent(new StorageEvent('storage',{key:'lumina.ui.animations'}));});
 await page.keyboard.press('F5');await home.locator('.page-summary').filter({hasText:'32 项'}).waitFor();
 await home.getByLabel('视图切换',{exact:true}).selectOption('immersive');
 const size=home.getByLabel('缩略图大小',{exact:true});await size.fill('170');await page.waitForTimeout(800);
 const demos=[];
 demos.push(await capture('gallery-browsing',async()=>{
  const box=await size.boundingBox(),limits=await size.evaluate(input=>({min:Number(input.min),max:Number(input.max)}));
  const x=value=>box.x+8+(value-limits.min)/(limits.max-limits.min)*(box.width-16),y=box.y+box.height/2;
  await page.mouse.move(x(170),y);await page.mouse.down();for(const value of [185,205,225,245,265,245,225,205,185]){await page.mouse.move(x(value),y,{steps:3});await page.waitForTimeout(140);}await page.mouse.up();
  await page.waitForTimeout(600);await home.getByLabel('视图切换',{exact:true}).selectOption('time');await page.waitForTimeout(1300);await home.getByLabel('视图切换',{exact:true}).selectOption('masonry');await page.waitForTimeout(1300);await home.getByLabel('视图切换',{exact:true}).selectOption('immersive');
 }));
 const input=home.locator('.search-builder input');
 demos.push(await capture('tag-search',async()=>{
  await input.click();await home.getByRole('option',{name:'标签',exact:true}).hover();await page.waitForTimeout(700);await home.getByRole('listbox',{name:'标签条件',exact:true}).getByRole('option',{name:'包含',exact:true}).click();
  await input.pressSequentially('lx',{delay:250});await page.waitForTimeout(900);await home.getByRole('listbox',{name:'标签建议',exact:true}).getByRole('option').filter({hasText:'旅行'}).click();await home.locator('.page-summary').filter({hasText:'16 项'}).waitFor();
  await page.waitForTimeout(1000);await input.click();await home.getByRole('option',{name:'文件名',exact:true}).hover();await page.waitForTimeout(500);await home.getByRole('listbox',{name:'文件名条件',exact:true}).getByRole('option',{name:'包含',exact:true}).click();await input.pressSequentially('山',{delay:200});await page.waitForTimeout(600);await input.press('Enter');await home.locator('h2').first().click();await page.waitForTimeout(1000);
  while(await home.locator('.search-chip button').count())await home.locator('.search-chip button').first().click();await home.locator('h2').first().click();await home.locator('.page-summary').filter({hasText:'32 项'}).waitFor();
 }));
 assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'recording.json'),JSON.stringify({ok:true,syntheticMedia:true,demos,errors},null,2));console.log('QA ROOT '+qaRoot);
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png'),scale:'css'}).catch(()=>{});console.error('QA ROOT '+qaRoot);throw error;}finally{clearTimeout(deadline);await desktop.close();}
