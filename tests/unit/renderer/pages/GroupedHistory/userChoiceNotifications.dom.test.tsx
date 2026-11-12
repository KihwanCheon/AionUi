import React from 'react';
import ReactMarkdown from 'react-markdown';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { ConversationFailure } from '@/renderer/pages/conversation/GroupedHistory/utils/conversationFailure';
import type { IMessageAsk } from '@/common/chat/chatLib';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  mobile: false,
  onStream: vi.fn(),
  onUserCreated: vi.fn(),
  onChoiceNoticesChanged: vi.fn(),
  onReconnect: vi.fn(),
  listChoiceNotices: vi.fn(),
  registerChoiceNotice: vi.fn(),
  dismissChoiceNotice: vi.fn(),
  getConversation: vi.fn().mockResolvedValue({ name: 'Conversation A' }),
  lookupName: vi.fn(),
  failures: new Map<string, ConversationFailure>(),
  acknowledge: vi.fn(),
  answerAsk: vi.fn(),
}));
vi.mock('@/common/adapter/ipcBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/common/adapter/ipcBridge')>();
  return { ...actual, conversation: { ...actual.conversation, answerAsk: { invoke: state.answerAsk } } };
});
vi.mock('@/common', () => ({
  ipcBridge: {
    realtime: { reconnected: { on: state.onReconnect } },
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
vi.mock('@/renderer/hooks/context/UserChoiceNotifications/MobilePushSync', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'ko-KR' },
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
import MessageQuestion from '@/renderer/pages/conversation/Messages/MessageQuestion';
import {
  QuestionNoticeProvider,
  QuestionNoticeParagraph,
} from '@/renderer/hooks/context/UserChoiceNotifications/components/QuestionNotice';

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
  state.onReconnect.mockReturnValue(vi.fn());
  state.listChoiceNotices.mockResolvedValue([]);
  state.registerChoiceNotice.mockResolvedValue([]);
  state.dismissChoiceNotice.mockResolvedValue([]);
  state.lookupName.mockReturnValue('Conversation A');
  state.getConversation.mockResolvedValue({ name: 'Conversation A' });
  state.failures = new Map();
  state.answerAsk.mockResolvedValue(undefined);
});

describe('native question notifications', () => {
  const question = (content: Partial<IMessageAsk['content']> = {}): IMessageAsk => ({
    id: 'ask-native',
    msg_id: 'ask-native',
    conversation_id: 'conversation-a',
    type: 'ask',
    position: 'left',
    content: {
      session_id: 'conversation-a',
      request_id: 'request-native',
      persisted: true,
      pendingVerified: true,
      questions: [
        { question: '배포 범위', options: [{ label: '검증 환경' }, { label: '운영 환경' }] },
        { question: '대상 기능', multi_select: true, options: [{ label: '질문 알림' }, { label: '질문 이동' }] },
      ],
      ...content,
    },
  });
  const nativeSetup = () => {
    const store = createChoiceNoticeStore();
    store.replaceAll(
      [0, 1].map((index) => ({
        key: JSON.stringify(['conversation-a', 'ask-native', index]),
        conversationId: 'conversation-a',
        messageId: 'ask-native',
        markerIndex: index,
        preview: index ? '대상 기능' : '배포 범위',
        createdAt: 1,
      }))
    );
    render(
      <UserChoiceNotificationsProvider store={store}>
        <MessageQuestion message={question()} />
        <UserChoiceNotificationButton />
      </UserChoiceNotificationsProvider>
    );
    return store;
  };

  it('navigates to the exact persisted question without answering or dismissing it', async () => {
    const store = nativeSetup();
    expect(screen.getByTestId('message-question-item-1')).toHaveAttribute('data-choice-marker-index', '1');
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    fireEvent.click(await screen.findByRole('button', { name: /Conversation A.*대상 기능/ }));
    expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation-a', {
      state: { targetMessageId: 'ask-native', targetMarkerIndex: 1 },
    });
    expect(store.getSnapshot()).toHaveLength(2);
    expect(state.answerAsk).not.toHaveBeenCalled();
  });

  it('highlights only the native question targeted by a notification preview', async () => {
    nativeSetup();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    const item = (await screen.findByRole('button', { name: /Conversation A.*대상 기능/ })).parentElement!;
    fireEvent.mouseEnter(item);
    expect(screen.getByTestId('message-question-item-1')).toHaveAttribute('data-notification-highlight', 'true');
    expect(screen.getByTestId('message-question-item-0')).not.toHaveAttribute('data-notification-highlight');
    fireEvent.mouseLeave(item);
    expect(screen.getByTestId('message-question-item-1')).not.toHaveAttribute('data-notification-highlight');
  });

  it('dismisses a notification without declining or answering the question', async () => {
    const store = nativeSetup();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    const dismiss = await screen.findAllByRole('button', { name: 'conversation.userChoiceNotifications.dismiss' });
    fireEvent.click(dismiss[0]);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(state.answerAsk).not.toHaveBeenCalled();
    expect(screen.getByTestId('message-question-decline')).toBeEnabled();
  });

  it('dismisses only the selected native question through its inline button', async () => {
    const store = nativeSetup();
    state.dismissChoiceNotice.mockImplementation(async () => store.getSnapshot());
    fireEvent.click(
      within(screen.getByTestId('message-question-item-1')).getByRole('button', {
        name: 'conversation.userChoiceNotifications.dismiss',
      })
    );

    await waitFor(() =>
      expect(state.dismissChoiceNotice).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conversation-a', messageId: 'ask-native', markerIndex: 1 })
      )
    );
    expect(store.getSnapshot().map((notice) => notice.markerIndex)).toEqual([0]);
    expect(state.answerAsk).not.toHaveBeenCalled();
  });

  it('does not offer dismissal for a native question whose notification is already removed', () => {
    const store = nativeSetup();
    act(() => store.replaceAll(store.getSnapshot().filter((notice) => notice.markerIndex === 0)));

    expect(fireEvent.contextMenu(screen.getByTestId('message-question-item-1'))).toBe(true);
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('answers every question through the dedicated channel and preserves manual notices', async () => {
    const store = nativeSetup();
    fireEvent.click(screen.getByRole('radio', { name: '검증 환경' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '질문 알림' }));
    fireEvent.click(screen.getByTestId('message-question-submit'));
    await waitFor(() =>
      expect(state.answerAsk).toHaveBeenCalledWith({
        conversation_id: 'conversation-a',
        request_id: 'request-native',
        answers: [
          { question: '배포 범위', labels: ['검증 환경'] },
          { question: '대상 기능', labels: ['질문 알림'] },
        ],
      })
    );
    expect(store.getSnapshot()).toHaveLength(2);
    expect(screen.getByTestId('message-question-status')).toHaveTextContent('messages.askAnswered');
  });

  it('restores accepted selections without enabling a second answer', () => {
    render(
      <MessageQuestion
        message={question({
          resolution: 'answered',
          answers: [{ question: '배포 범위', labels: ['검증 환경'] }],
        })}
      />
    );
    expect(screen.queryByTestId('message-question-submit')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '검증 환경' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '검증 환경' })).toBeDisabled();
  });

  it('keeps restored questions disabled until their pending state is verified', () => {
    const { rerender } = render(<MessageQuestion message={question({ pendingVerified: false })} />);
    expect(screen.getByTestId('message-question-decline')).toBeDisabled();
    rerender(<MessageQuestion message={question({ resolution: 'closed' })} />);
    expect(screen.getByTestId('message-question-status')).toHaveTextContent('messages.askClosed');
    expect(state.answerAsk).not.toHaveBeenCalled();
  });
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

describe('question notification status and inline dismissal', () => {
  const contextSetup = ({
    messageId = 'stored-row',
    streamMessageId = 'message-a',
    withNotice = true,
    onParse = () => {},
  } = {}) => {
    const text = `일반 설명\n\n${USER_CHOICE_MARKER}\n첫 질문?\n\n${USER_CHOICE_MARKER}\n둘째 질문?\n`;
    const store = createChoiceNoticeStore();
    if (withNotice) store.consume({ ...frame(), data: text });
    state.dismissChoiceNotice.mockImplementation(async () => store.getSnapshot());
    render(
      <UserChoiceNotificationsProvider store={store}>
        <UserChoiceNotificationButton />
        <QuestionNoticeProvider conversationId='conversation-a' messageId={messageId} streamMessageId={streamMessageId}>
          <ReactMarkdown
            components={{ p: QuestionNoticeParagraph }}
            remarkPlugins={[
              [remarkChoiceQuestions, { label: '답변 요청', fallback: '질문 수신 중', complete: true }],
              () => () => {
                onParse();
              },
            ]}
          >
            {text}
          </ReactMarkdown>
        </QuestionNoticeProvider>
      </UserChoiceNotificationsProvider>
    );
    return store;
  };
  const box = (index: number) => screen.getAllByRole('group', { name: '답변 요청' })[index];
  const dismissButton = (index: number) =>
    within(box(index)).getByRole('button', { name: 'conversation.userChoiceNotifications.dismiss' });
  const status = (index: number) =>
    box(index).querySelector('[data-choice-notice-state]')?.getAttribute('data-choice-notice-state');

  it.each([
    { messageId: 'stored-row', streamMessageId: 'message-a' },
    { messageId: 'message-a', streamMessageId: 'another-stream' },
  ])('dismisses only the matching marker through its visible button: %j', async (identity) => {
    const store = contextSetup(identity);
    act(() => store.consume(frame('conversation-b', 'message-a', '다른 대화의 질문?')));
    fireEvent.click(dismissButton(1));
    await waitFor(() =>
      expect(state.dismissChoiceNotice).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conversation-a', markerIndex: 1 })
      )
    );
    expect([status(0), status(1)]).toEqual(['active', 'dismissed']);
    expect(store.getSnapshot().map(({ conversationId, markerIndex }) => [conversationId, markerIndex])).toEqual([
      ['conversation-a', 0],
      ['conversation-b', 0],
    ]);
  });

  it('keeps unknown history in checking state instead of claiming it was dismissed', () => {
    contextSetup({ withNotice: false });
    expect(status(0)).toBe('checking');
    expect(within(box(0)).queryByRole('button')).not.toBeInTheDocument();
    expect(box(0)).toHaveTextContent('conversation.userChoiceNotifications.statusChecking');
  });

  it('updates only the status controls without reparsing the message Markdown', () => {
    const onParse = vi.fn();
    const store = contextSetup({ onParse });
    onParse.mockClear();
    fireEvent.click(dismissButton(0));
    act(() => store.consume(frame('conversation-b', 'message-b')));
    expect(status(0)).toBe('dismissed');
    expect(onParse).not.toHaveBeenCalled();
  });

  it('shows a confirmed historical dismissal without restoring its button', () => {
    const store = contextSetup({ withNotice: false });
    act(() => store.settleUpsert(JSON.stringify(['conversation-a', 'message-a', 0]), []));
    expect(status(0)).toBe('dismissed');
    expect(status(1)).toBe('checking');
    expect(within(box(0)).queryByRole('button')).not.toBeInTheDocument();
  });

  it('updates the box immediately when another device dismisses its notification', () => {
    const store = contextSetup();
    act(() => store.replaceAll(store.getSnapshot()));
    act(() => store.replaceAll([]));
    expect([status(0), status(1)]).toEqual(['dismissed', 'dismissed']);
    expect(within(box(0)).queryByRole('button')).not.toBeInTheDocument();
    expect(state.dismissChoiceNotice).not.toHaveBeenCalled();
  });

  it('reflects caption-list dismissal in the corresponding body box', async () => {
    contextSetup();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    const item = (await screen.findByRole('button', { name: /Conversation A.*둘째 질문/ })).parentElement!;
    fireEvent.click(within(item).getByRole('button', { name: 'conversation.userChoiceNotifications.dismiss' }));
    expect([status(0), status(1)]).toEqual(['active', 'dismissed']);
  });

  it('preserves the normal context menu even on an active question', () => {
    const store = contextSetup();
    expect(fireEvent.contextMenu(screen.getByText('첫 질문?'))).toBe(true);
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    expect(store.getSnapshot()).toHaveLength(2);
  });

  it('restores the active label and button when dismissal synchronization fails', async () => {
    const store = contextSetup();
    state.dismissChoiceNotice.mockRejectedValue(new Error('Offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    fireEvent.click(dismissButton(0));
    expect(status(0)).toBe('dismissed');
    await act(async () => vi.advanceTimersByTimeAsync(7000));
    expect(status(0)).toBe('active');
    expect(dismissButton(0)).toBeEnabled();
    expect(store.getSnapshot()).toHaveLength(2);
  });
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

  it('does not revive a remotely dismissed question from a delayed initial load', async () => {
    const remote = createChoiceNoticeStore();
    remote.consume(frame());
    const oldNotice = remote.getSnapshot()[0];
    let resolve!: (items: ReturnType<typeof remote.getSnapshot>) => void;
    state.listChoiceNotices.mockReturnValue(new Promise((fulfill) => (resolve = fulfill)));
    render(
      <UserChoiceNotificationsProvider>
        <UserChoiceNotificationButton />
      </UserChoiceNotificationsProvider>
    );

    act(() => {
      state.onChoiceNoticesChanged.mock.calls[0][0]({ user_id: 'user-a', items: [] });
    });
    await act(async () => resolve([oldNotice]));

    expect(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:0' })).toBeInTheDocument();
  });

  it('keeps the latest question and its target after an older registration response arrives late', async () => {
    state.mobile = true;
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    vi.useFakeTimers();
    const store = setup(undefined, false);
    let resolve!: (items: ReturnType<typeof store.getSnapshot>) => void;
    state.registerChoiceNotice.mockReturnValueOnce(new Promise((fulfill) => (resolve = fulfill)));
    act(() => store.consume(frame('conversation-a', 'old-message', '어느 것부터 진행할까요?')));
    const oldNotice = store.getSnapshot()[0];
    await act(async () => vi.advanceTimersByTimeAsync(250));

    const remote = createChoiceNoticeStore();
    remote.consume(frame('conversation-a', 'new-message', '이 설계로 진행할까요?'));
    const newNotice = remote.getSnapshot()[0];
    state.listChoiceNotices.mockResolvedValue([newNotice]);
    act(() => {
      state.onChoiceNoticesChanged.mock.calls[0][0]({ user_id: 'user-a', items: [oldNotice] });
      state.onChoiceNoticesChanged.mock.calls[0][0]({ user_id: 'user-a', items: [newNotice] });
    });
    await act(async () => resolve([oldNotice]));

    expect(store.getSnapshot()).toEqual([newNotice]);
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.userChoiceNotifications.label:1' }));
    fireEvent.click(await screen.findByRole('button', { name: /Conversation A.*이 설계로 진행할까요/ }));
    expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation-a', {
      state: { targetMessageId: 'new-message', targetMarkerIndex: 0 },
    });
  });

  it('does not replace a newer remote question with a delayed dismissal response', async () => {
    const store = setup();
    let resolve!: (items: ReturnType<typeof store.getSnapshot>) => void;
    state.dismissChoiceNotice.mockReturnValueOnce(new Promise((fulfill) => (resolve = fulfill)));
    const oldNotice = store.getSnapshot()[0];
    act(() => store.dismiss(oldNotice.key));
    const remote = createChoiceNoticeStore();
    remote.consume(frame('conversation-a', 'new-message', '이 설계로 진행할까요?'));
    state.listChoiceNotices.mockResolvedValue(remote.getSnapshot());
    act(() => state.onChoiceNoticesChanged.mock.calls[0][0]({ user_id: 'user-a', items: remote.getSnapshot() }));

    await act(async () => resolve([]));

    expect(store.getSnapshot()).toEqual(remote.getSnapshot());
  });

  it('starts a dismissal before mobile navigation can unmount the provider', () => {
    const store = createChoiceNoticeStore();
    store.consume(frame());
    const notice = store.getSnapshot()[0];
    const { unmount } = render(<UserChoiceNotificationsProvider store={store} />);

    act(() => store.dismiss(notice.key));
    unmount();

    expect(state.dismissChoiceNotice).toHaveBeenCalledWith(notice);
  });

  it('keeps a newer registration when an earlier refresh completes without a websocket event', async () => {
    vi.useFakeTimers();
    const store = setup(undefined, false);
    let resolve!: (items: ReturnType<typeof store.getSnapshot>) => void;
    state.listChoiceNotices.mockReturnValueOnce(new Promise((fulfill) => (resolve = fulfill)));
    act(() => state.onReconnect.mock.calls[0][0]());
    state.registerChoiceNotice.mockImplementation(async (notice) => [notice]);
    act(() => store.consume(frame()));
    const notice = store.getSnapshot()[0];
    await act(async () => vi.advanceTimersByTimeAsync(250));

    await act(async () => resolve([]));

    expect(store.getSnapshot()).toEqual([notice]);
  });

  it('does not retry an older preview over a newer queued registration', async () => {
    vi.useFakeTimers();
    const store = setup(undefined, false);
    let reject!: (reason: Error) => void;
    state.registerChoiceNotice.mockReturnValueOnce(new Promise((_resolve, fail) => (reject = fail)));
    state.registerChoiceNotice.mockImplementation(async (notice) => [notice]);
    act(() => store.consume({ ...frame(), data: `${USER_CHOICE_MARKER}\n어느 것부터` }));
    await act(async () => vi.advanceTimersByTimeAsync(250));
    act(() => store.consume({ ...frame(), data: ' 진행할까요?\n' }));

    await act(async () => {
      reject(new Error('Network lost'));
      await vi.advanceTimersByTimeAsync(7000);
    });

    expect(state.registerChoiceNotice.mock.calls.map(([notice]) => notice.preview)).toEqual([
      '어느 것부터',
      '어느 것부터 진행할까요?',
    ]);
    expect(store.getSnapshot().map((notice) => notice.preview)).toEqual(['어느 것부터 진행할까요?']);
  });

  it.each(['reconnect', 'visible'])(
    'reconciles missed remote dismissals when the mobile page becomes %s',
    async (event) => {
      const store = setup();
      state.listChoiceNotices.mockResolvedValue([]);

      act(() => {
        if (event === 'reconnect') state.onReconnect.mock.calls[0][0]();
        else {
          vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
          fireEvent(document, new Event('visibilitychange'));
        }
      });
      await waitFor(() => expect(store.getSnapshot()).toEqual([]));

      expect(state.listChoiceNotices).toHaveBeenCalledOnce();
    }
  );

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
