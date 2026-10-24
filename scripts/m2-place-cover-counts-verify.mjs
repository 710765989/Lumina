import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const require=createRequire(import.meta.url),sharp=require('../apps/desktop/node_modules/sharp');
const {desktop,page,qaRoot,command,errors}=await launchIsolated(process.argv[2],'m2-place-cover-counts');
const deadline=setTimeout(()=>void desktop.close(),120000),checks=[],pass=value=>{checks.push(value);console.log('PASS '+value);};page.setDefaultTimeout(15000);
try{
 await desktop.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(win=>win.getTitle().includes('Lumina'));win.setContentSize(1300,900);});
 await command({...(await command({type:'organization.settings'})),type:'organization.configure',watch:false});
 const root=path.join(qaRoot,'photos');await mkdir(root);
 const colors=['#cf8158','#4479b4','#6ba37a','#8c75ac'];
 for(let n=1;n<=4;n++)for(let index=0;index<n+1;index++){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="${colors[index%4]}"/><circle cx="350" cy="75" r="35" fill="#ffedbd"/><path d="M0 320V230L180 110L320 250L480 150V320Z" fill="#ffffff" fill-opacity=".3"/></svg>`;
  await writeFile(path.join(root,`group-${n}-${index}.jpg`),await sharp(Buffer.from(svg)).jpeg().toBuffer());
 }
 await command({type:'roots.addAndScan',absolutePath:root});const media=await command({type:'media.list',limit:100}),bad=[];
 for(const item of media){const [,group,index]=/group-(\d)-(\d)\.jpg$/u.exec(item.absolutePath);await command({type:'media.attributes',id:item.id,country:'CN',region:'测试地区',city:`${group}张可用照片`});if(index===group)bad.push(item.id);}
 await desktop.evaluate(({ipcMain},bad)=>{const original=ipcMain._invokeHandlers.get('lumina:thumbnail');globalThis.__coverCalls=[];globalThis.__unavailableCovers=new Set(bad);ipcMain.removeHandler('lumina:thumbnail');ipcMain.handle('lumina:thumbnail',(event,input)=>{const id=typeof input==='string'?input:input.mediaId;globalThis.__coverCalls.push(id);if(globalThis.__unavailableCovers.has(id))throw Error('heif: No decoding plugin installed for this compression format');return original(event,input);});},bad);
 await page.locator('.sidebar .nav-item').filter({hasText:'足迹'}).click();
 const layouts=[];
 for(let count=1;count<=4;count++){
  const card=page.getByRole('button',{name:`查看地点 ${count}张可用照片`,exact:true});await card.scrollIntoViewIfNeeded();
  await page.waitForFunction(({count})=>document.querySelector(`[aria-label="查看地点 ${count}张可用照片"] .geo-mosaic`)?.dataset.coverCount===String(count),{count});
  // Wait for the permanently failing candidate as well; the final layout must retain only successful images.
  await page.waitForTimeout(200);if(count<4){const failed=media.find(item=>item.absolutePath.endsWith(`group-${count}-${count}.jpg`));assert(await desktop.evaluate((_,id)=>globalThis.__coverCalls.includes(id),failed.id));}
  const images=card.locator('.geo-mosaic-cell>img');assert.equal(await images.count(),count);for(const image of await images.all())await image.evaluate(image=>image.decode());
  const layout=await card.locator('.geo-mosaic').evaluate(node=>{const box=node.getBoundingClientRect();return {width:box.width,height:box.height,gap:Number.parseFloat(getComputedStyle(node).gap),cells:[...node.querySelectorAll('.geo-mosaic-cell')].map(cell=>{const rect=cell.getBoundingClientRect();return {x:rect.x-box.x,y:rect.y-box.y,width:rect.width,height:rect.height};})};});
  assert(layout.cells.every(cell=>cell.width>20&&cell.height>20&&cell.x>=-1&&cell.y>=-1&&cell.x+cell.width<=layout.width+1&&cell.y+cell.height<=layout.height+1));
  const area=layout.cells.reduce((sum,cell)=>sum+cell.width*cell.height,0);assert(area/(layout.width*layout.height)>.97,'成功照片应填满封面，不能留下固定四宫格空白');
  if(count===1){assert(Math.abs(layout.cells[0].width-layout.width)<1);assert(Math.abs(layout.cells[0].height-layout.height)<1);}
  if(count===2)assert(layout.cells.every(cell=>Math.abs(cell.height-layout.height)<1));
  if(count===3){assert(Math.abs(layout.cells[0].height-layout.height)<1);assert(layout.cells.slice(1).every(cell=>cell.height<layout.height*.6));}
  if(count===4)assert.equal(new Set(layout.cells.map(cell=>Math.round(cell.y))).size,2);
  assert.equal(await card.locator('.geo-mosaic-empty').count(),0);layouts.push({count,...layout});pass(`${count}张有效图、1张模拟不可解码图：仅渲染有效照片，按数量填满封面，无空格`);
 }
 await page.screenshot({path:path.join(qaRoot,'adaptive-covers.png'),scale:'css'});
 const count=2,card=page.getByRole('button',{name:'查看地点 2张可用照片',exact:true});await card.click();await page.getByRole('button',{name:'返回',exact:true}).click();await card.scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('[aria-label="查看地点 2张可用照片"] .geo-mosaic')?.dataset.coverCount==='2');assert.equal(await card.locator('.geo-mosaic-cell').count(),2);pass('进入地点再返回，3项中仅2张可解码仍保持双图铺满，不恢复空格');
 assert.deepEqual(errors,[]);await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,layouts,errors},null,2));console.log(JSON.stringify({ok:true,qaRoot,count:checks.length}));
}catch(error){await page.screenshot({path:path.join(qaRoot,'failure.png'),scale:'css'}).catch(()=>{});console.error('QA ROOT '+qaRoot);throw error;}finally{clearTimeout(deadline);await desktop.close();}
