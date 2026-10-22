import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../packages/core/node_modules/sharp'),ffmpeg=require('../packages/core/node_modules/ffmpeg-static');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-external-drag');
const deadline=setTimeout(()=>{console.error('Verification exceeded 120 seconds');void desktop.close();},120000);
page.setDefaultTimeout(12000);
const checks=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
const nav=name=>page.locator('.sidebar .nav-item').filter({hasText:name}).click();
const card=id=>page.locator(`[data-media-id="${id}"]`).filter({visible:true});
const calls=()=>desktop.evaluate(()=>globalThis.__dragCalls??[]);
async function dispatch(id,{image=false,times=1}={}){
 const previous=(await calls()).length;
 await card(id).evaluate((node,{image,times})=>{for(let i=0;i<times;i++)(image?node.querySelector('img'):node).dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}));},{image,times});
 await page.waitForFunction(()=>true);
 return previous;
}
async function delivered(previous,expected){
 await page.waitForFunction(()=>true);
 for(let i=0;i<80 && (await calls()).length===previous;i++)await page.waitForTimeout(25);
 const records=await calls();assert.equal(records.length,previous+1);assert.deepEqual(records.at(-1).files,expected);assert(records.at(-1).iconWidth>=24);return records.at(-1);
}
try{
 await command({...(await command({type:'organization.settings'})),type:'organization.configure',watch:false});
 const fixtures=path.join(qaRoot,'fixtures');await mkdir(fixtures);
 const originals=new Map();for(const name of ['中文 空格.jpg','photo-b.jpg','photo-c.jpg']){const bytes=await sharp({create:{width:160,height:120,channels:3,background:'#719ad5'}}).jpeg().toBuffer();const file=path.join(fixtures,name);await writeFile(file,bytes);originals.set(file,bytes);}
 await new Promise((resolve,reject)=>{const child=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x120:d=1','-c:v','libx264','-pix_fmt','yuv420p',path.join(fixtures,'video.mp4')],{windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('video fixture failed')));});
 await command({type:'roots.addAndScan',absolutePath:fixtures});await page.keyboard.press('F5');
 const media=await command({type:'media.list',sortBy:'name',sort:'asc'}),photo=media.find(item=>item.absolutePath.endsWith('中文 空格.jpg')),other=media.find(item=>item.absolutePath.endsWith('photo-b.jpg')),video=media.find(item=>item.kind==='video');
 await desktop.evaluate(({BrowserWindow})=>{globalThis.__dragCalls=[];const owner=BrowserWindow.getAllWindows()[0];owner.webContents.startDrag=item=>{if(globalThis.__dragFail){globalThis.__dragFail=false;throw new Error('测试原生拖出失败');}globalThis.__dragCalls.push({files:item.files,iconWidth:item.icon.getSize().width,iconPng:item.icon.toPNG().toString('base64')});};});
 await card(photo.id).waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('.library-content [data-media-id] img')].some(image=>image.complete&&image.naturalWidth>0));
 assert.equal(await card(photo.id).locator('img').first().evaluate(node=>node.draggable),false);pass('thumbnail images cannot start a browser URL/image drag instead of the original file');
 for(const view of ['immersive','time','masonry','list']){
  await page.locator('.library-content').getByLabel('视图切换',{exact:true}).selectOption(view);
  const before=await dispatch(photo.id,{image:true});await delivered(before,[photo.absolutePath]);
 }
 pass('all four views drag the original Chinese/spaced filename through the native bridge');
 const singleIcon=Buffer.from((await calls()).at(-1).iconPng,'base64');await writeFile(path.join(qaRoot,'single-drag-icon.png'),singleIcon);
 const raw=await sharp(singleIcon).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(raw.info.width,96);const pixel=(32*96+43)*4;assert(raw.data[pixel+2]-raw.data[pixel+1]>25,'drag icon must contain the actual blue photo, not the fallback document');pass('native drag icon displays the cached photo thumbnail');
 await card(photo.id).click();await card(other.id).click({modifiers:['Control']});assert.equal(await page.locator('.library-content [data-media-id].selected').count(),2);
 let before=await dispatch(photo.id);await delivered(before,[photo.absolutePath,other.absolutePath]);
 await card(photo.id).evaluate(node=>node.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal(await page.locator('.library-content [data-media-id].selected').count(),2);
 const multiIcon=Buffer.from((await calls()).at(-1).iconPng,'base64');await writeFile(path.join(qaRoot,'multi-drag-icon.png'),multiIcon);const badge=await sharp(multiIcon).extract({left:78,top:64,width:1,height:1}).raw().toBuffer();assert(badge[2]>badge[0],'multi-selection icon has the blue count badge');pass('multi-selection uses the thumbnail with a count badge');
 pass('dragging a selected item preserves the full selection and suppresses its synthetic finishing click');
 await card(other.id).click();assert.equal(await page.locator('.library-content [data-media-id].selected').count(),1);pass('the next intentional click after dragging works normally');
 before=await dispatch(video.id);await delivered(before,[video.absolutePath]);assert.equal(await page.locator('.library-content [data-media-id].selected').count(),1);assert(await card(video.id).evaluate(node=>node.classList.contains('selected')));await writeFile(path.join(qaRoot,'video-drag-icon.png'),Buffer.from((await calls()).at(-1).iconPng,'base64'));pass('dragging an unselected video replaces the outgoing selection with that video');
 before=await dispatch(photo.id,{times:3});await delivered(before,[photo.absolutePath]);await page.waitForTimeout(120);assert.equal((await calls()).length,before+1);pass('three immediate drag events issue one preparation/native drag');
 await desktop.evaluate(()=>{globalThis.__dragFail=true;});await dispatch(photo.id);await page.getByRole('status').filter({hasText:'测试原生拖出失败'}).waitFor();before=await dispatch(photo.id);await delivered(before,[photo.absolutePath]);pass('native failures produce a readable toast and release the drag lock for retry');
 const album=await command({type:'albums.edit',name:'拖出相册'});await command({type:'albums.addMedia',id:album.id,mediaIds:[photo.id,other.id]});const tag=await command({type:'tags.create',name:'拖出标签'});await command({type:'media.addTag',id:photo.id,tagName:tag.name});await nav('相册');await page.keyboard.press('F5');await page.locator('.album-cover-card').filter({hasText:'拖出相册'}).first().click();
 await card(photo.id).waitFor();before=await dispatch(photo.id);await delivered(before,[photo.absolutePath]);pass('ordinary album media shares the drag behavior');
 await nav('标签');await page.keyboard.press('F5');await page.locator(`[data-tag-id="${tag.id}"] .tag-browse`).click();await card(photo.id).waitFor();before=await dispatch(photo.id);await delivered(before,[photo.absolutePath]);pass('tag-associated media shares the drag behavior');
 await command({type:'media.hide',id:photo.id});await assert.rejects(()=>command({type:'media.delivery',mediaIds:[photo.id]}),/媒体已隐藏/);await nav('隐藏内容');await page.keyboard.press('F5');await card(photo.id).waitFor();before=await dispatch(photo.id);await delivered(before,[photo.absolutePath]);pass('the explicit hidden-content scope allows hidden originals while the ordinary scope still refuses them');
 await command({type:'media.unhide',id:photo.id});await command({type:'trash.put',mediaIds:[other.id]});await nav('回收站');await page.keyboard.press('F5');await card(other.id).waitFor();assert.equal(await card(other.id).evaluate(node=>node.draggable),false);pass('trash media is not accidentally exposed as a normal external drag');
 await nav('图库');await page.keyboard.press('F5');await card(photo.id).waitFor();await unlink(photo.absolutePath);await dispatch(photo.id);await page.getByRole('status').filter({hasText:'无法读取'}).waitFor();pass('missing originals stop the entire outgoing drag and display an actionable filename error');
 for(const [file,bytes] of originals)if(file!==photo.absolutePath && file!==other.absolutePath)assert.deepEqual(await readFile(file),bytes);
 const restored=await command({type:'trash.restore',mediaIds:[other.id]});assert(restored.every(item=>item.ok));assert.deepEqual(await readFile(other.absolutePath),originals.get(other.absolutePath));pass('dragging does not move or alter originals, tags or album membership');
 assert.equal((await command({type:'albums.media',id:album.id})).some(item=>item.id===other.id),true);
 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(qaRoot,'drag-failure-feedback.png')});
 await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,errors,claimBoundary:'Native bridge arguments and real rendered gesture handlers verified. Native startDrag is intercepted here; this does not claim Windows Explorer/WeChat accepted a real OS drop.'},null,2));
 console.log(JSON.stringify({ok:true,qaRoot,count:checks.length}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});console.error((await sessionDiagnostics()).slice(-1800));throw error;}
finally{clearTimeout(deadline);await desktop.close();}
async function sessionDiagnostics(){return readFile(path.join(qaRoot,'user-data','lumina-main.log'),'utf8').catch(()=>'');}
