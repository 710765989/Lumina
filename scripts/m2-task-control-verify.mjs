import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../apps/desktop/node_modules/sharp'),Database=require('../packages/storage/node_modules/better-sqlite3');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-task-control');
const checks=[],pass=name=>{checks.push(name);console.log('PASS '+name);},deadline=setTimeout(()=>void desktop.close(),120000);
async function settled(id){for(let i=0;i<400;i++){const row=await command({type:'jobs.result',id});if(!row.active)return row;await page.waitForTimeout(20);}throw Error('task did not settle');}
try{
 await command({...(await command({type:'organization.settings'})),type:'organization.configure',watch:false,syncHidden:true});
 const root=path.join(qaRoot,'fixtures');await mkdir(root);const bytes=await sharp({create:{width:100,height:80,channels:3,background:'blue'}}).jpeg().toBuffer();
 for(let i=0;i<100;i++)await writeFile(path.join(root,`fixture-${i}.jpg`),bytes);await writeFile(path.join(root,'extra.PNG'),await sharp(bytes).png().toBuffer());
 await command({type:'roots.addAndScan',absolutePath:root});assert.deepEqual(await command({type:'media.formats'}),['jpg','png']);assert.deepEqual(await command({type:'media.search',query:'',extensions:['.custom']}),[]);pass('运行包格式列表只包含库内jpg/png，未列后缀仍可查询');
 const media=(await command({type:'media.list',limit:200})).filter(row=>row.absolutePath.endsWith('.jpg'));const selected=media.slice(0,10);
 for(const row of selected)execFileSync('attrib.exe',['+H',row.absolutePath],{windowsHide:true});
 const data=path.join(await desktop.evaluate(({app})=>app.getPath('userData')),'data/lumina.db');assert(data.startsWith(qaRoot));const db=new Database(data);
 const task='qa-paused-hide';db.transaction(()=>{
  for(const row of media)db.prepare('INSERT INTO hidden_media(media_id) VALUES(?)').run(row.id);
  for(const row of selected)db.prepare('INSERT INTO media_details(media_id,metadata_json) VALUES(?,?) ON CONFLICT(media_id) DO UPDATE SET metadata_json=excluded.metadata_json').run(row.id,JSON.stringify({windowsHiddenOriginal:false}));
  db.prepare("INSERT INTO tasks(id,kind,status,processed,total,payload_json) VALUES(?,'visibility','paused',10,100,?)").run(task,JSON.stringify({options:{type:'jobs.start',kind:'visibility',syncOnly:true,hidden:true},context:{windowsTargets:Object.fromEntries(media.map(row=>[row.id,true]))},info:{snapshotVersion:1}}));
  media.forEach((row,i)=>db.prepare('INSERT INTO job_items(task_id,media_id,file_path,size_bytes,fingerprint,ordinal,status) VALUES(?,?,?,?,?,?,?)').run(task,row.id,row.absolutePath,row.sizeBytes,row.fingerprint,i+1,i<10?'completed':'pending'));
  db.prepare('DELETE FROM windows_visibility_queue').run();db.prepare('DELETE FROM hidden_media').run();
 })();db.close();await command({type:'organization.settings'});
 const prior=await command({type:'jobs.result',id:task});assert.equal(prior.status,'cancelled');assert.equal(prior.processed,10);assert(prior.info.superseded);
 const next=(await command({type:'tasks.list',limit:200})).find(row=>row.kind==='visibility'&&row.id!==task);assert(next);assert.equal(next.total,10);assert.equal((await settled(next.id)).status,'completed');
 for(const row of selected)assert(!execFileSync('attrib.exe',[row.absolutePath],{encoding:'utf8',windowsHide:true}).slice(0,20).includes('H'));
 pass('10/100暂停任务自动取消，新任务只恢复10张真实文件隐藏属性，保留两条历史');
 await assert.rejects(command({type:'jobs.control',id:task,action:'resume'}),/接替/);pass('被接替任务不能恢复旧隐藏意图');
 const tag=await command({type:'tags.create',name:'隐藏验收'});await command({type:'jobs.start',kind:'tags',tagName:tag.name,mediaIds:media.map(row=>row.id)}).then(job=>settled(job.id));
 const result=await command({type:'tags.setHidden',id:tag.id,hidden:true});assert(result.visibilityTaskId);const began=Date.now();await command({type:'jobs.control',id:result.visibilityTaskId,action:'pause'});const paused=await settled(result.visibilityTaskId);assert.equal(paused.status,'paused');assert(Date.now()-began<2500);await page.waitForTimeout(350);assert.equal((await command({type:'jobs.result',id:paused.id})).processed,paused.processed);pass('真实属性worker可及时暂停，等待后进度不继续增加');
 await command({type:'jobs.control',id:paused.id,action:'cancel'});assert.equal((await command({type:'jobs.result',id:paused.id})).status,'cancelled');pass('已暂停属性任务可取消');
 await page.keyboard.press('F5');await page.locator('.sidebar .nav-item').filter({hasText:'常规'}).click();await page.locator('.task-panel').scrollIntoViewIfNeeded();await page.locator('.task-list .task-row').first().waitFor();pass('最终EXE可启动并展示任务列表');
 assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot,count:checks.length}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});console.error('QA ROOT '+qaRoot);throw error;}finally{clearTimeout(deadline);await desktop.close();}
