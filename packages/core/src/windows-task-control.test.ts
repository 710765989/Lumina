import {it,expect,vi} from 'vitest';
import {openDatabase,closeDatabase} from '@lumina/storage';
import {LibraryService} from './service.js';
const helper=vi.hoisted(()=>({request:vi.fn(),close:vi.fn()}));
vi.mock('./windows-hidden-worker.js',()=>({WindowsHiddenAttributes:class{request=helper.request;close=helper.close;}}));
async function until(check:()=>boolean,timeout=20000){const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw Error('wait timeout');await new Promise(resolve=>setTimeout(resolve,2));}}
for(const action of ['pause','cancel'] as const)it(`Windows attribute ${action} aborts the active helper and stops all 1005 queued files instead of launching the next batch`,async()=>{
 const db=openDatabase(':memory:'),service=new LibraryService(db),writes:string[]=[];let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
 helper.request.mockReset();helper.request.mockImplementation(async(_file:string,_hidden:boolean|undefined,signal?:AbortSignal)=>{started();await new Promise<void>((_resolve,reject)=>{signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});return 0;});
 try{
  db.prepare("INSERT OR REPLACE INTO settings(key,value_json) VALUES('organization',?)").run(JSON.stringify({syncHidden:true,watch:false}));
  db.transaction(()=>{for(let i=0;i<1005;i++){const id=`media-${i}`;db.prepare("INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,'photo',100,1,?)").run(id,`C:/isolated/${id}.jpg`,id);db.prepare('INSERT INTO hidden_media(media_id) VALUES(?)').run(id);}})();
  const response:any=await service.handle({type:'organization.settings'});await ready;const task=(await service.handle({type:'tasks.list',limit:200}) as any[]).find(row=>row.kind==='visibility');expect(response.visibilityTaskId??task.id).toBe(task.id);
  expect((db.prepare('SELECT COUNT(*) AS n FROM windows_visibility_queue').get() as {n:number}).n).toBe(5);
  let notifications=0;const notify=vi.spyOn(service.organization.jobs as any,'notify').mockImplementation(()=>notifications++);
  const began=Date.now();await service.handle({type:'jobs.control',id:task.id,action});await until(()=>!service.organization.jobs.isActive(task.id));expect(Date.now()-began).toBeLessThan(1000);expect(notifications).toBeGreaterThan(0);notify.mockRestore();
  expect(db.prepare('SELECT status,processed,total FROM tasks WHERE id=?').get(task.id)).toEqual({status:action==='pause'?'paused':'cancelled',processed:0,total:1005});expect(helper.request).toHaveBeenCalledTimes(1);expect(helper.request.mock.calls[0]![2].aborted).toBe(true);expect(db.prepare('SELECT COUNT(*) AS n FROM windows_visibility_queue').get()).toEqual({n:0});
  for(let i=0;i<5;i++)await service.handle({type:'tasks.activity'});await new Promise(resolve=>setTimeout(resolve,220));expect(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='visibility'").get()).toEqual({n:1});
  helper.request.mockImplementation(async(file:string,hidden?:boolean,signal?:AbortSignal)=>{signal?.throwIfAborted();if(hidden!==undefined)writes.push(file);return 0;});
  await service.handle({type:'jobs.control',id:task.id,action:'resume'});await until(()=>!service.organization.jobs.isActive(task.id));expect(db.prepare('SELECT status,processed,total FROM tasks WHERE id=?').get(task.id)).toEqual({status:'completed',processed:1005,total:1005});expect(writes).toHaveLength(1005);expect(new Set(writes).size).toBe(1005);
 }finally{service.close();closeDatabase(db);}
},30000);

it('pause preserves already completed attribute changes and resumes only unfinished files',async()=>{
 const db=openDatabase(':memory:'),service=new LibraryService(db);let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);let writes=0,reads=0;
 helper.request.mockReset();helper.request.mockImplementation(async(_file:string,hidden?:boolean,signal?:AbortSignal)=>{if(hidden!==undefined){writes++;return 0;}if(++reads>1){started();await new Promise<void>((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}return 0;});
 try{
  db.prepare("INSERT OR REPLACE INTO settings(key,value_json) VALUES('organization',?)").run(JSON.stringify({syncHidden:true,watch:false}));
  db.transaction(()=>{for(let i=0;i<3;i++){db.prepare("INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,'photo',100,1,?)").run(String(i),`C:/isolated/${i}.jpg`,String(i));db.prepare('INSERT INTO hidden_media(media_id) VALUES(?)').run(String(i));}})();
  await service.handle({type:'organization.settings'});await ready;const task=(db.prepare("SELECT id FROM tasks WHERE kind='visibility'").get() as {id:string});await service.handle({type:'jobs.control',id:task.id,action:'pause'});await until(()=>!service.organization.jobs.isActive(task.id));expect(writes).toBe(1);expect(db.prepare('SELECT processed FROM tasks WHERE id=?').get(task.id)).toEqual({processed:1});
  helper.request.mockImplementation(async(_file:string,hidden?:boolean)=>{if(hidden!==undefined)writes++;return 0;});await service.handle({type:'jobs.control',id:task.id,action:'resume'});await until(()=>!service.organization.jobs.isActive(task.id));expect(writes).toBe(3);
 }finally{service.close();closeDatabase(db);}
});

it('a later unhide cancels the paused hide record and restores only the ten attributes already processed out of 100',async()=>{
 const db=openDatabase(':memory:'),service=new LibraryService(db);let reads=0;let ready!:()=>void;const blocked=new Promise<void>(resolve=>ready=resolve);const attributes=new Map<string,number>();const restores:string[]=[];
 helper.request.mockReset();helper.request.mockImplementation(async(file:string,hidden?:boolean,signal?:AbortSignal)=>{
  if(hidden===undefined && ++reads===11){ready();await new Promise<void>((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}
  const before=attributes.get(file)??0;if(hidden!==undefined)attributes.set(file,hidden?2:0);return before;
 });
 try{
  db.prepare("INSERT OR REPLACE INTO settings(key,value_json) VALUES('organization',?)").run(JSON.stringify({syncHidden:true,watch:false}));
  db.transaction(()=>{for(let i=0;i<100;i++){db.prepare("INSERT INTO media(id,absolute_path,kind,size_bytes,modified_at_ms,fingerprint) VALUES(?,?,'photo',100,1,?)").run(String(i),`C:/isolated/${i}.jpg`,String(i));db.prepare('INSERT INTO hidden_media(media_id) VALUES(?)').run(String(i));}})();
  await service.handle({type:'organization.settings'});await blocked;const old=db.prepare("SELECT id FROM tasks WHERE kind='visibility'").get() as {id:string};
  await service.handle({type:'jobs.control',id:old.id,action:'pause'});await until(()=>!service.organization.jobs.isActive(old.id));expect(db.prepare('SELECT processed,total FROM tasks WHERE id=?').get(old.id)).toEqual({processed:10,total:100});
  helper.request.mockImplementation(async(file:string,hidden?:boolean)=>{const before=attributes.get(file)??0;if(hidden!==undefined){restores.push(file);attributes.set(file,hidden?2:0);}return before;});
  db.transaction(()=>db.prepare('DELETE FROM hidden_media').run())();await service.handle({type:'organization.settings'});
  expect(db.prepare('SELECT status,processed,total FROM tasks WHERE id=?').get(old.id)).toEqual({status:'cancelled',processed:10,total:100});
  const next=db.prepare("SELECT id,total FROM tasks WHERE kind='visibility' AND id<>?").get(old.id) as {id:string;total:number};expect(next.total).toBe(10);
  await until(()=>!service.organization.jobs.isActive(next.id));expect(restores).toHaveLength(10);expect([...attributes.values()].every(value=>value===0)).toBe(true);
  expect(db.prepare("SELECT COUNT(*) AS n FROM media_details WHERE json_type(metadata_json,'$.windowsHiddenOriginal') IN('true','false')").get()).toEqual({n:0});
  await service.handle({type:'organization.settings'});expect(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='visibility'").get()).toEqual({n:2});
 }finally{service.close();closeDatabase(db);}
});
