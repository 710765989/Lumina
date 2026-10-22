import {createHash,randomUUID} from 'node:crypto';
import {mkdir,rename,stat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {runFfmpeg} from './thumbnail.js';

// Hover never requests a complete compatibility transcode. Only one short,
// silent, low-resolution clip may be generated at a time, including teardown.
export class HoverVideoPreviews {
  private active?:{session:string;id:string;target:string;abort:AbortController;promise:Promise<{cachePath:string}>};
  private cancelled=new Set<string>();
  private closed=false;
  cancel(session:string){
    this.cancelled.add(session);if(this.cancelled.size>256)this.cancelled.delete(this.cancelled.values().next().value!);
    if(this.active?.session===session)this.active.abort.abort();
  }
  close(){this.closed=true;this.active?.abort.abort();}
  async prepare(media:{id:string;fingerprint:string},source:string,root:string,session:string,valid:()=>boolean){
    if(this.closed||this.cancelled.has(session))throw new Error('预览已取消');
    const abort=new AbortController();
    const key=createHash('sha256').update(`${media.id}:${media.fingerprint}:hover-v1`).digest('hex');
    const target=path.join(root,`playback-${key}.mp4`),temporary=`${target}.${randomUUID()}.mp4`;
    const running=this.active;
    // Range requests and a newly mounted view may refer to the same poster clip.
    // Transfer cancellation ownership instead of starting the encoder again.
    if(running?.target===target&&!running.abort.signal.aborted){running.session=session;return running.promise;}
    const previous=this.active;previous?.abort.abort();
    const promise=(async()=>{
      await previous?.promise.catch(()=>{});abort.signal.throwIfAborted();
      if(!valid())throw new Error('媒体已移除或更新');
      try{const file=await stat(target);if(file.isFile()&&file.size>0){abort.signal.throwIfAborted();if(!valid())throw new Error('媒体已移除或更新');return {cachePath:target};}}catch{abort.signal.throwIfAborted();/* Generate below. */}
      const timeout=setTimeout(()=>abort.abort(),15000);
      try{
        await mkdir(root,{recursive:true});
        await runFfmpeg(['-y','-hide_banner','-loglevel','error','-threads','2','-i',source,'-t','6','-map','0:v:0','-an','-sn','-vf',"scale='min(480,iw)':-2,fps=15",'-c:v','libx264','-threads','2','-preset','ultrafast','-crf','28','-pix_fmt','yuv420p','-movflags','+faststart',temporary],abort.signal);
        abort.signal.throwIfAborted();if(!valid())throw new Error('媒体已移除或更新');
        await rename(temporary,target);if(!valid()){await unlink(target).catch(()=>{});throw new Error('媒体已移除或更新');}return {cachePath:target};
      }finally{clearTimeout(timeout);await unlink(temporary).catch(()=>{});}
    })();
    this.active={session,id:media.id,target,abort,promise};
    try{return await promise;}finally{if(this.active?.abort===abort)this.active=undefined;}
  }
}
