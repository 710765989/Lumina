import {createRequire} from 'node:module';
import {cp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),desktop=path.join(root,'apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
const {build}=require('esbuild'),nodePaths=process.env.LUMINA_BUILD_NODE_PATH?[process.env.LUMINA_BUILD_NODE_PATH]:[];
const base={bundle:true,platform:'node',format:'cjs',nodePaths};
await build({...base,entryPoints:[path.join(root,'apps/core-host/src/main.ts')],external:['better-sqlite3'],outfile:path.join(desktop,'dist/core-host.cjs')});
await build({...base,entryPoints:[path.join(desktop,'src/preload.ts')],external:['electron'],outfile:path.join(desktop,'dist/preload.cjs')});
await build({...base,entryPoints:[path.join(root,'packages/core/src/japanese-worker.ts')],outfile:path.join(desktop,'dist/japanese-worker.cjs')});
const coreRequire=createRequire(path.join(root,'packages/core/package.json')),dependency=path.dirname(coreRequire.resolve('kuromoji/package.json',{paths:[...nodePaths,path.join(root,'packages/core')]}));
await mkdir(path.join(desktop,'dist/japanese-dict'),{recursive:true});
await cp(path.join(dependency,'dict'),path.join(desktop,'dist/japanese-dict'),{recursive:true});
for(const name of ['LICENSE-2.0.txt','NOTICE.md'])await cp(path.join(dependency,name),path.join(desktop,'dist/japanese-dict',name));
const dependencyRequire=createRequire(path.join(dependency,'package.json'));
for(const [name,license] of [['async','LICENSE'],['doublearray','LICENSE.txt'],['lodash','LICENSE'],['zlibjs','LICENSE']]){
 const directory=path.dirname(dependencyRequire.resolve(`${name}/package.json`));
 await cp(path.join(directory,license),path.join(desktop,'dist/japanese-dict',`${name}-LICENSE.txt`));
}
