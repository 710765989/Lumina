import {createRequire} from 'node:module';
import {mkdir,writeFile,utimes} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../apps/desktop/node_modules/sharp'),Sqlite=require('../packages/storage/node_modules/better-sqlite3');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-place-cover-order');
const deadline=setTimeout(()=>void desktop.close(),120000),checks=[],pass=value=>{checks.push(value);console.log('PASS '+value);};page.setDefaultTimeout(20000);
try{
 await command({...(await command({type:'organization.settings'})),type:'organization.configure',watch:false});
 const root=path.join(qaRoot,'photos');await mkdir(root);const colors=['#cf8158','#4479b4','#6ba37a','#8c75ac','#bf7a97','#78a5ab'];
 for(let i=0;i<19;i++){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="${colors[i%6]}"/><circle cx="350" cy="75" r="35" fill="#ffedbd"/><path d="M0 320V230L180 110L320 250L480 150V320Z" fill="#ffffff" fill-opacity=".3"/><text x="25" y="55" fill="white" font-size="30">${i+1}</text></svg>`;
  const file=path.join(root,`place-${String(i).padStart(2,'0')}.jpg`);await writeFile(file,await sharp(Buffer.from(svg)).jpeg().toBuffer());const date=new Date(1700000000000-i*1000);await utimes(file,date,date);
 }
 await command({type:'roots.addAndScan',absolutePath:root});const all=await command({type:'media.search',query:'',sortBy:'fileTime',sort:'desc',limit:100});assert.equal(all.length,19);
 const db=new Sqlite(path.join(qaRoot,'user-data/data/lumina.db'));db.transaction(()=>{for(const [i,item] of all.entries()){
  db.prepare("UPDATE media_details SET metadata_json=json_set(metadata_json,'$.country','CN','$.region','测试地区','$.city','17项排序回归') WHERE media_id=?").run(item.id);
  db.prepare('UPDATE media SET captured_at_ms=? WHERE id=?').run(1600000000000+i*1000,item.id);
 }})();db.close();
 const good=all.slice(0,6).map(item=>item.id);for(const item of [all[15],all[18]])await command({type:'media.hide',id:item.id});
 await desktop.evaluate(({ipcMain},good)=>{const original=ipcMain._invokeHandlers.get('lumina:thumbnail');globalThis.__coverGood=new Set(good);ipcMain.removeHandler('lumina:thumbnail');ipcMain.handle('lumina:thumbnail',(event,input)=>{const id=typeof input==='string'?input:input.mediaId;if(!globalThis.__coverGood.has(id))throw Error('heif: No decoding plugin installed');return original(event,input);});},good);
 const scope={country:'CN',region:'测试地区',city:'17项排序回归'};
 const geo=page.locator('.geo-page'),card=page.getByRole('button',{name:'查看地点 17项排序回归',exact:true});
 async function expectCovers(sortBy,sort){
  const visible=await command({type:'geo.media',...scope,sortBy,sort,limit:100}),expected=visible.filter(item=>good.includes(item.id)).slice(0,4).map(item=>item.id);
  await page.waitForFunction(expected=>{const urls=[...document.querySelectorAll('.geo-mosaic-cell>img')].map(img=>img.src);return urls.length===4&&expected.every((id,index)=>urls[index].includes(id));},expected);
  for(const image of await card.locator('.geo-mosaic-cell>img').all())await image.evaluate(image=>image.decode());return {visible,expected};
 }
 await page.locator('.sidebar .nav-item').filter({hasText:'足迹'}).click();const initial=await expectCovers('fileTime','desc');assert.equal(initial.visible.length,17);assert.deepEqual(initial.expected,good.slice(0,4));assert.match(await card.locator('.geo-mosaic').getAttribute('title'),/文件修改时间倒序/);pass('隐藏后排2项后剩17项：封面默认与按文件时间倒序列表一致，前面4张正常照片均显示');
 await card.click();await geo.locator('.collection-result-summary').filter({hasText:'17 项'}).waitFor();const defaultBrowser=await command({type:'geo.media',...scope,sortBy:'fileTime',sort:'desc',limit:100});assert.deepEqual(defaultBrowser.slice(0,6).map(item=>item.id),good);await geo.getByRole('button',{name:'返回',exact:true}).click();await expectCovers('fileTime','desc');pass('封面首张与地点内第一张一致，没有从第二张开始或因隐藏后排项目丢失前排照片');
 async function changeSort(label){await card.click();await geo.locator('.sort-label').click();await geo.getByRole('option',{name:label,exact:true}).click();await geo.locator('.sort-label').filter({hasText:label}).waitFor();await geo.getByRole('button',{name:'返回',exact:true}).click();}
 await changeSort('按拍摄时间');const captured=await expectCovers('capturedAt','desc');assert.deepEqual(captured.expected,[...good].reverse().slice(0,4));pass('切换拍摄时间后，返回足迹的四图封面按相同顺序更新，跳过前面不可解码候选');
 await card.click();await geo.locator('.sort-direction').click();await geo.getByRole('button',{name:'返回',exact:true}).click();await expectCovers('capturedAt','asc');pass('正序/倒序同时作用于地点列表与封面，缓存不会沿用上一排序结果');
 await changeSort('按文件时间');await card.click();await geo.locator('.sort-direction').click();await geo.getByRole('button',{name:'返回',exact:true}).click();await expectCovers('fileTime','desc');
 await command({type:'media.hide',id:good[0]});await page.keyboard.press('F5');const after=await expectCovers('fileTime','desc');assert.equal(after.visible.length,16);assert.deepEqual(after.expected,good.slice(1,5));pass('隐藏首张后，封面自动替补下一张正常照片，数量和四图与可见列表同步');
 await page.screenshot({path:path.join(qaRoot,'cover-order-after-hide.png'),scale:'css'});assert.deepEqual(errors,[]);assert.equal((await command({type:'tasks.list',limit:100})).filter(row=>row.kind==='scan').length,1);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot,count:checks.length}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});console.error('QA ROOT '+qaRoot);throw error;}finally{clearTimeout(deadline);await desktop.close();}
