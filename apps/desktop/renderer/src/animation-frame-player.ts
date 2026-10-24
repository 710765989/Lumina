import {t} from './i18n';
// The automatic preview owns one decoded output frame at a time. A native <img>
// remains available for deliberate hover playback of expensive originals.
type Frame=CanvasImageSource & {displayWidth:number;displayHeight:number;duration:number|null;close:()=>void};
type Decoder={tracks:{ready:Promise<unknown>;selectedTrack?:{frameCount:number}|null};decode:(options:{frameIndex:number})=>Promise<{image:Frame}>;close:()=>void};
type DecoderConstructor={new(options:{data:Uint8Array;type:string;preferAnimation:boolean;desiredWidth:number;desiredHeight:number}):Decoder;isTypeSupported:(type:string)=>Promise<boolean>};
export function animationPreviewSize(width:number,height:number){const scale=Math.min(1,480/width,320/height);return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};}
export function animationWorkingBytes(sizeBytes:number,width:number,height:number){
 const output=animationPreviewSize(width,height);
 // Reserve compressed input/decoder data, source/compositing working surfaces
 // and the small displayed canvas. This is an estimate, not process RSS.
 return sizeBytes*2+width*height*4*3+output.width*output.height*4;
}
async function readBounded(response:Response,maxBytes:number){
 if(!response.ok)throw new Error("动图预览加载失败");
 if(maxBytes>0&&Number(response.headers.get('content-length'))>maxBytes)throw new Error("动图超过自动播放大小限制");
 if(!response.body)throw new Error("动图内容不可用");
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(maxBytes>0&&total>maxBytes)throw new Error("动图超过自动播放大小限制");chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
export function playAnimationFrames(options:{canvas:HTMLCanvasElement;url:string;width:number;height:number;maxBytes:number;onReady:()=>void;onError:()=>void}){
 const {canvas,onReady,onError}=options,controller=new AbortController();let stopped=false,decoder:Decoder|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 function release(){const current=decoder;decoder=undefined;try{current?.close();}catch{/* An already failed decoder may be closed. */}}
 async function run(){
  const Constructor=(globalThis as typeof globalThis & {ImageDecoder?:DecoderConstructor}).ImageDecoder;
  if(!Constructor)throw new Error("当前环境不支持逐帧动图预览");
  const response=await fetch(options.url,{signal:controller.signal});
  const mime=response.headers.get('content-type')?.split(';')[0]??'image/gif';
  if(!await Constructor.isTypeSupported(mime))throw new Error("当前动图格式不支持自动预览");
  if(stopped)return;
  const data=await readBounded(response,options.maxBytes);if(stopped)return;
  const size=animationPreviewSize(options.width,options.height);
  decoder=new Constructor({data,type:mime,preferAnimation:true,desiredWidth:size.width,desiredHeight:size.height});
  await decoder.tracks.ready;if(stopped)return;
  const count=decoder.tracks.selectedTrack?.frameCount??0;if(!count)throw new Error("动图没有可播放的画面");
  canvas.width=size.width;canvas.height=size.height;
  const context=canvas.getContext('2d',{alpha:true});if(!context)throw new Error("无法绘制动图预览");
  let index=0,ready=false;
  async function next(){
   if(stopped||!decoder)return;
   const began=performance.now();const {image}=await decoder.decode({frameIndex:index});let duration=100;
   try{if(stopped)return;context!.clearRect(0,0,canvas.width,canvas.height);context!.drawImage(image,0,0,canvas.width,canvas.height);duration=Math.max(20,(image.duration??100000)/1000);if(!ready){ready=true;onReady();}}
   finally{image.close();}
   if(stopped)return;
   index=(index+1)%count;
   timer=setTimeout(()=>void next().catch(fail),Math.max(0,duration-(performance.now()-began)));
  }
  await next();
 }
 function fail(){if(stopped)return;stopped=true;controller.abort();clearTimeout(timer);release();canvas.width=0;canvas.height=0;onError();}
 void run().catch(fail);
 return()=>{stopped=true;controller.abort();clearTimeout(timer);release();canvas.width=0;canvas.height=0;};
}
