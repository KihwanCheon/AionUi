import React from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import '@arco-design/web-react/dist/css/arco.css';
import '@arco-design/web-react/es/_util/react-19-adapter';
import 'virtual:uno.css';
import '@/renderer/styles/arco-override.css';
import '@/renderer/styles/themes/index.css';
import koSettings from '@/renderer/services/i18n/locales/ko-KR/settings.json';
import koCommon from '@/renderer/services/i18n/locales/ko-KR/common.json';
import ArchiveRetentionSettings from '@/renderer/pages/settings/ArchivedSettings/ArchiveRetentionSettings';
import { applyTheme } from '@/renderer/utils/theme/applyTheme';
import { BUILTIN_THEMES } from '@/renderer/theme/builtinThemes';

await i18next.use(initReactI18next).init({
  lng: 'ko-KR',
  resources: { 'ko-KR': { translation: { settings: koSettings, common: koCommon } } },
  interpolation: { escapeValue: false },
});
applyTheme(BUILTIN_THEMES.find((theme) => theme.appearance === 'dark')!);
createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18next}>
    <div className='p-24px bg-base h-screen'>
      <ArchiveRetentionSettings />
    </div>
  </I18nextProvider>
);
