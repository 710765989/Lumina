import {WindowsHiddenAttributes} from './windows-hidden-worker.js';
const shared=new WindowsHiddenAttributes();
export const windowsHiddenAttribute=(file:string,hidden?:boolean)=>shared.request(file,hidden);
