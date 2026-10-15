/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type PropsWithChildren } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageText } from '@/common/chat/chatLib';
import type { MessageCursorPage } from '@/common/adapter/ipcBridge';
import {
  MessageListLoadingProvider,
  MessageListProvider,
  MessagePaginationProvider,
  useMessageLstCache,
} from '@/renderer/pages/conversation/Messages/hooks';
import MessageList from '@/renderer/pages/conversation/Messages/MessageList';

let resizeObserverCallback: ResizeObserverCallback | null = null;
let locationState: { key: string; state: { targetMessageId?: string } } = { key: 'location-key', state: {} };
const { loadLatest, loadAnchor } = vi.hoisted(() => ({ loadLatest: vi.fn(), loadAnchor: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      userCreated: { on: () => () => {} },
      statusChanged: { on: () => () => {} },
      turnCompleted: { on: () => () => {} },
    },
  },
}));

vi.mock('@/renderer/utils/chat/messagePagination', () => ({
  DEFAULT_MESSAGE_PAGE_LIMIT: 50,
  loadLatestConversationMessages: loadLatest,
  loadConversationAnchorWindow: loadAnchor,
  loadConversationMessagePage: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  useConversationRuntimeView: () => ({ isProcessing: false }),
}));

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }

  observe() {}
  unobserve() {}
  disconnect() {
    resizeObserverCallback = null;
  }
}

global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => locationState,
}));

vi.mock('@arco-design/web-react', () => ({
  Image: {
    PreviewGroup: ({ children }: PropsWithChildren) => <>{children}</>,
  },
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({ conversation_id: 'conversation-1' }),
}));

vi.mock('@/renderer/pages/conversation/Messages/artifacts', () => ({
  useConversationArtifacts: () => [],
}));

vi.mock('@/renderer/pages/conversation/Messages/anchorRail', () => ({
  MessageAnchorRail: () => null,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageText', () => ({
  default: ({ message }: { message: IMessageText }) => <div>{message.content.content}</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageTips', () => ({
  default: () => <div>tips</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolCall', () => ({
  default: () => <div>tool_call</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroup', () => ({
  default: () => <div>tool_group</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageAgentStatus', () => ({
  default: () => <div>agent_status</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessagePermission', () => ({
  default: () => <div>permission</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpPermission', () => ({
  default: () => <div>acp_permission</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpToolCall', () => ({
  default: () => <div>acp_tool_call</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessagePlan', () => ({
  default: () => <div>plan</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageThinking', () => ({
  default: () => <div>thinking</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageCronTrigger', () => ({
  default: () => <div>cron_trigger</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageSkillSuggest', () => ({
  default: () => <div>skill_suggest</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary', () => ({
  default: () => <div>tool_summary</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/MessageFileChanges', () => ({
  __esModule: true,
  default: () => <div>file_changes</div>,
  parseDiff: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/SelectionReplyButton', () => ({
  default: () => null,
}));

vi.mock('@icon-park/react', () => ({
  Down: () => <span>down</span>,
}));

function createTextMessage(content: string): IMessageText {
  return {
    id: 'message-1',
    msg_id: 'msg-1',
    conversation_id: 'conversation-1',
    type: 'text',
    position: 'left',
    content: {
      content,
    },
    created_at: 1,
  };
}

function Wrapper({ children, messages }: PropsWithChildren<{ messages: IMessageText[] }>): JSX.Element {
  return <MessageListProvider value={messages}>{children}</MessageListProvider>;
}

function LoadedMessageList(): JSX.Element {
  useMessageLstCache('conversation-1');
  return <MessageList />;
}

function Conversation({ messages = [] }: { messages?: IMessageText[] }): JSX.Element {
  return (
    <MessageListProvider value={messages}>
      <MessageListLoadingProvider value={false}>
        <MessagePaginationProvider
          value={{ hasMoreBefore: false, hasMoreAfter: false, isLoadingBefore: false, isLoadingAnchor: false }}
        >
          <LoadedMessageList />
        </MessagePaginationProvider>
      </MessageListLoadingProvider>
    </MessageListProvider>
  );
}

function messagePage(items: IMessageText[]): MessageCursorPage<IMessageText> {
  return { items, has_more_before: false, has_more_after: false, oldest_cursor: null, newest_cursor: null };
}

function deferredPage() {
  let resolve!: (page: MessageCursorPage<IMessageText>) => void;
  const promise = new Promise<MessageCursorPage<IMessageText>>((fulfill) => (resolve = fulfill));
  return { promise, resolve };
}

function trackTargetScroll(id = 'message-1') {
  const scroller = screen.getByTestId('message-list-scroller') as HTMLDivElement;
  setScrollableMetrics(scroller, { scrollTop: 0 });
  const target = document.getElementById(`message-${id}`)!;
  target.getBoundingClientRect = () => new DOMRect(0, 300 - scroller.scrollTop, 100, 40);
  scroller.getBoundingClientRect = () => new DOMRect(0, 0, 400, 400);
  return { scroller, target };
}

function setScrollableMetrics(
  scroller: HTMLDivElement,
  {
    clientHeight = 400,
    scrollHeight = 1000,
    scrollTop = 600,
  }: {
    clientHeight?: number;
    scrollHeight?: number;
    scrollTop?: number;
  } = {}
): void {
  Object.defineProperty(scroller, 'clientHeight', {
    configurable: true,
    writable: true,
    value: clientHeight,
  });
  Object.defineProperty(scroller, 'scrollHeight', {
    configurable: true,
    writable: true,
    value: scrollHeight,
  });
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    writable: true,
    value: scrollTop,
  });
  scroller.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
    if (typeof top === 'number') {
      scroller.scrollTop = top;
    }
  });
}

function flushResizeObserver(): void {
  act(() => {
    resizeObserverCallback?.([], {} as ResizeObserver);
    vi.runAllTimers();
  });
}

describe('MessageList streaming scroll behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T12:00:00.000Z'));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle));
    resizeObserverCallback = null;
    locationState = { key: 'location-key', state: {} };
    loadLatest.mockReset();
    loadAnchor.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('keeps streamed auto-follow scroll targets moving forward as content grows', () => {
    const firstMessage = createTextMessage('hello');
    const { rerender } = render(
      <Wrapper messages={[firstMessage]}>
        <MessageList />
      </Wrapper>
    );

    const scroller = screen.getByTestId('message-list-scroller') as HTMLDivElement;
    setScrollableMetrics(scroller);

    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    const growthSteps = [
      { content: 'hello world'.repeat(4), scrollHeight: 1080 },
      { content: 'hello world'.repeat(8), scrollHeight: 1160 },
      { content: 'hello world'.repeat(12), scrollHeight: 1240 },
    ];

    for (const step of growthSteps) {
      rerender(
        <Wrapper messages={[createTextMessage(step.content)]}>
          <MessageList />
        </Wrapper>
      );
      scroller.scrollHeight = step.scrollHeight;
      flushResizeObserver();
    }

    const scrollTargets = vi
      .mocked(scroller.scrollTo)
      .mock.calls.map(([options]) => options.top)
      .filter((top): top is number => typeof top === 'number');

    expect(scrollTargets).toEqual([680, 760, 840]);
  });

  it('stops auto-following streamed updates after the user scrolls up', () => {
    const firstMessage = createTextMessage('hello');
    const { rerender } = render(
      <Wrapper messages={[firstMessage]}>
        <MessageList />
      </Wrapper>
    );

    const scroller = screen.getByTestId('message-list-scroller') as HTMLDivElement;
    setScrollableMetrics(scroller);

    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    scroller.scrollTop = 480;
    vi.setSystemTime(new Date('2026-05-26T12:00:00.250Z'));
    fireEvent.scroll(scroller);

    rerender(
      <Wrapper messages={[createTextMessage('hello world'.repeat(10))]}>
        <MessageList />
      </Wrapper>
    );
    scroller.scrollHeight = 1200;
    flushResizeObserver();

    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });

  it('keeps the notification target in view on the first visit after delayed history loads', async () => {
    const latest = deferredPage();
    loadLatest.mockReturnValue(latest.promise);
    locationState.state.targetMessageId = 'message-1';
    render(<Conversation />);
    expect(screen.getByTestId('message-list-skeleton')).toBeInTheDocument();

    await act(async () => latest.resolve(messagePage([createTextMessage('approval question')])));
    const { scroller } = trackTargetScroll();
    act(() => vi.runAllTimers());
    flushResizeObserver();

    expect(scroller.scrollTop).toBe(120);
  });

  it('waits for initial history even when the target is already present from a live update', async () => {
    const latest = deferredPage();
    loadLatest.mockReturnValue(latest.promise);
    locationState.state.targetMessageId = 'message-1';
    const message = createTextMessage('approval question');
    render(<Conversation messages={[message]} />);
    const { scroller } = trackTargetScroll();
    act(() => vi.runAllTimers());
    expect(scroller.scrollTop).not.toBe(120);

    await act(async () => latest.resolve(messagePage([message])));
    act(() => vi.runAllTimers());
    expect(scroller.scrollTop).toBe(120);
  });

  it('loads an older notification target and preserves its position after rendering', async () => {
    const latest = deferredPage();
    const anchor = deferredPage();
    loadLatest.mockReturnValue(latest.promise);
    loadAnchor.mockReturnValue(anchor.promise);
    locationState.state.targetMessageId = 'message-1';
    render(<Conversation />);
    const recent = { ...createTextMessage('recent'), id: 'recent', msg_id: 'recent', created_at: 2 };
    await act(async () => latest.resolve(messagePage([recent])));
    setScrollableMetrics(screen.getByTestId('message-list-scroller') as HTMLDivElement);
    act(() => vi.runAllTimers());
    expect(loadAnchor).toHaveBeenCalledTimes(1);

    await act(async () => anchor.resolve(messagePage([createTextMessage('approval question'), recent])));
    const { scroller } = trackTargetScroll();
    act(() => vi.runAllTimers());
    flushResizeObserver();

    expect(scroller.scrollTop).toBe(120);
  });

  it('cancels a scheduled notification jump when navigation changes before the next frame', () => {
    const messages = [createTextMessage('approval question')];
    locationState.state.targetMessageId = 'message-1';
    const { rerender } = render(
      <Wrapper messages={messages}>
        <MessageList />
      </Wrapper>
    );
    const { scroller } = trackTargetScroll();
    locationState = { key: 'another-location', state: {} };
    rerender(
      <Wrapper messages={messages}>
        <MessageList />
      </Wrapper>
    );
    act(() => vi.runAllTimers());

    expect(scroller.scrollTop).not.toBe(120);
  });

  it('allows another click on the same notification after its first jump', () => {
    const messages = [createTextMessage('approval question')];
    locationState.state.targetMessageId = 'message-1';
    const { rerender } = render(
      <Wrapper messages={messages}>
        <MessageList />
      </Wrapper>
    );
    const { scroller } = trackTargetScroll();
    act(() => vi.runAllTimers());
    fireEvent.wheel(scroller, { deltaY: -100 });
    scroller.scrollTop = 20;
    locationState = { key: 'second-click', state: { targetMessageId: 'message-1' } };
    rerender(
      <Wrapper messages={messages}>
        <MessageList />
      </Wrapper>
    );
    act(() => vi.runAllTimers());

    expect(scroller.scrollTop).toBe(120);
  });

  it.each(['missing', 'failed'])('retries a %s anchor only on a new notification click', async (outcome) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const latest = deferredPage();
    loadLatest.mockReturnValue(latest.promise);
    if (outcome === 'failed') loadAnchor.mockRejectedValueOnce(new Error('offline'));
    else loadAnchor.mockResolvedValueOnce(messagePage([]));
    locationState.state.targetMessageId = 'message-1';
    const { rerender } = render(<Conversation />);
    await act(async () => latest.resolve(messagePage([])));
    await act(async () => vi.runAllTimersAsync());
    rerender(<Conversation />);
    await act(async () => vi.runAllTimersAsync());
    expect(loadAnchor).toHaveBeenCalledTimes(1);

    loadAnchor.mockResolvedValueOnce(messagePage([createTextMessage('approval question')]));
    locationState = { key: 'retry-click', state: { targetMessageId: 'message-1' } };
    rerender(<Conversation />);
    // Fetch the anchor, then allow React to mount its message before scrolling.
    await act(async () => vi.runAllTimersAsync());
    const { scroller } = trackTargetScroll();
    act(() => vi.runAllTimers());
    expect(scroller.scrollTop).toBe(120);
  });
});
