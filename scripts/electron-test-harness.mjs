import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
async function mainPage(desktop){
 const began=Date.now();
 while(Date.now()-began<25000){for(const page of desktop.windows()){if(await page.locator('.app-header').count().catch(()=>0)){await page.waitForFunction(()=>document.documentElement.dataset.startup==='ready',{},{timeout:20000});return page;}}await new Promise(resolve=>setTimeout(resolve,60));}
 throw new Error('主窗口未完成启动，请查看加载小窗与启动日志');
}
export async function launchIsolated(packageRoot, label) {
  packageRoot = path.resolve(packageRoot);
  const executable=packageRoot.toLowerCase().endsWith('.exe');
  const qaRoot = path.resolve(process.env.LUMINA_QA_ROOT || 'build-staging', `${label}${executable?'-exe':''}-${Date.now()}`);
  const userData = path.join(qaRoot, 'user-data'); await mkdir(userData, { recursive: true });
  if(executable){
    const {_electron:electron}=require(process.env.LUMINA_PLAYWRIGHT_PATH||'playwright');
    const env={...process.env,LUMINA_TEST_USER_DATA:userData};delete env.ELECTRON_RUN_AS_NODE;
    const desktop=await electron.launch({executablePath:packageRoot,args:[`--user-data-dir=${userData}`],env,timeout:20000});const page=await mainPage(desktop),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.locator('.app-header').waitFor({timeout:20000});
    if(path.resolve(await desktop.evaluate(({app})=>app.getPath('userData')))!==path.resolve(userData)){await desktop.close();throw new Error('测试 userData 隔离校验失败');}
    const command=request=>page.evaluate(input=>window.lumina.command(input),request);
    if((await command({type:'health'})).mediaCount!==0){await desktop.close();throw new Error('隔离测试库必须为空');}
    return {desktop,page,qaRoot,errors,command,diagnostics:async()=>readFile(path.join(userData,'lumina-main.log'),'utf8').catch(()=>'')};
  }
  const { buildSync } = require('../apps/desktop/node_modules/esbuild');
  const syncMain = path.join(qaRoot, 'app-main.cjs');
  buildSync({ entryPoints: [path.join(packageRoot, 'dist/main.js')], outfile: syncMain, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], define: { 'import.meta.url': JSON.stringify(pathToFileURL(path.join(packageRoot, 'dist/main.js')).href) } });
  const wrapper = path.join(qaRoot, 'main.cjs');
  await writeFile(wrapper, `const { app } = require('electron');
app.setPath('userData',${JSON.stringify(userData)}); app.setAppPath(${JSON.stringify(packageRoot)});
Object.defineProperty(app,'isPackaged',{value:true}); require(${JSON.stringify(syncMain)});
`);
  const { _electron: electron } = require(process.env.LUMINA_PLAYWRIGHT_PATH || 'playwright');
  const env = { ...process.env,LUMINA_TEST_USER_DATA:userData }; delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({ executablePath: path.resolve('apps/desktop/node_modules/electron/dist/electron.exe'), args: [wrapper,`--user-data-dir=${userData}`], env,timeout:20000 });
  const page = await mainPage(desktop); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.app-header').waitFor({timeout:20000});
  if(path.resolve(await desktop.evaluate(({app})=>app.getPath('userData')))!==path.resolve(userData) || (await page.evaluate(()=>window.lumina.command({type:'health'}))).mediaCount!==0){await desktop.close();throw new Error('测试数据目录隔离校验失败');}
  return { desktop, page, qaRoot, errors, command: (request) => page.evaluate((input) => window.lumina.command(input), request), diagnostics: async () => readFile(path.join(userData, 'lumina-main.log'), 'utf8').catch(() => '') };
}
