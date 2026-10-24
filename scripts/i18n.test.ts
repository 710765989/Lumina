import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {catalog} from '../apps/desktop/renderer/src/locales/catalog';
import {t,getLanguage,setLanguage,translateMessage,formatMonth,normalizeLanguage,subscribeLanguage,initializeLanguage} from '../apps/desktop/renderer/src/i18n';
import {taskInformation} from '../apps/desktop/renderer/src/task-information';
import {userErrorMessage} from '../apps/desktop/renderer/src/user-error';
const storage=new Map<string,string>();
vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});
afterEach(()=>setLanguage('zh-CN'));
describe('bundled language catalogs',()=>{
 it('has both translations and preserves every interpolation slot',()=>{
  const slots=(value:string)=>[...new Set(value.match(/\{\d+\}/gu)??[])].sort();
  expect(Object.keys(catalog).length).toBeGreaterThan(1300);
  for(const [key,values] of Object.entries(catalog))for(const value of values){expect(value,key).not.toBe('');expect(slots(value),key).toEqual(slots(key));}
 });
 it('covers every explicit UI translation key',()=>{
  const root=path.resolve('apps/desktop/renderer/src');const missing=new Set<string>();
  for(const name of readdirSync(root)){if(!/\.tsx?$/u.test(name)||name==='i18n.ts')continue;const source=ts.createSourceFile(name,readFileSync(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,name.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='t'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){const key=node.arguments[0].text;if(/[\u3400-\u9fff]/u.test(key)&&!catalog[key]&&!catalog[key.trim()])missing.add(key);}ts.forEachChild(node,visit);}visit(source);}
  expect([...missing]).toEqual([]);
 });
 it('persists a valid language and notifies once per change without a core command',()=>{
  let calls=0;const stop=subscribeLanguage(()=>calls++);setLanguage('en');expect(getLanguage()).toBe('en');expect(storage.get('lumina.ui.language')).toBe('en');expect(calls).toBe(1);stop();expect(normalizeLanguage('de')).toBe('zh-CN');
 });
 it('switches between Chinese, English and Japanese immediately',()=>{
  expect(t('图库')).toBe('图库');setLanguage('en');expect(t('图库')).toBe('Library');setLanguage('ja');expect(t('图库')).toBe('ライブラリ');setLanguage('zh-CN');expect(t('图库')).toBe('图库');
 });
 it('preserves filenames, paths, user text and braces in substitutions',()=>{
  const raw='照片 {1} & <日本語> C:\\相册\\猫.jpg';setLanguage('en');expect(t('删除 {0}',[raw])).toBe('Delete '+raw);expect(t('这是用户的自定义名称')).toBe('这是用户的自定义名称');expect(t('文件 {0}',[raw])).toBe('文件 '+raw);
 });
 it('translates service errors and cached dynamic notices after language changes',()=>{
  setLanguage('en');expect(userErrorMessage(new Error('标签名称已存在'))).toBe('A tag with this name already exists');expect(userErrorMessage(new Error('ENOENT'))).toContain('does not exist');expect(translateMessage('已加入 7 个相册')).toBe('Added to 7 albums');setLanguage('ja');expect(translateMessage('已加入 7 个相册')).toBe('7 件のアルバムに追加しました');
 });
 it('updates an already displayed translated notice when changing languages',()=>{
  setLanguage('en');const message=t('已加入 {0} 个相册',[7]);setLanguage('ja');expect(translateMessage(message)).toBe('7 件のアルバムに追加しました');expect(userErrorMessage(new Error('A tag with this name already exists'))).toBe('同じ名前のタグが既に存在します');setLanguage('zh-CN');expect(translateMessage(message)).toBe('已加入 7 个相册');
 });
 it('uses the native installation language on first launch, then keeps explicit UI choices',async()=>{
  const native=vi.fn(async(input:{action:string})=>input.action==='get-language'?{language:'ja'}:{ok:true});
  vi.stubGlobal('window',{lumina:{native},addEventListener:vi.fn(),removeEventListener:vi.fn()});
  try{storage.delete('lumina.ui.language');const stop=await initializeLanguage();expect(getLanguage()).toBe('ja');expect(storage.get('lumina.ui.language')).toBe('ja');stop();native.mockClear();setLanguage('en');native.mockClear();const stop2=await initializeLanguage();expect(getLanguage()).toBe('en');expect(native).not.toHaveBeenCalledWith({action:'get-language'});stop2();}finally{delete (globalThis as any).window;}
 });
 it('localizes task verbs without changing tag names or job semantics',()=>{
  setLanguage('en');const info=taskInformation({kind:'tags',total:20,options:{tagAction:'remove',tagName:'新增'}});expect(info.title).toBe('Tag edit · Remove');expect(info.description).toContain('「新增」');expect(info.description).toContain('Remove');expect(info.description).not.toContain('ancestor');
 });
 it('formats month headings without changing internal timeline keys',()=>{
  const key='2026年10月';setLanguage('en');expect(formatMonth(key)).toBe('October 2026');setLanguage('ja');expect(formatMonth(key)).toBe('2026年10月');expect(key).toBe('2026年10月');
 });
 it('leaves processing errors as messages and does not expose transport wrappers',()=>{
  setLanguage('ja');expect(userErrorMessage(new Error("Error invoking remote method 'lumina:command': Error: 标签名称已存在"))).toBe('同じ名前のタグが既に存在します');expect(userErrorMessage(new Error('heif: No decoding plugin'))).toContain('HEIF/HEIC');
 });
});
