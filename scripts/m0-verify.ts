import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { scanDirectory, getHealth } from '@lumina/core';
import { closeDatabase, openDatabase } from '@lumina/storage';

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lumina-m0-'));
const mediaRoot = path.join(tempRoot, 'library');
await mkdir(path.join(mediaRoot, 'nested'), { recursive: true });
const require=createRequire(import.meta.url);const sharp=require('../packages/core/node_modules/sharp');sharp.cache(false);
await writeFile(path.join(mediaRoot, 'one.jpg'),await sharp({create:{width:120,height:80,channels:3,background:'#3478d4'}}).jpeg().toBuffer());
const ffmpeg=require('../packages/core/node_modules/ffmpeg-static') as string;
await new Promise<void>((resolve,reject)=>{const process=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x180:d=0.5','-pix_fmt','yuv420p',path.join(mediaRoot,'nested','two.mp4')],{windowsHide:true});process.on('error',reject);process.on('close',(code)=>code===0?resolve():reject(new Error(`Video fixture failed: ${code}`)));});
const db = openDatabase(path.join(tempRoot, 'lumina.db'));
try {
  const result = await scanDirectory(db, mediaRoot);
  const health = getHealth(db);
  if (health.foreignKeys !== 1 || health.mediaCount !== 2 || result.task.status !== 'completed') throw new Error(`M0 verification failed: ${JSON.stringify({ health, task: result.task })}`);
  console.log(JSON.stringify({ ok: true, mediaCount: health.mediaCount, task: result.task }, null, 2));
} finally {
  closeDatabase(db);
  await rm(tempRoot, { recursive: true, force: true });
}
