import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {openDatabase,closeDatabase,addLibraryRoot,saveDirectoryConfiguration,directoryRuleContext,applyDirectoryRules,mediaCardTags} from '@lumina/storage';
const temp=await mkdtemp(path.join(os.tmpdir(),'lumina-directory-bench-')),db=openDatabase(path.join(temp,'synthetic.db')),count=38000,folders=1000;
try{
 const root=addLibraryRoot(db,path.join(temp,'synthetic-media'),'Synthetic');
 const configStart=performance.now();saveDirectoryConfiguration(db,root.id,{autoAlbums:false,hierarchy:false,rules:[{relativePath:'',name:'All folders'},...Array.from({length:folders},(_,i)=>({relativePath:`folder-${i}`,name:`Directory ${i}`}))]});const configurationMs=performance.now()-configStart;
 const insert=db.prepare("INSERT INTO media(id,absolute_path,file_name,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,?,'photo',1024,1700000000000,?)");
 db.transaction(()=>{for(let i=0;i<count;i++)insert.run(String(i),path.join(root.absolutePath,`folder-${i%folders}`,`${i}.jpg`),`${i}.jpg`,String(i));})();
 const before=process.memoryUsage().rss,start=performance.now(),context=directoryRuleContext(db);db.transaction(()=>{for(let i=0;i<count;i++)applyDirectoryRules(db,String(i),path.join(root.absolutePath,`folder-${i%folders}`,`${i}.jpg`),context);})();const applyMs=performance.now()-start;
 const hover=[];for(let n=0;n<7;n++){const start=performance.now();const result=mediaCardTags(db,Array.from({length:300},(_,i)=>String(i)));if(Object.values(result).some(tags=>tags.length!==2))throw new Error('directory inheritance mismatch');hover.push(performance.now()-start);}hover.sort((a,b)=>a-b);
 const result={syntheticMedia:count,directoryRules:folders+1,configurationMs:Math.round(configurationMs),applyTotalMs:Math.round(applyMs),averagePerMediaMs:Number((applyMs/count).toFixed(3)),visibleTagBatchSize:300,visibleTagMedianMs:Number(hover[3].toFixed(2)),rssGrowthMiB:Math.round((process.memoryUsage().rss-before)/1048576),scope:'Synthetic SQLite rule application only; excludes filesystem walking, photo/video decode and real-library stress acceptance'};
 const output=path.resolve('build-staging/directory-rules-performance.json');await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{closeDatabase(db);await rm(temp,{recursive:true,force:true});}


