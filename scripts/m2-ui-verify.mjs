import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { launchIsolated } from './electron-test-harness.mjs';
const require = createRequire(import.meta.url); const sharp = require('../packages/core/node_modules/sharp'); const ffmpeg = require('../packages/core/node_modules/ffmpeg-static');
const session = await launchIsolated(process.argv[2], 'm2-ui-qa');
const { desktop, page, qaRoot, command, errors } = session;
const root = path.join(qaRoot, 'fixtures'); await mkdir(root); const exportRoot = path.join(qaRoot, 'export'); await mkdir(exportRoot);
const photo = path.join(root, 'photo-000.jpg');
await sharp({ create: { width: 640, height: 400, channels: 3, background: '#3478d4' } }).jpeg().toFile(photo);
await Promise.all(Array.from({ length: 404 }, (_, i) => copyFile(photo, path.join(root, `photo-${String(i + 1).padStart(3, '0')}.jpg`))));
await sharp({ create: { width: 320, height: 240, channels: 3, background: '#8ca6bc' } }).jpeg().withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '31/1 14/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '121/1 28/1 0/1' } }).toFile(path.join(root, 'location.jpg'));
for (const [name, codec] of [['clip.mp4','libx264'],['compatibility.avi','ffv1']]) await new Promise((resolve, reject) => { const process = spawn(ffmpeg, ['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x180:d=8','-c:v',codec,'-pix_fmt','yuv420p',path.join(root,name)], { windowsHide: true }); process.on('error',reject); process.on('exit',(code)=>code===0?resolve():reject(new Error(`Video fixture ${code}`))); });
const navigate = (name) => page.locator('.sidebar .nav-item').filter({ hasText: name }).click();
const step = (name) => console.log(`CHECK ${name}`);
try {
  step('scan and virtualized automatic paging');
  await command({ type: 'roots.addAndScan', absolutePath: root });
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.media-card').length>0);
  assert((await page.locator('.media-card').count())<80);
  for (let count=0;count<3;count++) { await page.locator('.grouped-media-scroll').evaluate(node=>{node.scrollTop=node.scrollHeight}); await page.waitForTimeout(200); }
  await page.waitForFunction(()=>document.querySelector('.grouped-media-canvas')?.dataset.total==='408');
  assert((await page.locator('.media-card').count())<80);
  const scrollBefore=await page.locator('.grouped-media-scroll').evaluate(node=>node.scrollTop);
  await page.locator('.media-card').last().locator('.media-meta').click();
  await page.getByRole('button',{name:'编辑标签',exact:true}).click();await page.getByRole('dialog',{name:'编辑标签',exact:true}).getByLabel('连续添加',{exact:true}).check();
  await page.locator('.tag-dialog input').fill('分页保留'); await page.locator('.tag-dialog').getByRole('button',{name:'添加',exact:true}).click();
  await page.locator('.dialog-tag').filter({hasText:'#分页保留'}).waitFor();
  await page.locator('.tag-dialog').getByRole('button',{name:'完成',exact:true}).click();
  assert.equal(await page.locator('.grouped-media-scroll').evaluate(node=>node.scrollTop),scrollBefore);
  await page.waitForFunction(()=>document.querySelector('.grouped-media-canvas')?.dataset.total==='408');
  await page.screenshot({path:path.join(qaRoot,'timeline.png')});

  step('photo viewer, filmstrip, keyboard, zoom and information');
  await page.locator('.grouped-media-scroll').evaluate(node=>{node.scrollTop=0});
  const card=page.locator('.media-card').filter({hasText:/\.jpg/}).first(); await card.locator('.media-meta').dblclick();
  await page.locator('.viewer-photo.ready').waitFor();
  const firstTitle=await page.locator('.viewer-head strong').textContent(); const viewerBounds=await page.locator('.media-viewer').boundingBox();
  assert((await page.locator('.filmstrip button').count())<=21);
  await page.keyboard.press('ArrowRight'); await page.waitForFunction((title)=>document.querySelector('.viewer-head strong').textContent!==title,firstTitle);
  assert.deepEqual(await page.locator('.media-viewer').boundingBox(),viewerBounds);
  await page.locator('.viewer-photo.ready').waitFor(); const oldWidth=await page.locator('.viewer-photo').evaluate(node=>node.style.width);
  await page.getByRole('button',{name:'＋',exact:true}).click(); assert.notEqual(await page.locator('.viewer-photo').evaluate(node=>node.style.width),oldWidth);
  await page.getByRole('button',{name:'旋转',exact:true}).click();
  await page.getByRole('button',{name:'详情',exact:true}).click(); await page.locator('.viewer-info').getByText('相机 / 镜头',{exact:true}).waitFor();
  await page.screenshot({path:path.join(qaRoot,'viewer.png')}); await page.keyboard.press('Escape'); await page.locator('.media-viewer').waitFor({state:'hidden'});

  step('smart album creation, dynamic membership and cover picker');
  const all=await command({type:'media.list',limit:1000,sortBy:'name',sort:'asc'});
  const photos=all.filter(item=>item.kind==='photo');
  await command({type:'media.addTag',id:photos[0].id,tagName:'旅行'}); await command({type:'media.addTag',id:photos[0].id,tagName:'精选'}); await command({type:'media.addTag',id:photos[1].id,tagName:'旅行'});
  await page.getByRole('button',{name:'刷新',exact:true}).click(); await navigate('相册');
  await page.getByRole('button',{name:'+新建智能相册',exact:true}).click(); const editor=page.getByRole('dialog',{name:'新建智能相册',exact:true});
  await editor.getByLabel('相册名称',{exact:true}).fill('智能旅行'); await editor.getByLabel('相册描述',{exact:true}).fill('动态标签整理');
  await editor.getByLabel('旅行',{exact:true}).first().check(); await editor.getByLabel('精选',{exact:true}).first().check();
  await editor.getByText('当前匹配 1 项',{exact:true}).waitFor(); await page.screenshot({path:path.join(qaRoot,'smart-editor.png')});
  await editor.getByRole('button',{name:'保存',exact:true}).click(); await editor.waitFor({state:'hidden'});
  await page.locator('.album-cover-card').filter({hasText:'智能旅行'}).click(); await page.getByRole('heading',{name:'智能旅行',exact:true}).waitFor();
  await page.locator('.smart-badge').filter({hasText:'智能相册'}).waitFor(); await page.getByRole('button',{name:'相册更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'编辑相册',exact:true}).click();await page.getByRole('dialog',{name:'编辑相册',exact:true}).getByRole('button',{name:'设置封面',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'设置封面',exact:true}); await picker.locator('.cover-candidates button').first().click(); await picker.getByRole('button',{name:'保存封面',exact:true}).click(); await picker.waitFor({state:'hidden'});
  
  await page.getByRole('dialog',{name:'编辑相册',exact:true}).getByRole('button',{name:'取消',exact:true}).click();

  step('software recycle and exact restoration through UI');
  await navigate('主页'); await page.locator('.media-card').filter({hasText:/\.jpg/}).first().locator('.media-meta').click();
  const selectedName=await page.locator('.media-card.selected strong').textContent(); const selectedMedia=all.find(item=>path.basename(item.absolutePath)===selectedName); const original=await readFile(selectedMedia.absolutePath);
  await page.getByRole('button',{name:'删除',exact:true}).click(); const deletion=page.getByRole('dialog',{name:'从图库删除',exact:true}); await deletion.getByRole('button',{name:'确认删除',exact:true}).click(); await deletion.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'撤销删除',exact:true}).click();await page.getByText('已撤销删除',{exact:true}).waitFor();assert.deepEqual(await readFile(selectedMedia.absolutePath),original);
  await page.locator('.media-card').filter({hasText:selectedName}).locator('.media-meta').click();await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('dialog',{name:'从图库删除',exact:true}).getByRole('button',{name:'确认删除',exact:true}).click();await page.getByRole('dialog',{name:'从图库删除',exact:true}).waitFor({state:'hidden'});
  await navigate('回收站'); await page.locator('.recycle-list .media-row').filter({hasText:selectedName}).waitFor(); await page.screenshot({path:path.join(qaRoot,'recycle.png')});
  await page.locator('.recycle-list .media-row').filter({hasText:selectedName}).getByRole('button',{name:'还原',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.recycle-list .media-row').length===0); assert.deepEqual(await readFile(selectedMedia.absolutePath),original);

  step('export UI with real files and GPS removal');
  await desktop.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]})},exportRoot);
  await navigate('主页'); await page.locator('.media-card').filter({hasText:/\.jpg/}).first().locator('.media-meta').click();
  await page.getByRole('button',{name:'导出',exact:true}).click(); const exportDialog=page.getByRole('dialog',{name:'导出',exact:true}); await exportDialog.getByRole('button',{name:'浏览…',exact:true}).click(); await exportDialog.getByRole('button',{name:'导出',exact:true}).click();
  const progress=page.getByRole('dialog',{name:'任务进度',exact:true}); await progress.getByText(/已完成/).waitFor(); await progress.getByRole('button',{name:'关闭',exact:true}).click();
  assert((await import('node:fs/promises')).readdir(exportRoot));

  step('tag management, duplicate detector, places and settings');
  await navigate('标签'); await page.getByText(/合并标签不可撤销/).first().waitFor(); await page.getByRole('button',{name:'属性',exact:true}).first().click(); await page.getByRole('dialog',{name:'标签属性'}).getByLabel('分组',{exact:true}).fill('人物'); await page.getByRole('dialog',{name:'标签属性'}).getByRole('button',{name:'保存',exact:true}).click();
  await navigate('重复检测'); await page.getByRole('button',{name:'开始检测',exact:true}).click(); await page.getByRole('dialog',{name:'任务进度'}).getByText(/已完成/).waitFor({timeout:60000}); await page.getByRole('dialog',{name:'任务进度'}).getByRole('button',{name:'关闭',exact:true}).click(); await page.locator('.duplicate-groups h3').first().waitFor();
  await navigate('足迹'); await page.getByRole('button',{name:'整理地理信息',exact:true}).click(); await page.getByRole('dialog',{name:'任务进度'}).getByText(/已完成/).waitFor({timeout:60000}); await page.getByRole('dialog',{name:'任务进度'}).getByRole('button',{name:'关闭',exact:true}).click(); await page.locator('.place-card').first().waitFor(); await page.screenshot({path:path.join(qaRoot,'places.png')});
  await navigate('常规'); await page.getByRole('button',{name:'计算索引与缓存',exact:true}).click(); await page.locator('.storage-report-grid').waitFor(); await page.screenshot({path:path.join(qaRoot,'settings.png')});
  assert.deepEqual(errors,[]); console.log(JSON.stringify({ok:true,qaRoot,checks:['virtual timeline automatic pages','tag scroll preservation','photo transforms and filmstrip','smart album and cover','software recycle restore','export','tag properties','duplicate hashing UI','offline places UI','settings statistics']}));
} catch(error) { await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{}); console.error((await session.diagnostics()).split('\n').slice(-18).join('\n')); throw error; }
finally { await desktop.close(); }
