import {createRequire} from 'node:module';
import {mkdir,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../apps/desktop/node_modules/sharp');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-first-cache');
const deadline=setTimeout(()=>void desktop.close(),120000),checks=[],pass=value=>{checks.push(value);console.log('PASS '+value);};
page.setDefaultTimeout(15000);const dialog=()=>page.getByRole('dialog',{name:'确认添加目录',exact:true});
async function choose(file){await desktop.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);}
async function open(file){await choose(file);await page.locator('.library-content').getByRole('button',{name:'添加图库目录',exact:true}).click();await dialog().getByRole('button',{name:'确认并后台添加',exact:true}).waitFor();}
async function finish(id){for(let i=0;i<400;i++){const job=await command({type:'jobs.result',id});if(!job.active){assert.equal(job.status,'completed',job.error);return;}await page.waitForTimeout(20);}throw Error('job timeout');}
try{
 await command({...await command({type:'organization.settings'}),type:'organization.configure',watch:false});
 const photos=path.join(qaRoot,'photos'),second=path.join(qaRoot,'second'),cache=path.join(qaRoot,'chosen-cache');for(const folder of [photos,second,cache])await mkdir(folder);
 await writeFile(path.join(photos,'first.jpg'),await sharp({create:{width:240,height:160,channels:3,background:'#6495de'}}).jpeg().toBuffer());
 const initial=await command({type:'cache.settings'});assert.equal(initial.setupRequired,true);
 await desktop.evaluate(({ipcMain})=>{const handler=ipcMain._invokeHandlers.get('lumina:command');globalThis.__firstCacheCommands=[];ipcMain.removeHandler('lumina:command');ipcMain.handle('lumina:command',(event,input)=>{globalThis.__firstCacheCommands.push(input.type);return handler(event,input);});});
 await open(photos);await dialog().getByText(/磁盘可用空间/).waitFor();assert.equal(await dialog().getByLabel('首次媒体缓存路径',{exact:true}).inputValue(),initial.directory);assert.equal(await dialog().getByLabel('首次媒体缓存路径',{exact:true}).getAttribute('readonly'),'');assert.equal((await command({type:'roots.list'})).length,0);assert.equal((await command({type:'tasks.list'})).length,0);
 pass('首次确认页显示实际默认路径、可用空间和只读路径选择，未点击确认前不建立索引或任务');
 await choose(photos);await dialog().getByRole('button',{name:'选择缓存目录',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'缓存目录不能放在图库目录内或包含图库目录'}).waitFor();assert(await dialog().getByRole('button',{name:'确认并后台添加',exact:true}).isDisabled());
 await choose(cache);await dialog().getByRole('button',{name:'选择缓存目录',exact:true}).click();await dialog().getByText(/磁盘可用空间/).waitFor();await dialog().getByRole('button',{name:'取消',exact:true}).click();assert.equal((await command({type:'cache.settings'})).directory,initial.directory);assert.equal((await command({type:'cache.settings'})).setupRequired,true);assert.deepEqual(await command({type:'roots.list'}),[]);
 pass('拒绝图库内缓存位置；改选后取消不保存路径、不添加图库');
 await open(photos);await dialog().getByText(/磁盘可用空间/).waitFor();await choose(cache);await dialog().getByRole('button',{name:'选择缓存目录',exact:true}).click();await dialog().getByText(/磁盘可用空间/).waitFor();await page.screenshot({path:path.join(qaRoot,'first-cache-confirmation.png')});
 await dialog().getByRole('button',{name:'确认并后台添加',exact:true}).click();await dialog().waitFor({state:'hidden'});
 await page.waitForFunction(async()=> (await window.lumina.command({type:'roots.list'})).length===1);const task=(await command({type:'tasks.list',limit:100})).find(row=>row.kind==='directory-rules');await finish(task.id);
 const settings=await command({type:'cache.settings'});assert.equal(settings.directory,cache);assert.equal(settings.setupRequired,false);
 const commands=await desktop.evaluate(()=>globalThis.__firstCacheCommands);assert(commands.indexOf('cache.setup')>=0&&commands.indexOf('cache.setup')<commands.indexOf('roots.configure'));
 const [media]=await command({type:'media.list'}),thumbnail=await command({type:'media.thumbnail',id:media.id});assert.equal(path.dirname(thumbnail.cachePath),cache);await stat(thumbnail.cachePath);
 const progress=page.getByRole('dialog',{name:'任务进度',exact:true});if(await progress.count())await progress.getByRole('button',{name:'关闭',exact:true}).click();
 pass('先保存缓存位置，再添加/扫描图库，第一张缩略图直接写入选定位置');
 await page.locator('.sidebar .nav-item').filter({hasText:'常规'}).click();await page.getByLabel('当前媒体缓存路径',{exact:true}).waitFor();assert.equal(await page.getByLabel('当前媒体缓存路径',{exact:true}).inputValue(),cache);
 await choose(second);await page.getByRole('button',{name:'＋ 添加目录',exact:true}).click();await dialog().getByRole('button',{name:'确认并后台添加',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.first-library-cache'));assert.equal(await dialog().getByRole('region',{name:'首次设置缓存目录'}).count(),0);await dialog().getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'目录设置',exact:true}).first().click();assert.equal(await page.getByRole('dialog',{name:'编辑目录',exact:true}).locator('.first-library-cache').count(),0);
 pass('常规页同步显示选定缓存；后续添加和编辑图库不重复显示首次设置');
 assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot,checks}));
}catch(error){console.error('QA ROOT '+qaRoot);await page.screenshot({path:path.join(qaRoot,'failure.png')}).catch(()=>{});throw error;}finally{clearTimeout(deadline);await desktop.close();}
