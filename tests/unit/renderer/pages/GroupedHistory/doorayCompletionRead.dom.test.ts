import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import { resolveProjectGroupIndicatorStatus } from '@/renderer/pages/conversation/GroupedHistory/utils/completionUnread';

const mock = vi.hoisted(() => ({
  events: new Map<string, (event: unknown) => void>(),
  list: vi.fn(),
  get: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@/renderer/utils/emitter', () => ({
  addEventListener: (name: string, listener: (event: unknown) => void) => mock.events.set(name, listener),
}));

vi.mock('@/common', () => {
  const on = (name: string) => (listener: (event: unknown) => void) => mock.events.set(name, listener);
  return {
    ipcBridge: {
      database: { getUserConversations: { invoke: mock.list } },
      application: { writeRendererLog: { invoke: mock.log } },
      conversation: {
        get: { invoke: mock.get },
        listChanged: { on: on('listChanged') },
        responseStream: { on: on('stream') },
        turnCompleted: { on: on('completed') },
        confirmation: { remove: { on: on('confirmation.remove') } },
      },
    },
  };
});

const ordinary = (id = 'ordinary', extra: Record<string, unknown> = {}): TChatConversation =>
  ({ id, name: 'Dooray AI 대응 제안 작성', type: 'acp', extra }) as TChatConversation;
const proposal = (id = 'proposal', phase = 'review') =>
  ordinary(id, { mnpDoorayResponseId: 'dooray-request', mnpDoorayOperationId: `dooray-request-${phase}-0` });

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const emit = (name: string, event: unknown) => {
  const listener = mock.events.get(name);
  if (!listener) throw new Error(`Missing listener: ${name}`);
  act(() => listener(event));
};
const stream = (id: string, type: string, data: unknown = {}) =>
  emit('stream', { conversation_id: id, type, data, turn_id: 'turn-1' });
const complete = (id: string, state = 'ai_waiting_input') =>
  emit('completed', { session_id: id, state, turn_id: 'turn-1' });

let removeFocusListeners = () => {};

const mount = async () => {
  const { useConversationListSync } =
    await import('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync');
  const addListener = vi.spyOn(window, 'addEventListener');
  const view = renderHook(() => useConversationListSync());
  const focusListeners = addListener.mock.calls.filter(([type]) => type === 'focus');
  removeFocusListeners = () => {
    for (const [type, listener, options] of focusListeners) window.removeEventListener(type, listener, options);
  };
  await act(flush);
  return view;
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  mock.events.clear();
  mock.list.mockResolvedValue({ items: [] });
  mock.get.mockResolvedValue(null);
  mock.log.mockResolvedValue(undefined);
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  removeFocusListeners();
  vi.restoreAllMocks();
});

describe('dedicated Dooray proposal completion', () => {
  it.each(['route', 'review'])(
    'auto-reads %s stream completion and the following duplicate turn event',
    async (phase) => {
      mock.list.mockResolvedValue({ items: [proposal('proposal', phase)] });
      const { result } = await mount();
      stream('proposal', 'start');
      stream('proposal', 'finish');
      complete('proposal');
      expect(result.current.hasCompletionUnread('proposal')).toBe(false);
      expect(result.current.completionUnreadCount).toBe(0);
      expect(mock.get).not.toHaveBeenCalled();
    }
  );

  it.each(['ai_waiting_input', 'error', 'stopped'])(
    'auto-reads a terminal %s event even without stream frames',
    async (state) => {
      mock.list.mockResolvedValue({ items: [proposal()] });
      const { result } = await mount();
      complete('proposal', state);
      expect(result.current.hasCompletionUnread('proposal')).toBe(false);
      expect(result.current.completionUnreadCount).toBe(0);
    }
  );

  it.each(['finish', 'error'])('preserves an ordinary conversation completion through %s', async (type) => {
    mock.list.mockResolvedValue({ items: [ordinary()] });
    const { result } = await mount();
    stream('ordinary', 'start');
    stream('ordinary', type);
    expect(result.current.hasCompletionUnread('ordinary')).toBe(true);
    expect(result.current.completionUnreadCount).toBe(1);
  });

  it.each(['card-handoff', 'approval', 'root-handoff'])(
    'keeps %s chats unread despite the same name and workspace',
    async (id) => {
      mock.list.mockResolvedValue({
        items: [ordinary(id, { purpose: 'dooray-response', workspace: 'C:/Dooray AI 대응' })],
      });
      const { result } = await mount();
      complete(id);
      expect(result.current.hasCompletionUnread(id)).toBe(true);
      expect(result.current.completionUnreadCount).toBe(1);
    }
  );

  it('keeps the proposal generating indicator and aggregates it to the collapsed project', async () => {
    mock.list.mockResolvedValue({ items: [proposal()] });
    const { result } = await mount();
    stream('proposal', 'start');
    expect(result.current.isConversationGenerating('proposal')).toBe(true);
    expect(
      resolveProjectGroupIndicatorStatus(
        false,
        result.current.conversations,
        result.current.isConversationGenerating,
        result.current.hasCompletionUnread
      )
    ).toBe('generating');
  });

  it.each([
    ['permission', { call_id: 'permission-1' }],
    ['ask', { request_id: 'question-1' }],
  ])('keeps user confirmation visible for %s', async (type, data) => {
    mock.list.mockResolvedValue({ items: [proposal()] });
    const { result } = await mount();
    stream('proposal', 'start');
    stream('proposal', type as string, data);
    expect(result.current.isConversationWaitingConfirmation('proposal')).toBe(true);
    expect(result.current.hasCompletionUnread('proposal')).toBe(false);
  });

  it('preserves manually unread proposal conversations across repeated completions', async () => {
    mock.list.mockResolvedValue({ items: [proposal()] });
    const { result } = await mount();
    act(() => result.current.markManualUnread('proposal'));
    for (let turn = 0; turn < 2; turn++) {
      stream('proposal', 'start');
      stream('proposal', 'finish');
      complete('proposal');
    }
    expect(result.current.isManualUnread('proposal')).toBe(true);
    expect(localStorage.getItem('conversation-manual-unread-ids')).toBe('["proposal"]');
    expect(result.current.hasCompletionUnread('proposal')).toBe(false);
  });

  it('clears an existing proposal dot on refresh without clearing ordinary or manual unread', async () => {
    mock.list.mockResolvedValue({ items: [ordinary('proposal'), ordinary()] });
    const { result } = await mount();
    complete('proposal');
    complete('ordinary');
    act(() => result.current.markManualUnread('proposal'));
    expect(result.current.completionUnreadCount).toBe(2);
    mock.list.mockResolvedValue({ items: [proposal(), ordinary()] });
    emit('chat.history.refresh', undefined);
    await act(flush);
    expect([
      result.current.hasCompletionUnread('proposal'),
      result.current.hasCompletionUnread('ordinary'),
      result.current.isManualUnread('proposal'),
    ]).toEqual([false, true, true]);
    expect(result.current.completionUnreadCount).toBe(1);
  });

  it('does not leave a project dot or taskbar count after a proposal completes', async () => {
    mock.list.mockResolvedValue({ items: [proposal()] });
    const { result } = await mount();
    stream('proposal', 'start');
    stream('proposal', 'finish');
    complete('proposal');
    expect(
      resolveProjectGroupIndicatorStatus(
        false,
        result.current.conversations,
        result.current.isConversationGenerating,
        result.current.hasCompletionUnread
      )
    ).toBe('none');
    expect(result.current.completionUnreadCount).toBe(0);
  });
});

describe('history and completion delivery order', () => {
  it('does not flash unread when completion arrives before the conversation list', async () => {
    mock.list.mockImplementation(() => new Promise(() => {}));
    mock.get.mockResolvedValue(proposal());
    const { result } = await mount();
    complete('proposal');
    expect(result.current.hasCompletionUnread('proposal')).toBe(false);
    await act(flush);
    mock.list.mockResolvedValue({ items: [proposal()] });
    emit('chat.history.refresh', undefined);
    await act(flush);
    expect(result.current.hasCompletionUnread('proposal')).toBe(false);
    expect(result.current.completionUnreadCount).toBe(0);
  });

  it('preserves ordinary notifications when metadata lookup fails', async () => {
    mock.list.mockImplementation(() => new Promise(() => {}));
    mock.get.mockRejectedValue(new Error('metadata unavailable'));
    const { result } = await mount();
    complete('ordinary');
    await act(flush);
    expect(result.current.hasCompletionUnread('ordinary')).toBe(true);
  });

  it('does not restore unread after the user reads a pending completion', async () => {
    mock.list.mockImplementation(() => new Promise(() => {}));
    mock.get.mockResolvedValue(ordinary());
    const { result } = await mount();
    complete('ordinary');
    act(() => result.current.clearCompletionUnread('ordinary'));
    await act(flush);
    expect(result.current.hasCompletionUnread('ordinary')).toBe(false);
  });

  it('cancels a pending completion when the active conversation window regains focus', async () => {
    mock.list.mockImplementation(() => new Promise(() => {}));
    mock.get.mockResolvedValue(ordinary());
    const { result } = await mount();
    act(() => result.current.setActiveConversation('ordinary'));
    complete('ordinary');
    act(() => window.dispatchEvent(new Event('focus')));
    await act(flush);
    expect(result.current.hasCompletionUnread('ordinary')).toBe(false);
  });

  it('does not restore unread after a conversation is deleted during its lookup', async () => {
    mock.list.mockImplementation(() => new Promise(() => {}));
    mock.get.mockResolvedValue(ordinary());
    const { result } = await mount();
    complete('ordinary');
    emit('listChanged', { action: 'deleted', conversation_id: 'ordinary' });
    await act(flush);
    expect(result.current.hasCompletionUnread('ordinary')).toBe(false);
  });
});
