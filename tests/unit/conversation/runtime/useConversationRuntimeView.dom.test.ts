import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TConversationRuntimeSummary } from '@/common/config/storage';
import { useConversationRuntimeView } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';
import { resetConversationRuntimeViewStoreForTest } from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';

const { getConversation, changed, reconnected, disposeChanged, disposeReconnect } = vi.hoisted(() => ({
  getConversation: vi.fn(),
  changed: {
    listener: null as ((event: { conversation_id: string; runtime: TConversationRuntimeSummary }) => void) | null,
  },
  reconnected: { listener: null as (() => void) | null },
  disposeChanged: vi.fn(),
  disposeReconnect: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      turnCompleted: { on: () => vi.fn() },
      listChanged: { on: () => vi.fn() },
      runtimeChanged: {
        on: (listener: typeof changed.listener) => {
          changed.listener = listener;
          return disposeChanged;
        },
      },
    },
    realtime: {
      reconnected: {
        on: (listener: () => void) => {
          reconnected.listener = listener;
          return disposeReconnect;
        },
      },
    },
  },
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({ getConversationOrNull: getConversation }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync', () => ({
  reconcileGeneratingFromRuntime: vi.fn(),
  reconcileWaitingConfirmationFromRuntime: vi.fn(),
}));

const runtime = (revision: number, target: string | null): TConversationRuntimeSummary => ({
  state: 'idle',
  can_send_message: true,
  has_task: true,
  task_status: 'finished',
  is_processing: false,
  pending_confirmations: 0,
  turn_id: null,
  can_stop: target !== null,
  cancel_turn_id: target,
  runtime_instance_id: 'core-1',
  runtime_revision: revision,
});

describe('conversation stop state synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConversationRuntimeViewStoreForTest();
    getConversation.mockReset().mockResolvedValue({ runtime: runtime(1, null) });
  });

  it('loads a continuation stop target when opening an existing conversation', async () => {
    getConversation.mockResolvedValue({ runtime: runtime(2, 'background-1') });
    const { result } = renderHook(() => useConversationRuntimeView('conv-1'));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current).toMatchObject({
      canStop: true,
      cancelTurnId: 'background-1',
      activeTurnId: null,
      canSendMessage: true,
    });
  });

  it('keeps the realtime target when a slower initial fetch returns an older idle state', async () => {
    let resolveFetch!: (value: { runtime: TConversationRuntimeSummary }) => void;
    getConversation.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    const { result } = renderHook(() => useConversationRuntimeView('conv-1'));
    act(() => changed.listener?.({ conversation_id: 'conv-1', runtime: runtime(2, 'background-1') }));
    await act(async () => {
      resolveFetch({ runtime: runtime(1, null) });
    });
    expect(result.current).toMatchObject({ canStop: true, cancelTurnId: 'background-1' });
  });

  it('refreshes missed stop state on reconnect and focus and removes subscriptions on unmount', async () => {
    const { result, unmount } = renderHook(() => useConversationRuntimeView('conv-1'));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    getConversation.mockResolvedValue({ runtime: runtime(2, 'background-1') });
    await act(async () => {
      reconnected.listener?.();
    });
    expect(result.current.canStop).toBe(true);
    getConversation.mockResolvedValue({ runtime: runtime(3, null) });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current.canStop).toBe(false);
    unmount();
    expect([disposeChanged.mock.calls.length, disposeReconnect.mock.calls.length]).toEqual([1, 1]);
  });

  it('retains the known target when refreshing fails', async () => {
    getConversation.mockResolvedValue({ runtime: runtime(2, 'background-1') });
    const { result } = renderHook(() => useConversationRuntimeView('conv-1'));
    await waitFor(() => expect(result.current.canStop).toBe(true));
    getConversation.mockRejectedValue(new Error('offline'));
    await act(async () => {
      reconnected.listener?.();
    });
    expect(result.current.cancelTurnId).toBe('background-1');
  });
});
