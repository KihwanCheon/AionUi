/** Isolated sidebar: all conversation data and mutations stay inside this page. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { Button, Input } from '@arco-design/web-react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import '@arco-design/web-react/dist/css/arco.css';
import 'virtual:uno.css';
import '@/renderer/styles/arco-override.css';
import '@/renderer/styles/themes/index.css';
import koConversation from '@/renderer/services/i18n/locales/ko-KR/conversation.json';
import koCommon from '@/renderer/services/i18n/locales/ko-KR/common.json';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { configService } from '@/common/config/configService';
import { ConversationHistoryProvider } from '@/renderer/hooks/context/ConversationHistoryContext';
import { LayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { ThemeProvider } from '@/renderer/hooks/context/ThemeContext';
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

const now = Date.now();
let conversations = Array.from({ length: 814 }, (_, index) => ({
  id: `row-${index}`,
  name: `검증 대화 ${index}`,
  type: 'acp',
  pinned: true,
  created_at: now - index * 1000,
  modified_at: now - (index < 120 ? index * 1000 : 10 * 86400000 + index * 1000),
  extra: {
    backend: 'claude',
    sortOrder: index * 1000,
    ...(index < 700 ? { custom_workspace: true, workspace: index < 600 ? '/work/ProjectA' : '/work/ProjectB' } : {}),
  },
  model: {},
})) as TChatConversation[];

ipcBridge.conversation.responseStream.on = () => () => {};
ipcBridge.conversation.listChanged.on = () => () => {};
ipcBridge.conversation.turnCompleted.on = () => () => {};
ipcBridge.conversation.get.invoke = async ({ id }) => conversations.find((item) => item.id === id)!;
ipcBridge.database.getUserConversations.invoke = async () => ({
  items: conversations,
  total: conversations.length,
  has_more: false,
});
ipcBridge.fs.getGitBranches.invoke = async ({ workspaces }) =>
  workspaces.map((workspace) => ({ workspace, branch: 'main' }));
ipcBridge.cron.listJobs.invoke = async () => [];
ipcBridge.conversation.update.invoke = async ({ id, updates }) => {
  conversations = conversations.map((item) =>
    item.id === id
      ? (Object.assign({}, item, updates, { extra: { ...item.extra, ...updates.extra } }) as TChatConversation)
      : item
  );
  document.documentElement.dataset.updatedConversation = id;
  document.documentElement.dataset.updatedSortOrder = String(updates.extra?.sortOrder);
  return true;
};

function Fixture() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const isMobile = window.innerWidth < 600;
  return (
    <LayoutContext.Provider value={{ isMobile, siderCollapsed: hidden, setSiderCollapsed: setHidden }}>
      <div className='flex gap-8px h-screen'>
        <div
          data-conversation-scroll
          data-testid='sidebar'
          className='w-280px shrink-0 h-full overflow-y-auto bg-base'
          style={{ visibility: hidden ? 'hidden' : 'visible', transform: hidden ? 'translateX(-100%)' : undefined }}
        >
          <WorkspaceGroupedHistory batchMode={batchMode} onBatchModeChange={setBatchMode} />
        </div>
        <div className='flex flex-col gap-12px min-w-0'>
          <Button data-testid='reveal-target' onClick={() => void navigate('/conversation/row-800')}>
            대상 이동
          </Button>
          <Button data-testid='toggle-sidebar' onClick={() => setHidden((value) => !value)}>
            목록 열기·닫기
          </Button>
          <Button data-testid='toggle-batch' onClick={() => setBatchMode((value) => !value)}>
            일괄 선택
          </Button>
          <Input.TextArea data-testid='typing' />
          <output data-testid='navigation'>{id}</output>
        </div>
      </div>
    </LayoutContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18next}>
    <MemoryRouter initialEntries={['/conversation/row-0']}>
      <ThemeProvider>
        <ConversationHistoryProvider>
          <Routes>
            <Route path='/conversation/:id' element={<Fixture />} />
          </Routes>
        </ConversationHistoryProvider>
      </ThemeProvider>
    </MemoryRouter>
  </I18nextProvider>
);
