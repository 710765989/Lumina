import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../apps/desktop/node_modules/sharp');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-recycle-layout');
const deadline=setTimeout(()=>{console.error('Verification exceeded 120 seconds');void desktop.close();},120000);
page.setDefaultTimeout(12000);
const checks=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
const navigate=name=>page.locator('.sidebar .nav-item').filter({hasText:name}).click();
try{
 await command({...(await command({type:'organization.settings'})),type:'organization.configure',watch:false});
 const root=path.join(qaRoot,'fixtures');await mkdir(root);
 for(let i=0;i<5;i++)await sharp({create:{width:600+i*30,height:400,channels:3,background:['#85b5ed','#e0ba95','#a4c7ad','#b7acda','#d9b1bd'][i]}}).jpeg().toFile(path.join(root,`完整文件名称-very-long-photo-name-${i}.jpg`));
 await command({type:'roots.addAndScan',absolutePath:root});const media=await command({type:'media.list'});
 for(const item of media)for(const tagName of ['人物','较长的标签一','标签二'])await command({type:'media.addTag',id:item.id,tagName});
 await page.keyboard.press('F5');const home=page.locator('.library-content'),card=home.locator('[data-media-id]').first();await card.waitFor();
 for(const view of ['immersive','time','masonry'])for(const size of ['110','320']){
  await home.getByLabel('视图切换',{exact:true}).selectOption(view);
  await home.getByLabel('缩略图大小',{exact:true}).fill(size);await card.hover();
  await page.waitForTimeout(200);
  const info=await card.locator('.immersive-media-overlay').evaluate(node=>({height:node.getBoundingClientRect().height,scroll:node.scrollHeight,client:node.clientHeight,tag:node.querySelector('.immersive-tag-list').getBoundingClientRect().height}));
  assert(Math.abs(info.height-34)<.1);assert(Math.abs(info.tag-14)<.1);assert(info.scroll<=info.client);
 }
 await page.screenshot({path:path.join(qaRoot,'gallery-compact-info.png')});pass('gallery information panel stays 34px at both thumbnail extremes in all three grid views');
 await navigate('标签');await page.keyboard.press('F5');const tags=await command({type:'tags.list'}),tag=tags.find(row=>row.name==='人物');
 await page.locator(`[data-tag-id="${tag.id}"]`).getByRole('button',{name:'编辑标签 人物',exact:true}).click();const editor=page.getByRole('dialog',{name:'编辑标签',exact:true});
 const search=editor.getByLabel('搜索父标签',{exact:true}),box=await search.boundingBox();assert(box.width<=280.1);assert(Math.abs(box.height-30)<.1);await search.fill('标签');await editor.getByRole('checkbox',{name:'父标签 标签二',exact:true}).waitFor();await page.screenshot({path:path.join(qaRoot,'parent-search-compact.png')});await editor.getByRole('button',{name:'取消',exact:true}).click();pass('parent search is 280px by 30px and still filters matching parents');
 const rule={relation:'AND',tags:[tag.id],notTags:[],excludedMediaIds:[]},preview=await command({type:'smart.preview',rule}),album=await command({type:'smart.save',name:'排除项布局验收',rule,revision:preview.revision});await command({type:'smart.exclude',id:album.id,mediaIds:[media[0].id]});
 await navigate('相册');await page.keyboard.press('F5');await page.locator('.album-caption strong').filter({hasText:album.name}).click();await page.getByRole('button',{name:/管理排除项/}).click();const dialog=page.getByRole('dialog',{name:'管理排除项',exact:true});await dialog.getByRole('button',{name:'恢复',exact:true}).waitFor();
 async function checkDialog(){const bounds=await dialog.boundingBox(),body=await dialog.locator('.smart-exclusions-body').boundingBox(),list=await dialog.locator('.smart-exclusions-list').boundingBox();assert(list.x-bounds.x>=21);assert(bounds.x+bounds.width-list.x-list.width>=21);assert(body.y>=bounds.y);assert.equal(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth),true);const footer=await dialog.locator('.dialog-footer').boundingBox();assert(footer.y+footer.height<=bounds.y+bounds.height+1);assert(bounds.y>=0&&bounds.y+bounds.height<=await page.evaluate(()=>innerHeight)+1);}
 await checkDialog();await page.screenshot({path:path.join(qaRoot,'exclusions-populated.png')});pass('populated exclusion dialog has aligned body padding and no horizontal or footer overflow');
 await dialog.getByRole('button',{name:'恢复',exact:true}).click();await dialog.getByText('没有排除项',{exact:true}).waitFor();await checkDialog();const empty=await dialog.getByText('没有排除项',{exact:true}).boundingBox();assert(empty.height>=100);await page.screenshot({path:path.join(qaRoot,'exclusions-empty.png')});pass('empty exclusions use a padded centered state with pagination and footer inside the dialog');
 await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,640));await page.waitForTimeout(200);await checkDialog();await page.screenshot({path:path.join(qaRoot,'exclusions-small-window.png')});pass('exclusion dialog remains within the minimum supported window');await dialog.getByRole('button',{name:'完成',exact:true}).click();await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1200,800));
 await command({type:'trash.put',mediaIds:media.slice(0,2).map(item=>item.id)});
 await navigate('回收站');await page.keyboard.press('F5');const trash=page.locator('.recycle-page'),select=trash.getByLabel('视图切换',{exact:true}),slider=trash.getByLabel('缩略图大小',{exact:true});await trash.locator('.media-row').first().waitFor();assert.equal(await select.inputValue(),'list');pass('fresh recycle bin still defaults to list view');
 async function wheel(delta){const target=trash.locator('.grouped-media-scroll'),bounds=await target.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+35);await page.keyboard.down('Control');await page.mouse.wheel(0,delta);await page.keyboard.up('Control');await page.waitForTimeout(180);}
 await wheel(-100);assert.equal(await select.inputValue(),'immersive');assert.equal(await slider.inputValue(),'110');await wheel(-100);assert.equal(await slider.inputValue(),'125');await wheel(100);assert.equal(await slider.inputValue(),'110');await wheel(100);assert.equal(await select.inputValue(),'list');pass('Ctrl wheel enlarges recycle thumbnails, shrinks them and crosses the list threshold');
 await select.selectOption('time');await slider.fill('110');await wheel(100);assert.equal(await select.inputValue(),'list');await wheel(-100);assert.equal(await select.inputValue(),'time');assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()),1);pass('Ctrl wheel restores the previous recycle grid view without changing application zoom');
 for(const view of ['immersive','time','masonry']){
  await select.selectOption(view);await slider.fill('220');await trash.locator('h2').hover();await page.waitForTimeout(220);
  const cards=trash.locator('.media-card');for(let i=0;i<await cards.count();i++){
   const item=cards.nth(i),overlay=item.locator('.immersive-media-overlay');assert(await overlay.isVisible());const rect=await overlay.boundingBox();assert(Math.abs(rect.height-50)<.1);
   const badge=overlay.locator('.media-expiry');await badge.getByText(/剩余.*天|已到期|不过期/).waitFor();const badgeBox=await badge.boundingBox(),tagBox=await overlay.locator('.immersive-tag-list').boundingBox();assert(badgeBox.y>=tagBox.y+tagBox.height);assert.equal(await item.locator(':scope>.media-expiry').count(),0);
  }
  await page.screenshot({path:path.join(qaRoot,`recycle-${view}-fixed-info.png`)});
 }
 pass('all recycle grid views permanently show filename, one tag row and expiry on the last line');
 await select.selectOption('list');assert.equal(await trash.locator('.media-row .media-meta .media-expiry').count(),2);assert.equal(await trash.getByRole('button',{name:'还原',exact:true}).count(),2);pass('recycle list keeps expiry under filename and tags and preserves per-row actions');
 assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify({qaRoot,checks:checks.length,errors}));
}finally{clearTimeout(deadline);await desktop.close();}
