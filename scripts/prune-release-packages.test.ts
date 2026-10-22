import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
it('keeps two latest valid packages and excludes library folders and incomplete directories',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'lumina-prune-'));
  try{
    for(const version of ['4.7','4.8','4.9','4.10','4.11']){
      const folder=path.join(root,'release-m2-20261018.'+version,'win-unpacked');await mkdir(path.join(folder,'resources'),{recursive:true});await writeFile(path.join(folder,'Lumina.exe'),'fixture');await writeFile(path.join(folder,'resources/app.asar'),'fixture');
    }
    await writeFile(path.join(root,'release-m2-20261018.4.11','win-unpacked','user-library.db'),'must stay');
    await mkdir(path.join(root,'release-m2-20261018.4.12'));await mkdir(path.join(root,'photos'));
    const {pruneReleasePackages}=await import('./prune-release-packages.mjs');
    const dry=await pruneReleasePackages(root);expect(dry.kept).toEqual(['release-m2-20261018.4.10','release-m2-20261018.4.9']);expect(dry.removed).toHaveLength(2);expect(await readdir(root)).toHaveLength(7);
    await pruneReleasePackages(root,{apply:true});expect((await readdir(root)).sort()).toEqual(['photos','release-m2-20261018.4.10','release-m2-20261018.4.11','release-m2-20261018.4.12','release-m2-20261018.4.9']);
  }finally{await rm(root,{recursive:true,force:true});}
});
