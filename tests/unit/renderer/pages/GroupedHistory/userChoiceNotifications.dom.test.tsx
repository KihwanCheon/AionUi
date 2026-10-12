import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  mobile: false,
  onStream: vi.fn(),
  getConversation: vi.fn().mockResolvedValue({ name: 'Conversation A' }),
}));
vi.mock('@/common', () => ({
  ipcBridge: { conversation: { responseStream: { on: state.onStream }, get: { invoke: state.getConversation } } },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) => (params?.count === undefined ? key : `${key}:${params.count}`),
  }),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: state.mobile }) }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync', () => ({
  getSnapshotConversationName: () => 'Conversation A',
}));

import {
  ConversationChoiceBadge,
  ProjectChoiceBadge,
  UserChoiceNotificationButton,
  UserChoiceNotificationsProvider,
} from '@/renderer/hooks/context/UserChoiceNotifications';
import { createChoiceNoticeStore } from '@/renderer/hooks/context/UserChoiceNotifications/store';
import { USER_CHOICE_MARKER } from '@/renderer/hooks/context/UserChoiceNotifications/protocol';
import ProjectGroupHeader from '@/renderer/pages/conversation/GroupedHistory/components/ProjectGroupHeader';
import ConversationLeadingStatus from '@/renderer/pages/conversation/GroupedHistory/components/ConversationLeadingStatus';

const frame = (conversationId = 'conversation-a', messageId = 'message-a'): IResponseMessage => ({
  type: 'content',
  conversation_id: conversationId,
  msg_id: messageId,
  data: `${USER_CHOICE_MARKER}\n재시작해도 될까요?\n`,
});
const setup = (content?: React.ReactNode) => {
  const store = createChoiceNoticeStore();
  store.consume(frame());
  render(
    <UserChoiceNotificationsProvider store={store}>
      {content ?? <UserChoiceNotificationButton />}
    </UserChoiceNotificationsProvider>
  );
  return store;
};

beforeEach(() => {
  vi.clearAllMocks();
  state.mobile = false;
  state.onStream.mockReturnValue(vi.fn());
});

afterEach(() => vi.restoreAllMocks());

describe('in-app choice notification UI', () => {
  it('opens the originating conversation and question without dismissing it', async () => {
    const store = setup();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    fireEvent.click(await screen.findByRole('button', { name: /Conversation A/ }));
    expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation-a', {
      state: { targetMessageId: 'message-a' },
    });
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('counts conversations rather than individual questions and clears only by dismissal', async () => {
    const store = setup();
    act(() => store.consume(frame('conversation-a', 'message-b')));
    expect(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    const buttons = await screen.findAllByRole('button', { name: 'conversation.userChoiceNotifications.dismiss' });
    fireEvent.click(buttons[0]);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('keeps the AI identity, running spinner and independent choice badge together', () => {
    setup(
      <>
        <ConversationLeadingStatus
          conversationId='conversation-a'
          isGenerating
          isWaitingConfirmation={false}
          batchMode={false}
        >
          <span data-testid='provider-logo' />
        </ConversationLeadingStatus>
        <ConversationChoiceBadge conversationId='conversation-a' />
      </>
    );
    expect(screen.getByTestId('provider-logo')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-generating-indicator-conversation-a')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-choice-conversation-a')).toBeInTheDocument();
  });

  it('shows a collapsed project badge without replacing the existing running indicator', () => {
    setup(
      <ProjectGroupHeader
        workspace='D:/project'
        displayName='Project'
        indicatorStatus='generating'
        choiceConversationIds={['conversation-a']}
      />
    );
    expect(screen.getByTestId('project-choice')).toBeInTheDocument();
    expect(screen.getByTestId('project-generating')).toBeInTheDocument();
  });

  it('does not mark an unrelated or expanded project', () => {
    setup(
      <>
        <ProjectChoiceBadge conversationIds={['conversation-b']} />
        <ProjectChoiceBadge conversationIds={[]} />
      </>
    );
    expect(screen.queryByTestId('project-choice')).not.toBeInTheDocument();
  });

  it('shows a bottom sheet on phones', async () => {
    state.mobile = true;
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    await waitFor(() => expect(document.querySelector('.arco-drawer')).toHaveStyle({ bottom: '0px', height: '65vh' }));
    fireEvent.click(await screen.findByRole('button', { name: /Conversation A/ }));
    expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation-a', {
      state: { targetMessageId: 'message-a' },
    });
  });

  it('continues showing a notification after a terminal stream frame', () => {
    setup(<ConversationChoiceBadge conversationId='conversation-a' />);
    const callback = state.onStream.mock.calls[0][0] as (message: IResponseMessage) => void;
    act(() => callback({ ...frame(), type: 'finish', data: {} }));
    expect(screen.getByTestId('conversation-choice-conversation-a')).toBeInTheDocument();
  });
});
