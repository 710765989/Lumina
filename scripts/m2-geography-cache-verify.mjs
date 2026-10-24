import {createRequire} from 'node:module';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../apps/desktop/node_modules/sharp');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-geography-cache');
const deadline=setTimeout(()=>void desktop.close(),120000),checks=[],pass=value=>{checks.push(value);console.log('PASS '+value);};page.setDefaultTimeout(20000);
try{
 await command({...(await command({type:'organization.settings'})),type:'organization.configure',watch:false});
 const root=path.join(qaRoot,'photos');await mkdir(root);const base=()=>sharp({create:{width:480,height:320,channels:3,background:'#5395b8'}});
 const gps=await base().jpeg().withExif({IFD3:{GPSLatitudeRef:'N',GPSLatitude:'31/1 14/1 0/1',GPSLongitudeRef:'E',GPSLongitude:'121/1 28/1 0/1'}}).toBuffer(),plain=await base().jpeg().toBuffer();
 for(let i=0;i<12;i++)await writeFile(path.join(root,`photo-${i}.jpg`),i<3?gps:plain);
 await command({type:'roots.addAndScan',absolutePath:root});const media=await command({type:'media.list',limit:100});await Promise.all(media.map(item=>command({type:'media.thumbnail',id:item.id})));
 await page.locator('.sidebar .nav-item').filter({hasText:'足迹'}).click();await page.locator('.place-card').first().waitFor();
 assert.equal((await command({type:'tasks.list',limit:100})).filter(task=>task.kind==='geo').length,0);assert.equal((await command({type:'geo.places'})).pendingOrganization,3);pass('扫描后直接显示城市与照片数量，打开足迹不启动二次扫描或地理任务');
 await rename(root,path.join(qaRoot,'originals-unavailable')); // Cached GPS must work even when all originals are unavailable.
 const button=page.getByRole('button',{name:'更新足迹',exact:true});await button.dblclick();
 const dialog=page.getByRole('dialog',{name:'任务进度',exact:true});await dialog.getByText(/已完成/).first().waitFor();
 let tasks=(await command({type:'tasks.list',limit:100})).filter(task=>task.kind==='geo');assert.equal(tasks.length,1);const result=await command({type:'jobs.result',id:tasks[0].id});assert.equal(result.total,3);assert.equal(result.status,'completed');assert.equal(result.processed,3);
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();pass('原文件全部不可读取时仍通过已存 GPS 完成分类，无 GPS 的9张照片不进入任务，重复点击不重复提交');
 await page.getByText(/待补全 0 张/).waitFor();await button.click();await page.getByText('位置信息已是最新，无需重新读取照片。',{exact:true}).waitFor();assert.equal(await dialog.count(),0);
 tasks=(await command({type:'tasks.list',limit:100})).filter(task=>task.kind==='geo');const newest=await command({type:'jobs.result',id:tasks.find(task=>task.id!==result.id).id});assert.equal(newest.total,0);pass('再次点击即时提示已是最新，不重新处理媒体，不打开空进度窗口');
 await page.screenshot({path:path.join(qaRoot,'footprints.png')});
 assert.equal((await command({type:'albums.list'})).length,0);assert.equal((await command({type:'tags.list'})).length,0);pass('足迹仅展示地点，补全不创建标签或相册');
 assert.equal((await command({type:'tasks.list',limit:100})).filter(task=>task.kind==='scan').length,1);assert.deepEqual(errors,[]);
 await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot,count:checks.length}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});console.error('QA ROOT '+qaRoot);throw error;}finally{clearTimeout(deadline);await desktop.close();}
