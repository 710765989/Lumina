import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile,readdir,stat,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../apps/desktop/node_modules/sharp'),ffmpeg=require('../apps/desktop/node_modules/ffmpeg-static');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-cache-reuse');
const deadline=setTimeout(()=>void desktop.close(),120000),checks=[],timings={},pass=name=>{checks.push(name);console.log('PASS '+name);};
const home=page.locator('.library-content');page.setDefaultTimeout(18000);
async function snapshot(root){const files={};for(const name of (await readdir(root)).filter(name=>/\.(jpg|png|mp4)$/u.test(name)).sort()){const file=path.join(root,name),info=await stat(file);files[name]={bytes:info.size,mtimeMs:info.mtimeMs,hash:createHash('sha256').update(await readFile(file)).digest('hex')};}return files;}
async function fetchMedia(id,kind,query='',range){return page.evaluate(async({id,kind,query,range})=>{const response=await fetch(window.lumina.mediaUrl(kind,id)+query,{headers:range?{Range:range}:{}}),bytes=new Uint8Array(await response.arrayBuffer());return {status:response.status,length:bytes.length,type:response.headers.get('content-type'),range:response.headers.get('content-range'),prefix:[...bytes.slice(0,8)]};},{id,kind,query,range});}
async function finish(id){for(let i=0;i<1000;i++){const job=await command({type:'jobs.result',id});if(!job.active&&!['running','queued'].includes(job.status)){assert.equal(job.status,'completed');return job;}await page.waitForTimeout(5);}throw Error('任务未完成');}
try{
 await command({...(await command({type:'organization.settings'})),type:'organization.configure',watch:false});
 const root=path.join(qaRoot,'fixtures');await mkdir(root);
 for(let i=0;i<9;i++)await writeFile(path.join(root,`photo-${i}.png`),await sharp({create:{width:i===0?4300:900,height:i===0?2800:600,channels:3,background:i%2?'#3489df':'#de8934'}}).png().toBuffer());
 const video=path.join(root,'clip.avi');await new Promise((resolve,reject)=>{const child=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=160x120:rate=5:duration=1','-c:v','mpeg4',video],{windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('fixture failed')));});
 await command({type:'roots.addAndScan',absolutePath:root});const media=await command({type:'media.list',limit:100}),photo=media.find(item=>item.absolutePath.endsWith('photo-0.png')),small=media.find(item=>item.absolutePath.endsWith('photo-1.png')),clip=media.find(item=>item.kind==='video');assert.equal(media.length,10);
 const cache=(await command({type:'cache.settings'})).directory;
 let began=performance.now();const first=await command({type:'media.thumbnail',id:photo.id});timings.coldThumbnailMs=performance.now()-began;
 began=performance.now();const warm=await Promise.all(Array.from({length:32},(_,i)=>command({type:'media.thumbnail',id:photo.id,width:i%2?110:1600})));timings.warm32ThumbnailRequestsMs=performance.now()-began;
 assert(warm.every(item=>item.cachePath===first.cachePath&&item.cached));
 await Promise.all(media.map(item=>command({type:'media.thumbnail',id:item.id})));
 assert.equal((await readdir(cache)).filter(name=>name.endsWith('.jpg')).length,10);
 pass('不同尺寸的32次并发请求复用同一缩略图，10个媒体各保存一份JPEG');
 began=performance.now();const preview=await command({type:'media.previewPath',id:photo.id});timings.coldPreviewMs=performance.now()-began;
 began=performance.now();await Promise.all(Array.from({length:32},()=>command({type:'media.previewPath',id:photo.id})));timings.warm32PreviewRequestsMs=performance.now()-began;
 const aliases=await Promise.all(Array.from({length:20},(_,i)=>command({type:'media.previewPath',id:small.id,fullSize:i%2===0})));assert.equal(new Set(aliases.map(item=>item.cachePath)).size,1);
 const full=await command({type:'media.previewPath',id:photo.id,fullSize:true});assert.notEqual(full.cachePath,preview.cachePath);
 pass('照片预览并发合并，小图屏幕/原尺寸共用缓存，大图保留所需两种清晰度');
 const png=await fetchMedia(photo.id,'preview','?full=0','bytes=0-127');assert.equal(png.status,206);assert.equal(png.length,128);assert.equal(png.type,'image/png');assert.deepEqual(png.prefix,[137,80,78,71,13,10,26,10]);
 const original=await fetchMedia(photo.id,'original','','bytes=0-63');assert.equal(original.status,206);assert.equal(original.length,64);assert.equal(original.type,'image/png');
 pass('照片原件和预览均支持流式及范围读取，PNG内容正确');
 const hoverSession=randomUUID(),playSession=randomUUID(),nextHover=randomUUID(),nextPlay=randomUUID();
 const hoverResults=await Promise.all(Array.from({length:8},()=>fetchMedia(clip.id,'hover','?session='+hoverSession,'bytes=0-127')));assert(hoverResults.every(result=>result.status===206));
 const playResults=await Promise.all(Array.from({length:8},()=>fetchMedia(clip.id,'playback','?session='+playSession,'bytes=0-127')));assert(playResults.every(result=>result.status===206));
 const tasks=await command({type:'tasks.list',limit:200});assert.equal(tasks.filter(task=>task.kind==='video-preview').length,1);
 const before=await snapshot(cache);await Promise.all(Array.from({length:8},()=>fetchMedia(clip.id,'hover','?session='+nextHover,'bytes=0-127')));await fetchMedia(clip.id,'playback','?session='+nextPlay,'bytes=0-127');assert.deepEqual(await snapshot(cache),before);
 pass('视频悬停和兼容播放的并发/重复范围请求不重复转码或新增视频任务');
 // A successful retry URL is safe to load again; healthy preview files stay intact.
 await fetchMedia(photo.id,'preview','?full=0&retry=1&session=cache-retry');await fetchMedia(photo.id,'preview','?full=0&retry=1&session=cache-retry');await fetchMedia(photo.id,'preview','?full=0&retry=2&session=cache-retry');assert.deepEqual(await snapshot(cache),before);
 pass('正常照片重复刷新、重试及同一重试URL读取不重写缓存');
 const bytes=await readFile(small.absolutePath);await unlink(small.absolutePath);await command({type:'media.thumbnail',id:small.id});await command({type:'media.previewPath',id:small.id,regenerate:true});assert.deepEqual(await snapshot(cache),before);await writeFile(small.absolutePath,bytes);
 pass('原件暂不可读时仍复用完整缓存，不为正常缓存再次读取原件');
 await page.keyboard.press('F5');await home.locator('.page-summary').filter({hasText:'10 项'}).waitFor();
 for(const mode of ['list','masonry','time','immersive']){await home.getByLabel('视图切换',{exact:true}).selectOption(mode);await home.locator('[data-media-id]').first().waitFor();}
 await home.getByLabel('缩略图大小',{exact:true}).evaluate(input=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'190');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
 const card=home.locator(`[data-media-id="${photo.id}"]`);await card.dblclick();await page.locator('.viewer-photo.ready').waitFor();await page.keyboard.press('F5');await page.locator('.viewer-photo.ready').waitFor();await page.keyboard.press('Escape');await page.locator('.media-viewer').waitFor({state:'hidden'});await page.waitForTimeout(250);
 // The viewer may prefetch neighboring photos once; snapshot them after first use.
 const afterFirstView=await snapshot(cache);await card.dblclick();await page.locator('.viewer-photo.ready').waitFor();await page.keyboard.press('Escape');await page.waitForTimeout(200);assert.deepEqual(await snapshot(cache),afterFirstView);
 assert.equal((await command({type:'tasks.list',limit:200})).filter(task=>task.kind==='scan').length,1);
 pass('四种视图、缩略图缩放、查看器刷新及反复打开照片不重建缓存、不新增扫描');
 // Explicitly damaged output is repaired once, then reused.
 await writeFile(first.cachePath,'damaged');const repaired=await Promise.all(Array.from({length:24},()=>command({type:'media.thumbnail',id:photo.id})));assert(repaired.every(item=>item.cachePath===first.cachePath));await sharp(first.cachePath).raw().toBuffer();const repairedStamp=await stat(first.cachePath);await command({type:'media.thumbnail',id:photo.id});assert.equal((await stat(first.cachePath)).mtimeMs,repairedStamp.mtimeMs);
 pass('损坏缩略图的24次并发请求修复一次，随后继续复用');
 const transferBefore=await snapshot(cache),target=path.join(qaRoot,'moved-cache'),plan=await command({type:'cache.movePreview',directory:target}),move=await command({type:'cache.move',token:plan.token});const pending=command({type:'media.thumbnail',id:photo.id});await finish(move.id);const moved=await pending;assert(moved.cachePath.startsWith(target));const transferred=await snapshot(target);for(const [name,entry] of Object.entries(transferBefore))assert.equal(transferred[name]?.hash,entry.hash);
 const movedStamp=await snapshot(target);await command({type:'media.previewPath',id:photo.id});await fetchMedia(photo.id,'thumbnail','?v=after-move');assert.deepEqual(await snapshot(target),movedStamp);
 pass('迁移期间请求等待路径切换，迁移后读取原有缓存内容且不重新生成');
 const orphan=path.join(target,`orphan-${'f'.repeat(16)}.jpg`);await writeFile(orphan,await readFile(first.cachePath.replace(cache,target)));const report=await command({type:'storage.report',refresh:true});assert(report.unusedCacheCount>=1);const clear=await command({type:'storage.cachePreview',scope:'unused'}),cleanup=await command({type:'storage.clearCache',token:clear.token});await finish(cleanup.id);await assert.rejects(stat(orphan));assert.deepEqual(await snapshot(target),movedStamp);
 pass('无用缓存清理保留当前缩略图、照片预览和视频缓存');
 assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,timings,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot,count:checks.length,timings}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});console.error('QA ROOT',qaRoot);throw error;}finally{clearTimeout(deadline);await desktop.close();}
