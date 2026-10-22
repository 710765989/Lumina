import sharp from 'sharp';
// Feature extraction must release source file handles on Windows even when
// loaded independently of the main library service.
sharp.cache(false);
import { createHash } from 'node:crypto';
import { mediaColumns, readMediaRows, visibleSql, type LuminaDatabase, type OrganizedMedia } from '@lumina/storage';

export const similarityAlgorithm='dct63-gradient64-color4-v1';
export type SimilarityFeature={hash:string;gradient:string;colors:string;width:number;height:number};
export type SimilarityLevel='strict'|'standard'|'relaxed';
const presets={strict:{distance:4,color:18,gradient:12,aspect:.96},standard:{distance:7,color:30,gradient:20,aspect:.92},relaxed:{distance:10,color:42,gradient:28,aspect:.85}};
const cos=Array.from({length:8},(_,u)=>Array.from({length:32},(_,x)=>Math.cos((2*x+1)*u*Math.PI/64)*(u===0?Math.SQRT1_2:1)));
const bitHash=(values:number[],pivot:number)=>values.reduce((hash,value)=>(hash<<1n)|(value>pivot?1n:0n),0n).toString(16).padStart(16,'0');
function popcount(value:number){value-=(value>>>1)&0x55555555;value=(value&0x33333333)+((value>>>2)&0x33333333);return (((value+(value>>>4))&0x0f0f0f0f)*0x01010101)>>>24;}
export function hamming(a:string,b:string){return popcount(parseInt(a.slice(0,8),16)^parseInt(b.slice(0,8),16))+popcount(parseInt(a.slice(8),16)^parseInt(b.slice(8),16));}

export async function imageFeature(file:string):Promise<SimilarityFeature> {
  const source=sharp(file,{failOn:'error',limitInputPixels:268402689});const meta=await source.metadata();
  const {data,info}=await source.rotate().flatten({background:'#ffffff'}).toColourspace('srgb').removeAlpha().resize(32,32,{fit:'fill'}).raw().toBuffer({resolveWithObject:true});
  if(info.channels!==3 || !meta.width || !meta.height)throw new Error('照片无法生成视觉特征');
  const gray=Array.from({length:1024},(_,i)=>data[i*3]!* .299+data[i*3+1]!* .587+data[i*3+2]!* .114);
  const rowDct=Array.from({length:32},(_,y)=>cos.map((wave)=>wave.reduce((sum,value,x)=>sum+value*gray[y*32+x]!,0)));
  const coefficients:number[]=[];
  for(let v=0;v<8;v++)for(let u=0;u<8;u++)if(u||v){const value=cos[v]!.reduce((sum,wave,y)=>sum+wave*rowDct[y]![u]!,0);coefficients.push(Math.abs(value)<1e-6?0:value);}
  const median=[...coefficients].sort((a,b)=>a-b)[31]!;
  const gradient:number[]=[];
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){const sample=(column:number)=>gray[Math.round((y+.5)*4-.5)*32+Math.round(column*31/8)]!;gradient.push(sample(x+1)-sample(x));}
  const colors=Buffer.alloc(48);
  for(let by=0;by<4;by++)for(let bx=0;bx<4;bx++)for(let channel=0;channel<3;channel++){
    let sum=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++)sum+=data[((by*8+y)*32+bx*8+x)*3+channel]!;
    colors[(by*4+bx)*3+channel]=Math.round(sum/64);
  }
  const swapped=(meta.orientation??1)>=5;
  return {hash:bitHash(coefficients,median),gradient:bitHash(gradient,0),colors:colors.toString('base64'),width:swapped?meta.height:meta.width,height:swapped?meta.width:meta.height};
}

export function similarityScore(a:SimilarityFeature,b:SimilarityFeature,level:SimilarityLevel):number|null {
  const preset=presets[level];const ar=a.width/a.height;const br=b.width/b.height;
  if(Math.min(ar,br)/Math.max(ar,br)<preset.aspect)return null;
  const distance=hamming(a.hash,b.hash);if(distance>preset.distance || hamming(a.gradient,b.gradient)>preset.gradient)return null;
  const ac=Buffer.from(a.colors,'base64'),bc=Buffer.from(b.colors,'base64');if(ac.length!==48 || bc.length!==48)return null;
  const color=Math.sqrt(ac.reduce((sum,value,i)=>sum+(value-bc[i]!)**2,0)/48);if(color>preset.color)return null;
  return Math.round(100*(1-.75*distance/63-.25*color/255));
}

type Candidate=OrganizedMedia & SimilarityFeature & {contentHash?:string|null};
type Group={representative:Candidate;items:Array<Candidate & {similarity:number}>};
type GroupIndex={representativeId:string;items:{id:string;similarity:number}[]};
const cachedGroups=new WeakMap<LuminaDatabase,Map<SimilarityLevel,{key:string;promise:Promise<GroupIndex[]>}>>();
// A distance <=k over four disjoint bands guarantees one band has <=floor(k/4)
// differences. Enumerate those masks; do not compare every pair of photographs.
// Only representatives are indexed, preventing transitive similarity chains.
export async function groupSimilar(candidates:Candidate[],level:SimilarityLevel) {
  const bands=Array.from({length:4},()=>new Map<number,number[]>());const groups:Group[]=[];
  const exactAssignments=new Map<string,number>();
  const masks=[0];if(presets[level].distance>=4)for(let bit=0;bit<16;bit++)masks.push(1<<bit);
  if(presets[level].distance>=8)for(let a=0;a<16;a++)for(let b=a+1;b<16;b++)masks.push((1<<a)|(1<<b));
  for(let ordinal=0;ordinal<candidates.length;ordinal++) {
    if(ordinal%128===0)await new Promise<void>((resolve)=>setImmediate(resolve));
    const media=candidates[ordinal]!;const keys=[0,4,8,12].map((start)=>parseInt(media.hash.slice(start,start+4),16));
    const possible=new Set<number>();keys.forEach((key,band)=>masks.forEach((mask)=>bands[band]!.get(key^mask)?.forEach((index)=>possible.add(index))));
    let best=media.contentHash?exactAssignments.get(media.contentHash)??-1:-1,score=-1;
    if(best>=0)score=similarityScore(groups[best]!.representative,media,level)??100;
    else for(const index of possible){const value=similarityScore(groups[index]!.representative,media,level);if(value!==null && value>score){best=index;score=value;}}
    if(best>=0)groups[best]!.items.push({...media,similarity:score});
    else {const index=groups.length;groups.push({representative:media,items:[{...media,similarity:100}]});keys.forEach((key,band)=>{const entries=bands[band]!.get(key)??[];entries.push(index);bands[band]!.set(key,entries);});best=index;}
    if(media.contentHash)exactAssignments.set(media.contentHash,best);
  }
  return groups.filter((group)=>group.items.length>1).map((group)=>({representativeId:group.representative.id,items:group.items}));
}

export async function similarGroups(db:LuminaDatabase,level:SimilarityLevel) {
  const candidates=readMediaRows(db.prepare(`SELECT ${mediaColumns},s.hash,s.gradient,s.colors,s.width,s.height,
    (SELECT d.content_hash FROM media_details d WHERE d.media_id=m.id AND d.hash_fingerprint=m.fingerprint) AS contentHash FROM media m JOIN similarity_features s ON s.media_id=m.id
    WHERE ${visibleSql()} AND m.kind='photo' AND s.fingerprint=m.fingerprint AND s.algorithm=? ORDER BY s.width*s.height DESC,m.size_bytes DESC,m.id`).all(similarityAlgorithm)) as Candidate[];
  const digest=createHash('sha256');for(const media of candidates)digest.update(`${media.id}:${media.fingerprint}:${media.contentHash??''};`);const key=digest.digest('hex');
  let cache=cachedGroups.get(db);if(!cache){cache=new Map();cachedGroups.set(db,cache);}
  let entry=cache.get(level);if(entry?.key!==key){entry={key,promise:groupSimilar(candidates,level).then((groups)=>groups.map((group)=>({representativeId:group.representativeId,items:group.items.map((media)=>({id:media.id,similarity:media.similarity}))})))};cache.set(level,entry);}
  const index=await entry!.promise;const byId=new Map(candidates.map((media)=>[media.id,media]));
  const groups=index.map((group)=>{
    const counts=new Map<string,number>();for(const row of group.items){const hash=byId.get(row.id)?.contentHash;if(hash)counts.set(hash,(counts.get(hash)??0)+1);}
    const items=group.items.map((row)=>{const media=byId.get(row.id)!;return {...media,similarity:row.similarity,isRepresentative:row.id===group.representativeId,exactDuplicate:Boolean(media.contentHash && (counts.get(media.contentHash)??0)>1)};});
    items.sort((a,b)=>Number(b.exactDuplicate)-Number(a.exactDuplicate) || (a.exactDuplicate && b.exactDuplicate ? (a.contentHash??'').localeCompare(b.contentHash??'') : 0) || b.similarity-a.similarity || b.sizeBytes-a.sizeBytes || a.id.localeCompare(b.id));
    return {...group,items,exactCount:items.filter((row)=>row.exactDuplicate).length};
  }).sort((a,b)=>b.exactCount-a.exactCount || b.items.length-a.items.length || a.representativeId.localeCompare(b.representativeId));
  return {groups,indexed:candidates.length,total:Number((db.prepare(`SELECT COUNT(*) AS count FROM media m WHERE ${visibleSql()} AND m.kind='photo'`).get() as {count:number}).count)};
}
