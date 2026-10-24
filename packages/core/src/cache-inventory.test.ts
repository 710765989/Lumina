import {it,expect} from 'vitest';
import {openDatabase,closeDatabase,schemaVersion} from '@lumina/storage';
import {mkdtemp,mkdir,writeFile,lstat,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {inventoryCheckpoint,saveInventory,inventoryEntries,rememberCache,forgetCache} from './cache-inventory.js';
it('a manual calibration does not resurrect a deleted file or lose cache generated while it is reading',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'lumina-inventory-')),db=openDatabase(':memory:');
 try{const a=path.join(root,'a.jpg'),b=path.join(root,'b.jpg');await writeFile(a,'first');await rememberCache(db,root,a);const checkpoint=inventoryCheckpoint(db),info=await lstat(a);await writeFile(b,'second');await rememberCache(db,root,b);forgetCache(db,a);
  saveInventory(db,root,[{file:a,name:'a.jpg',bytes:info.size,stamp:`${info.size}:${info.mtimeMs}:${info.ino}`}],checkpoint);
  expect(inventoryEntries(db,root).map(row=>row.file)).toEqual([b]);
 }finally{closeDatabase(db);await rm(root,{recursive:true,force:true});}
});
it('upgrades an existing schema 8 library with a backup while preserving media and cache settings',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'lumina-inventory-upgrade-')),file=path.join(root,'library.db');let db=openDatabase(file);
 try{db.prepare("INSERT INTO settings(key,value_json) VALUES('media-cache-directory',?)").run(JSON.stringify(path.join(root,'old-cache')));db.exec('DROP TABLE cache_inventory; DELETE FROM schema_migrations; INSERT INTO schema_migrations(version) VALUES(8);');closeDatabase(db);db=openDatabase(file);expect(schemaVersion).toBe(12);expect(db.prepare("SELECT value_json FROM settings WHERE key='media-cache-directory'").get()).toEqual({value_json:JSON.stringify(path.join(root,'old-cache'))});expect(db.prepare("SELECT name FROM sqlite_master WHERE name='cache_inventory'").get()).toBeTruthy();expect((await readdir(root)).some(name=>name.startsWith('library.db.pre-m2-'))).toBe(true);
 }finally{closeDatabase(db);await rm(root,{recursive:true,force:true});}
});
