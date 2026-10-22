import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated} from './electron-test-harness.mjs';
const {desktop,page,qaRoot,errors}=await launchIsolated(process.argv[2],'m2-lumina-icon');
try{
 const brand=page.locator('.app-brand .brand-mark');await brand.waitFor();assert.equal(await brand.evaluate(img=>img.tagName==='IMG'&&img.complete&&img.naturalWidth===256),true);
 assert.equal(await brand.evaluate(img=>getComputedStyle(img).backgroundColor),'rgba(0, 0, 0, 0)');
 await page.locator('.app-brand').screenshot({path:path.join(qaRoot,'app-brand.png')});await page.screenshot({path:path.join(qaRoot,'main-window.png')});
 const shellIcon=await desktop.evaluate(async({app})=>{const icon=await app.getFileIcon(process.execPath,{size:'normal'});return {empty:icon.isEmpty(),size:icon.getSize(),png:icon.toPNG().toString('base64')};});assert.equal(shellIcon.empty,false);await writeFile(path.join(qaRoot,'windows-shell-icon.png'),Buffer.from(shellIcon.png,'base64'));
 assert.deepEqual(errors,[]);const checks=['最终EXE独立图库启动成功','顶栏相片匣PNG正常解码，背景透明','Windows可读取新版EXE图标'];await writeFile(path.join(qaRoot,'checks.json'),JSON.stringify({ok:true,checks,errors,shellIconSize:shellIcon.size},null,2));console.log(JSON.stringify({ok:true,qaRoot,checks}));
}finally{await desktop.close();}
