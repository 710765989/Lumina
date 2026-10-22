import {createRequire} from 'node:module';
import {mkdir,copyFile,writeFile,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url);const sharp=require('../packages/core/node_modules/sharp');const ffmpeg=require('../packages/core/node_modules/ffmpeg-static');
const {desktop,page,qaRoot,command,errors,diagnostics}=await launchIsolated(process.argv[2],'m2-interactions-qa');
const checks=[];const pass=(name)=>{checks.push(name);console.log(`PASS ${name}`);};
const navigate=(name)=>page.locator('.sidebar .nav-item').filter({hasText:name}).click();
const home=page.locator('.library-content');const grid=home.locator('.grouped-media-scroll');
async function finish(id){for(let i=0;i<500;i++){const result=await command({type:'jobs.result',id});if(['completed','failed'].includes(result.status)){assert.equal(result.status,'completed',result.errorMessage);return result;}await page.waitForTimeout(40);}throw new Error('task timeout');}
async function closeViewer(){await page.keyboard.press('Escape');await page.locator('.media-viewer').waitFor({state:'hidden'});}
try{
 const fixtures=path.join(qaRoot,'fixtures');await mkdir(fixtures);
 await Promise.all(Array.from({length:211},async(_,i)=>sharp({create:{width:320,height:200,channels:3,background:{r:i,g:45+(i%60),b:(i*13)%255}}}).jpeg().toFile(path.join(fixtures,`photo-${String(i).padStart(3,'0')}.jpg`))));
 await copyFile(path.join(fixtures,'photo-000.jpg'),path.join(fixtures,'人物日常.jpg'));
 await new Promise((resolve,reject)=>{const child=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x90:d=10','-c:v','libx264','-pix_fmt','yuv420p',path.join(fixtures,'video.mp4')],{windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('video fixture')));});
 await command({type:'roots.addAndScan',absolutePath:fixtures});await home.getByRole('button',{name:'刷新',exact:true}).click();await home.locator('.media-card').first().waitFor();
 assert.equal(await page.locator('.app-header .search-builder').count(),0);assert.equal(await home.locator('.search-builder').count(),1);
 const summary=await home.locator('.page-summary').boundingBox(),searchBox=await home.locator('.search-builder').boundingBox();assert(searchBox.y>summary.y+summary.height);
 assert.equal(await home.locator('.media-meta small').count(),0);await home.locator('.video-play-badge').first().waitFor();await page.screenshot({path:path.join(qaRoot,'home-time.png')});
 pass('home title, inline search, footer refresh and video play markers align without type labels');

 const first=home.locator('.media-card').first();const id=await first.getAttribute('data-media-id');await first.locator('.media-meta').dblclick();await page.locator('.media-viewer').waitFor();
 await page.locator('.viewer-backdrop').click({position:{x:2,y:2}});await page.locator('.media-viewer').waitFor({state:'hidden'});
 await first.locator('.media-meta').dblclick();await page.locator('video').waitFor();await page.locator('video').focus();await closeViewer();
 pass('outside click closes viewer and native video control focus cannot swallow Escape');

 await home.getByLabel('视图切换').selectOption('immersive');await home.locator('.view-immersive .media-card').first().waitFor();
 assert.equal(await home.locator('.media-month-heading').count(),0);assert.equal(await home.locator('.media-meta').count(),0);
 const immersive=await home.locator('.media-card').first().boundingBox(),image=await home.locator('.media-card .media-placeholder').first().boundingBox();assert(Math.abs(immersive.height-image.height)<=4);
 await page.screenshot({path:path.join(qaRoot,'home-immersive.png')});
 const size=home.getByLabel('缩略图大小');await size.fill('280');const large=await home.locator('.media-card').first().boundingBox();assert(large.width>immersive.width);
 await size.fill('110');await grid.hover();await page.keyboard.down('Control');await page.mouse.wheel(0,140);await page.keyboard.up('Control');await home.locator('.view-list .media-row').first().waitFor();
 await page.keyboard.down('Control');await page.mouse.wheel(0,-140);await page.keyboard.up('Control');await home.locator('.view-time .media-card').first().waitFor();
 await home.getByLabel('视图切换').selectOption('list');assert(await home.locator('.media-row .media-meta small').count()>0);await page.screenshot({path:path.join(qaRoot,'home-list.png')});
 pass('time, immersive and virtual list views resize thumbnails and Ctrl-wheel transitions at minimum');

 await home.getByLabel('视图切换').selectOption('time');await size.fill('165');
 await grid.evaluate(node=>{node.scrollTop=380});const homeScroll=await grid.evaluate(node=>node.scrollTop);await navigate('相册');await navigate('主页');assert(Math.abs(await grid.evaluate(node=>node.scrollTop)-homeScroll)<2);
 await navigate('主页');assert.equal(await grid.evaluate(node=>node.scrollTop),0);
 const empty=await command({type:'albums.create',name:'空相册验收'});await home.getByRole('button',{name:'刷新',exact:true}).click();await navigate('相册');
 await page.locator('.album-cover-card').filter({hasText:'空相册验收'}).click();await page.getByRole('heading',{name:'空相册验收',exact:true}).waitFor();
 const prior=(await diagnostics()).split('"type":"albums.media"').length;await page.waitForTimeout(2200);const later=(await diagnostics()).split('"type":"albums.media"').length;assert(later-prior<=1);await page.getByText('相册暂无媒体',{exact:true}).waitFor();
 await navigate('标签');await navigate('相册');await page.getByRole('heading',{name:'空相册验收',exact:true}).waitFor();await page.keyboard.press('Backspace');await page.getByRole('heading',{name:'相册',exact:true}).waitFor();
 await page.locator('.album-cover-card').filter({hasText:'空相册验收'}).click();await navigate('相册');await page.getByRole('heading',{name:'相册',exact:true}).waitFor();
 pass('empty albums stop refreshing; switching pages retains state, active-menu click resets, Backspace goes up');

 const tags=[];for(let i=0;i<12;i++){const tag=await command({type:'tags.create',name:i===0?'人':i===1?'日':`最近标签${i}`});tags.push(tag);await command({type:'media.addTag',id,tagName:tag.name});}
 await navigate('主页');await home.getByRole('button',{name:'刷新',exact:true}).click();
 await home.locator('.media-card').first().click();await home.getByRole('button',{name:'编辑标签',exact:true}).click();let editor=page.getByRole('dialog',{name:'编辑标签',exact:true});assert.equal(await editor.getByLabel('连续添加',{exact:true}).isChecked(),false);await editor.getByLabel('连续添加',{exact:true}).check();const input=editor.getByRole('combobox',{name:'标签名称'});const popup=page.locator('#add-tag-suggestions');
 await input.click();await popup.waitFor();assert.equal(await popup.getByRole('option').count(),10);await input.fill('r');await popup.getByRole('option',{name:'#人',exact:true}).waitFor();await popup.getByRole('option',{name:'#日',exact:true}).waitFor();
 await popup.getByRole('option',{name:'#人',exact:true}).click();await popup.waitFor({state:'hidden'});await page.waitForTimeout(250);assert.equal(await popup.count(),0);
 const pill=editor.locator('.dialog-tag').filter({hasText:'#人'});await pill.getByRole('button').click();await pill.waitFor({state:'hidden'});await editor.getByRole('button',{name:'完成',exact:true}).click();
 const search=home.locator('.search-builder input');await search.focus();await home.locator('.search-mode-menu').getByRole('button',{name:'标签',exact:true}).click();await search.fill('r');await home.getByRole('listbox',{name:'标签建议'}).getByRole('option',{name:'#日',exact:true}).waitFor();
 await search.press('Backspace');await search.fill('');await search.press('Backspace');await page.locator('.app-brand').click();await navigate('主页');
 pass('merged tag editor uses x removal, ten recent tags, Chinese initials and closes after automatic commit');

 await home.locator('.media-card').first().click();await page.keyboard.press('Control+a');const selectedText=await home.locator('.selection-count').textContent();assert.match(selectedText,/已选择 (2\d\d|1\d\d) 项/);
 await home.getByRole('button',{name:'编辑标签',exact:true}).click();editor=page.getByRole('dialog',{name:'编辑标签',exact:true});assert(await editor.getByLabel('连续添加',{exact:true}).isChecked());await editor.getByLabel('连续添加',{exact:true}).uncheck();await editor.getByRole('combobox',{name:'标签名称'}).fill('日');await popup.getByRole('option',{name:'#日',exact:true}).click();
 await page.getByRole('dialog',{name:'任务进度',exact:true}).waitFor();assert.equal(await popup.count(),0);await page.waitForTimeout(350);assert.equal(await popup.count(),0);
 await page.getByRole('dialog',{name:'任务进度',exact:true}).getByText(/已完成/).waitFor();await editor.waitFor({state:'hidden'});await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'任务进度',exact:true}).waitFor({state:'hidden'});assert.equal(await popup.count(),0);
 pass('candidate click auto-submits a bulk tag job and never reopens suggestions above progress');

 await home.locator('.media-card').filter({hasText:'photo-210.jpg'}).first().locator('.media-meta').dblclick();await page.locator('.viewer-photo.ready').waitFor();
 await page.getByRole('button',{name:'幻灯片',exact:true}).click();await page.locator('.viewer-controls').locator('label').filter({hasText:'间隔'}).locator('select').selectOption('15');
 await page.locator('.viewer-controls > select').first().selectOption('random');await page.locator('.viewer-controls > select').nth(1).selectOption('none');await closeViewer();
 await home.locator('.media-card').filter({hasText:'photo-210.jpg'}).first().locator('.media-meta').dblclick();await page.getByRole('button',{name:'幻灯片',exact:true}).click();assert.equal(await page.locator('.viewer-controls').locator('label').filter({hasText:'间隔'}).locator('select').inputValue(),'15');
 await page.getByLabel('全屏幻灯片',{exact:true}).check();await page.waitForFunction(()=>Boolean(document.fullscreenElement));await page.locator('.media-viewer.presentation-mode').waitFor();
 await page.mouse.move(650,350);await page.waitForTimeout(750);assert.equal(await page.locator('.viewer-head').evaluate(node=>getComputedStyle(node).visibility),'hidden');
 await page.mouse.move(650,12);await page.waitForTimeout(200);assert.equal(await page.locator('.viewer-head').evaluate(node=>getComputedStyle(node).visibility),'visible');
 await page.screenshot({path:path.join(qaRoot,'slideshow-hover-controls.png')});await closeViewer();await page.waitForFunction(()=>!document.fullscreenElement);
 pass('slideshow settings persist across viewer sessions; fullscreen hides UI and reveals it near edges');

 await navigate('常规');const taskPanel=page.locator('.task-panel');await taskPanel.locator('.task-row').first().waitFor();assert.equal(await taskPanel.locator('.task-row').count(),10);await taskPanel.getByRole('button',{name:'下一页',exact:true}).click();assert.equal(await taskPanel.locator('.task-row').count(),10);await taskPanel.getByText(/2 \/ \d+/).waitFor();
 pass('task history uses real ten-item backend pages');

 await navigate('重复检测');let job=await command({type:'jobs.start',kind:'duplicates'});await finish(job.id);await page.locator('.duplicate-page').getByRole('button',{name:'刷新',exact:true}).click();
 await page.locator('.duplicate-summary').getByRole('button',{name:'删除重复',exact:true}).click();let deletion=page.getByRole('dialog',{name:'从图库删除',exact:true});await deletion.locator('.cleanup-preview > strong').filter({hasText:/本次删除 \d+ 个文件 · 占用/}).waitFor();await deletion.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'相似照片',exact:true}).click();job=await command({type:'jobs.start',kind:'similar'});await finish(job.id);await page.locator('.duplicate-page').getByRole('button',{name:'刷新',exact:true}).click();
 const choices=page.locator('.similar-delete-choice input');await choices.first().waitFor();assert.equal(await page.locator('.similar-mode .smart-badge').count(),0);const checked=await choices.evaluateAll(nodes=>nodes.filter(node=>node.checked).length);assert(checked>1);
 await page.locator('.similar-delete-choice input:checked').first().uncheck();await page.locator('.duplicate-summary').getByRole('button',{name:'删除相似',exact:true}).click();deletion=page.getByRole('dialog',{name:'从图库删除',exact:true});await deletion.locator('.cleanup-preview > strong').waitFor();await page.screenshot({path:path.join(qaRoot,'similar-selection-confirm.png')});await deletion.getByRole('button',{name:'取消',exact:true}).click();
 pass('each detection page opens its own deletion confirmation directly; similar files have deletion checkboxes');

 await navigate('标签');await page.getByPlaceholder('搜索标签...').waitFor();await navigate('主页');await home.locator('.media-card').first().click();await home.getByRole('button',{name:'删除',exact:true}).click();deletion=page.getByRole('dialog',{name:'从图库删除',exact:true});await deletion.getByRole('button',{name:'确认删除',exact:true}).click();await deletion.waitFor({state:'hidden'});
 const toast=await page.locator('.undo-toast').boundingBox(),footer=await home.locator('.selection-bar').boundingBox();assert(toast.y+toast.height<footer.y);await page.screenshot({path:path.join(qaRoot,'toast-above-footer.png')});await page.getByRole('button',{name:'撤销删除',exact:true}).click();
 pass('home deletion toast stays above the footer and supports undo');
 assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot,checks}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});console.error((await diagnostics()).slice(-9000));throw error;}finally{await desktop.close();}
