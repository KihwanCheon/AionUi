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
let locationState: { key: string; state: { targetMessageId?: string; targetMarkerIndex?: number } } = {
  key: 'location-key',
  state: {},
};
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
    window.history.replaceState(null, '', '/');
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

  it.each([false, true])(
    'recovers missed user messages while preserving reading or bottom-follow mode (%s)',
    async (following) => {
      loadLatest.mockResolvedValue(messagePage([createTextMessage('answer')]));
      render(<Conversation />);
      await act(async () => {
        await Promise.resolve();
      });
      const scroller = screen.getByTestId('message-list-scroller') as HTMLDivElement;
      setScrollableMetrics(scroller);
      act(() => vi.runAllTimers());
      if (!following) {
        fireEvent.wheel(scroller, { deltaY: -400 });
        scroller.scrollTop = 200;
        fireEvent.scroll(scroller);
      }
      loadLatest.mockResolvedValue(
        messagePage([
          createTextMessage('answer'),
          { ...createTextMessage('sent while away'), id: 'user-2', msg_id: 'user-2', position: 'right', created_at: 2 },
        ])
      );
      scroller.scrollHeight = 1200;
      // Connectivity restoration also hydrates history without a visibility transition.
      window.dispatchEvent(new Event('online'));
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      act(() => vi.runAllTimers());
      expect(screen.getByText('sent while away')).toBeInTheDocument();
      expect(scroller.scrollTop).toBe(following ? 800 : 200);
    }
  );

  it.each([false, true])(
    'retains the visible message across recovery above it, unless an explicit jump owns scrolling (%s)',
    async (locked) => {
      const first = createTextMessage('short answer');
      const second = { ...first, id: 'second', msg_id: 'second', created_at: 2, content: { content: 'reading here' } };
      loadLatest.mockResolvedValue(messagePage([first, second]));
      render(<Conversation />);
      await act(async () => {
        await Promise.resolve();
      });
      const { scroller } = trackTargetScroll();
      act(() => vi.runAllTimers());
      fireEvent.wheel(scroller, { deltaY: -400 });
      scroller.scrollTop = 200;
      fireEvent.scroll(scroller);
      const firstRow = document.getElementById('message-message-1')!;
      firstRow.getBoundingClientRect = () => new DOMRect(0, -1000, 400, 10);
      const secondRow = document.getElementById('message-second')!;
      secondRow.getBoundingClientRect = () =>
        new DOMRect(0, (firstRow.textContent?.includes('expanded') ? 540 : 240) - scroller.scrollTop, 400, 80);
      if (locked) {
        locationState.state.targetMessageId = 'second';
      }
      loadLatest.mockResolvedValue(
        messagePage([
          { ...first, content: { content: 'expanded answer' } },
          { ...second, id: 'saved-second' },
        ])
      );
      window.dispatchEvent(new Event('online'));
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      act(() => vi.runAllTimers());
      expect(document.getElementById('message-saved-second')).toBe(secondRow);
      // Explicit target navigation owns its own positioning; recovery must not fight it.
      expect(scroller.scrollTop).toBe(locked ? 380 : 500);
    }
  );

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

  it('jumps to the streamed question by its notification id instead of staying on the previous question', () => {
    const previous = { ...createTextMessage('previous dismissed question'), id: 'previous', msg_id: 'previous' };
    const live = {
      ...createTextMessage('new approval question'),
      id: 'live-renderer-row',
      msg_id: 'notification-message',
      content: { content: 'new approval question', replace: true as const },
      created_at: 2,
    };
    locationState.state.targetMessageId = live.msg_id;
    loadAnchor.mockResolvedValue(messagePage([]));
    render(
      <Wrapper messages={[previous, live]}>
        <MessageList />
      </Wrapper>
    );
    const { scroller } = trackTargetScroll(live.id);
    act(() => vi.runAllTimers());

    expect(scroller.scrollTop).toBe(120);
    expect(loadAnchor).not.toHaveBeenCalled();
  });

  it('removes a completed marker jump from history while preserving the hash URL and other navigation state', () => {
    locationState.state = { targetMessageId: 'message-1', targetMarkerIndex: 0 };
    window.history.replaceState(
      { key: locationState.key, idx: 4, usr: { ...locationState.state, workspace: 'project-a' } },
      '',
      '/?webui=1#/conversation/conversation-1'
    );
    const originalUrl = window.location.href;
    const originalLength = window.history.length;
    render(
      <Wrapper messages={[createTextMessage('approval question')]}>
        <MessageList />
      </Wrapper>
    );
    trackTargetScroll();
    act(() => vi.runAllTimers());

    expect(window.history.state).toEqual({ key: locationState.key, idx: 4, usr: { workspace: 'project-a' } });
    expect(window.location.href).toBe(originalUrl);
    expect(window.history.length).toBe(originalLength);
  });

  it('shows the latest messages after reloading a conversation whose notification jump was already used', () => {
    const messages = [createTextMessage('approval question')];
    locationState.state = { targetMessageId: 'message-1', targetMarkerIndex: 0 };
    window.history.replaceState({ key: locationState.key, idx: 1, usr: locationState.state }, '');
    const firstVisit = render(
      <Wrapper messages={messages}>
        <MessageList />
      </Wrapper>
    );
    const { scroller } = trackTargetScroll();
    act(() => vi.runAllTimers());
    fireEvent.pointerDown(scroller);
    scroller.scrollTop = 600;
    fireEvent.scroll(scroller);
    firstVisit.unmount();

    // A hard reload recreates the router from the persisted history entry.
    locationState = { key: window.history.state.key, state: window.history.state.usr };
    render(
      <Wrapper messages={messages}>
        <MessageList />
      </Wrapper>
    );
    const afterReload = trackTargetScroll().scroller;
    act(() => vi.runAllTimers());

    expect(afterReload.scrollTop).toBe(600);
  });

  it('keeps aligning the question after consuming its history entry while the message layout changes', () => {
    locationState.state = { targetMessageId: 'message-1', targetMarkerIndex: 0 };
    window.history.replaceState({ key: locationState.key, usr: locationState.state }, '');
    render(
      <Wrapper messages={[createTextMessage('approval question')]}>
        <MessageList />
      </Wrapper>
    );
    const { scroller, target } = trackTargetScroll();
    act(() => vi.runAllTimers());

    target.getBoundingClientRect = () => new DOMRect(0, 700 - scroller.scrollTop, 100, 40);
    flushResizeObserver();

    expect(scroller.scrollTop).toBe(500);
  });

  it('does not clear a newer history entry when an older navigation finishes aligning', () => {
    locationState.state = { targetMessageId: 'message-1', targetMarkerIndex: 0 };
    const newerEntry = {
      key: 'new-navigation',
      idx: 2,
      usr: { targetMessageId: 'another-question', targetMarkerIndex: 1 },
    };
    window.history.replaceState(newerEntry, '');
    render(
      <Wrapper messages={[createTextMessage('approval question')]}>
        <MessageList />
      </Wrapper>
    );
    trackTargetScroll();
    act(() => vi.runAllTimers());

    expect(window.history.state).toEqual(newerEntry);
  });

  it('retains an unconsumed notification target when its history page fails to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    locationState.state = { targetMessageId: 'message-1', targetMarkerIndex: 0 };
    const entry = { key: locationState.key, idx: 1, usr: locationState.state };
    window.history.replaceState(entry, '');
    loadLatest.mockResolvedValueOnce(messagePage([]));
    loadAnchor.mockRejectedValueOnce(new Error('offline'));
    render(<Conversation />);
    await act(async () => vi.runAllTimersAsync());

    expect(window.history.state).toEqual(entry);
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
