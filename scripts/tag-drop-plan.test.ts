import {it,expect} from 'vitest';
import {tagOccurrences} from '../packages/contracts/src/tag-graph';
import {planTagDrop,applyTagDrop,tagDropRenderKey} from '../apps/desktop/renderer/src/tag-drop-plan';
const tags=[{id:'a',name:'甲'},{id:'b',name:'乙'},{id:'c',name:'子',parentIds:['a']},{id:'leaf',name:'叶',parentIds:['c']}];
it('previews a move as a relocated subtree while keeping the old React/layout identities',()=>{
 const plan=planTagDrop(tags,'a/c','b',false)!;expect(plan.parentIds).toEqual(['b']);const preview=tagOccurrences(applyTagDrop(tags,plan));expect(preview.map(row=>row.key)).toContain('b/c/leaf');expect(preview.map(row=>row.key)).not.toContain('a/c');expect(tagDropRenderKey('b/c/leaf',plan)).toBe('a/c/leaf');expect(tags[2].parentIds).toEqual(['a']);
});
it('copies one shared reference without removing the original branch or duplicating a tag record',()=>{
 const plan=planTagDrop(tags,'a/c','b',true)!;expect(plan.parentIds).toEqual(['a','b']);const result=applyTagDrop(tags,plan);expect(result).toHaveLength(tags.length);expect(tagOccurrences(result).filter(row=>row.id==='c').map(row=>row.key)).toEqual(['a/c','b/c']);expect(tagDropRenderKey('b/c',plan)).toBe('b/c');expect(planTagDrop(result,'a/c','b',true)).toBeNull();
});
it('keeps an explicit top-level occurrence when copying to a parent and supports copying back to root',()=>{
 const root=planTagDrop(tags,'a','b',true)!;const rows=tagOccurrences(applyTagDrop(tags,root));expect(rows.some(row=>row.key==='a')).toBe(true);expect(rows.some(row=>row.key==='b/a')).toBe(true);
 const copied=planTagDrop(tags,'a/c',null,true)!;expect(copied.rootReference).toBe(true);expect(tagOccurrences(applyTagDrop(tags,copied)).filter(row=>row.id==='c').map(row=>row.key)).toEqual(['a/c','c']);
});
it('rejects cycles, sixth levels and directory targets before producing a preview',()=>{
 expect(()=>planTagDrop(tags,'a','a/c',true)).toThrow('自己或子标签');expect(()=>planTagDrop([...tags,{id:'dir',name:'目录',directory:true}],'a/c','dir',true)).toThrow('不能建立父子关系');
 const deep=Array.from({length:5},(_,i)=>({id:String(i),name:String(i),parentIds:i?[String(i-1)]:[]}));expect(()=>planTagDrop([...deep,{id:'other',name:'另'}],'other','0/1/2/3/4',true)).toThrow('5 级');
});
