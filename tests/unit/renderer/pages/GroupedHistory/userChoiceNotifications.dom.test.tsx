import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { ConversationFailure } from '@/renderer/pages/conversation/GroupedHistory/utils/conversationFailure';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  mobile: false,
  onStream: vi.fn(),
  onUserCreated: vi.fn(),
  onChoiceNoticesChanged: vi.fn(),
  listChoiceNotices: vi.fn(),
  registerChoiceNotice: vi.fn(),
  dismissChoiceNotice: vi.fn(),
  getConversation: vi.fn().mockResolvedValue({ name: 'Conversation A' }),
  lookupName: vi.fn(),
  failures: new Map<string, ConversationFailure>(),
  acknowledge: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: { on: state.onStream },
      userCreated: { on: state.onUserCreated },
      choiceNoticesChanged: { on: state.onChoiceNoticesChanged },
      listChoiceNotices: { invoke: state.listChoiceNotices },
      registerChoiceNotice: { invoke: state.registerChoiceNotice },
      dismissChoiceNotice: { invoke: state.dismissChoiceNotice },
      get: { invoke: state.getConversation },
    },
  },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) => (params?.count === undefined ? key : `${key}:${params.count}`),
  }),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: state.mobile }) }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync', () => ({
  getSnapshotConversationName: state.lookupName,
  useUnreadConversationFailures: () => ({ failures: state.failures, acknowledge: state.acknowledge }),
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

const frame = (
  conversationId = 'conversation-a',
  messageId = 'message-a',
  preview = '재시작해도 될까요?'
): IResponseMessage => ({
  type: 'content',
  conversation_id: conversationId,
  msg_id: messageId,
  data: `${USER_CHOICE_MARKER}\n${preview}\n`,
});
const setup = (content?: React.ReactNode, withQuestion = true) => {
  const store = createChoiceNoticeStore();
  if (withQuestion) store.consume(frame());
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
  state.onUserCreated.mockReturnValue(vi.fn());
  state.onChoiceNoticesChanged.mockReturnValue(vi.fn());
  state.listChoiceNotices.mockResolvedValue([]);
  state.registerChoiceNotice.mockResolvedValue([]);
  state.dismissChoiceNotice.mockResolvedValue([]);
  state.lookupName.mockReturnValue('Conversation A');
  state.getConversation.mockResolvedValue({ name: 'Conversation A' });
  state.failures = new Map();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('in-app attention notification UI', () => {
  it('opens the originating conversation and question without dismissing it', async () => {
    const store = setup();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    fireEvent.click(await screen.findByRole('button', { name: /Conversation A/ }));
    expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation-a', {
      state: { targetMessageId: 'message-a' },
    });
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('counts conversations rather than individual questions and dismisses only the selected question', async () => {
    const store = setup();
    act(() => store.consume(frame('conversation-a', 'message-b', '배포해도 될까요?')));
    expect(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    const buttons = await screen.findAllByRole('button', { name: 'conversation.userChoiceNotifications.dismiss' });
    fireEvent.click(buttons[0]);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('clears existing choices only when a visible user send is created', () => {
    const store = setup(<ConversationChoiceBadge conversationId='conversation-a' />);
    const callback = state.onUserCreated.mock.calls[0][0] as (message: {
      conversation_id: string;
      hidden: boolean;
      source: 'user' | 'agent_turn';
    }) => void;

    act(() => callback({ conversation_id: 'conversation-a', hidden: false, source: 'agent_turn' }));
    expect(store.getSnapshot()).toHaveLength(1);
    act(() => callback({ conversation_id: 'conversation-a', hidden: true, source: 'user' }));
    expect(store.getSnapshot()).toHaveLength(1);
    act(() => callback({ conversation_id: 'conversation-a', hidden: false, source: 'user' }));
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('replaces the local list when another device changes the server snapshot', () => {
    const store = setup(<ConversationChoiceBadge conversationId='conversation-b' />);
    const callback = state.onChoiceNoticesChanged.mock.calls[0][0] as (event: {
      user_id: string;
      items: ReturnType<typeof store.getSnapshot>;
    }) => void;
    const remote = createChoiceNoticeStore();
    remote.consume(frame('conversation-b', 'message-b', '배포해도 될까요?'));

    act(() => callback({ user_id: 'user-a', items: remote.getSnapshot() }));
    expect(store.getSnapshot().map((item) => item.conversationId)).toEqual(['conversation-b']);
    expect(screen.getByTestId('conversation-choice-conversation-b')).toBeInTheDocument();
  });

  it('loads the shared server snapshot when a device opens the app', async () => {
    const remote = createChoiceNoticeStore();
    remote.consume(frame('conversation-b', 'message-b', '배포해도 될까요?'));
    state.listChoiceNotices.mockResolvedValue(remote.getSnapshot());
    render(
      <UserChoiceNotificationsProvider>
        <ConversationChoiceBadge conversationId='conversation-b' />
      </UserChoiceNotificationsProvider>
    );

    expect(await screen.findByTestId('conversation-choice-conversation-b')).toBeInTheDocument();
    expect(state.listChoiceNotices).toHaveBeenCalledOnce();
  });

  it('cancels a pending registration when the notice is dismissed immediately', async () => {
    vi.useFakeTimers();
    const store = setup(undefined, false);
    const callback = state.onStream.mock.calls[0][0] as (message: IResponseMessage) => void;
    act(() => callback(frame()));
    const notice = store.getSnapshot()[0];

    act(() => store.dismiss(notice.key));
    await act(async () => vi.runAllTimersAsync());

    expect(state.registerChoiceNotice).not.toHaveBeenCalled();
    expect(state.dismissChoiceNotice).toHaveBeenCalledWith(notice);
    vi.useRealTimers();
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

  it('shows the generalized heading and empty message when neither source has notifications', async () => {
    setup(undefined, false);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:0' }));
    expect(await screen.findByText('conversation.userChoiceNotifications.title')).toBeInTheDocument();
    expect(screen.getByText('conversation.userChoiceNotifications.empty')).toBeInTheDocument();
  });

  it('includes unread error reasons alongside questions and counts distinct conversations', async () => {
    state.failures.set('conversation-b', { turnId: 'turn-b', completedAt: 100, message: 'Server unavailable' });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:2' }));
    expect(await screen.findByText('conversation.userChoiceNotifications.unreadFailure')).toBeInTheDocument();
    expect(screen.getByText('Server unavailable')).toBeInTheDocument();
    expect(screen.getByText('재시작해도 될까요?')).toBeInTheDocument();
  });

  it('keeps both item types for one conversation without counting it twice', async () => {
    state.failures.set('conversation-a', { turnId: 'turn-a', completedAt: 100 });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    expect(await screen.findByText('conversation.userChoiceNotifications.unreadFailure')).toBeInTheDocument();
    expect(screen.getByText('conversation.userChoiceNotifications.choiceRequired')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'conversation.userChoiceNotifications.dismiss' })).toHaveLength(2);
  });

  it('opens and acknowledges an error without dismissing the same conversation question', async () => {
    state.failures.set('conversation-a', { turnId: 'turn-a', completedAt: 100, message: 'Server unavailable' });
    const store = setup();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    fireEvent.click(await screen.findByRole('button', { name: /unreadFailure.*Server unavailable/ }));
    expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation-a');
    expect(state.acknowledge).toHaveBeenCalledWith('conversation-a');
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('dismisses an error using the existing read receipt without navigating or dismissing questions', async () => {
    state.failures.set('conversation-a', {
      turnId: 'turn-a',
      completedAt: Date.now() + 100,
      message: 'Server unavailable',
    });
    const store = setup();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    const buttons = await screen.findAllByRole('button', { name: 'conversation.userChoiceNotifications.dismiss' });
    fireEvent.click(buttons[0]);
    expect(state.acknowledge).toHaveBeenCalledWith('conversation-a');
    expect(state.navigate).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('does not acknowledge an independent error when dismissing the same conversation question', async () => {
    state.failures.set('conversation-a', { turnId: 'turn-a', completedAt: 100, message: 'Server unavailable' });
    const store = setup();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    const buttons = await screen.findAllByRole('button', { name: 'conversation.userChoiceNotifications.dismiss' });
    fireEvent.click(buttons[0]);
    expect(store.getSnapshot()).toHaveLength(0);
    expect(state.acknowledge).not.toHaveBeenCalled();
    expect(screen.getByText('Server unavailable')).toBeInTheDocument();
  });

  it('keeps an error actionable even when its reason and conversation lookup are unavailable', async () => {
    state.failures.set('conversation-b', { turnId: 'turn-b', completedAt: 100 });
    state.lookupName.mockReturnValue(undefined);
    state.getConversation.mockRejectedValue(new Error('Lookup failed'));
    setup(undefined, false);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    fireEvent.click(await screen.findByRole('button', { name: /unreadFailure.*responseFailed/ }));
    expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation-b');
    expect(state.acknowledge).toHaveBeenCalledWith('conversation-b');
  });
});
