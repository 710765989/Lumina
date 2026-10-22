import {nativeImage,type NativeImage} from 'electron';

// Small, transient bitmap only. It never writes another thumbnail to disk.
export function createMediaDragIcon(thumbnail:NativeImage|undefined,count:number):NativeImage {
  const width=96,height=88,pixels=Buffer.alloc(width*height*4);
  const fill=(left:number,top:number,w:number,h:number,b:number,g:number,r:number)=>{
    for(let y=top;y<top+h;y++)for(let x=left;x<left+w;x++){
      const at=(y*width+x)*4;pixels[at]=b;pixels[at+1]=g;pixels[at+2]=r;pixels[at+3]=255;
    }
  };
  if(count>1){fill(10,8,82,66,232,220,209);fill(6,4,82,66,247,239,229);}
  fill(2,0,82,66,255,255,255);
  if(thumbnail && !thumbnail.isEmpty()){
    const original=thumbnail.getSize(),scale=Math.min(78/original.width,62/original.height);
    const image=thumbnail.resize({width:Math.max(1,Math.round(original.width*scale)),height:Math.max(1,Math.round(original.height*scale)),quality:'good'});
    const size=image.getSize(),bytes=image.toBitmap(),left=4+Math.floor((78-size.width)/2),top=2+Math.floor((62-size.height)/2);
    for(let y=0;y<size.height;y++)bytes.copy(pixels,((top+y)*width+left)*4,y*size.width*4,(y+1)*size.width*4);
  }else{
    fill(8,6,70,54,250,239,224);fill(22,16,40,4,215,153,83);fill(22,28,32,4,215,153,83);fill(22,40,36,4,215,153,83);
  }
  if(count>1){
    const glyphs:Record<string,string>={'0':'111101101101111','1':'010110010010111','2':'111001111100111','3':'111001111001111','4':'101101111001001','5':'111100111001111','6':'111100111101111','7':'111001001001001','8':'111101111101111','9':'111101111001111','+':'000010111010000'};
    const label=count>999?'999+':String(count),badgeWidth=label.length*8+10,left=width-badgeWidth;
    fill(left,62,badgeWidth,22,220,102,21);
    [...label].forEach((char,index)=>{[...glyphs[char]!].forEach((value,at)=>{if(value==='1')fill(left+5+index*8+(at%3)*2,68+Math.floor(at/3)*2,2,2,255,255,255);});});
  }
  return nativeImage.createFromBitmap(pixels,{width,height,scaleFactor:1});
}
