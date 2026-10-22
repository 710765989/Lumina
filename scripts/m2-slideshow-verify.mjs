import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url);const sharp=require('../apps/desktop/node_modules/sharp');const ffmpeg=require('../apps/desktop/node_modules/ffmpeg-static');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-slideshow-qa');
const run=(args)=>new Promise((resolve,reject)=>{const child=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error',...args],{windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('fixture generation')));});
try{
 await page.locator('.library-content').getByLabel('视图切换',{exact:true}).selectOption('time');
 const root=path.join(qaRoot,'fixtures');await mkdir(root);const image=path.join(root,'slide.jpg');await sharp({create:{width:640,height:400,channels:3,background:'#2874df'}}).jpeg().withExif({IFD0:{Make:'LuminaTest',Model:'TestCamera'}}).toFile(image);
 const music=path.join(qaRoot,'silent.wav');await run(['-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','1',music]);await run(['-f','lavfi','-i','color=c=blue:s=160x90:d=8','-c:v','libx264','-pix_fmt','yuv420p',path.join(root,'slide-video.mp4')]);
 const before=await readFile(image);await command({type:'roots.addAndScan',absolutePath:root});await page.getByRole('button',{name:'刷新',exact:true}).click();await page.locator('.media-card').filter({hasText:'slide.jpg'}).dblclick();await page.locator('.viewer-photo.ready').waitFor();
 await page.getByRole('button',{name:'幻灯片',exact:true}).click();await page.locator('.viewer-controls select').first().selectOption('30');await page.getByRole('button',{name:'幻灯片设置',exact:true}).click();const settings=page.locator('.slideshow-settings');
 await settings.getByLabel('显示日期分组标题',{exact:true}).check();await settings.getByLabel('叠加 EXIF 信息',{exact:true}).check();await page.locator('.slideshow-overlay').getByText(/LuminaTest/).waitFor();
 await desktop.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},music);await settings.getByRole('button',{name:'选择音乐',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=2 && !document.querySelector('audio').paused);
 await page.getByRole('button',{name:'暂停',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio').paused);await page.getByRole('button',{name:'继续',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('audio').paused);
 await page.locator('.viewer-controls select').nth(2).selectOption('random');assert.match(await page.locator('.media-viewer').getAttribute('class'),/transition-(fade|slide)/);
 const displays=await page.evaluate(()=>window.lumina.native({action:'displays'}));assert(displays.length>0);const originalBounds=await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
 await settings.getByLabel('全屏显示器',{exact:true}).selectOption(String(displays[0].id));await settings.getByRole('button',{name:'在此显示器全屏',exact:true}).click();await page.waitForFunction(()=>Boolean(document.fullscreenElement));await page.screenshot({path:path.join(qaRoot,'slideshow.png')});await page.keyboard.press('Escape');await page.locator('.media-viewer').waitFor({state:'hidden'});
 await page.waitForTimeout(300);const restored=await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
 // Windows rounds the native frame at fractional DPI (up to one pixel per edge).
 for(const key of ['x','y','width','height'])assert(Math.abs(restored[key]-originalBounds[key])<=2,`window ${key} did not restore`);assert.deepEqual(await readFile(image),before);
 await page.locator('.media-month-heading').first().click();const config=await command({type:'organization.settings'});await command({type:'organization.configure',...config,idleSlideshowMinutes:5});await desktop.evaluate(({powerMonitor,BrowserWindow})=>{powerMonitor.getSystemIdleTime=()=>3600;BrowserWindow.getAllWindows()[0].focus();});
 await page.locator('.media-viewer').waitFor({timeout:22000});if(await page.locator('video').count())assert.equal(await page.locator('video').evaluate(video=>video.muted),true);
 await page.waitForTimeout(1200);await page.keyboard.press('Delete');await page.locator('.media-viewer').waitFor({state:'hidden'});assert.equal(await page.getByRole('dialog',{name:'从图库删除',exact:true}).count(),0);await command({type:'organization.configure',...config,idleSlideshowMinutes:0});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,qaRoot,displayCount:displays.length,checks:['EXIF and date overlay','silent local music plays and pauses','random transition','selected display fullscreen','original window bounds restored','idle launch with mocked OS clock','idle input exits','original photo unchanged']}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});throw error;}finally{await desktop.close();}
