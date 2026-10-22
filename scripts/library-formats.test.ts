import {it,expect} from 'vitest';
import {extensionSuggestions} from '../apps/desktop/renderer/src/SearchTypeMenu';
it('suggests library suffixes and retains arbitrary manual suffix input',()=>{
 expect(extensionSuggestions('',['PNG','jpg','jpg'])).toEqual([{value:'.jpg',label:'.jpg'},{value:'.png',label:'.png'}]);
 expect(extensionSuggestions('avif',['jpg'])).toEqual([{value:'.avif',label:'搜索后缀 .avif'}]);
 expect(extensionSuggestions('j',['jpg','jpeg'])).toEqual([{value:'.j',label:'搜索后缀 .j'},{value:'.jpeg',label:'.jpeg'},{value:'.jpg',label:'.jpg'}]);
 expect(extensionSuggestions('',[])).toEqual([]);
});
