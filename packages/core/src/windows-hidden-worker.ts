import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
const script=`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
while ($null -ne ($line = [Console]::In.ReadLine())) {
 try {
  $request = $line | ConvertFrom-Json
  $attributes = [System.IO.File]::GetAttributes([string]$request.path)
  if ($request.action -ne 'read') {
   $next = [int]$attributes -band (-bnot [int][System.IO.FileAttributes]::Hidden)
   if ($request.hidden) { $next = $next -bor [int][System.IO.FileAttributes]::Hidden }
   if ($next -ne [int]$attributes) { [System.IO.File]::SetAttributes([string]$request.path,[System.IO.FileAttributes]$next) }
  }
  [Console]::WriteLine((@{ok=$true;attributes=[int]$attributes} | ConvertTo-Json -Compress))
 } catch { [Console]::WriteLine((@{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress)) }
}
`;
// Reuse one helper rather than launching a shell for each attribute read/write.
// File paths are structured stdin data and never form part of shell code.
export class WindowsHiddenAttributes{
 private child?:ChildProcessWithoutNullStreams;private sequence:Promise<unknown>=Promise.resolve();private output='';private idle?:ReturnType<typeof setTimeout>;
 private current?:{resolve:(value:number)=>void;reject:(reason:Error)=>void;timer:ReturnType<typeof setTimeout>};
 request(file:string,hidden?:boolean,signal?:AbortSignal):Promise<number>{const result=this.sequence.then(()=>{signal?.throwIfAborted();return this.perform(file,hidden,signal);});this.sequence=result.catch(()=>{});return result;}
 close(){clearTimeout(this.idle);const child=this.child;this.child=undefined;if(this.current){clearTimeout(this.current.timer);this.current.reject(new Error('同步 Windows 隐藏属性已停止'));this.current=undefined;}child?.stdin.end();child?.kill();}
 private perform(file:string,hidden?:boolean,signal?:AbortSignal):Promise<number>{
  signal?.throwIfAborted();
  if(process.platform!=='win32')return Promise.reject(new Error('当前系统不支持同步 Windows 隐藏属性'));
  clearTimeout(this.idle);
  if(!this.child){
   const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});this.child=child;this.output='';
   const failed=()=>{if(this.child!==child)return;this.child=undefined;if(this.current){clearTimeout(this.current.timer);this.current.reject(new Error('同步 Windows 隐藏属性服务中断，请重试'));this.current=undefined;}};
   child.on('error',failed);child.on('exit',failed);child.stdin.on('error',failed);child.stderr.on('data',()=>{});
   child.stdout.on('data',chunk=>{if(this.child!==child)return;this.output+=String(chunk);for(let end;(end=this.output.indexOf('\n'))>=0;){const line=this.output.slice(0,end).trim();this.output=this.output.slice(end+1);if(!line)continue;let result:any;try{result=JSON.parse(line);}catch{continue;}const current=this.current;if(!current)continue;this.current=undefined;clearTimeout(current.timer);if(result.ok&&Number.isInteger(result.attributes))current.resolve(result.attributes);else current.reject(new Error(`同步 Windows 隐藏属性失败：${result.error??'无法读取或设置文件属性'}`));this.idle=setTimeout(()=>this.close(),2000);this.idle.unref();}});
  }
  const abort=()=>this.close();
  const result=new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>{this.current=undefined;reject(new Error('同步 Windows 隐藏属性超时，请重试'));this.close();},10000);this.current={resolve,reject,timer};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}this.child!.stdin.write(JSON.stringify({path:file,action:hidden===undefined?'read':'write',hidden})+'\n');});
  return result.finally(()=>signal?.removeEventListener('abort',abort));
 }
}
