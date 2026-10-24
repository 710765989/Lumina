import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {readLanguagePreference} from '../apps/desktop/src/language-preference';
describe('installer language handoff',()=>{
 it('seeds all three installation languages without changing an existing preference',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'lumina-language-'));try{const install=path.join(root,'install'),user=path.join(root,'ui-language.json');mkdirSync(install);const marker=path.join(install,'installation-language.json');for(const language of ['zh-CN','en','ja'] as const){writeFileSync(marker,JSON.stringify({language}));expect(readLanguagePreference(user,install)).toBe(language);}writeFileSync(user,JSON.stringify({language:'en'}));expect(readLanguagePreference(user,install)).toBe('en');expect(JSON.parse(readFileSync(marker,'utf8')).language).toBe('ja');}finally{rmSync(root,{recursive:true,force:true});}
 });
 it('falls back safely for missing, truncated or unsupported preferences',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'lumina-language-'));try{const user=path.join(root,'ui-language.json');expect(readLanguagePreference(user,root)).toBe('zh-CN');writeFileSync(user,'{');writeFileSync(path.join(root,'installation-language.json'),'{"language":"ja"}');expect(readLanguagePreference(user,root)).toBe('ja');writeFileSync(user,'{"language":"de"}');expect(readLanguagePreference(user,root)).toBe('ja');}finally{rmSync(root,{recursive:true,force:true});}
 });
 it('configures an explicit language selector and Chinese, English and Japanese installer resources',()=>{
  const config=readFileSync('apps/desktop/electron-builder.yml','utf8'),include=readFileSync('apps/desktop/assets/installer-language.nsh','utf8');expect(config).toContain('displayLanguageSelector: true');for(const locale of ['zh_CN','en_US','ja_JP'])expect(config).toContain('- '+locale);for(const code of ['1033','1041'])expect(include).toContain('$LANGUAGE == '+code);expect(include).toContain('installation-language.json');expect(include).not.toContain('ui-language.json');
 });
 it('localizes the shared desktop/start-menu shortcut name with a plain Lumina fallback',()=>{
  const config=readFileSync('apps/desktop/electron-builder.yml','utf8'),include=readFileSync('apps/desktop/assets/installer-language.nsh','utf8');
  expect(config).toContain('shortcutName: Lumina');
  expect(include).toContain('!define SHORTCUT_NAME "$(LuminaShortcutName)"');
  expect(include).toContain('LangString LuminaShortcutName 2052 "光匣 Lumina"');
  for(const locale of [1033,1041])expect(include).toContain(`LangString LuminaShortcutName ${locale} "Lumina"`);
 });
});
