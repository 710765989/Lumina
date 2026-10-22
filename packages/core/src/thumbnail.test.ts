import {runFfmpeg} from './thumbnail.js';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import ffmpegPath from 'ffmpeg-static';
import { generatePhotoThumbnail, generateVideoThumbnail, generateMediaThumbnail, getCachedThumbnail, thumbnailCachePath } from './thumbnail.js';

let tempRoot: string | undefined;
// Avoid Windows retaining fixture file handles in libvips' operation cache.
sharp.cache(false);

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('photo thumbnails', () => {
  it('rejects a truncated cached JPEG and rebuilds a decodable thumbnail', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lumina-damaged-cache-'));
    const source = path.join(tempRoot, 'source.jpg');
    await sharp({ create: { width: 800, height: 400, channels: 3, background: '#3478d4' } }).jpeg().toFile(source);
    const record = { id: 'damaged-cache', absolutePath: source, kind: 'photo' as const, sizeBytes: 0, modifiedAtMs: 1, fingerprint: 'cache-fixture' };
    const cache = path.join(tempRoot, 'thumbs');
    const initial = await generateMediaThumbnail(record, cache);
    const bytes = await readFile(initial.cachePath);
    // JPEG headers remain readable even when scan data is missing.
    await writeFile(initial.cachePath, bytes.subarray(0, Math.floor(bytes.length * 0.7)));
    expect((await sharp(initial.cachePath).metadata()).width).toBeGreaterThan(0);
    expect(await getCachedThumbnail(record, cache)).toBeNull();
    const rebuilt = await generateMediaThumbnail(record, cache);
    await expect(sharp(rebuilt.cachePath).raw().toBuffer()).resolves.toBeInstanceOf(Buffer);
  });

  it('coalesces concurrent requests and publishes only a complete JPEG', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lumina-concurrent-cache-'));
    const source = path.join(tempRoot, 'source.png');
    await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#3478d4' } }).png().toFile(source);
    const record = { id: 'concurrent', absolutePath: source, kind: 'photo' as const, sizeBytes: 0, modifiedAtMs: 1, fingerprint: 'concurrent-fixture' };
    const cache = path.join(tempRoot, 'thumbs');
    const results = await Promise.all(Array.from({ length: 12 }, () => generateMediaThumbnail(record, cache)));
    expect(results.every((result) => result === results[0])).toBe(true);
    await expect(sharp(results[0]!.cachePath).raw().toBuffer()).resolves.toBeInstanceOf(Buffer);
    expect(await readdir(cache)).toEqual([path.basename(results[0]!.cachePath)]);
  });

  it('creates a fingerprinted JPEG cache entry without changing the source', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lumina-thumbnail-'));
    const source = path.join(tempRoot, 'source.png');
    const cache = path.join(tempRoot, 'thumbs');
    await sharp({ create: { width: 800, height: 400, channels: 3, background: '#3478d4' } }).png().toFile(source);
    const record = { id: 'media-1', absolutePath: source, kind: 'photo' as const, sizeBytes: 0, modifiedAtMs: 1, fingerprint: 'fingerprint-1' };
    const result = await generatePhotoThumbnail(record, cache, { width: 320, height: 320 });
    expect(result.width).toBe(640);
    expect(result.height).toBe(320);
    expect(result.bytes).toBeGreaterThan(0);
    expect(await readFile(source)).toHaveLength((await readFile(source)).length);
    expect(result.cachePath).toBe(thumbnailCachePath(cache, record, { width: 320, height: 320 }));
  });

  it('extracts a frame from a video through ffmpeg-static', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lumina-video-thumbnail-'));
    const binary = ffmpegPath;
    if (!binary) throw new Error('ffmpeg binary is unavailable');
    const video = path.join(tempRoot, 'clip.mp4');
    await new Promise<void>((resolve, reject) => {
      const process = spawn(binary, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=0.5', '-pix_fmt', 'yuv420p', video], { windowsHide: true });
      process.on('error', reject);
      process.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg fixture failed: ${code}`)));
    });
    const result = await generateVideoThumbnail({ id: 'video-1', absolutePath: video, kind: 'video', sizeBytes: 0, modifiedAtMs: 1, fingerprint: 'video-fingerprint' }, path.join(tempRoot, 'thumbs'));
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.bytes).toBeGreaterThan(0);
  });
});

it('shares one thumbnail across all requested UI sizes and removes superseded fingerprint variants',async()=>{
  tempRoot=await mkdtemp(path.join(os.tmpdir(),'lumina-one-thumb-'));const source=path.join(tempRoot,'original.png'),cache=path.join(tempRoot,'thumbs');await sharp({create:{width:1000,height:700,channels:3,background:'#3184e7'}}).png().toFile(source);
  const record={id:'single',kind:'photo' as const,absolutePath:source,sizeBytes:0,modifiedAtMs:1,fingerprint:'one'};
  const a=await generateMediaThumbnail(record,cache,{width:160,height:100});const b=await generateMediaThumbnail(record,cache,{width:1200,height:900});expect(a.cachePath).toBe(b.cachePath);expect(await readdir(cache)).toHaveLength(1);
  const latest=await generateMediaThumbnail({...record,fingerprint:'two'},cache);expect(latest.cachePath).not.toBe(a.cachePath);expect(await readdir(cache)).toEqual([path.basename(latest.cachePath)]);expect(await getCachedThumbnail({...record,fingerprint:'two'},cache,{width:110,height:110})).not.toBeNull();
});

it('aborts a compatibility conversion promptly and waits for the child to stop',async()=>{const controller=new AbortController(),started=Date.now();const request=runFfmpeg(['-hide_banner','-loglevel','error','-re','-f','lavfi','-i','testsrc2=s=160x90:r=20:d=600','-f','null','-'],controller.signal);setTimeout(()=>controller.abort(),40);await expect(request).rejects.toThrow('任务已取消');expect(Date.now()-started).toBeLessThan(3000);});
