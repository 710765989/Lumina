// A browser may request the same retry URL more than once. Only the user's new
// retry token invalidates the disk preview; repeated reads reuse the result.
export class PreviewRequests{
 private completed=new Map<string,string>();
 private pending=new Map<string,Promise<{cachePath:string}>>();
 async load(key:string,token:string|undefined,read:(regenerate:boolean)=>Promise<{cachePath:string}>){
  const requestKey=JSON.stringify([key,token??'']),existing=this.pending.get(requestKey);if(existing)return existing;
  const work=Promise.resolve().then(()=>read(Boolean(token&&this.completed.get(key)!==token))).then(result=>{
   if(token){this.completed.delete(key);this.completed.set(key,token);if(this.completed.size>256)this.completed.delete(this.completed.keys().next().value!);}
   return result;
  });this.pending.set(requestKey,work);
  try{return await work;}finally{if(this.pending.get(requestKey)===work)this.pending.delete(requestKey);}
 }
}
