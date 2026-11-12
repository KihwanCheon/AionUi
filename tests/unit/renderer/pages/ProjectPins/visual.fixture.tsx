/** Isolated sidebar fixture. The browser runner intercepts data and preference requests. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import '@arco-design/web-react/dist/css/arco.css';
import 'virtual:uno.css';
import '@/renderer/styles/arco-override.css';
import '@/renderer/styles/themes/index.css';
import koConversation from '@/renderer/services/i18n/locales/ko-KR/conversation.json';
import koCommon from '@/renderer/services/i18n/locales/ko-KR/common.json';
import { configService } from '@/common/config/configService';
import WorkspaceGroupedHistory from '@/renderer/pages/conversation/GroupedHistory';
import { applyTheme } from '@/renderer/utils/theme/applyTheme';
import { BUILTIN_THEMES } from '@/renderer/theme/builtinThemes';

await i18next.use(initReactI18next).init({
  lng: 'ko-KR',
  resources: { 'ko-KR': { translation: { conversation: koConversation, common: koCommon } } },
  interpolation: { escapeValue: false },
});
await configService.initialize();
applyTheme(BUILTIN_THEMES.find((theme) => theme.appearance === 'dark')!);
createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18next}>
    <MemoryRouter>
      <div className='w-280px h-screen bg-base overflow-y-auto py-12px'>
        <WorkspaceGroupedHistory />
      </div>
    </MemoryRouter>
  </I18nextProvider>
);
