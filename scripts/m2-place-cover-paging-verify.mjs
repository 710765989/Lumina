import {createRequire} from 'node:module';
import {mkdir,writeFile,utimes} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../apps/desktop/node_modules/sharp'),Sqlite=require('../packages/storage/node_modules/better-sqlite3');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-place-cover-paging');
const deadline=setTimeout(()=>void desktop.close(),120000),checks=[],pass=value=>{checks.push(value);console.log('PASS '+value);};page.setDefaultTimeout(20000);
try{
 await command({...(await command({type:'organization.settings'})),type:'organization.configure',watch:false});
 const root=path.join(qaRoot,'photos');await mkdir(root);const colors=['#d58565','#5687b5','#68a47f','#9780b4'];
 for(let index=0;index<80;index++){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="${colors[index%4]}"/><circle cx="350" cy="75" r="35" fill="#ffedbd"/><path d="M0 320V230L180 110L320 250L480 150V320Z" fill="#ffffff" fill-opacity=".3"/><text x="25" y="55" fill="white" font-size="30">${index+1}</text></svg>`;
  const file=path.join(root,`地点-${String(index).padStart(2,'0')}.jpg`);await writeFile(file,await sharp(Buffer.from(svg)).jpeg().toBuffer());const date=new Date(1700000000000-index*1000);await utimes(file,date,date);
 }
 await command({type:'roots.addAndScan',absolutePath:root});
 const db=new Sqlite(path.join(qaRoot,'user-data/data/lumina.db'));db.prepare("UPDATE media_details SET metadata_json=json_set(metadata_json,'$.country','CN','$.region','测试地区','$.city','后面还有正常照片')").run();db.close();
 const scope={country:'CN',region:'测试地区',city:'后面还有正常照片'},all=(await command({type:'geo.media',...scope,limit:100,sortBy:'fileTime',sort:'desc'}));
 // Explicitly compare against candidate order, independent of the browser's selected sort.
 let cursor,ordered=[];for(;;){const result=await command({type:'geo.coverCandidates',...scope,cursor,limit:24});ordered.push(...result.items);if(!result.hasMore)break;const last=result.items.at(-1);cursor={value:last.coverSortValue,id:last.id};}
 assert.equal(ordered.length,80);assert.equal(all.length,80);assert.deepEqual(ordered.map(item=>path.basename(item.absolutePath)),Array.from({length:80},(_,i)=>`地点-${String(i).padStart(2,'0')}.jpg`));
 const good=[ordered[0].id,ordered[61].id,ordered[62].id,ordered[63].id];
 await desktop.evaluate(({ipcMain},{good})=>{
  const original=ipcMain._invokeHandlers.get('lumina:thumbnail');globalThis.__coverRequests=[];globalThis.__candidatePages=[];globalThis.__coverGood=new Set(good);
  ipcMain.removeHandler('lumina:thumbnail');ipcMain.handle('lumina:thumbnail',(event,input)=>{const id=typeof input==='string'?input:input.mediaId;globalThis.__coverRequests.push(id);if(!globalThis.__coverGood.has(id))throw Error('heif: No decoding plugin installed');return original(event,input);});
  const cmd=ipcMain._invokeHandlers.get('lumina:command');ipcMain.removeHandler('lumina:command');ipcMain.handle('lumina:command',(event,input)=>{if(input.type==='geo.coverCandidates')globalThis.__candidatePages.push(input);return cmd(event,input);});
 },{good});
 await page.locator('.sidebar .nav-item').filter({hasText:'足迹'}).click();const card=page.getByRole('button',{name:'查看地点 后面还有正常照片',exact:true});
 await page.waitForFunction(()=>document.querySelector('.geo-mosaic')?.dataset.coverCount==='4');
 for(const image of await card.locator('.geo-mosaic-cell>img').all())await image.evaluate(image=>image.decode());
 const requests=await desktop.evaluate(()=>globalThis.__coverRequests),pages=await desktop.evaluate(()=>globalThis.__candidatePages);
 assert.deepEqual(requests,ordered.slice(0,64).map(item=>item.id));assert.deepEqual(pages.map(row=>row.cursor.id),[ordered[11].id,ordered[35].id,ordered[59].id]);assert(pages.every(row=>row.limit===24));
 pass('80张候选，前12张仅1张可用：跨3页跳过60张模拟HEIF失败，找到后面3张正常照片，凑满4张即停止');
 assert.equal(await card.locator('.geo-mosaic-cell').count(),4);assert.equal(await card.locator('.geo-mosaic-empty').count(),0);await page.screenshot({path:path.join(qaRoot,'four-covers-after-failures.png'),scale:'css'});
 await card.click();await page.waitForTimeout(400);const cityRequests=await desktop.evaluate(()=>globalThis.__coverRequests);await page.getByRole('button',{name:'返回',exact:true}).click();await page.waitForTimeout(300);assert.deepEqual(await desktop.evaluate(()=>globalThis.__coverRequests),cityRequests);assert.equal(await desktop.evaluate(()=>globalThis.__candidatePages.length),pages.length);pass('进入地点后返回复用成功封面与候选游标，不重复尝试前面失败的照片');
 const button=page.getByRole('button',{name:'更新足迹',exact:true});assert.match(await button.getAttribute('title'),/不重新扫描整个图库/);assert.equal(await page.getByRole('button',{name:'补全地点',exact:true}).count(),0);pass('按钮改为更新足迹，提示复用GPS、不重新扫描整个图库');
 assert.equal((await command({type:'tasks.list',limit:100})).filter(task=>task.kind==='scan').length,1);assert.equal((await command({type:'tags.list'})).length,0);assert.equal((await command({type:'albums.list'})).length,0);assert.deepEqual(errors,[]);pass('封面翻页未新增目录扫描、地点标签或地点相册，无页面异常');
 await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,requests:requests.length,candidatePages:pages.length,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot,count:checks.length}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});console.error('QA ROOT '+qaRoot);throw error;}finally{clearTimeout(deadline);await desktop.close();}
