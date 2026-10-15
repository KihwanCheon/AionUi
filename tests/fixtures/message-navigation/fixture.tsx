/** Real message rendering and scroll hooks with isolated, delayed history responses. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Button } from '@arco-design/web-react';
import '@arco-design/web-react/dist/css/arco.css';
import '@/renderer/styles/themes/index.css';
import 'virtual:uno.css';
import { ipcBridge } from '@/common';
import type { IMessageText } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import { LayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { PreviewProvider } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import MessageList from '@/renderer/pages/conversation/Messages/MessageList';
import {
  MessageListProvider,
  MessageListLoadingProvider,
  MessagePaginationProvider,
  useMessageLstCache,
  useUpdateMessageList,
} from '@/renderer/pages/conversation/Messages/hooks';
import {
  UserChoiceNotificationsProvider,
  UserChoiceNotificationButton,
} from '@/renderer/hooks/context/UserChoiceNotifications';
import { createChoiceNoticeStore } from '@/renderer/hooks/context/UserChoiceNotifications/store';
import { USER_CHOICE_MARKER } from '@/renderer/hooks/context/UserChoiceNotifications/protocol';
import koConversation from '@/renderer/services/i18n/locales/ko-KR/conversation.json';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') ?? 'delayed-image';
const conversationId = 'isolated-message-navigation';
const conversation = {
  id: conversationId,
  name: '알림 위치 검증',
  type: 'acp',
  extra: { backend: 'claude' },
  model: {},
} as TChatConversation;
const message = (index: number, text: string): IMessageText => ({
  id: `navigation-${index}`,
  msg_id: `navigation-turn-${index}`,
  conversation_id: conversationId,
  created_at: index,
  position: 'left',
  type: 'text',
  content: { content: text },
});
const targetId = 'navigation-10';
const markerExamples = `> ${USER_CHOICE_MARKER}\n\n\`${USER_CHOICE_MARKER}\`\n\n\`\`\`text\n${USER_CHOICE_MARKER}\n\`\`\`\n\n`;
const targetText = `${scenario === 'long-message' ? '긴 설명 문단입니다.\n\n'.repeat(45) : ''}${scenario === 'two-markers' ? `${markerExamples}${USER_CHOICE_MARKER}\n첫 질문입니다.\n\n${'긴 설명입니다.\n\n'.repeat(25)}` : ''}${USER_CHOICE_MARKER}\n검증용 승인 질문입니다.\n`;
const messages = Array.from({ length: 25 }, (_, i) =>
  message(i, i === 10 ? targetText : `기록 ${i}\n\n일반 대화 내용입니다.\n\n${'추가 설명입니다. '.repeat(8)}`)
);
if (scenario === 'delayed-image') {
  messages[3] = message(3, '![늦게 표시되는 이미지](https://fixture.invalid/growth.svg)');
}
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
for (const event of [
  ipcBridge.conversation.responseStream,
  ipcBridge.conversation.userCreated,
  ipcBridge.conversation.statusChanged,
  ipcBridge.conversation.listChanged,
  ipcBridge.conversation.turnCompleted,
  ipcBridge.theme.changed,
])
  event.on = () => () => {};
ipcBridge.theme.requestCurrent.invoke = async () => ({ css: '' });
ipcBridge.acpConversation.getManagedAgents.invoke = async () => [];
ipcBridge.conversation.get.invoke = async () => conversation;
ipcBridge.database.getUserConversations.invoke = async () => ({ items: [conversation], total: 1, has_more: false });
ipcBridge.database.getConversationMessages.invoke = async ({ limit, anchor_message_id, before }) => {
  await wait(limit === 200 ? 0 : 120);
  const items = limit === 200 || anchor_message_id || scenario !== 'older-anchor' ? messages : messages.slice(18);
  return {
    items: before ? [] : items,
    has_more_before: !before && scenario === 'older-anchor' && !anchor_message_id && limit !== 200,
    has_more_after: false,
    oldest_cursor: 'oldest',
    newest_cursor: 'newest',
  };
};

await i18next.use(initReactI18next).init({
  lng: 'ko-KR',
  resources: { 'ko-KR': { translation: { conversation: koConversation } } },
  interpolation: { escapeValue: false },
});
const store = createChoiceNoticeStore();
store.consume({ type: 'content', conversation_id: conversationId, msg_id: targetId, data: targetText });

function Chat() {
  useMessageLstCache(conversationId);
  const update = useUpdateMessageList();
  return (
    <>
      <Button onClick={() => update((list) => [...list, { ...message(100, '검증용 사용자 응답'), position: 'right' }])}>
        사용자 메시지 추가
      </Button>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <MessageList />
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18next}>
    <LayoutContext.Provider value={{ isMobile: false, siderCollapsed: false, setSiderCollapsed: () => {} }}>
      <MemoryRouter initialEntries={['/guid']}>
        <PreviewProvider>
          <UserChoiceNotificationsProvider store={store}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '0 20px' }}>
              <div style={{ height: 48, flexShrink: 0 }}>
                <UserChoiceNotificationButton />
              </div>
              <Routes>
                <Route path='/guid' element={<div>대화 로딩 전</div>} />
                <Route
                  path='/conversation/:id'
                  element={
                    <ConversationProvider value={{ conversation_id: conversationId, type: 'acp' }}>
                      <MessageListProvider value={[]}>
                        <MessageListLoadingProvider value={false}>
                          <MessagePaginationProvider
                            value={{
                              hasMoreBefore: false,
                              hasMoreAfter: false,
                              isLoadingBefore: false,
                              isLoadingAnchor: false,
                            }}
                          >
                            <Chat />
                          </MessagePaginationProvider>
                        </MessageListLoadingProvider>
                      </MessageListProvider>
                    </ConversationProvider>
                  }
                />
              </Routes>
            </div>
          </UserChoiceNotificationsProvider>
        </PreviewProvider>
      </MemoryRouter>
    </LayoutContext.Provider>
  </I18nextProvider>
);
document.body.style.margin = '0';
