import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import { createConversationFailureTracker } from '@/renderer/pages/conversation/GroupedHistory/utils/conversationFailure';

const mock = vi.hoisted(() => ({ events: new Map<string, (event: unknown) => void>(), list: vi.fn(), log: vi.fn() }));
vi.mock('@/renderer/utils/emitter', () => ({
  addEventListener: (name: string, cb: (event: unknown) => void) => mock.events.set(name, cb),
}));
vi.mock('@/common', () => {
  const on = (name: string) => (cb: (event: unknown) => void) => mock.events.set(name, cb);
  return {
    ipcBridge: {
      database: { getUserConversations: { invoke: mock.list } },
      application: { writeRendererLog: { invoke: mock.log } },
      conversation: {
        get: { invoke: vi.fn().mockResolvedValue(null) },
        listChanged: { on: on('list') },
        responseStream: { on: on('stream') },
        turnCompleted: { on: on('completed') },
        confirmation: { remove: { on: on('remove') } },
      },
    },
  };
});

const reason = 'Selected model is at capacity. Please try a different model.';
const failedConversation = (turnId = 'turn-1', status = 'error', completedAt = 100): TChatConversation =>
  ({
    id: 'conversation',
    type: 'acp',
    name: 'Conversation',
    extra: {
      backend: 'codex',
      last_turn_result: { turn_id: turnId, status, completed_at: completedAt, error: reason },
    },
  }) as TChatConversation;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const emit = (name: string, event: unknown) => act(() => mock.events.get(name)?.(event));
let removeListeners = () => {};
const mount = async () => {
  const { useConversationListSync } =
    await import('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync');
  const add = vi.spyOn(window, 'addEventListener');
  const view = renderHook(() => useConversationListSync());
  const listeners = add.mock.calls.filter(([name]) => name === 'focus');
  removeListeners = () => listeners.forEach(([name, cb, options]) => window.removeEventListener(name, cb, options));
  await act(flush);
  return view;
};
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  mock.events.clear();
  mock.list.mockResolvedValue({ items: [] });
  mock.log.mockResolvedValue(undefined);
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  removeListeners();
  vi.restoreAllMocks();
});

describe('unread failure recovery', () => {
  it('restores an offline failure from the persisted conversation result', () => {
    const tracker = createConversationFailureTracker(() => false, vi.fn());
    tracker.reconcile([failedConversation()]);
    expect(tracker.getSnapshot().get('conversation')?.message).toBe(reason);
  });
  it('keeps an acknowledged turn read after a new tracker loads', () => {
    const tracker = createConversationFailureTracker(() => false, vi.fn());
    tracker.reconcile([failedConversation()]);
    tracker.read('conversation');
    const recovered = createConversationFailureTracker(() => false, vi.fn());
    recovered.reconcile([failedConversation()]);
    expect(recovered.getSnapshot().size).toBe(0);
    recovered.reconcile([failedConversation('turn-2', 'error', 200)]);
    expect(recovered.getSnapshot().size).toBe(1);
  });
  it('ignores malformed storage and malformed server results', () => {
    localStorage.setItem('conversation-read-failure-turns', '{broken');
    const tracker = createConversationFailureTracker(() => false, vi.fn());
    tracker.reconcile([{ id: 'conversation', extra: { last_turn_result: { status: 'error' } } } as TChatConversation]);
    expect(tracker.getSnapshot().size).toBe(0);
  });
  it('keeps a live failure when an older successful list response arrives', () => {
    const tracker = createConversationFailureTracker(() => false, vi.fn());
    tracker.mark('conversation', { turnId: 'new', completedAt: 200, message: reason });
    tracker.reconcile([failedConversation('old', 'finish', 100)]);
    expect(tracker.getSnapshot().get('conversation')?.turnId).toBe('new');
    tracker.reconcile([failedConversation('next', 'finish', 300)]);
    expect(tracker.getSnapshot().size).toBe(0);
  });
});

describe('sidebar failure event wiring', () => {
  const stream = (type: string, turn = 'turn-1') =>
    emit('stream', { conversation_id: 'conversation', type, turn_id: turn, data: { message: reason } });
  it('stops generation and shows failure instead of a completion dot after partial content', async () => {
    const { result } = await mount();
    stream('start');
    stream('content');
    stream('error');
    expect(result.current.isConversationGenerating('conversation')).toBe(false);
    expect(result.current.getConversationFailure('conversation')?.message).toBe(reason);
    expect(result.current.hasCompletionUnread('conversation')).toBe(false);
  });

  it('recovers failures emitted as persisted tips before any content', async () => {
    const { result } = await mount();
    emit('stream', {
      conversation_id: 'conversation',
      turn_id: 'turn-1',
      type: 'tips',
      status: 'error',
      replace: true,
      data: { type: 'error', content: reason },
    });
    expect(result.current.getConversationFailure('conversation')?.message).toBe(reason);
    expect(result.current.hasCompletionUnread('conversation')).toBe(false);
  });

  it('does not recreate a successful completion dot after an acknowledged failure', async () => {
    const { result } = await mount();
    stream('start');
    stream('error');
    act(() => result.current.clearCompletionUnread('conversation'));
    emit('completed', { session_id: 'conversation', turn_id: 'turn-1', state: 'ai_waiting_input' });
    expect(result.current.hasFailureUnread('conversation')).toBe(false);
    expect(result.current.hasCompletionUnread('conversation')).toBe(false);
  });
  it('does not turn a failed stream into successful completion on the following turn event', async () => {
    const { result } = await mount();
    stream('start');
    stream('error');
    emit('completed', { session_id: 'conversation', turn_id: 'turn-1', state: 'ai_waiting_input' });
    expect(result.current.hasFailureUnread('conversation')).toBe(true);
    expect(result.current.hasCompletionUnread('conversation')).toBe(false);
  });
  it('does not clear the newer running turn when an older error and completion arrive', async () => {
    const { result } = await mount();
    stream('start', 'old');
    stream('start', 'new');
    stream('error', 'old');
    emit('completed', { session_id: 'conversation', turn_id: 'old', state: 'error' });
    expect(result.current.isConversationGenerating('conversation')).toBe(true);
    expect(result.current.hasFailureUnread('conversation')).toBe(false);
  });

  it('does not resurrect the previous failure from a stale list after a new request starts', async () => {
    const { result } = await mount();
    stream('start');
    stream('error');
    stream('start', 'turn-2');
    mock.list.mockResolvedValue({ items: [failedConversation()] });
    emit('list', { conversation_id: 'conversation', action: 'updated' });
    await act(flush);
    expect(result.current.isConversationGenerating('conversation')).toBe(true);
    expect(result.current.hasFailureUnread('conversation')).toBe(false);
  });
  it('acknowledges failure on opening the conversation and preserves that receipt after reload', async () => {
    mock.list.mockResolvedValue({ items: [failedConversation()] });
    const { result } = await mount();
    expect(result.current.hasFailureUnread('conversation')).toBe(true);
    act(() => result.current.clearCompletionUnread('conversation'));
    emit('list', { conversation_id: 'conversation', action: 'updated' });
    await act(flush);
    expect(result.current.hasFailureUnread('conversation')).toBe(false);
  });
});
