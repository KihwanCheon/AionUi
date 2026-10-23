import React from 'react';
import ReactMarkdown from 'react-markdown';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  useConversationNotificationHighlight,
  useMessageNotificationHighlight,
  useCompletedChoiceMessage,
} from '@/renderer/hooks/context/UserChoiceNotifications';
import { createChoiceNoticeStore } from '@/renderer/hooks/context/UserChoiceNotifications/store';
import { USER_CHOICE_MARKER } from '@/renderer/hooks/context/UserChoiceNotifications/protocol';
import { remarkChoiceQuestions } from '@/renderer/hooks/context/UserChoiceNotifications/remarkChoiceQuestions';
import { MARKDOWN_REMARK_PLUGINS } from '@/renderer/components/Markdown/markdownComponents';
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

describe('prose question boxes', () => {
  const fallback = '사용자 확인이 필요합니다. 위 내용을 확인해 주세요.';
  const markdown = (text: string, complete = false) => (
    <ReactMarkdown
      remarkPlugins={[[remarkChoiceQuestions, { label: '답변 요청', fallback, complete }], ...MARKDOWN_REMARK_PLUGINS]}
    >
      {text}
    </ReactMarkdown>
  );

  it('turns a final marker after the question and options into an anchored fallback box at completion', () => {
    const text = `어떻게 진행할까요?\n\n- 직접 처리\n- 자동 처리\n\n${USER_CHOICE_MARKER}`;
    const { container, rerender } = render(markdown(text));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    rerender(markdown(text, true));
    const box = screen.getByRole('group', { name: '답변 요청' });
    expect(box).toHaveAttribute('data-choice-marker-index', '0');
    expect(box).toHaveTextContent(fallback);
    expect(box).not.toHaveTextContent('직접 처리');
    expect(container).not.toHaveTextContent(USER_CHOICE_MARKER);
  });

  it('shows separate fallback boxes for consecutive empty markers', () => {
    render(markdown(`${USER_CHOICE_MARKER}\n\n${USER_CHOICE_MARKER}`, true));
    expect(screen.getAllByText(fallback)).toHaveLength(2);
    expect(screen.getAllByRole('group').map((box) => box.dataset.choiceMarkerIndex)).toEqual(['0', '1']);
  });

  it('keeps introductory prose outside the question box even without a blank line', () => {
    const { container } = render(markdown(`먼저 설명합니다.\n${USER_CHOICE_MARKER}\n이 범위로 진행할까요?`));
    const box = screen.getByRole('group', { name: '답변 요청' });

    expect(box).toHaveTextContent('이 범위로 진행할까요?');
    expect(box).not.toHaveTextContent('먼저 설명합니다.');
    expect(container).not.toHaveTextContent(USER_CHOICE_MARKER);
  });

  it('preserves Markdown links, emphasis and lists across question boundaries', () => {
    render(
      markdown(
        `앞의 [문서][ref]\n\n${USER_CHOICE_MARKER}\n**어떤 경로인가요?**\n\n- CPU\n- Vulkan\n\n[ref]: https://example.com/spec`
      )
    );
    const box = screen.getByRole('group', { name: '답변 요청' });

    expect(screen.getByRole('link', { name: '문서' })).toHaveAttribute('href', 'https://example.com/spec');
    expect(box.querySelector('strong')).toHaveTextContent('어떤 경로인가요?');
    expect(box.querySelectorAll('li')).toHaveLength(2);
  });

  it('keeps each marker index attached to its own question including all following blocks', () => {
    render(markdown(`${USER_CHOICE_MARKER}\n첫 질문?\n\n첫 설명.\n\n${USER_CHOICE_MARKER}\n둘째 질문?\n\n둘째 설명.`));
    const boxes = screen.getAllByRole('group', { name: '답변 요청' });

    expect(boxes.map((box) => box.getAttribute('data-choice-marker-index'))).toEqual(['0', '1']);
    expect(boxes.map((box) => box.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '답변 요청 첫 질문? 첫 설명.',
      '답변 요청 둘째 질문? 둘째 설명.',
    ]);
  });

  it.each([
    `> ${USER_CHOICE_MARKER}\n> 인용 예시`,
    `\`\`\`text\n${USER_CHOICE_MARKER}\n코드 예시\n\`\`\``,
    `    ${USER_CHOICE_MARKER}\n    코드 예시`,
    `인라인 \`${USER_CHOICE_MARKER}\` 예시`,
    `문장 안의 ${USER_CHOICE_MARKER}\n일반 설명`,
    `\\[\\[AIONUI_USER_CHOICE_REQUIRED\\]\\]\n이스케이프 예시`,
  ])('leaves quoted and code examples unboxed: %s', (text) => {
    render(markdown(text));

    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByText(USER_CHOICE_MARKER, { exact: false })).toBeInTheDocument();
  });

  it('adds one box only after the streamed marker line is complete', () => {
    const { rerender } = render(markdown(USER_CHOICE_MARKER.slice(0, 15)));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();

    rerender(markdown(USER_CHOICE_MARKER));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();

    rerender(markdown(`${USER_CHOICE_MARKER}\n첫 질문?`));
    rerender(markdown(`${USER_CHOICE_MARKER}\n첫 질문?\n\n- 선택지`));
    expect(screen.getAllByRole('group', { name: '답변 요청' })).toHaveLength(1);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('in-app attention notification UI', () => {
  const CompletedQuestion = ({ complete }: { complete: boolean }) => {
    const message = React.useMemo(
      () => ({
        id: 'stored-row',
        msg_id: 'stored-message',
        conversation_id: 'conversation-a',
        type: 'text' as const,
        position: 'left' as const,
        created_at: 123,
        content: { content: `어떻게 진행할까요?\n\n${USER_CHOICE_MARKER}` },
      }),
      []
    );
    useCompletedChoiceMessage(message, message.content.content, complete);
    return null;
  };

  it('recovers a completed final marker on mount and navigates to its fallback box', async () => {
    state.registerChoiceNotice.mockImplementation(async (notice) => [notice]);
    setup(
      <>
        <UserChoiceNotificationButton />
        <CompletedQuestion complete />
      </>,
      false
    );
    await waitFor(() => expect(state.registerChoiceNotice).toHaveBeenCalledTimes(1));
    expect(state.registerChoiceNotice).toHaveBeenCalledWith(
      expect.objectContaining({ preview: '', messageId: 'stored-message', markerIndex: 0 })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    fireEvent.click(await screen.findByRole('button', { name: /messages.userQuestion.fallback/ }));
    expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation-a', {
      state: { targetMessageId: 'stored-message', targetMarkerIndex: 0 },
    });
  });

  it('keeps a recovered question hidden when the server already has its dismissal tombstone', async () => {
    setup(
      <>
        <UserChoiceNotificationButton />
        <CompletedQuestion complete />
      </>,
      false
    );
    await waitFor(() => expect(state.registerChoiceNotice).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:0' })).toBeInTheDocument();
  });

  it('does not recover a final partial line while its response is streaming', async () => {
    setup(
      <>
        <UserChoiceNotificationButton />
        <CompletedQuestion complete={false} />
      </>,
      false
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(state.registerChoiceNotice).not.toHaveBeenCalled();
  });
  const HighlightTargets = ({ conversationId = 'conversation-a' }: { conversationId?: string }) => {
    const highlighted = useConversationNotificationHighlight(conversationId);
    const highlightedQuestionIndex = useMessageNotificationHighlight(conversationId, 'persisted-row', 'message-a');
    return (
      <div data-testid={`targets-${conversationId}`}>
        <span data-testid={`row-${conversationId}`} data-highlighted={highlighted} />
        <ReactMarkdown
          remarkPlugins={[
            [
              remarkChoiceQuestions,
              { label: '답변 요청', fallback: '위 내용을 확인해 주세요.', highlightedQuestionIndex },
            ],
          ]}
        >
          {`${USER_CHOICE_MARKER}\n첫 질문?\n\n${USER_CHOICE_MARKER}\n둘째 질문?`}
        </ReactMarkdown>
      </div>
    );
  };

  const setupHighlight = () => {
    const store = createChoiceNoticeStore();
    store.consume({ ...frame(), data: `${USER_CHOICE_MARKER}\n첫 질문?\n\n${USER_CHOICE_MARKER}\n둘째 질문?\n` });
    render(
      <UserChoiceNotificationsProvider store={store}>
        <UserChoiceNotificationButton />
        <HighlightTargets />
        <HighlightTargets conversationId='conversation-b' />
      </UserChoiceNotificationsProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    return store;
  };

  it('previews only the matching conversation and marker without opening or dismissing it', async () => {
    const store = setupHighlight();
    const button = await screen.findByRole('button', { name: /Conversation A.*둘째 질문/ });
    const item = button.parentElement!;
    const boxes = within(screen.getByTestId('targets-conversation-a')).getAllByRole('group');
    fireEvent.mouseEnter(item);

    expect(screen.getByTestId('row-conversation-a')).toHaveAttribute('data-highlighted', 'true');
    expect(boxes.map((box) => box.hasAttribute('data-notification-highlight'))).toEqual([false, true]);
    expect(screen.getByTestId('row-conversation-b')).toHaveAttribute('data-highlighted', 'false');
    expect(screen.getByTestId('targets-conversation-b').querySelector('[data-notification-highlight]')).toBeNull();
    fireEvent.mouseEnter(within(item).getByRole('button', { name: 'conversation.userChoiceNotifications.dismiss' }));
    expect(boxes[1]).toHaveAttribute('data-notification-highlight', 'true');
    fireEvent.mouseLeave(item);
    expect(boxes[1]).not.toHaveAttribute('data-notification-highlight');
    expect(store.getSnapshot()).toHaveLength(2);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.dismissChoiceNotice).not.toHaveBeenCalled();
  });

  it('moves the preview between questions and clears it when the popup closes', async () => {
    setupHighlight();
    const first = (await screen.findByRole('button', { name: /Conversation A.*첫 질문/ })).parentElement!;
    const second = screen.getByRole('button', { name: /Conversation A.*둘째 질문/ }).parentElement!;
    const boxes = within(screen.getByTestId('targets-conversation-a')).getAllByRole('group');
    fireEvent.mouseEnter(first);
    fireEvent.mouseLeave(first);
    fireEvent.mouseEnter(second);
    expect(boxes.map((box) => box.hasAttribute('data-notification-highlight'))).toEqual([false, true]);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    await waitFor(() => expect(boxes[1]).not.toHaveAttribute('data-notification-highlight'));
    expect(screen.getByTestId('row-conversation-a')).toHaveAttribute('data-highlighted', 'false');
  });

  it('keeps keyboard focus preview on the dismiss button and clears only the dismissed target', async () => {
    const store = setupHighlight();
    const open = await screen.findByRole('button', { name: /Conversation A.*둘째 질문/ });
    const dismiss = within(open.parentElement!).getByRole('button', {
      name: 'conversation.userChoiceNotifications.dismiss',
    });
    const boxes = within(screen.getByTestId('targets-conversation-a')).getAllByRole('group');
    fireEvent.focus(open);
    fireEvent.blur(open, { relatedTarget: dismiss });
    fireEvent.focus(dismiss, { relatedTarget: open });
    expect(boxes[1]).toHaveAttribute('data-notification-highlight', 'true');
    fireEvent.click(dismiss);
    expect(boxes[1]).not.toHaveAttribute('data-notification-highlight');
    expect(store.getSnapshot().map((notice) => notice.markerIndex)).toEqual([0]);
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('clears a preview removed by another device while keeping the original question visible', async () => {
    const store = setupHighlight();
    const item = (await screen.findByRole('button', { name: /Conversation A.*둘째 질문/ })).parentElement!;
    fireEvent.mouseEnter(item);
    act(() => store.replaceAll(store.getSnapshot().filter((notice) => notice.markerIndex === 0)));
    expect(screen.getByTestId('targets-conversation-a').querySelector('[data-notification-highlight]')).toBeNull();
    expect(within(screen.getByTestId('targets-conversation-a')).getAllByRole('group')).toHaveLength(2);
  });

  it('opens and manually dismisses a server-owned structured question without a prose marker', async () => {
    const store = setup(undefined, false);
    const notice = {
      key: JSON.stringify(['conversation-a', 'question-async-0', 0]),
      conversationId: 'conversation-a',
      messageId: 'question-async-0',
      markerIndex: 0,
      preview: 'Teams도 포함할까요?',
      createdAt: 100,
    };
    act(() => {
      state.onStream.mock.calls[0][0]({
        type: 'content',
        conversation_id: notice.conversationId,
        msg_id: notice.messageId,
        data: { content: 'Teams도 포함할까요?\n- 일반 대화\n- Teams 포함' },
        replace: true,
      });
      state.onChoiceNoticesChanged.mock.calls[0][0]({ user_id: 'user-a', items: [notice] });
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    fireEvent.click(await screen.findByRole('button', { name: /Conversation A/ }));
    expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation-a', {
      state: { targetMessageId: notice.messageId, targetMarkerIndex: 0 },
    });
    expect(store.getSnapshot()).toEqual([notice]);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.userChoiceNotifications.dismiss' }));
    await waitFor(() => expect(state.dismissChoiceNotice).toHaveBeenCalledWith(notice));
  });

  it('opens the originating conversation and question without dismissing it', async () => {
    const store = setup();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    fireEvent.click(await screen.findByRole('button', { name: /Conversation A/ }));
    expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation-a', {
      state: { targetMessageId: 'message-a', targetMarkerIndex: 0 },
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

  it('keeps the notification after a visible user send until its dismiss button is clicked', async () => {
    const store = setup();
    const notice = store.getSnapshot()[0];
    act(() => {
      for (const [callback] of state.onUserCreated.mock.calls) {
        callback({ conversation_id: 'conversation-a', hidden: false, source: 'user' });
      }
    });

    expect(store.getSnapshot()).toEqual([notice]);
    expect(state.dismissChoiceNotice).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.userChoiceNotifications.dismiss' }));
    await waitFor(() => expect(state.dismissChoiceNotice).toHaveBeenCalledWith(notice));
    expect(store.getSnapshot()).toEqual([]);
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

    act(() => callback({ user_id: 'user-a', items: [] }));
    expect(store.getSnapshot()).toEqual([]);
    expect(screen.queryByTestId('conversation-choice-conversation-b')).not.toBeInTheDocument();
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

  it('keeps synchronizing a new question when the user replies before registration completes', async () => {
    vi.useFakeTimers();
    const store = setup(<ConversationChoiceBadge conversationId='conversation-a' />, false);
    const callback = state.onStream.mock.calls[0][0] as (message: IResponseMessage) => void;
    act(() => callback(frame()));
    const notice = store.getSnapshot()[0];
    state.registerChoiceNotice.mockResolvedValue([notice]);

    act(() => {
      for (const [onUserCreated] of state.onUserCreated.mock.calls) {
        onUserCreated({ conversation_id: 'conversation-a', hidden: false, source: 'user' });
      }
    });
    await act(async () => vi.runAllTimersAsync());

    expect(state.registerChoiceNotice).toHaveBeenCalledWith(notice);
    expect(store.getSnapshot()).toEqual([notice]);
    expect(screen.getByTestId('conversation-choice-conversation-a')).toBeInTheDocument();
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
      state: { targetMessageId: 'message-a', targetMarkerIndex: 0 },
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
