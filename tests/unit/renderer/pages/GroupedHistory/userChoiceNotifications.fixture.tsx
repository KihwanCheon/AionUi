/** Isolated visual fixture: no real conversation, setting, or AI request is mutated. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import '@arco-design/web-react/dist/css/arco.css';
import '@/renderer/styles/themes/index.css';
import '@/renderer/styles/arco-override.css';
import 'virtual:uno.css';
import koConversation from '@/renderer/services/i18n/locales/ko-KR/conversation.json';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { LayoutContext } from '@/renderer/hooks/context/LayoutContext';
import {
  UserChoiceNotificationsProvider,
  UserChoiceNotificationButton,
  useUserChoiceNotifications,
} from '@/renderer/hooks/context/UserChoiceNotifications';
import { createChoiceNoticeStore } from '@/renderer/hooks/context/UserChoiceNotifications/store';
import { USER_CHOICE_MARKER } from '@/renderer/hooks/context/UserChoiceNotifications/protocol';
import ConversationRow from '@/renderer/pages/conversation/GroupedHistory/ConversationRow';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';
import ProjectGroupHeader from '@/renderer/pages/conversation/GroupedHistory/components/ProjectGroupHeader';
import { applyTheme } from '@/renderer/utils/theme/applyTheme';
import { BUILTIN_THEMES } from '@/renderer/theme/builtinThemes';

await i18next.use(initReactI18next).init({
  lng: 'ko-KR',
  resources: { 'ko-KR': { translation: { conversation: koConversation } } },
  interpolation: { escapeValue: false },
});
ipcBridge.conversation.responseStream.on = () => () => {};
const conversations = ['conversation-a', 'conversation-b'].map(
  (id, index) =>
    ({
      id,
      name: `선택 질문 테스트 ${index + 1}`,
      type: 'acp',
      created_at: 1,
      modified_at: 1,
      extra: { backend: index ? 'claude' : 'codex', isPinned: true },
      model: {},
    }) as TChatConversation
);
ipcBridge.conversation.get.invoke = async ({ id }) => conversations.find((item) => item.id === id)!;
const store = createChoiceNoticeStore(localStorage, 'isolated-choice-notification-fixture');
for (const conversation of conversations) {
  store.consume({
    type: 'content',
    conversation_id: conversation.id,
    msg_id: `message-${conversation.id}`,
    data: `${USER_CHOICE_MARKER}\n검증이 끝나면 재시작해도 될까요?\n`,
  });
}
const noop = () => {};
const rowProps = (conversation: TChatConversation): ConversationRowProps => ({
  conversation,
  isGenerating: true,
  isWaitingConfirmation: false,
  hasUnread: false,
  isManualUnread: false,
  collapsed: false,
  tooltipEnabled: false,
  batchMode: false,
  checked: false,
  selected: false,
  menuVisible: false,
  onToggleChecked: noop,
  onConversationClick: noop,
  onOpenMenu: noop,
  onMenuVisibleChange: noop,
  onEditStart: noop,
  onCreateCronTask: noop,
  onArchive: noop,
  onTogglePin: noop,
  onToggleManualUnread: noop,
  getJobStatus: () => 'none',
});

function Fixture() {
  const location = useLocation();
  const { notices } = useUserChoiceNotifications();
  const state = location.state as { targetMessageId?: string } | null;
  return (
    <div className='bg-1 text-t-primary min-h-screen p-16px'>
      <div className='flex justify-end h-48px items-center gap-16px border-b border-b-base'>
        <span>사용량 91%</span>
        <UserChoiceNotificationButton />
      </div>
      <div className='w-260px flex flex-col gap-8px mt-16px'>
        {conversations.map((conversation) => (
          <ConversationRow key={conversation.id} {...rowProps(conversation)} />
        ))}
        <div className='relative flex h-40px items-center'>
          <ProjectGroupHeader
            workspace='D:/Project'
            displayName='Project'
            indicatorStatus='generating'
            choiceConversationIds={conversations.map((item) => item.id)}
          />
        </div>
      </div>
      <output data-testid='fixture-pending'>{notices.length}</output>
      <output data-testid='fixture-navigation' data-path={location.pathname} data-message={state?.targetMessageId} />
    </div>
  );
}

document.documentElement.setAttribute('data-color-scheme', 'default');
applyTheme(BUILTIN_THEMES.find((theme) => theme.appearance === 'dark')!);
createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18next}>
    <LayoutContext.Provider
      value={{ isMobile: window.innerWidth <= 1024, siderCollapsed: false, setSiderCollapsed: noop }}
    >
      <MemoryRouter initialEntries={['/guid']}>
        <UserChoiceNotificationsProvider store={store}>
          <Routes>
            <Route path='*' element={<Fixture />} />
          </Routes>
        </UserChoiceNotificationsProvider>
      </MemoryRouter>
    </LayoutContext.Provider>
  </I18nextProvider>
);
