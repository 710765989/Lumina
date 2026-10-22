import {createRequire} from 'node:module';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url);const sharp=require('../packages/core/node_modules/sharp');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-recheck-fixed');
const checks=[];const checked=(name)=>{checks.push(name);console.log(`PASS ${name}`);};
const navigate=(name)=>page.locator('.sidebar .nav-item').filter({hasText:name}).click();
const search=page.locator('.search-builder input');
const openFirst=async()=>{await page.locator('.media-card').first().locator('.media-meta').dblclick();await page.locator('.viewer-photo.ready').waitFor();};
const clearSearch=async()=>{
  while(await page.locator('.search-chip button').count())await page.locator('.search-chip button').first().click();
  await search.fill('');await search.press('Backspace');await page.locator('.app-brand').click();
  await page.getByRole('button',{name:'刷新',exact:true}).click();
};
const chooseMode=async(name)=>{await search.focus();await search.fill('');await search.press('Backspace');await page.locator('.search-mode-menu').getByRole('button',{name,exact:true}).click();};
try {
  const root=path.join(qaRoot,'fixtures');await mkdir(root);const photo=path.join(root,'photo-000.jpg');
  await sharp({create:{width:320,height:200,channels:3,background:'#3478d4'}}).jpeg().toFile(photo);
  await Promise.all(Array.from({length:204},(_,i)=>copyFile(photo,path.join(root,`photo-${String(i+1).padStart(3,'0')}.jpg`))));
  await command({type:'roots.addAndScan',absolutePath:root});
  const ids=await command({type:'media.playlist',source:{scope:'library',sortBy:'fileTime',sort:'desc'}});assert.equal(ids.length,205);
  for(const id of [ids[0],ids[204]])await command({type:'media.addTag',id,tagName:'审计标签'});
  await page.getByRole('button',{name:'刷新',exact:true}).click();await page.locator('.media-card').first().waitFor();

  await chooseMode('标签');await search.fill('审计');await page.locator('.search-tag-suggestions').waitFor();
  await page.locator('.app-brand').click();assert.equal(await page.locator('.search-tag-suggestions').count(),0);
  await search.focus();await page.locator('.search-tag-suggestions').waitFor();
  await search.press('ArrowDown');await search.press('ArrowUp');await search.press('Enter');
  await page.locator('.search-chip').filter({hasText:'审计标签'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.library-subtitle')?.textContent?.includes('2') || document.querySelectorAll('.media-card').length===2);
  assert.equal(await page.locator('.media-card').count(),2);checked('tag suggestions close outside and support keyboard commit');

  await clearSearch();await chooseMode('标签排除');await search.fill('审计');
  await page.locator('.search-tag-suggestions button').first().click();
  await page.locator('.search-chip').filter({hasText:'标签排除'}).waitFor();
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  const visible=await page.locator('.media-card').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-media-id')));
  assert(visible.length>0);assert(!visible.includes(ids[0]));assert(!visible.includes(ids[204]));
  const galleryIds=await page.locator('.media-card').first().evaluate(node=>{let fiber=node[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))];while(fiber){if(Array.isArray(fiber.memoizedProps?.items))return fiber.memoizedProps.items.map(item=>item.id);fiber=fiber.return;}return [];});
  assert.equal(galleryIds.length,200);assert(!galleryIds.includes(ids[0]));checked('excluded tags are not accidentally repeated as a positive text query');

  await clearSearch();await page.locator('.media-card').first().locator('.media-meta').click();
  await page.getByRole('button',{name:'编辑标签',exact:true}).click();await page.getByRole('dialog',{name:'编辑标签',exact:true}).getByLabel('连续添加',{exact:true}).check();await page.getByRole('dialog',{name:'编辑标签',exact:true}).waitFor();
  await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'编辑标签',exact:true}).waitFor({state:'hidden'});
  checked('tag dialog Escape closes the dialog');

  const first=(await command({type:'media.list',limit:1}))[0];
  await command({type:'media.attributes',id:first.id,country:'CN',region:'上海',city:'上海'});
  await openFirst();await page.getByRole('button',{name:'详情',exact:true}).click();
  const info=page.locator('.viewer-info');await info.getByLabel('显示名称',{exact:true}).fill('复查保存名称');
  await info.locator('label').filter({hasText:'评分'}).locator('select').selectOption('4');await info.getByRole('button',{name:'保存整理信息',exact:true}).click();
  await page.locator('.viewer-head strong').filter({hasText:'复查保存名称'}).waitFor();
  await page.keyboard.press('Escape');await page.locator('.media-viewer').waitFor({state:'hidden'});
  await page.locator('.media-card strong').filter({hasText:'复查保存名称'}).waitFor();
  assert.equal((await command({type:'media.details',id:first.id})).metadata.rating,4);
  checked('saved display name appears immediately in viewer and then gallery');

  await openFirst();await page.locator('.viewer-head span').filter({hasText:'1 / 205'}).waitFor();
  await page.locator('.viewer-head').click();await page.keyboard.press('End');
  await page.locator('.viewer-head span').filter({hasText:'205 / 205'}).waitFor();await page.locator('.viewer-photo.ready').waitFor();
  assert((await page.locator('.filmstrip button').count())<=21);await page.keyboard.press('ArrowLeft');
  await page.locator('.viewer-head span').filter({hasText:'204 / 205'}).waitFor();
  checked('End and previous traverse beyond the first gallery page with bounded filmstrip');
  await page.keyboard.press('Home');await page.locator('.viewer-head span').filter({hasText:'1 / 205'}).waitFor();
  await page.getByRole('button',{name:'幻灯片',exact:true}).click();
  await page.locator('.viewer-controls select').first().selectOption('3');await page.locator('.viewer-controls select').nth(1).selectOption('random');
  await page.evaluate(()=>{window.__luminaSavedRandom=Math.random;Math.random=()=>.999999;});
  await page.locator('.viewer-head span').filter({hasText:'205 / 205'}).waitFor({timeout:9000});
  await page.getByRole('button',{name:'停止幻灯片',exact:true}).click();
  await page.evaluate(()=>{Math.random=window.__luminaSavedRandom;});
  await page.screenshot({path:path.join(qaRoot,'random-beyond-first-page.png')});
  checked('random slideshow reaches the actual 205th item without paging the gallery');
  await page.waitForFunction(()=>document.querySelectorAll('.filmstrip button').length>1);
  await page.locator('.viewer-head').getByRole('button',{name:'删除',exact:true}).click();
  const deletion=page.getByRole('dialog',{name:'从图库删除',exact:true});await deletion.waitFor();
  await deletion.getByRole('button',{name:'确认删除',exact:true}).click();await deletion.waitFor({state:'hidden'});
  await page.locator('.viewer-head span').filter({hasText:'204 / 204'}).waitFor();
  assert.equal((await command({type:'trash.list'}))[0].id,ids[204]);
  checked('deleting an item beyond the gallery page selects its actual neighbor and updates the playlist total');
  await page.keyboard.press('Escape');await page.locator('.media-viewer').waitFor({state:'hidden'});
  assert.equal((await command({type:'trash.restore',mediaIds:[ids[204]]}))[0].ok,true);

  await navigate('标签');await page.getByRole('button',{name:'#审计标签',exact:true}).click();await openFirst();
  await page.locator('.viewer-head span').filter({hasText:'1 / 2'}).waitFor();
  await page.getByRole('button',{name:'幻灯片',exact:true}).click();
  await page.locator('.viewer-controls select').first().selectOption('3');await page.locator('.viewer-controls select').nth(1).selectOption('random');
  await page.getByLabel('循环',{exact:true}).uncheck();
  await page.locator('.viewer-head span').filter({hasText:'2 / 2'}).waitFor({timeout:9000});
  await page.getByRole('button',{name:'幻灯片',exact:true}).waitFor({timeout:9000});
  checked('tag scope stays filtered and non-loop random playback stops after every item');
  await page.keyboard.press('Escape');await page.locator('.media-viewer').waitFor({state:'hidden'});

  assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,errors},null,2));
  console.log(JSON.stringify({ok:true,qaRoot,checks}));
} catch(error) {await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});throw error;}
finally {await desktop.close();}
