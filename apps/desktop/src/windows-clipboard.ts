import { spawn } from 'node:child_process';

// Read only file references. Never execute clipboard text or change its contents.
export async function readWindowsFileList():Promise<string[]> {
  if(process.platform!=='win32')return [];
  const script=`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$files=@([System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { [string]$_ })
ConvertTo-Json -InputObject $files -Compress`;
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>{child.kill();reject(new Error('读取剪贴板超时，请重试'));},10000);let output='';
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(output.length>8*1024*1024)child.kill();});child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error('剪贴板暂时不可读取，请重试'));try{const paths=JSON.parse(output.replace(/^\uFEFF/u,''));if(!Array.isArray(paths)||!paths.every(item=>typeof item==='string'))throw Error();resolve(paths);}catch{reject(new Error('剪贴板文件列表无效'));}});
  });
}

// Windows' FileDrop format maps to CF_HDROP. Explicit COPY prevents a receiver
// from treating file references as a move. JSON is data on stdin, never code.
export async function copyWindowsFiles(files: string[], imagePath?: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('原文件剪贴板当前仅支持 Windows');
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$data = New-Object System.Windows.Forms.DataObject
$paths = New-Object System.Collections.Specialized.StringCollection
foreach ($file in $request.files) { [void]$paths.Add([string]$file) }
$data.SetFileDropList($paths)
$effect = New-Object System.IO.MemoryStream
$effect.Write([byte[]](1,0,0,0),0,4)
$effect.Position = 0
$data.SetData('Preferred DropEffect',$effect)
$image = $null
try {
  if ($request.imagePath) { $image = [System.Drawing.Image]::FromFile([string]$request.imagePath); $data.SetImage($image) }
  [System.Windows.Forms.Clipboard]::SetDataObject($data,$true,10,100)
} finally { if ($image) { $image.Dispose() }; $effect.Dispose() }
`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    const deadline=setTimeout(()=>{child.kill();reject(new Error('系统剪贴板暂时没有响应，请稍后重试'));},15000);
    let error = ''; child.stderr.on('data', (chunk) => { error += String(chunk); }); child.on('error', (error)=>{clearTimeout(deadline);reject(error);});
    child.stdin.on('error',(error)=>{clearTimeout(deadline);child.kill();reject(error);});
    child.on('close', (code) => {clearTimeout(deadline);code === 0 ? resolve() : reject(new Error(error || '剪贴板被其他程序占用，请重试'));});
    child.stdin.end(JSON.stringify({ files, imagePath }));
  });
}
