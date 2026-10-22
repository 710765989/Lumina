import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, link, unlink, mkdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function exists(file: string) { try { await stat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
export async function hashFile(file: string,signal?:AbortSignal) {
  const hash = createHash('sha256');
  if(signal?.aborted)throw new Error('已取消，未执行');
  try{for await (const chunk of createReadStream(file,{signal})) hash.update(chunk);}catch(error){if(signal?.aborted)throw new Error('已取消，未执行');throw error;}
  return hash.digest('hex');
}
// Windows decoders and virus scanners can briefly deny unlink while releasing
// handles. Bound the wait, keep cancellation responsive, and recheck content
// before retrying the destructive step of a verified move.
export async function unlinkWithRetry(file:string,signal?:AbortSignal,beforeRetry?:()=>Promise<void>){
  for(let attempt=0;;attempt++){
    if(signal?.aborted)throw new Error('已取消，未执行');
    try{await unlink(file);return;}catch(error){
      if(attempt>=5 || !['EPERM','EBUSY','EACCES'].includes((error as NodeJS.ErrnoException).code??''))throw error;
      await new Promise<void>((resolve,reject)=>{
        const cancel=()=>{clearTimeout(timer);reject(new Error('已取消，未执行'));};
        const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},Math.min(320,40*2**attempt));
        signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
      });
      if(beforeRetry)await beforeRetry();
    }
  }
}
// No overwrite, including when the destination appears after the initial check.
// Link/unlink is atomic on one volume; cross-volume copies are verified first.
export async function moveExclusive(source: string, target: string, expectedHash?: string,signal?:AbortSignal) {
  if (path.resolve(source).toLocaleLowerCase() === path.resolve(target).toLocaleLowerCase()) throw new Error('来源与目标相同');
  await mkdir(path.dirname(target), { recursive: true });
  let copied = false;let created=false;
  try {
  if(signal?.aborted)throw new Error('已取消，未执行');
  try { await link(source, target);created=true; }
  catch (error) {
    if (!['EXDEV', 'EPERM', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    const before = await stat(source);
    await copyFile(source, target, constants.COPYFILE_EXCL); copied = true;created=true;
    const after = await stat(source);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || await hashFile(source,signal) !== await hashFile(target,signal)) {
      await unlink(target); throw new Error('文件在复制过程中变化，已保留原文件');
    }
  }
  if (expectedHash && (await hashFile(source,signal) !== expectedHash || copied && await hashFile(target,signal) !== expectedHash)) {
    await unlink(target).catch(() => {}); throw new Error('文件内容已变化，已保留原文件');
  }
  if(signal?.aborted)throw new Error('已取消，未执行');
  try { await unlinkWithRetry(source,signal,async()=>{if(expectedHash && (await hashFile(source,signal)!==expectedHash || copied && await hashFile(target,signal)!==expectedHash))throw new Error('文件在等待释放期间变化，已保留原文件');}); }
  catch (error) { await unlink(target).catch(() => {}); throw error; }
  return { copied };
  }catch(error){if(created && await exists(source))await unlink(target).catch(()=>{});throw error;}
}
export async function copyExclusive(source: string, directory: string, name: string) {
  await mkdir(directory, { recursive: true });
  const parsed = path.parse(path.basename(name));
  for (let index = 0; index < 10000; index++) {
    const target = path.join(directory, `${parsed.name}${index ? ` (${index})` : ''}${parsed.ext}`);
    try { await copyFile(source, target, constants.COPYFILE_EXCL); return target; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  throw new Error('重名文件过多，请选择另一个目录');
}
export async function directoryBytes(directory: string): Promise<number> {
  const { readdir } = await import('node:fs/promises');
  try {
    let bytes = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) bytes += await directoryBytes(file);
      else if (entry.isFile()) bytes += (await stat(file)).size;
    }
    return bytes;
  } catch { return 0; }
}
