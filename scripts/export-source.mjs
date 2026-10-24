import {readdir,readFile,writeFile,mkdir,lstat,realpath,access,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const argument=process.argv.indexOf('--out');
if(argument<0||!process.argv[argument+1])throw new Error('用法：node scripts/export-source.mjs --out <新的输出目录>');
const target=path.resolve(process.argv[argument+1]);
if(target===root||root.startsWith(target+path.sep))throw new Error('输出目录不能是源码目录或它的上级');
try{await access(target);throw new Error('输出目录已存在，请使用新的目录以避免覆盖文件');}catch(error){if(error.code!=='ENOENT')throw error;}
const roots=['apps','packages','scripts','docs'];
const rootFiles=['.gitignore','.gitattributes','README.md','README.en.md','README.ja.md','THIRD_PARTY_NOTICES.md','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','tsconfig.json'];
const excluded=new Set(['node_modules','dist','release','release-verify','build-staging','data','cache','media-cache','thumbnails','previews','user-data','tmp','output','coverage','.git','.codex','.agents','.workbuddy','.vscode','.idea']);
const codeTypes=new Set(['.ts','.tsx','.mjs','.nsh','.ps1','.py','.json','.yaml','.yml','.md','.css','.html']);
const assets=new Set(['apps/desktop/assets/lumina-album-icon.ico','apps/desktop/assets/lumina-album-icon.png','apps/desktop/renderer/public/lumina-album-icon-256.png','docs/images/gallery-browsing.gif','docs/images/tag-search.gif']);
const files=[];
async function collect(relative){
 const full=path.join(root,relative),info=await lstat(full);if(info.isSymbolicLink())throw new Error(`源码中不应有符号链接：${relative}`);
 if(info.isDirectory()){
  const name=path.basename(relative);if(excluded.has(name)&&relative!=='packages/core/src/data')return;
  for(const entry of (await readdir(full)).sort())await collect(`${relative}/${entry}`);return;
 }
 if(!info.isFile()||relative.endsWith('.tsbuildinfo'))return;
 if(!rootFiles.includes(relative)&&!codeTypes.has(path.extname(relative))&&!assets.has(relative))return;
 const bytes=await readFile(full);
 if(bytes.subarray(0,16).toString().startsWith('SQLite format 3'))throw new Error(`发现数据库：${relative}`);
 if(!assets.has(relative)){
  const text=bytes.toString('utf8');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bsk-[a-zA-Z0-9]{32,}/u.test(text))throw new Error(`发现疑似凭据，请人工检查：${relative}`);
 }
 files.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
for(const file of rootFiles)await collect(file);for(const directory of roots)await collect(directory);
await mkdir(target,{recursive:true});
for(const entry of files){const destination=path.join(target,entry.path);await mkdir(path.dirname(destination),{recursive:true});await copyFile(path.join(root,entry.path),destination);}
const manifest={format:1,version:JSON.parse(await readFile(path.join(root,'apps/desktop/package.json'),'utf8')).version,files:files.sort((a,b)=>a.path.localeCompare(b.path))};
await writeFile(path.join(target,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({target,files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0)},null,2));
