import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../packages/core/node_modules/sharp');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-dropdowns-qa');page.setDefaultTimeout(15000);
const home=page.locator('.library-content'),checks=[];const pass=name=>{checks.push(name);console.log(`PASS ${name}`);};
try{
 const fixtures=path.join(qaRoot,'fixtures');await mkdir(fixtures);await sharp({create:{width:64,height:48,channels:3,background:'blue'}}).jpeg().toFile(path.join(fixtures,'test.jpg'));await command({type:'roots.addAndScan',absolutePath:fixtures});const [media]=await command({type:'media.list'});await command({type:'media.addTag',id:media.id,tagName:'候选'});const album=await command({type:'albums.create',name:'菜单验收'});await command({type:'albums.addMedia',id:album.id,mediaIds:[media.id]});await home.getByRole('button',{name:'刷新',exact:true}).click();await home.locator('.media-card').waitFor();
 const search=home.locator('.search-builder input'),mode=home.locator('.search-mode-menu'),sort=home.locator('.sort-menu');
 await search.focus();await mode.waitFor();await home.locator('.page-summary').click();await mode.waitFor({state:'hidden'});
 await search.focus();await mode.waitFor();for(let n=0;n<4;n++)await page.keyboard.press('Tab');await mode.waitFor({state:'hidden'});
 await search.focus();await mode.waitFor();await home.locator('.sort-label').focus();await mode.waitFor({state:'hidden'});
 await home.locator('.sort-label').click();await sort.waitFor();await sort.getByRole('option').last().focus();await sort.waitFor();await page.keyboard.press('Tab');await sort.waitFor({state:'hidden'});
 await home.locator('.sort-label').click();await sort.waitFor();await search.focus();await sort.waitFor({state:'hidden'});await mode.waitFor();await home.locator('.sort-label').click();await sort.waitFor();await mode.waitFor({state:'hidden'});await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await sort.waitFor({state:'hidden'});
 pass('search and sort close on blank clicks, keyboard Tab, external focus, competing controls and window blur');
 await home.locator('.media-card').click();await home.getByRole('button',{name:'编辑标签',exact:true}).click();const editor=page.getByRole('dialog',{name:'编辑标签',exact:true}),input=editor.getByRole('combobox'),popup=page.locator('#add-tag-suggestions');await input.click();await popup.waitFor();await editor.getByLabel('连续添加',{exact:true}).focus();await popup.waitFor({state:'hidden'});await input.click();await popup.waitFor();await popup.getByRole('option').first().focus();await popup.waitFor();await editor.getByRole('button',{name:'完成',exact:true}).focus();await popup.waitFor({state:'hidden'});await editor.getByRole('button',{name:'完成',exact:true}).click();
 pass('portal tag suggestions remain open for internal focus and close when focus enters another dialog control');
 await home.locator('.media-card').click({button:'right'});const context=page.locator('.context-menu');await context.waitFor();await context.getByRole('button',{name:'打开',exact:true}).focus();await context.waitFor();await home.getByLabel('视图切换').focus();await context.waitFor({state:'hidden'});
 pass('media context menu closes when focus moves to another module');
 await page.locator('.sidebar .nav-item').filter({hasText:'相册'}).click();await page.locator('.album-cover-card').filter({hasText:'菜单验收'}).click();const more=page.getByRole('button',{name:'相册更多操作'}),albumMenu=page.getByRole('menu',{name:'相册操作',exact:true});await more.click();await albumMenu.waitFor();await albumMenu.getByRole('menuitem',{name:'编辑相册',exact:true}).focus();await albumMenu.waitFor();await page.getByRole('button',{name:'返回',exact:true}).focus();await albumMenu.waitFor({state:'hidden'});await more.click();await albumMenu.waitFor();await page.getByRole('heading',{name:'菜单验收',exact:true}).click();await albumMenu.waitFor({state:'hidden'});await more.click();await albumMenu.getByRole('menuitem',{name:'编辑相册',exact:true}).click();await albumMenu.waitFor({state:'hidden'});await page.getByRole('dialog',{name:'编辑相册',exact:true}).waitFor();await page.keyboard.press('Escape');
 pass('album menu closes on outside click or focus change and selecting an item still opens its dialog');
 assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot,checks}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});throw error;}finally{await desktop.close();}
