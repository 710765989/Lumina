import {readdir,lstat,realpath,access,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

async function containsUserData(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name),info=await lstat(file);
    if(info.isSymbolicLink())return true;
    if(entry.isDirectory()){if(await containsUserData(file))return true;}
    else if(/\.(?:db|db-wal|db-shm|sqlite|sqlite3|jpe?g|png|webp|gif|heic|mp4|mov|avi|mkv)$/iu.test(entry.name))return true;
  }
  return false;
}

// Run only after the new directory package has passed its EXE checks.
export async function pruneReleasePackages(directory,{apply=false}={}){
  const root=await realpath(directory),packages=[];
  for(const entry of await readdir(root,{withFileTypes:true})){
    if(!entry.isDirectory() || !/^release-m2-\d{8}(?:\.\d+)+$/u.test(entry.name))continue;
    const target=path.join(root,entry.name),info=await lstat(target);
    if(info.isSymbolicLink() || path.dirname(await realpath(target))!==root)continue;
    try{await access(path.join(target,'win-unpacked','Lumina.exe'));await access(path.join(target,'win-unpacked','resources','app.asar'));}catch{continue;}
    // A package directory must not also be used to hold the user's library.
    const names=await readdir(target);if(names.some(name=>!['win-unpacked','release-manifest.json','package-manifest.json','启动说明.txt'].includes(name)))continue;
    if(await containsUserData(path.join(target,'win-unpacked')))continue;
    packages.push({name:entry.name,target});
  }
  packages.sort((a,b)=>b.name.localeCompare(a.name,'en',{numeric:true}));
  const remove=packages.slice(2);
  if(apply)for(const entry of remove)await rm(entry.target,{recursive:true,force:false});
  return {root,kept:packages.slice(0,2).map(entry=>entry.name),removed:remove.map(entry=>entry.name),applied:apply};
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(!process.argv[2])throw new Error('请提供发布包父目录');
  console.log(JSON.stringify(await pruneReleasePackages(process.argv[2],{apply:process.argv.includes('--apply')}),null,2));
}
