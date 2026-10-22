export function releaseMediaResource(resource:HTMLImageElement|HTMLVideoElement){
 resource.removeAttribute('src');
 if(resource instanceof HTMLVideoElement){resource.pause();resource.load();}
}
