export function singleFlight(){
 const pending=new Map<string,Promise<unknown>>();
 return <T>(key:string,action:()=>Promise<T>):Promise<T>=>{
  const current=pending.get(key);if(current)return current as Promise<T>;
  const request=Promise.resolve().then(action);pending.set(key,request);
  const clear=()=>{if(pending.get(key)===request)pending.delete(key);};void request.then(clear,clear);
  return request;
 };
}
