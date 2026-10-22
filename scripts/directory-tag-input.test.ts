import {it,expect} from 'vitest';
import {directoryLeafName,directoryTagNames,directoryTagSuggestion} from '../apps/desktop/renderer/src/directory-tag-input';

it('extracts the final folder name from either slash style and preserves every configured tag',()=>{
  expect(directoryLeafName('F:\\photos\\旅行\\')).toBe('旅行');
  expect(directoryLeafName('F:/photos/旅行/child/')).toBe('child');
  expect(directoryTagNames([{relativePath:'',name:'旅行'},{relativePath:'',name:'精选'},{relativePath:'child',name:'海边'}])).toEqual({'':['旅行','精选'],child:['海边']});
});
it('retains an ordinary name and proposes a distinct directory name, including repeated collisions',()=>{
  expect(directoryTagSuggestion('旅行',[{name:'旅行',directory:false}])).toBe('旅行（目录）');
  expect(directoryTagSuggestion('旅行',[{name:'旅行',directory:false},{name:'旅行（目录）',directory:true}])).toBe('旅行（目录）');
  expect(directoryTagSuggestion('旅行',[{name:'旅行',directory:false},{name:'旅行（目录）',directory:false}])).toBe('旅行（目录2）');
});
