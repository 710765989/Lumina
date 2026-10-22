import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {describe,it,expect} from 'vitest';
import {imageFeature,similarityScore,groupSimilar} from './similarity.js';

const fixture=Buffer.from('<svg width="480" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="320" fill="#b8d5f0"/><path d="M0 250L110 90L280 220L410 60L480 250Z" fill="#234d69"/><circle cx="100" cy="65" r="32" fill="#f5bf62"/><rect y="252" width="480" height="68" fill="#62949e"/><rect x="300" y="180" width="60" height="90" fill="#c36555"/></svg>');
describe('perceptual photo similarity',()=>{
  it('matches compressed resized copies and applies EXIF orientation before comparing',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'lumina-similarity-'));
    try{
      const original=path.join(root,'original.png'),compressed=path.join(root,'compressed.jpg'),oriented=path.join(root,'oriented.jpg'),rotated=path.join(root,'rotated.jpg');
      await sharp(fixture).png().toFile(original);await sharp(fixture).resize(180,120).jpeg({quality:45}).toFile(compressed);
      const first=await imageFeature(original),second=await imageFeature(compressed);
      expect(similarityScore(first,second,'standard')).not.toBeNull();
      await sharp(fixture).jpeg({quality:90}).withMetadata({orientation:6}).toFile(oriented);
      await sharp(fixture).rotate(90).jpeg({quality:90}).toFile(rotated);
      const exif=await imageFeature(oriented),physical=await imageFeature(rotated);
      expect(exif.width).toBe(320);expect(exif.height).toBe(480);expect(similarityScore(exif,physical,'standard')).not.toBeNull();
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('rejects unrelated colors even when flat pictures have matching low-frequency hashes',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'lumina-similarity-'));
    try{
      const a=path.join(root,'blue.jpg'),b=path.join(root,'red.jpg');
      await sharp({create:{width:96,height:64,channels:3,background:'#0033dd'}}).jpeg().toFile(a);
      await sharp({create:{width:96,height:64,channels:3,background:'#dd3300'}}).jpeg().toFile(b);
      expect(similarityScore(await imageFeature(a),await imageFeature(b),'relaxed')).toBeNull();
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('does not chain visually different endpoints through an intermediate photo',async()=>{
    const make=(id:string,hash:string)=>({id,hash:hash.padStart(16,'0'),gradient:'0000000000000000',colors:Buffer.alloc(48,100).toString('base64'),width:100,height:100,absolutePath:id,kind:'photo',sizeBytes:100,modifiedAtMs:1,capturedAtMs:null,fingerprint:id,hidden:false,metadata:{}});
    const result=await groupSimilar([make('a','0'),make('b','f'),make('c','ff')],'strict');
    expect(result).toHaveLength(1);expect(result[0]!.items.map((item)=>item.id)).toEqual(['a','b']);
  });
});
