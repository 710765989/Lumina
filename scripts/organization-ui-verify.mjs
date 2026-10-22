// Run against a completed package directory. Playwright is a verification-only dependency.
// LUMINA_PLAYWRIGHT_PATH can point to an existing Playwright installation.
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.LUMINA_PLAYWRIGHT_PATH || 'playwright');
const sharp = require('../packages/core/node_modules/sharp');
const packageRoot = path.resolve(process.argv[2]);
const qaRoot = path.resolve('build-staging', `organization-qa-${Date.now()}`);
const fixtureRoot = path.join(qaRoot, 'fixtures');
await mkdir(fixtureRoot, { recursive: true });
await mkdir(path.join(qaRoot, 'user-data'), { recursive: true });
const fixture = path.join(fixtureRoot, 'organization-check.jpg');
await sharp({ create: { width: 120, height: 80, channels: 3, background: '#3478d4' } }).jpeg().toFile(fixture);
const wrapper = path.join(qaRoot, 'main.cjs');
const { buildSync } = require('../apps/desktop/node_modules/esbuild');
const syncMain = path.join(qaRoot, 'app-main.cjs');
// Keep protocol registration synchronous, before Electron reaches app.ready.
buildSync({ entryPoints: [path.join(packageRoot, 'dist/main.js')], outfile: syncMain,
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(path.join(packageRoot, 'dist/main.js')).href) } });
// Use the shipped main/preload/renderer/core-host with an isolated test database.
await writeFile(wrapper, `const { app } = require('electron');
const fs = require('node:fs');
const report = (error) => fs.appendFileSync(${JSON.stringify(path.join(qaRoot, 'startup.log'))}, String(error.stack || error) + '\\n');
process.on('uncaughtException', report);
process.on('unhandledRejection', report);
fs.appendFileSync(${JSON.stringify(path.join(qaRoot, 'startup.log'))}, 'wrapper started\\n');
app.setPath('userData', ${JSON.stringify(path.join(qaRoot, 'user-data'))});
app.setAppPath(${JSON.stringify(packageRoot)});
Object.defineProperty(app, 'isPackaged', { value: true });
require(${JSON.stringify(syncMain)});
`);
const errors = [];
let desktop;
const executablePath = path.resolve('apps/desktop/node_modules/electron/dist/electron.exe');
const launch = async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await electron.launch({ executablePath, args: [wrapper], env });
  desktop.process().stderr.on('data', (chunk) => console.error(String(chunk).trim()));
  const page = await desktop.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.sidebar .nav-item').filter({ hasText: '主页' }).waitFor();
  return page;
};
const command = (page, input) => page.evaluate((request) => window.lumina.command(request), input);

try {
  let page = await launch();
  await command(page, { type: 'roots.addAndScan', absolutePath: fixtureRoot });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.locator('.sidebar .nav-item').filter({ hasText: '相册' }).click();
  await page.getByRole('button', { name: '+新建智能相册' }).click();
  await page.getByRole('dialog',{name:'新建智能相册',exact:true}).getByRole('checkbox',{name:'普通相册',exact:true}).check();
  let dialog = page.getByRole('dialog', { name: '新建相册', exact: true });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '请输入相册名称' }).waitFor();
  await dialog.getByLabel('相册名称').fill('验收相册');
  await dialog.getByLabel('相册描述').fill('测试创建与编辑');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.list-card').filter({ hasText: '验收相册' }).waitFor();
  await page.getByRole('button', { name: '+新建智能相册' }).click();
  await page.getByRole('dialog',{name:'新建智能相册',exact:true}).getByRole('checkbox',{name:'普通相册',exact:true}).check();
  dialog = page.getByRole('dialog', { name: '新建相册', exact: true });
  await dialog.getByLabel('相册名称').fill('验收相册');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '已存在' }).waitFor();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.list-card').filter({ hasText: '验收相册' }).click();
  await page.getByRole('button',{name:'相册更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'编辑相册',exact:true}).click();
  dialog = page.getByRole('dialog', { name: '编辑相册', exact: true });
  await dialog.getByLabel('相册名称').fill('验收相册已编辑');
  await dialog.getByLabel('相册描述').fill('更新后的描述');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('heading', { name: '验收相册已编辑', exact: true }).waitFor();
  await page.locator('.sidebar .nav-item').filter({ hasText: '主页' }).click();
  await page.locator('.media-card').click();
  await page.getByRole('button', { name: '加入相册', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '加入相册', exact: true });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '加入相册', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.sidebar .nav-item').filter({ hasText: '相册' }).click();
  await page.locator('.media-card').waitFor();

  await page.locator('.sidebar .nav-item').filter({ hasText: '标签' }).click();
  await page.getByRole('button', { name: '＋ 新建标签' }).click();
  dialog = page.getByRole('dialog', { name: '新建标签', exact: true });
  await dialog.getByLabel('标签名称').fill('测试标签');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '#测试标签', exact: true }).waitFor();
  const [media] = await command(page, { type: 'media.list' });
  await command(page, { type: 'media.addTag', id: media.id, tagName: '测试标签' });
  await page.getByRole('button', { name: '编辑标签 测试标签', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑标签', exact: true });
  await dialog.getByLabel('标签名称').fill('重命名后的标签');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '#重命名后的标签', exact: true }).click();
  await page.locator('.tags-content .media-card').waitFor();
  await page.locator('.tags-content .media-card').dblclick();
  await page.locator('.preview-panel').waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({ path: path.join(qaRoot, 'tag-associated-media.png') });
  await desktop.close();

  page = await launch();
  await page.locator('.sidebar .nav-item').filter({ hasText: '相册' }).click();
  await page.locator('.list-card').filter({ hasText: '验收相册已编辑' }).click();
  await page.locator('.media-card').waitFor();
  await page.locator('.sidebar .nav-item').filter({ hasText: '标签' }).click();
  await page.getByRole('button', { name: '#重命名后的标签', exact: true }).waitFor();
  await page.getByRole('button', { name: '删除标签 重命名后的标签', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '删除标签', exact: true });
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await command(page, { type: 'tags.list' })).length, 0);
  assert.equal((await command(page, { type: 'media.tags', id: media.id })).length, 0);
  assert.equal((await command(page, { type: 'media.list' })).length, 1);
  const [album] = await command(page, { type: 'albums.list' });
  assert.equal((await command(page, { type: 'albums.media', id: album.id })).length, 1);
  assert((await stat(fixture)).isFile());
  await page.locator('.sidebar .nav-item').filter({ hasText: '相册' }).click();
  await page.getByRole('button',{name:'相册更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'编辑相册',exact:true}).click();
  await page.screenshot({ path: path.join(qaRoot, 'album-editor.png') });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks: ['create album via UI', 'blank/duplicate name validation', 'edit album', 'join album', 'create tag', 'rename tag', 'browse/preview associated media', 'restart persistence', 'delete tag preserves files and album'], qaRoot }));
} catch (error) {
  try { console.error(await readFile(path.join(qaRoot, 'startup.log'), 'utf8')); } catch { /* preserve original failure */ }
  try { console.error(await readFile(path.join(qaRoot, 'user-data/lumina-main.log'), 'utf8')); } catch { /* preserve original failure */ }
  throw error;
} finally {
  await desktop?.close();
}
