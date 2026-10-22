// Run against a completed desktop staging package, never the user's library.
import { createRequire } from 'node:module';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.LUMINA_PLAYWRIGHT_PATH || 'playwright');
const sharp = require('../packages/core/node_modules/sharp');
const { buildSync } = require('../apps/desktop/node_modules/esbuild');
const packageRoot = path.resolve(process.argv[2]);
const qaRoot = path.resolve('build-staging', `media-refresh-qa-${Date.now()}`);
const fixtureRoot = path.join(qaRoot, 'fixtures');
const userData = path.join(qaRoot, 'user-data');
await mkdir(fixtureRoot, { recursive: true }); await mkdir(userData, { recursive: true });
const fixture = path.join(fixtureRoot, 'photo-000.jpg');
await sharp({ create: { width: 120, height: 80, channels: 3, background: '#3478d4' } }).jpeg().toFile(fixture);
await Promise.all(Array.from({ length: 404 }, (_, index) => copyFile(fixture, path.join(fixtureRoot, `photo-${String(index + 1).padStart(3, '0')}.jpg`))));
const syncMain = path.join(qaRoot, 'app-main.cjs');
buildSync({ entryPoints: [path.join(packageRoot, 'dist/main.js')], outfile: syncMain, bundle: true,
  platform: 'node', format: 'cjs', external: ['electron'],
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(path.join(packageRoot, 'dist/main.js')).href) } });
const wrapper = path.join(qaRoot, 'main.cjs');
await writeFile(wrapper, `const { app } = require('electron');
app.setPath('userData', ${JSON.stringify(userData)});
app.setAppPath(${JSON.stringify(packageRoot)});
Object.defineProperty(app, 'isPackaged', { value: true });
require(${JSON.stringify(syncMain)});
`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await electron.launch({ executablePath: path.resolve('apps/desktop/node_modules/electron/dist/electron.exe'), args: [wrapper], env });
const command = (page, request) => page.evaluate((input) => window.lumina.command(input), request);
const errors = [];
try {
  const page = await desktop.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.app-header').waitFor();
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
  const titleMetrics = await page.evaluate(() => ({
    height: document.querySelector('.app-header').getBoundingClientRect().height,
    drag: getComputedStyle(document.querySelector('.app-header')).webkitAppRegion,
    searchDrag: getComputedStyle(document.querySelector('.search-builder')).webkitAppRegion,
    toolsRight: document.querySelector('.header-tools').getBoundingClientRect().right,
    overlay: navigator.windowControlsOverlay?.visible,
    overlayRect: navigator.windowControlsOverlay?.getTitlebarAreaRect().toJSON(),
    width: innerWidth,
  }));
  assert(Math.abs(titleMetrics.height - 48) < 0.1); assert.equal(titleMetrics.drag, 'drag');
  assert.equal(titleMetrics.searchDrag, 'no-drag'); assert.equal(titleMetrics.overlay, true);
  assert(titleMetrics.toolsRight <= titleMetrics.overlayRect.width);
  await page.locator('.search-builder input').click(); await page.locator('.search-mode-menu').waitFor();
  await page.locator('.topbar h1').click();

  await command(page, { type: 'roots.addAndScan', absolutePath: fixtureRoot });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.media-card').length === 200);
  await page.getByRole('button', { name: '加载更多', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.media-card').length === 400);
  await page.getByRole('button', { name: '加载更多', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.media-card').length === 405);
  const last = page.locator('.media-card').last();
  await last.locator('.media-meta').click();
  const before = await page.locator('.grouped-media-scroll').evaluate((node) => node.scrollTop);
  assert(before > 0);
  await page.getByRole('button', { name: '添加标签', exact: true }).click();
  await page.locator('.tag-dialog input').fill('保留分页');
  await page.locator('.tag-dialog').getByRole('button', { name: '添加', exact: true }).click();
  await page.locator('.dialog-tag').filter({ hasText: '#保留分页' }).waitFor();
  await page.locator('.tag-dialog').getByRole('button', { name: '完成', exact: true }).click();
  assert.equal(await page.locator('.media-card').count(), 405);
  assert.equal(await page.locator('.grouped-media-scroll').evaluate((node) => node.scrollTop), before);
  assert.equal(await page.locator('.media-card.selected').count(), 1);
  await page.getByRole('button', { name: '移除标签', exact: true }).click();
  await page.locator('.dialog-tag').filter({ hasText: '#保留分页' }).getByRole('button').click();
  await page.locator('.tag-dialog .dialog-hint').filter({ hasText: '选中媒体暂无标签' }).waitFor();
  await page.locator('.tag-dialog').getByRole('button', { name: '完成', exact: true }).click();
  assert.equal(await page.locator('.media-card').count(), 405);
  assert.equal(await page.locator('.grouped-media-scroll').evaluate((node) => node.scrollTop), before);

  // Exercise the browser's real image-error path, then decode the recovered image.
  const thumbnail = page.locator('.media-card.selected img');
  await thumbnail.waitFor();
  await thumbnail.evaluate((img) => { img.src = 'data:image/jpeg;base64,YnJva2Vu'; });
  await page.waitForFunction(() => {
    const img = document.querySelector('.media-card.selected img');
    return img && img.src !== 'data:image/jpeg;base64,YnJva2Vu' && img.complete && img.naturalWidth > 0;
  });
  await page.screenshot({ path: path.join(qaRoot, 'library-preserved.png') });

  const media = await command(page, { type: 'media.list', limit: 1000 });
  const album = await command(page, { type: 'albums.create', name: '分页相册' });
  await command(page, { type: 'albums.addMedia', id: album.id, mediaIds: media.map((item) => item.id) });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.locator('.sidebar .nav-item').filter({ hasText: '相册' }).click();
  await page.locator('.list-card').filter({ hasText: '分页相册' }).click();
  const viewport = page.locator('.virtual-grid-viewport');
  const initialHeight = await page.locator('.virtual-grid-canvas').evaluate((node) => node.style.height);
  await viewport.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await page.waitForFunction((height) => document.querySelector('.virtual-grid-canvas').style.height !== height, initialHeight);
  await viewport.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await page.getByText('已加载全部媒体', { exact: true }).waitFor();
  const loadedHeight = await page.locator('.virtual-grid-canvas').evaluate((node) => node.style.height);
  await page.locator('.media-card').last().click({ button: 'right' });
  const albumBefore = await viewport.evaluate((node) => node.scrollTop);
  await page.locator('.context-menu').getByRole('button', { name: '添加标签…', exact: true }).click();
  await page.locator('.tag-dialog input').fill('相册内标签');
  await page.locator('.tag-dialog').getByRole('button', { name: '添加', exact: true }).click();
  await page.locator('.dialog-tag').filter({ hasText: '#相册内标签' }).waitFor();
  await page.locator('.tag-dialog').getByRole('button', { name: '完成', exact: true }).click();
  assert.equal(await viewport.evaluate((node) => node.scrollTop), albumBefore);
  assert.equal(await page.locator('.virtual-grid-canvas').evaluate((node) => node.style.height), loadedHeight);
  await page.screenshot({ path: path.join(qaRoot, 'album-preserved.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, titleMetrics, checks: ['405 loaded library items survive tag add/remove', 'library scroll and selection preserved', 'album loaded pages and scroll preserved', 'right-click tag dialog', 'broken image auto-retry', 'integrated titlebar and native controls reserve', 'search remains interactive'], qaRoot }));
} finally { await desktop.close(); }
