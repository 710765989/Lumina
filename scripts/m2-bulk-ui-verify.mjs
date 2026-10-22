import {createRequire} from 'node:module';
import {mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url);const sharp=require('../apps/desktop/node_modules/sharp');
const session=await launchIsolated(process.argv[2],'m2-bulk-qa');const {desktop,page,command,qaRoot,errors}=session;
try{
 const root=path.join(qaRoot,'fixtures');await mkdir(root);const original=path.join(root,'photo-0000.jpg');await sharp({create:{width:72,height:48,channels:3,background:'#2874df'}}).jpeg().toFile(original);
 await Promise.all(Array.from({length:1004},(_,index)=>copyFile(original,path.join(root,`photo-${String(index+1).padStart(4,'0')}.jpg`))));
 await command({type:'roots.addAndScan',absolutePath:root});const album=await command({type:'albums.create',name:'千项批量测试'});await page.getByRole('button',{name:'刷新',exact:true}).click();
 for(let index=0;index<30;index++){if(await page.locator('.grouped-media-canvas[data-total="1005"]').count())break;await page.locator('.grouped-media-scroll').evaluate(node=>{node.scrollTop=node.scrollHeight});await page.waitForTimeout(150);}
 await page.waitForFunction(()=>document.querySelector('.grouped-media-canvas')?.dataset.total==='1005');await page.locator('.media-card').first().locator('.media-meta').click();await page.keyboard.press('Control+a');await page.locator('.selection-bar').getByText('已选择 1005 项',{exact:true}).waitFor();
 await page.getByRole('button',{name:'加入相册',exact:true}).click();const picker=page.getByRole('dialog',{name:'加入相册',exact:true});await picker.getByLabel('千项批量测试').check();await picker.getByRole('button',{name:'加入相册',exact:true}).click();await picker.waitFor({state:'hidden'});
 assert.equal((await command({type:'albums.media',id:album.id,limit:1000})).length,1000);assert.equal((await command({type:'albums.media',id:album.id,offset:1000,limit:1000})).length,5);
 await page.locator('.media-card').first().locator('.media-meta').click();await page.keyboard.press('Control+a');await page.getByRole('button',{name:'编辑标签',exact:true}).click();await page.getByRole('dialog',{name:'编辑标签',exact:true}).getByLabel('连续添加',{exact:true}).check();await page.locator('.tag-dialog input').fill('千项标签');await page.locator('.tag-dialog').getByRole('button',{name:'添加',exact:true}).click();
 const progress=page.getByRole('dialog',{name:'任务进度'});await progress.getByText(/已完成/).waitFor({timeout:30000});await progress.getByRole('button',{name:'关闭',exact:true}).click();await page.locator('.dialog-tag').filter({hasText:'千项标签'}).waitFor();
 const ids=(await command({type:'albums.media',id:album.id,limit:1000})).map(item=>item.id);assert.equal((await command({type:'media.tagSummary',mediaIds:ids})).find(tag=>tag.name==='千项标签').count,1000);
 await page.locator('.tag-dialog').getByRole('button',{name:'完成',exact:true}).click();
 await page.locator('.sidebar .nav-item').filter({hasText:'相册'}).click();await page.getByRole('button',{name:'+新建智能相册',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'新建智能相册',exact:true});const area=editor.locator('.rule-tag-options').first();assert((await area.boundingBox()).height>=48);
 await editor.getByLabel('相册名称',{exact:true}).fill('过期预览测试');await editor.getByLabel('千项标签',{exact:true}).first().check();await editor.getByText('当前匹配 1005 项',{exact:true}).waitFor();
 await command({type:'media.removeTag',id:ids[0],tagName:'千项标签'});await editor.getByRole('button',{name:'保存',exact:true}).click();await editor.getByText(/匹配结果已变化/).waitFor();assert.equal(await editor.getByRole('button',{name:'保存',exact:true}).isEnabled(),false);
 await editor.getByRole('button',{name:'重新计算预览',exact:true}).click();await editor.getByText('当前匹配 1004 项',{exact:true}).waitFor();assert.equal(await editor.getByRole('button',{name:'保存',exact:true}).isEnabled(),true);await page.screenshot({path:path.join(qaRoot,'rule-layout.png')});
 await page.keyboard.press('Escape');await editor.waitFor({state:'hidden'});assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,qaRoot,checks:['1005 media automatic pages','Ctrl A selection','1005 album joins in safe chunks','persistent bulk tag task','aggregate tag counts','rule chip area remains visible','Esc album dialog']}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});throw error;}finally{await desktop.close();}
