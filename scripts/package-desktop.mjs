import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode=process.argv[2]??'dir';if(!['dir','zip','nsis','portable'].includes(mode))throw new Error('打包类型必须为 dir、zip、nsis 或 portable');
const desktop = path.join(root, 'apps', 'desktop');
const stage = path.join(root, 'build-staging', `desktop-${Date.now()}`);
await mkdir(stage, { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const manifest=JSON.parse(await readFile(path.join(desktop,'package.json'),'utf8'));
manifest.dependencies=Object.fromEntries(Object.entries(manifest.dependencies??{}).filter(([,version])=>!String(version).startsWith('workspace:')));
await writeFile(path.join(stage,'package.json'),JSON.stringify(manifest,null,2));
await cp(path.join(desktop, 'dist'), path.join(stage, 'dist'), { recursive: true });
await cp(path.join(desktop, 'assets'), path.join(stage, 'assets'), { recursive: true });
await mkdir(path.join(stage, 'dist', 'licenses'), { recursive: true });
await cp(path.join(root, 'packages', 'core', 'src', 'data', 'LICENSE-GeoNames.md'), path.join(stage, 'dist', 'licenses', 'GeoNames.md'));
await cp(path.join(root,'packages','contracts','node_modules','pinyin-pro','LICENSE'),path.join(stage,'dist','licenses','pinyin-pro.txt'));
let builderConfig = await readFile(path.join(desktop, 'electron-builder.yml'), 'utf8');
if (mode !== 'dir') {
  builderConfig = builderConfig.replace(/target:\r?\n\s+- target: dir\r?\n\s+arch:\r?\n\s+- x64/u, `target:\n    - target: ${mode}\n      arch:\n        - x64`);
}
builderConfig=builderConfig.replace('output: release',`output: ${JSON.stringify(path.join(desktop,'release'))}`);
await writeFile(path.join(stage, 'electron-builder.yml'), builderConfig);
await cp(path.join(root,'THIRD_PARTY_NOTICES.md'),path.join(stage,'dist','licenses','THIRD_PARTY_NOTICES.md'));
execFileSync(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
const ffmpegFile = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpegSource = path.join(root, 'packages', 'core', 'node_modules', 'ffmpeg-static', ffmpegFile);
const ffmpegTarget = path.join(stage, 'node_modules', 'ffmpeg-static', ffmpegFile);
await cp(ffmpegSource, ffmpegTarget);
const builder = path.join(desktop, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
const target = mode === 'dir' ? ['--dir'] : ['--win',mode,'--x64'];
execFileSync(builder, [...target, '--projectDir', stage, '--config', path.join(stage, 'electron-builder.yml')], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
// This directory was created above only for this build; output lives outside it.
if(!stage.startsWith(path.join(root,'build-staging')+path.sep))throw new Error('构建临时目录越界');
await rm(stage,{recursive:true,force:true});
console.log('发布文件：',path.join(desktop,'release'));
