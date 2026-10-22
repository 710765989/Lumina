export function createActionLock(changed:(busy:boolean)=>void=()=>{},minimumMs=300){
 let busy=false;
 return {get busy(){return busy;},run(action:()=>unknown):unknown{
  if(busy)return;busy=true;const started=Date.now();
  try{
   const value=action();
   if(!value || typeof (value as {then?:unknown}).then!=='function'){busy=false;return value;}
   changed(true);
   const release=async()=>{const remaining=minimumMs-(Date.now()-started);if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));busy=false;changed(false);};
   return Promise.resolve(value).then(async result=>{await release();return result;},async error=>{await release();throw error;});
  }catch(error){busy=false;throw error;}
 }};
}
