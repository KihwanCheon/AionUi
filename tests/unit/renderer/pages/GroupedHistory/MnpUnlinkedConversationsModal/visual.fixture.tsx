/** Isolated browser fixture. All lookups and archive requests are replaced in memory. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import '@arco-design/web-react/dist/css/arco.css';
import 'virtual:uno.css';
import '@/renderer/styles/arco-override.css';
import '@/renderer/styles/themes/index.css';
import koConversation from '@/renderer/services/i18n/locales/ko-KR/conversation.json';
import koCommon from '@/renderer/services/i18n/locales/ko-KR/common.json';
import { ipcBridge } from '@/common';
import { mindNProgressConversationApi } from '@/renderer/components/chat/SendBox/MindNProgressConversationLink';
import MnpUnlinkedConversationsModal from '@/renderer/pages/conversation/GroupedHistory/components/MnpUnlinkedConversationsModal';
import { applyTheme } from '@/renderer/utils/theme/applyTheme';
import { BUILTIN_THEMES } from '@/renderer/theme/builtinThemes';
import { conversation, link } from './fixtures';

await i18next.use(initReactI18next).init({
  lng: 'ko-KR',
  resources: { 'ko-KR': { translation: { conversation: koConversation, common: koCommon } } },
  interpolation: { escapeValue: false },
});
applyTheme(BUILTIN_THEMES.find((theme) => theme.appearance === 'dark')!);
const conversations = Array.from({ length: 9 }, (_, index) => ({
  ...conversation(`fixture-${index}`),
  name: index === 0 ? 'Common·Bindings 조회·등록·동기화 — 미연결 대화 정리 확인' : `프로젝트 검토 대화 ${index + 1}`,
}));
mindNProgressConversationApi.lookup = async (id) => {
  if (id === 'fixture-8') throw new Error('Isolated lookup failure');
  return link(id, id === 'fixture-7');
};
ipcBridge.sidebar.archive.invoke = async ({ item_id }) => {
  if (item_id === 'fixture-1') throw new Error('Isolated archive failure');
};
createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18next}>
    <MnpUnlinkedConversationsModal
      groupName='JP 로얄 — 프로젝트 대화'
      conversations={conversations}
      isConversationGenerating={(id) => id === 'fixture-0'}
      onClose={() => {}}
    />
  </I18nextProvider>
);
