// Interactive Windows smoke test: use a real mouse drag into the independent
// receiver window. No startDrag interception, synthetic drop, or real user data.
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../packages/core/node_modules/sharp');
const {_electron:electron}=require(process.env.LUMINA_PLAYWRIGHT_PATH||'playwright');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-external-drag-native');
let receiver;
try{
 await command({...(await command({type:'organization.settings'})),type:'organization.configure',watch:false});
 const fixtures=path.join(qaRoot,'fixtures'),received=path.join(qaRoot,'received');await mkdir(fixtures);await mkdir(received);
 await mkdir(path.join(qaRoot,'receiver-data'));
 const source=path.join(fixtures,'中文 空格.jpg');await sharp({create:{width:320,height:220,channels:3,background:'#719ad5'}}).jpeg().toFile(source);
 const second=path.join(fixtures,'second.jpg');await sharp({create:{width:320,height:220,channels:3,background:'#3fbc8f'}}).jpeg().toFile(second);
 const video=path.join(fixtures,'video.mp4'),ffmpeg=require('../packages/core/node_modules/ffmpeg-static');
 await new Promise((resolve,reject)=>{const child=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x120:d=1','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('fixture failed')));});
 await command({type:'roots.addAndScan',absolutePath:fixtures});await page.keyboard.press('F5');
 const media=await command({type:'media.list',sortBy:'name',sort:'asc'}),photo=media.find(item=>item.absolutePath===source);
 const card=id=>page.locator(`[data-media-id="${id}"]:visible`);await card(photo.id).waitFor();
 await desktop.evaluate(({BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows()[0],area=screen.getPrimaryDisplay().workArea;w.unmaximize();w.setBounds({x:area.x+30,y:area.y+30,width:1280,height:800});w.setTitle('Lumina drag-out QA source');});
 const receiverMain=path.join(qaRoot,'receiver.cjs'),preload=path.join(qaRoot,'receiver-preload.cjs'),log=path.join(qaRoot,'received.json');
 await writeFile(preload,`const {ipcRenderer,webUtils}=require('electron');window.addEventListener('DOMContentLoaded',()=>{document.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});document.addEventListener('drop',async e=>{e.preventDefault();const result=await ipcRenderer.invoke('receive',[...e.dataTransfer.files].map(f=>webUtils.getPathForFile(f)));document.body.textContent='Received '+result+' original files. Ready for next drop.';});});`);
 await writeFile(receiverMain,`const {app,BrowserWindow,ipcMain,screen}=require('electron');const fs=require('node:fs'),path=require('node:path');app.setPath('userData',${JSON.stringify(path.join(qaRoot,'receiver-data'))});let count=0,records=[];ipcMain.handle('receive',async(e,files)=>{const allowed=${JSON.stringify(media.map(m=>m.absolutePath))};if(!files.length||files.some(f=>!allowed.includes(f)))throw Error('Fixture-only receiver');const target=path.join(${JSON.stringify(received)},String(++count));fs.mkdirSync(target);for(const file of files)fs.copyFileSync(file,path.join(target,path.basename(file)),fs.constants.COPYFILE_EXCL);records.push({files,target});fs.writeFileSync(${JSON.stringify(log)},JSON.stringify(records));return files.length;});app.whenReady().then(()=>{const area=screen.getPrimaryDisplay().workArea;const w=new BrowserWindow({x:area.x+870,y:area.y+320,width:400,height:360,alwaysOnTop:true,title:'Lumina QA external file receiver',webPreferences:{preload:${JSON.stringify(preload)}}});w.loadURL('data:text/html,'+encodeURIComponent('<title>Lumina QA external file receiver</title><body style="background:#dceafd;color:#174e8b;font:24px sans-serif;padding:28px">Drop test files here<br><br>Independent receiving process<br>Only generated QA fixtures accepted</body>'));});app.on('window-all-closed',()=>app.quit());`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 receiver=await electron.launch({executablePath:path.resolve('apps/desktop/node_modules/electron/dist/electron.exe'),args:[receiverMain],env,timeout:30000});await receiver.firstWindow();
 await card(photo.id).click();await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());
 console.log(JSON.stringify({ready:'single',qaRoot,photoId:photo.id}));
 async function waitDrops(n){for(let i=0;i<120;i++){const rows=await readFile(log,'utf8').then(JSON.parse).catch(()=>[]);if(rows.length>=n)return rows;await page.waitForTimeout(500);}throw new Error('Real mouse drop timed out');}
 let rows=await waitDrops(1);assert.deepEqual(rows[0].files,[source]);
 // Select exactly all three fixtures, independent of the previous selection.
 await card(photo.id).click();for(const item of media.filter(item=>item.id!==photo.id))await card(item.id).click({modifiers:['Control']});
 assert.equal(await page.locator('[data-media-id].selected:visible').count(),3);console.log('READY multi: drag the same photo again');
 rows=await waitDrops(2);assert.deepEqual([...rows[1].files].sort(),media.map(item=>item.absolutePath).sort());
 for(const row of rows)for(const file of row.files)assert.deepEqual(await readFile(path.join(row.target,path.basename(file))),await readFile(file));
 assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks:['real Windows native single photo drop to independent process','real multi-photo/video file drop to independent process','receiver copied identical original bytes; source files retained'],records:rows,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot}));
}finally{await receiver?.close();await desktop.close();}
