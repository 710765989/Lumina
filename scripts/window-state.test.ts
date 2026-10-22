import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {restoreWindowState,saveWindowState} from '../apps/desktop/src/window-state.js';
it('persists normal bounds and maximization without using screen-sized restore bounds',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'lumina-window-'));try{const file=path.join(root,'state.json'),state={bounds:{x:100,y:60,width:1300,height:820},maximized:true};saveWindowState(file,state);expect(restoreWindowState(file,[{x:0,y:0,width:1920,height:1040}])).toEqual(state);}finally{rmSync(root,{recursive:true});}
});
it('recovers disconnected displays and clamps a larger window onto a smaller work area',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'lumina-window-'));try{const file=path.join(root,'state.json');saveWindowState(file,{bounds:{x:-3000,y:0,width:1800,height:1000},maximized:false});expect(restoreWindowState(file,[{x:0,y:0,width:1280,height:768}]).bounds).toEqual({x:0,y:0,width:1280,height:768});saveWindowState(file,{bounds:{x:-1800,y:20,width:1200,height:750},maximized:false});expect(restoreWindowState(file,[{x:0,y:0,width:1920,height:1080},{x:-1920,y:0,width:1920,height:1080}]).bounds.x).toBe(-1800);}finally{rmSync(root,{recursive:true});}
});
it('uses safe defaults for malformed state and fits screens below the normal minimum',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'lumina-window-'));try{const file=path.join(root,'state.json');for(const data of ['null','invalid','{"bounds":{"x":1,"y":2,"width":-5,"height":700},"maximized":true}']){writeFileSync(file,data);expect(restoreWindowState(file,[{x:0,y:0,width:1024,height:640}])).toEqual({bounds:{x:0,y:0,width:1024,height:640},maximized:false});}}finally{rmSync(root,{recursive:true});}
});

