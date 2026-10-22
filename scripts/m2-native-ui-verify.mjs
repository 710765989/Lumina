import { createRequire } from 'node:module';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { launchIsolated } from './electron-test-harness.mjs';
const require=createRequire(import.meta.url);const sharp=require('../packages/core/node_modules/sharp');const ffmpeg=require('../packages/core/node_modules/ffmpeg-static');
const session=await launchIsolated(process.argv[2],'m2-native-qa');const {desktop,page,qaRoot,command,errors}=session;
const fixtures=path.join(qaRoot,'fixtures');const pasted=path.join(qaRoot,'shell-paste');await mkdir(fixtures);await mkdir(pasted);
await sharp({create:{width:320,height:240,channels:3,background:'#3478d4'}}).jpeg().toFile(path.join(fixtures,'剪贴板测试 photo.jpg'));
for(const [name,codec] of [['seek.mp4','libx264'],['fallback.avi','ffv1']]) await new Promise((resolve,reject)=>{const process=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x180:d=10','-c:v',codec,'-pix_fmt','yuv420p',...(name.endsWith('.mp4')?['-metadata','location=+31.2300+121.4700/','-movflags','use_metadata_tags']:[]),path.join(fixtures,name)],{windowsHide:true});process.on('error',reject);process.on('exit',(code)=>code===0?resolve():reject(new Error(`fixture ${code}`)));});
let clipboardHelper;let clipboardResult;let dragResult;
try {
  await page.getByLabel('视图切换',{exact:true}).selectOption('time');
  await command({type:'roots.addAndScan',absolutePath:fixtures});await page.getByRole('button',{name:'刷新',exact:true}).click();
  const media=await command({type:'media.list'});const photo=media.find((item)=>item.kind==='photo');const mp4=media.find((item)=>item.absolutePath.endsWith('.mp4'));const avi=media.find((item)=>item.absolutePath.endsWith('.avi'));
  console.log('CHECK video byte ranges, seeking, keyboard and speed');
  const range=await page.evaluate(async(id)=>{const response=await fetch(window.lumina.mediaUrl('original',id),{headers:{Range:'bytes=0-99'}});return{status:response.status,range:response.headers.get('content-range'),bytes:(await response.arrayBuffer()).byteLength}},mp4.id);
  assert.equal(range.status,206);assert.equal(range.bytes,100);assert.match(range.range,/^bytes 0-99\//);
  await page.locator('.media-card').filter({hasText:'seek.mp4'}).dblclick();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  await page.locator('video').evaluate((video)=>{video.pause();video.currentTime=2});await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('video').currentTime>=6.9);
  await page.keyboard.press('Space');await page.waitForFunction(()=>!document.querySelector('video').paused);
  await page.locator('.viewer-controls select').first().selectOption('1.5');assert.equal(await page.locator('video').evaluate((video)=>video.playbackRate),1.5);
  await page.keyboard.press('Escape');
  console.log('CHECK generated compatibility video and video thumbnails');
  const before=await readFile(avi.absolutePath);await page.locator('.media-card').filter({hasText:'fallback.avi'}).dblclick();
  await page.waitForFunction(()=>document.querySelector('video')?.src.includes('lumina-media://playback/')); 
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2,{},{timeout:60000});assert.deepEqual(await readFile(avi.absolutePath),before);
  await page.screenshot({path:path.join(qaRoot,'video.png')});await page.keyboard.press('Escape');
  for(const item of [mp4,avi]){await page.evaluate(async(id)=>{const url=await window.lumina.thumbnail(id);await new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=reject;image.src=url})},item.id)}

  console.log('CHECK video GPS removal in exported copy, source unchanged');
  const videoMetadata=(file)=>new Promise((resolve,reject)=>{const child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-i',file,'-f','ffmetadata','pipe:1'],{windowsHide:true});let text='';child.stdout.on('data',(chunk)=>{text+=chunk});child.on('error',reject);child.on('exit',(code)=>code===0?resolve(text):reject(new Error('metadata fixture read failed')))});
  const originalVideo=await readFile(mp4.absolutePath);assert.match(await videoMetadata(mp4.absolutePath),/location=/i);
  const exporting=await command({type:'jobs.start',kind:'export',mediaIds:[mp4.id],directory:path.join(qaRoot,'video-export'),stripGps:true});
  let exported;for(let index=0;index<150;index++){exported=await command({type:'jobs.result',id:exporting.id});if(['completed','failed'].includes(exported.status))break;await new Promise((resolve)=>setTimeout(resolve,100))}
  assert.equal(exported.status,'completed');assert.doesNotMatch(await videoMetadata(exported.items[0].output),/location|GPS|ISO6709/i);assert.deepEqual(await readFile(mp4.absolutePath),originalVideo);

  console.log('CHECK native clipboard formats and Windows Shell copy (clipboard restored afterward)');
  const helperSource=await readFile(path.resolve('scripts/clipboard-verify.ps1'),'utf8');
  clipboardHelper=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(helperSource,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const lines=createInterface({input:clipboardHelper.stdout});const queue=[];let waiting;lines.on('line',(line)=>{if(waiting){const resolve=waiting;waiting=null;resolve(line)}else queue.push(line)});
  const nextLine=()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve)=>{waiting=resolve});
  let snapshotTimeout;const ready=await Promise.race([nextLine(),new Promise((resolve)=>{snapshotTimeout=setTimeout(()=>resolve('SKIP_CLIPBOARD_SNAPSHOT_TIMEOUT'),5000)})]);clearTimeout(snapshotTimeout);
  if(ready==='READY'){
    await page.evaluate((id)=>window.lumina.native({action:'copy',mediaIds:[id]}),photo.id);
    clipboardHelper.stdin.end(JSON.stringify({action:'verify',directory:pasted})+'\n');
    clipboardResult=JSON.parse(await nextLine());assert.equal(clipboardResult.fileCount,1);assert.equal(clipboardResult.effect,1);assert.equal(clipboardResult.imagePresent,true);assert.equal(clipboardResult.sourceRetained,true);assert.equal(clipboardResult.pasteExact,true);
  }else{clipboardResult={skipped:ready};if(clipboardHelper.exitCode===null)clipboardHelper.kill();}
  await new Promise((resolve,reject)=>{if(clipboardHelper.exitCode!==null || clipboardHelper.signalCode)return resolve();clipboardHelper.on('exit',(code)=>code===0 || clipboardResult?.skipped?resolve():reject(new Error(`clipboard helper ${code}`)));clipboardHelper.on('error',reject)});

  console.log('CHECK external drag IPC receives original files');
  await desktop.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.webContents.startDrag=(item)=>{globalThis.__luminaDragFiles=item.files}});
  await page.evaluate((id)=>window.lumina.startDrag([id]),photo.id);
  for(let index=0;index<30;index++){dragResult=await desktop.evaluate(()=>globalThis.__luminaDragFiles);if(dragResult)break;await new Promise((resolve)=>setTimeout(resolve,50))}
  assert.deepEqual(dragResult,[photo.absolutePath]);assert((await stat(photo.absolutePath)).isFile());
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,qaRoot,range,clipboardResult,dragPrepared:true,checks:['Range 206','video keyboard seeking','play/pause and speed','FFmpeg compatible preview','video thumbnails',...(clipboardResult?.skipped?[]:['Windows native clipboard and Shell paste']),'drag file payload preparation']}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});console.error((await session.diagnostics()).split('\n').slice(-12).join('\n'));throw error}
finally{if(clipboardHelper && !clipboardHelper.killed && clipboardHelper.exitCode===null && !clipboardHelper.stdin.writableEnded)clipboardHelper.stdin.end('{"action":"restore"}\n');await desktop.close()}
