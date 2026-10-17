import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.cwd(), '..', '..');
const desktop = path.join(root, 'apps', 'desktop');
const stage = path.join(root, 'build-staging', `desktop-${Date.now()}`);
await mkdir(stage, { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
await cp(path.join(desktop, 'package.json'), path.join(stage, 'package.json'));
await cp(path.join(desktop, 'dist'), path.join(stage, 'dist'), { recursive: true });
const builderConfig = await readFile(path.join(desktop, 'electron-builder.yml'), 'utf8');
await writeFile(path.join(stage, 'electron-builder.yml'), builderConfig);
execFileSync(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, HTTP_PROXY: process.env.HTTP_PROXY ?? 'http://127.0.0.1:7890', HTTPS_PROXY: process.env.HTTPS_PROXY ?? 'http://127.0.0.1:7890' } });
const builder = path.join(desktop, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
const target = process.argv[2] === 'portable' ? ['--win', 'portable'] : ['--dir'];
execFileSync(builder, [...target, '--projectDir', stage, '--config', path.join(stage, 'electron-builder.yml')], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
