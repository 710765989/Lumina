import {createRequire} from 'node:module';
import {mkdir,copyFile,writeFile,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url);const sharp=require('../packages/core/node_modules/sharp');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-enhancements-qa');
const checks=[];const checked=(name)=>{checks.push(name);console.log(`PASS ${name}`);};
const navigate=(name)=>page.locator('.sidebar .nav-item').filter({hasText:name}).click();
async function done(kind){for(let attempt=0;attempt<500;attempt++){const task=(await command({type:'tasks.list',limit:50})).find(task=>task.kind===kind);if(task && ['completed','failed'].includes(task.status)){assert.equal(task.status,'completed',task.errorMessage);return task;}await page.waitForTimeout(60);}throw new Error(`${kind} timeout`);}
async function runDetection(kind){await page.getByRole('button',{name:kind==='duplicates'?'开始检测':'检测相似照片',exact:true}).click();await page.getByRole('dialog',{name:'任务进度',exact:true}).waitFor();await done(kind);await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'任务进度',exact:true}).waitFor({state:'hidden'});}
const search=page.locator('.search-builder input');
try {
  const root=path.join(qaRoot,'fixtures');await mkdir(root);
  const svg=Buffer.from('<svg width="480" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="320" fill="#b8d5f0"/><path d="M0 250L110 90L280 220L410 60L480 250Z" fill="#234d69"/><circle cx="100" cy="65" r="32" fill="#f5bf62"/><rect y="252" width="480" height="68" fill="#62949e"/></svg>');
  const a=path.join(root,'original-a.jpg'),b=path.join(root,'original-b.jpg'),largest=path.join(root,'similar-largest.jpg'),unrelated=path.join(root,'unrelated.jpg');
  await sharp(svg).jpeg({quality:90}).toFile(a);await copyFile(a,b);
  await sharp(svg).resize(180,120).jpeg({quality:45}).withExif({IFD0:{ImageDescription:'x'.repeat(30000)}}).toFile(largest);
  await sharp({create:{width:480,height:320,channels:3,background:'#dd3300'}}).jpeg().toFile(unrelated);
  const largestBefore=await readFile(largest);
  await command({type:'roots.addAndScan',absolutePath:root});
  await command({type:'tags.create',name:'交互标签A'});await command({type:'tags.create',name:'交互标签B'});
  await page.getByRole('button',{name:'刷新',exact:true}).click();await page.locator('.library-content .media-card').first().waitFor();
  await search.focus();await page.locator('.search-mode-menu').getByRole('button',{name:'文件名',exact:true}).click();await search.fill('original');
  const names=page.getByRole('listbox',{name:'文件名建议'});await names.getByRole('option',{name:'original-b.jpg',exact:true}).waitFor();
  assert.equal(await names.getByRole('option').first().getAttribute('aria-selected'),'true');await search.press('ArrowDown');await search.press('Enter');
  await page.locator('.search-chip').filter({hasText:'original-b.jpg'}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.media-card').length===1);
  await page.locator('.search-chip button').click();await search.fill('');await search.press('Backspace');await page.locator('.app-brand').click();await page.getByRole('button',{name:'刷新',exact:true}).click();
  checked('filename suggestions support default selection, arrows and Enter');

  const source=(await command({type:'media.list'})).find(row=>row.absolutePath===a);
  await page.locator('.library-content .media-card').filter({hasText:'original-a.jpg'}).locator('.media-meta').click();await page.getByRole('button',{name:'编辑标签',exact:true}).click();await page.getByRole('dialog',{name:'编辑标签',exact:true}).getByLabel('连续添加',{exact:true}).check();
  const tagDialog=page.getByRole('dialog',{name:'编辑标签',exact:true});const tagInput=tagDialog.getByRole('combobox',{name:'标签名称'});
  await tagInput.fill('交互标签');const tagPopup=page.locator('#add-tag-suggestions');await tagPopup.waitFor();
  assert.equal(await tagPopup.getByRole('option').first().getAttribute('aria-selected'),'true');await tagInput.press('ArrowDown');await tagInput.press('Enter');
  await tagDialog.locator('.dialog-tag').filter({hasText:'交互标签B'}).waitFor();await tagPopup.waitFor({state:'hidden'});
  await tagInput.fill('交互标签A');await tagPopup.waitFor();await page.screenshot({path:path.join(qaRoot,'tag-suggestions.png')});
  await tagPopup.getByRole('option',{name:'#交互标签A',exact:true}).click();await tagDialog.locator('.dialog-tag').filter({hasText:'交互标签A'}).waitFor();
  assert((await command({type:'media.tags',id:source.id})).some(row=>row.name==='交互标签A'));await tagDialog.getByRole('button',{name:'完成',exact:true}).click();
  checked('tag popup escapes modal clipping, auto-commits selection and closes');

  await navigate('相册');await page.getByRole('button',{name:'+新建智能相册',exact:true}).click();const editor=page.getByRole('dialog',{name:'新建智能相册',exact:true});
  const before=await editor.boundingBox();const previewBefore=await editor.locator('.rule-preview').boundingBox();const tagsBefore=await editor.locator('.rule-tag-options').first().boundingBox();const footerBefore=await editor.locator('.dialog-footer').boundingBox();
  await editor.locator('.rule-tag-options').first().getByLabel('交互标签A',{exact:true}).check();await editor.locator('.preview-status').filter({hasText:'当前匹配 1 项'}).waitFor();
  const after=await editor.boundingBox();const previewAfter=await editor.locator('.rule-preview').boundingBox();const tagsAfter=await editor.locator('.rule-tag-options').first().boundingBox();const footerAfter=await editor.locator('.dialog-footer').boundingBox();
  assert(Math.abs(before.height-after.height)<=1);assert(Math.abs(previewBefore.height-previewAfter.height)<=1);assert(Math.abs(tagsBefore.height-tagsAfter.height)<=1);assert(Math.abs(footerBefore.y-footerAfter.y)<=1);
  assert.equal(await editor.locator('.preview-samples').first().locator('img,span').count(),5);await page.screenshot({path:path.join(qaRoot,'stable-smart-preview.png')});await page.keyboard.press('Escape');
  checked('smart album and five-slot previews reserve fixed geometry');

  await navigate('主页');await desktop.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];global.__luminaOverlay=[];const original=window.setTitleBarOverlay.bind(window);window.setTitleBarOverlay=(options)=>{global.__luminaOverlay.push(options);return original(options);};});
  await page.locator('.library-content .media-card').filter({hasText:'original-a.jpg'}).locator('.media-meta').dblclick();await page.locator('.viewer-photo.ready').waitFor();
  assert.equal((await desktop.evaluate(()=>global.__luminaOverlay)).at(-1).color,'#3f4451');
  await page.keyboard.press('Escape');await page.locator('.media-viewer').waitFor({state:'hidden'});assert.equal((await desktop.evaluate(()=>global.__luminaOverlay)).at(-1).color,'#ffffff');
  checked('native caption area dims with viewer and restores afterward');

  await navigate('重复检测');await runDetection('duplicates');await page.locator('.duplicate-group-head').waitFor();
  await page.getByRole('button',{name:'保留 original-b.jpg',exact:true}).click();await page.getByRole('button',{name:'删除重复',exact:true}).click();
  let deletion=page.getByRole('dialog',{name:'从图库删除',exact:true});await deletion.waitFor();await deletion.getByText(/本次删除 1 个文件 · 占用/).waitFor();
  await deletion.getByText('查看每组保留项',{exact:true}).click();await deletion.locator('.cleanup-preview').getByText(/original-b.jpg/).first().waitFor();
  // In-flight cancellation and restart are covered by background-file-jobs.test.ts.
  await deletion.getByRole('button',{name:'确认删除',exact:true}).click();await deletion.waitFor({state:'hidden'});await done('delete');await page.getByRole('dialog',{name:'任务进度',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();assert((await stat(b)).isFile());await assert.rejects(stat(a),{code:'ENOENT'});
  assert.equal((await command({type:'trash.restore',mediaIds:[source.id]}))[0].ok,true);
  checked('batch duplicate deletion confirms count and space and preserves the chosen original');

  await page.getByRole('button',{name:'相似照片',exact:true}).click();await runDetection('similar');await page.locator('.similar-mode .media-row').first().waitFor();
  assert.equal(await page.locator('.similar-mode .media-row').count(),3);assert.equal(await page.locator('.similar-mode .smart-badge').count(),0);const sorted=(await command({type:'similar.list'})).groups[0].items;assert(sorted.slice(0,2).every(item=>item.exactDuplicate));
  await page.screenshot({path:path.join(qaRoot,'similar-exact-priority.png')});
  await page.getByRole('button',{name:'删除相似',exact:true}).click();
  deletion=page.getByRole('dialog',{name:'从图库删除',exact:true});await deletion.waitFor();assert(await deletion.getByLabel('保留最大文件',{exact:false}).isChecked());
  await deletion.getByText('查看每组保留项',{exact:true}).click();await deletion.locator('.cleanup-preview').getByText(/similar-largest.jpg/).first().waitFor();const firstSummary=await deletion.locator('.cleanup-preview > strong').textContent();
  await deletion.getByLabel('保留最大文件',{exact:false}).uncheck();await deletion.locator('.cleanup-preview').getByText(/original-[ab].jpg/).first().waitFor();assert.notEqual(await deletion.locator('.cleanup-preview > strong').textContent(),firstSummary);
  await deletion.getByLabel('保留最大文件',{exact:false}).check();await deletion.locator('details').evaluate(node=>{node.open=true;});await deletion.locator('.cleanup-preview').getByText(/similar-largest.jpg/).first().waitFor();
  await page.screenshot({path:path.join(qaRoot,'batch-similar-confirm.png')});await deletion.getByRole('button',{name:'确认删除',exact:true}).click();await deletion.waitFor({state:'hidden'});await done('delete');await page.getByRole('dialog',{name:'任务进度',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
  assert.deepEqual(await readFile(largest),largestBefore);assert.equal((await command({type:'trash.list'})).length,2);
  checked('similar groups prioritize exact files and batch cleanup recalculates keep-largest counts and bytes');

  const live=await command({type:'media.list'});for(const row of live)await command({type:'media.addTag',id:row.id,tagName:'隐藏集合'});
  await navigate('标签');const tagRow=page.locator('.tag-management-row').filter({hasText:'#隐藏集合'});await tagRow.getByRole('button',{name:'隐藏标签 隐藏集合 关联媒体',exact:true}).click();
  let visibility=page.getByRole('dialog',{name:'隐藏标签关联媒体',exact:true});await visibility.getByText(/目前 2 项可见媒体/).waitFor();await visibility.getByRole('button',{name:'确认隐藏',exact:true}).click();await visibility.waitFor({state:'hidden'});
  assert.equal((await command({type:'media.list'})).length,0);await tagRow.getByRole('button',{name:'恢复标签 隐藏集合 关联媒体',exact:true}).click();
  visibility=page.getByRole('dialog',{name:'恢复标签关联媒体',exact:true});await visibility.getByRole('button',{name:'恢复显示',exact:true}).click();await visibility.waitFor({state:'hidden'});assert.equal((await command({type:'media.list'})).length,2);
  checked('tag-associated media can be hidden and restored without deleting tags');

  const recycleRoot=path.join(qaRoot,'recycle-fixtures');await mkdir(recycleRoot);await Promise.all(Array.from({length:205},(_,i)=>copyFile(unrelated,path.join(recycleRoot,`recycle-${String(i).padStart(3,'0')}.jpg`))));
  await command({type:'roots.addAndScan',absolutePath:recycleRoot});const recycleItems=await command({type:'media.search',query:'',fileNames:['recycle-'],limit:1000});
  const moved=await command({type:'trash.put',mediaIds:recycleItems.map(row=>row.id)});assert(moved.every(row=>row.ok),JSON.stringify(moved.filter(row=>!row.ok)));await navigate('回收站');await page.locator('.recycle-list .media-row').first().waitFor();
  await page.locator('.recycle-list').evaluate(node=>{node.scrollTop=node.scrollHeight;});await page.waitForFunction(()=>document.querySelectorAll('.recycle-list .media-row').length===207);
  const last=page.locator('.recycle-list .media-row').last();await last.click();const lastTitle=await last.locator('strong').textContent();const top=await page.locator('.recycle-list').evaluate(node=>node.scrollTop);
  for(let i=1;i<=6;i++){await command({type:'media.attributes',id:live[0].id,rating:i%6});await page.waitForTimeout(100);}
  await page.waitForTimeout(1400);assert.equal(await page.locator('.recycle-list .media-row').count(),207);assert.match(await page.locator('.recycle-list .media-row.selected').textContent(),new RegExp(lastTitle));
  assert(Math.abs(await page.locator('.recycle-list').evaluate(node=>node.scrollTop)-top)<2);assert.equal(await page.getByRole('button',{name:'取消未执行项',exact:true}).count(),0);
  await page.screenshot({path:path.join(qaRoot,'recycle-stable.png')});checked('recycle background changes preserve 207 loaded items, selection and scroll without refresh controls flashing');

  assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot,checks}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});throw error;}finally{await desktop.close();}
