import {useSyncExternalStore} from 'react';
import {getLanguage,languages,setLanguage,subscribeLanguage,t,type Language} from './i18n';

export function useLanguage(){return useSyncExternalStore(subscribeLanguage,getLanguage,getLanguage);}
export function LanguageSettings(){
  const language=useLanguage();
  return <section className="settings-panel language-settings" aria-label={t('界面语言')}>
    <div className="section-head"><div><h3>{t('界面语言')}</h3><p>{t('切换后立即生效并记住选择。文件名、路径、标签和相册名称保持原文。')}</p></div>
      <label className="language-choice">{t('语言')}<select aria-label={t('界面语言')} value={language} onChange={event=>setLanguage(event.target.value as Language)}>{languages.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    </div>
  </section>;
}
