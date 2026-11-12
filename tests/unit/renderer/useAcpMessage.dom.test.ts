/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenUsageFromAcpUsage, useAcpMessage } from '@/renderer/pages/conversation/platforms/acp/useAcpMessage';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { resetConversationTurnClockForTests } from '@/renderer/pages/conversation/utils/conversationTurnClock';
import { resetEnsureConversationRuntimeStateForTests } from '@/renderer/pages/conversation/utils/ensureConversationRuntime';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';

const {
  addOrUpdateMessageMock,
  ensureRuntimeInvokeMock,
  getSlashCommandsInvokeMock,
  getUsageInvokeMock,
  responseStreamOnMock,
  responseStreamHandlerRef,
} = vi.hoisted(() => ({
  addOrUpdateMessageMock: vi.fn(),
  ensureRuntimeInvokeMock: vi.fn(),
  getSlashCommandsInvokeMock: vi.fn(),
  getUsageInvokeMock: vi.fn(),
  responseStreamOnMock: vi.fn(),
  responseStreamHandlerRef: {
    current: undefined as ((message: IResponseMessage) => void) | undefined,
  },
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => addOrUpdateMessageMock,
  useMergeLiveMessage: () => addOrUpdateMessageMock,
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      responseStream: {
        on: responseStreamOnMock.mockImplementation((handler: (message: IResponseMessage) => void) => {
          responseStreamHandlerRef.current = handler;
          return vi.fn();
        }),
      },
    },
    conversation: {
      ensureRuntime: {
        invoke: ensureRuntimeInvokeMock,
      },
      getSlashCommands: {
        invoke: getSlashCommandsInvokeMock,
      },
      getUsage: {
        invoke: getUsageInvokeMock,
      },
    },
  },
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAcpMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConversationTurnClockForTests();
    resetEnsureConversationRuntimeStateForTests();
    ensureRuntimeInvokeMock.mockResolvedValue({ recovered: false, config_options: [], runtime: null });
    getSlashCommandsInvokeMock.mockResolvedValue([]);
    getUsageInvokeMock.mockResolvedValue(null);
    responseStreamHandlerRef.current = undefined;
  });

  it('restores a metadata-only compaction snapshot before usage has been reported', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const compaction = { count: 10, history_complete: true, last_compacted_at: 1000, updated_at: 2000 };
    getUsageInvokeMock.mockResolvedValue({ _meta: { 'aionui/contextCompaction': compaction } });
    const { result } = renderHook(() => useAcpMessage('conv-1'));
    await waitFor(() => expect(result.current.tokenUsage?.compaction).toEqual(compaction));
    expect(result.current.context_limit).toBe(0);
  });

  it('merges live compaction revisions independently without rolling back usage freshness', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const { result } = renderHook(() => useAcpMessage('conv-1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));
    const freshness = { status: 'pending', turn_id: 'new', status_changed_at: 100, updated_at: 1 };
    const compaction = { count: 2, history_complete: true, last_compacted_at: 50, updated_at: 100 };
    const emit = (data: unknown) =>
      act(() =>
        responseStreamHandlerRef.current?.({
          type: 'acp_context_usage',
          conversation_id: 'conv-1',
          msg_id: '',
          data,
        } as IResponseMessage)
      );
    emit({
      used: 3000,
      size: 100000,
      _meta: { 'aionui/contextUsage': freshness, 'aionui/contextCompaction': compaction },
    });
    emit({ _meta: { 'aionui/contextCompaction': { ...compaction, count: 3, updated_at: 200 } } });
    emit({
      used: 10,
      size: 200,
      _meta: {
        'aionui/contextUsage': { ...freshness, status: 'current', status_changed_at: 90 },
        'aionui/contextCompaction': compaction,
      },
    });
    expect(result.current.tokenUsage).toMatchObject({ total_tokens: 3000, freshness, compaction: { count: 3 } });
    expect(result.current.context_limit).toBe(100000);
  });

  it('restores compactions from a delayed snapshot without replacing a newer live usage reading', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const snapshot = deferred<{ used: number; size: number; _meta: Record<string, unknown> }>();
    getUsageInvokeMock.mockReturnValue(snapshot.promise);
    const { result } = renderHook(() => useAcpMessage('conv-1'));
    await waitFor(() => expect(getUsageInvokeMock).toHaveBeenCalled());
    act(() =>
      responseStreamHandlerRef.current?.({
        type: 'acp_context_usage',
        conversation_id: 'conv-1',
        msg_id: '',
        data: { used: 200, size: 200000 },
      } as unknown as IResponseMessage)
    );
    await act(async () => {
      snapshot.resolve({
        used: 100,
        size: 200000,
        _meta: {
          'aionui/contextCompaction': { count: 10, history_complete: true, last_compacted_at: 1000, updated_at: 2000 },
        },
      });
      await snapshot.promise;
    });
    expect(result.current.tokenUsage).toMatchObject({ total_tokens: 200, compaction: { count: 10 } });
  });

  it('retains compactions when subsequent usage frames omit the extension', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const compaction = { count: 10, history_complete: true, last_compacted_at: 1000, updated_at: 2000 };
    getUsageInvokeMock.mockResolvedValue({
      used: 100,
      size: 200000,
      _meta: { 'aionui/contextCompaction': compaction },
    });
    const { result } = renderHook(() => useAcpMessage('conv-1'));
    await waitFor(() => expect(result.current.tokenUsage?.compaction).toEqual(compaction));
    act(() =>
      responseStreamHandlerRef.current?.({
        type: 'acp_context_usage',
        conversation_id: 'conv-1',
        msg_id: '',
        data: { used: 200, size: 200000 },
      } as unknown as IResponseMessage)
    );
    expect(result.current.tokenUsage).toMatchObject({ total_tokens: 200, compaction });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('ignores an invalid compaction count %s', (count) => {
    const usage = tokenUsageFromAcpUsage({
      used: 123,
      _meta: {
        'aionui/contextCompaction': { count, history_complete: true, updated_at: 1 },
      },
    });
    expect(usage).toEqual({ total_tokens: 123 });
  });

  it('completes hydration when the conversation lookup fails', async () => {
    vi.mocked(getConversationOrNull).mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useAcpMessage('conv-1'));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.running).toBe(false);
    expect(result.current.aiProcessing).toBe(false);
  });

  it('emits a synthetic thinking done update on finish when the stream never sends one', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const now = Date.now();
    renderHook(() => useAcpMessage('conv-1'));

    expect(responseStreamHandlerRef.current).toBeTypeOf('function');

    responseStreamHandlerRef.current?.({
      type: 'request_trace',
      data: {
        timestamp: now - 4200,
        backend: 'claude',
        model_id: 'model-1',
      },
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
    });

    responseStreamHandlerRef.current?.({
      type: 'thinking',
      data: {
        content: 'alpha',
        status: 'thinking',
      },
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
    });

    responseStreamHandlerRef.current?.({
      type: 'finish',
      data: null,
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
    });

    expect(addOrUpdateMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'thinking',
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
        content: expect.objectContaining({
          status: 'done',
          duration: expect.any(Number),
        }),
      })
    );
  });

  it('completes thinking as soon as the first non-thinking message arrives', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    renderHook(() => useAcpMessage('conv-1'));

    responseStreamHandlerRef.current?.({
      type: 'thinking',
      data: {
        content: 'alpha',
        status: 'thinking',
      },
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
      created_at: 1_000,
    });

    responseStreamHandlerRef.current?.({
      type: 'text',
      data: 'beta',
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
      created_at: 4_200,
    });

    expect(addOrUpdateMessageMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'thinking',
        msg_id: 'msg-1',
        content: expect.objectContaining({
          status: 'thinking',
        }),
      })
    );
    expect(addOrUpdateMessageMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'thinking',
        msg_id: 'msg-1',
        content: expect.objectContaining({
          status: 'done',
          duration: 3200,
        }),
      })
    );
    expect(addOrUpdateMessageMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: 'text',
        msg_id: 'msg-1',
      })
    );
  });

  it('preserves slash-command metadata from available_commands stream updates', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const { result } = renderHook(() => useAcpMessage('conv-1'));

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'available_commands',
        data: {
          commands: [
            {
              name: 'review',
              description: 'Review the current diff',
              input: {
                hint: '⌘R',
              },
              _meta: {
                completion_behavior: 'neutral_tip_on_empty',
                empty_turn_tip_code: 'acp.empty_turn.choose_command',
                empty_turn_tip_params: {
                  command_count: 1,
                },
              },
            },
          ],
        },
        msg_id: 'cmd-1',
        conversation_id: 'conv-1',
      });
    });

    await waitFor(() => {
      expect(result.current.slashCommands).toEqual([
        {
          name: 'review',
          description: 'Review the current diff',
          hint: '⌘R',
          kind: 'template',
          source: 'acp',
          selectionBehavior: 'insert',
          completionBehavior: 'neutral_tip_on_empty',
          emptyTurnTipCode: 'acp.empty_turn.choose_command',
          emptyTurnTipParams: {
            command_count: 1,
          },
        },
      ]);
    });
  });

  it('loads initial slash commands after runtime ensure without legacy warmup', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    getSlashCommandsInvokeMock.mockResolvedValue([
      {
        command: 'review',
        description: 'Review the current diff',
        completion_behavior: 'neutral_tip_on_empty',
      },
    ]);

    const { result } = renderHook(() => useAcpMessage('conv-1'));

    await waitFor(() => {
      expect(ensureRuntimeInvokeMock).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
      expect(getSlashCommandsInvokeMock).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    });
    await waitFor(() => {
      expect(result.current.slashCommands).toEqual([
        {
          name: 'review',
          description: 'Review the current diff',
          kind: 'template',
          source: 'acp',
          selectionBehavior: 'insert',
          completionBehavior: 'neutral_tip_on_empty',
        },
      ]);
    });
  });

  it('uses injected runtime preparation for initial slash commands in team mode', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const prepareRuntime = vi.fn().mockResolvedValue(undefined);
    getSlashCommandsInvokeMock.mockResolvedValue([
      {
        command: 'review',
        description: 'Review the current diff',
      },
    ]);

    const { result } = renderHook(() => useAcpMessage('conv-1', { prepareRuntime }));

    await waitFor(() => {
      expect(prepareRuntime).toHaveBeenCalled();
      expect(getSlashCommandsInvokeMock).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    });
    expect(ensureRuntimeInvokeMock).not.toHaveBeenCalled();

    act(() => {
      result.current.fetchSlashCommands();
    });

    await waitFor(() => {
      expect(prepareRuntime).toHaveBeenCalledTimes(2);
    });
    expect(ensureRuntimeInvokeMock).not.toHaveBeenCalled();
  });

  it('deduplicates slash command fetches while a request is in flight', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const slashCommandsDeferred = deferred<
      Array<{
        command: string;
        description: string;
      }>
    >();
    getSlashCommandsInvokeMock.mockReturnValue(slashCommandsDeferred.promise);

    const { result } = renderHook(() => useAcpMessage('conv-1'));

    await waitFor(() => {
      expect(getSlashCommandsInvokeMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.fetchSlashCommands();
    });

    await waitFor(() => {
      expect(getSlashCommandsInvokeMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      slashCommandsDeferred.resolve([
        {
          command: 'review',
          description: 'Review the current diff',
        },
      ]);
      await slashCommandsDeferred.promise;
    });

    await waitFor(() => {
      expect(result.current.slashCommands).toEqual([
        {
          name: 'review',
          description: 'Review the current diff',
          kind: 'template',
          source: 'acp',
          selectionBehavior: 'insert',
        },
      ]);
    });
  });

  it('normalizes team teammate messages before inserting them into the message list', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    renderHook(() => useAcpMessage('leader-conversation-1'));

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'teammate_message',
        data: {
          id: 'projected-message-1',
          type: 'text',
          msg_id: 'projected-message-1',
          conversation_id: 'leader-conversation-1',
          position: 'left',
          status: 'finish',
          content: {
            content: '[Codex Assistant] idle',
            teammate_message: true,
            sender_name: 'Codex Assistant',
            sender_backend: 'codex',
            sender_conversation_id: 'teammate-conversation-1',
          },
        },
        msg_id: 'projected-message-1',
        conversation_id: 'leader-conversation-1',
      } as unknown as IResponseMessage);
    });

    expect(addOrUpdateMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'text',
        msg_id: 'projected-message-1',
        conversation_id: 'leader-conversation-1',
        content: {
          content: '[Codex Assistant] idle',
          teammateMessage: true,
          senderName: 'Codex Assistant',
          senderAgentType: 'codex',
          senderConversationId: 'teammate-conversation-1',
        },
      })
    );
  });

  it('renders an advisory tips notice without lighting the running timer', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const { result } = renderHook(() => useAcpMessage('conv-1'));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });
    expect(result.current.running).toBe(false);

    // A backend Notice (a rejected mode/model/effort switch, or a codex out-of-turn
    // warning) arrives as a `tips` frame while the conversation is idle. It must merge
    // for display but must NOT set running — falling through to the `default` arm's
    // setRunning(true) would light a spurious timer bar with no terminal to clear it.
    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'tips',
        data: {
          content: 'set effort: rejected by agent',
          type: 'warning',
        },
        msg_id: 'msg-tip-1',
        conversation_id: 'conv-1',
      } as unknown as IResponseMessage);
    });

    expect(addOrUpdateMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tips',
        msg_id: 'msg-tip-1',
        conversation_id: 'conv-1',
        content: expect.objectContaining({
          content: 'set effort: rejected by agent',
          type: 'warning',
        }),
      })
    );
    expect(result.current.running).toBe(false);
  });

  it('hydrates the context-usage indicator from the backend snapshot after runtime ensure', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    getUsageInvokeMock.mockResolvedValue({ used: 52_000, size: 1_048_576 });

    const { result } = renderHook(() => useAcpMessage('conv-1'));

    await waitFor(() => {
      expect(result.current.tokenUsage).toEqual({ total_tokens: 52_000 });
    });
    expect(result.current.context_limit).toBe(1_048_576);
  });

  it('keeps the indicator hidden when the backend has no usage snapshot yet', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    getUsageInvokeMock.mockResolvedValue(null);

    const { result } = renderHook(() => useAcpMessage('conv-1'));

    await waitFor(() => {
      expect(getUsageInvokeMock).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    });
    expect(result.current.tokenUsage).toBeNull();
    expect(result.current.context_limit).toBe(0);
  });

  it.each([
    { used: 27_237, size: 1_000_000 },
    { used: 240_255, size: 475_000 },
  ])('restores headless usage $used/$size without a live usage event', async (usage) => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    getUsageInvokeMock.mockResolvedValue({ ...usage, _meta: { '_claude/rateLimit': { status: 'allowed' } } });
    const { result } = renderHook(() => useAcpMessage('headless-conv'));
    await waitFor(() => expect(result.current.tokenUsage?.total_tokens).toBe(usage.used));
    expect(result.current.context_limit).toBe(usage.size);
  });

  it('does not infer usage from an old metadata-only snapshot', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    getUsageInvokeMock.mockResolvedValue({ _meta: { '_claude/rateLimit': { status: 'allowed' } } });
    const { result } = renderHook(() => useAcpMessage('headless-conv'));
    await waitFor(() => expect(getUsageInvokeMock).toHaveBeenCalledWith({ conversation_id: 'headless-conv' }));
    expect(result.current.tokenUsage).toBeNull();
    expect(result.current.context_limit).toBe(0);
  });

  it('does not clobber live stream usage with a slower HTTP snapshot', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const usageDeferred = deferred<{ used: number; size: number }>();
    getUsageInvokeMock.mockReturnValue(usageDeferred.promise);

    const { result } = renderHook(() => useAcpMessage('conv-1'));

    await waitFor(() => {
      expect(getUsageInvokeMock).toHaveBeenCalledTimes(1);
    });

    // A live acp_context_usage frame lands before the HTTP snapshot resolves.
    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'acp_context_usage',
        data: { used: 90_000, size: 0 },
        msg_id: 'usage-1',
        conversation_id: 'conv-1',
      } as unknown as IResponseMessage);
    });

    await act(async () => {
      usageDeferred.resolve({ used: 50, size: 200_000 });
      await usageDeferred.promise;
    });

    await waitFor(() => {
      // The stale snapshot must not overwrite the live counter, but it may
      // still fill in the context window the live frame did not carry.
      expect(result.current.context_limit).toBe(200_000);
    });
    expect(result.current.tokenUsage).toEqual({ total_tokens: 90_000 });
  });

  it.each(['pending', 'unavailable'] as const)(
    'restores a %s reading without treating it as current',
    async (status) => {
      vi.mocked(getConversationOrNull).mockResolvedValue(null);
      const freshness = { status, turn_id: 'turn-new', updated_at: 100, status_changed_at: 200, reason: null };
      getUsageInvokeMock.mockResolvedValue({
        used: 27_237,
        size: 1_000_000,
        _meta: { 'aionui/contextUsage': freshness },
      });
      const { result } = renderHook(() => useAcpMessage('headless-conv'));
      await waitFor(() => expect(result.current.tokenUsage?.freshness).toEqual(freshness));
      expect(result.current.tokenUsage?.total_tokens).toBe(27_237);
      expect(result.current.context_limit).toBe(1_000_000);
    }
  );

  it('restores metadata-only pending state and replaces it when confirmed usage arrives', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const freshness = { status: 'pending', turn_id: 'turn-first', updated_at: null, status_changed_at: 100 };
    getUsageInvokeMock.mockResolvedValue({ _meta: { 'aionui/contextUsage': freshness } });
    const { result } = renderHook(() => useAcpMessage('conv-1'));
    await waitFor(() => expect(result.current.tokenUsage?.freshness?.status).toBe('pending'));
    expect(result.current.context_limit).toBe(0);
    act(() =>
      responseStreamHandlerRef.current?.({
        type: 'acp_context_usage',
        conversation_id: 'conv-1',
        msg_id: '',
        data: {
          used: 27_237,
          size: 1_000_000,
          _meta: {
            'aionui/contextUsage': { ...freshness, status: 'current', updated_at: 200, status_changed_at: 200 },
          },
        },
      } as unknown as IResponseMessage)
    );
    expect(result.current.tokenUsage?.total_tokens).toBe(27_237);
    expect(result.current.tokenUsage?.freshness?.status).toBe('current');
    expect(result.current.context_limit).toBe(1_000_000);
  });

  it('keeps count, window and confirmation together when older frames arrive', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const current = { status: 'current', turn_id: 'turn-new', updated_at: 200, status_changed_at: 200 };
    getUsageInvokeMock.mockResolvedValue({ used: 50_000, size: 200_000, _meta: { 'aionui/contextUsage': current } });
    const { result } = renderHook(() => useAcpMessage('conv-1'));
    await waitFor(() => expect(result.current.tokenUsage?.freshness?.status).toBe('current'));
    const emit = (data: unknown) =>
      act(() =>
        responseStreamHandlerRef.current?.({
          type: 'acp_context_usage',
          conversation_id: 'conv-1',
          msg_id: '',
          data,
        } as unknown as IResponseMessage)
      );
    emit({
      used: 1,
      size: 10,
      _meta: { 'aionui/contextUsage': { ...current, status: 'pending', status_changed_at: 100 } },
    });
    expect(result.current.tokenUsage?.total_tokens).toBe(50_000);
    expect(result.current.context_limit).toBe(200_000);
    emit({
      _meta: { 'aionui/contextUsage': { ...current, turn_id: 'turn-next', status: 'pending', status_changed_at: 300 } },
    });
    emit({ used: 60_000, size: 1_000_000 });
    expect(result.current.tokenUsage?.freshness?.status).toBe('pending');
    expect(result.current.tokenUsage?.total_tokens).toBe(50_000);
    expect(result.current.context_limit).toBe(200_000);
  });

  it('does not restore a previous turn over live pending state from a slower HTTP request', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const snapshot = deferred<Record<string, unknown>>();
    getUsageInvokeMock.mockReturnValue(snapshot.promise);
    const { result } = renderHook(() => useAcpMessage('conv-1'));
    await waitFor(() => expect(getUsageInvokeMock).toHaveBeenCalledTimes(1));
    const freshness = { status: 'pending', turn_id: 'turn-new', updated_at: 100, status_changed_at: 200 };
    act(() =>
      responseStreamHandlerRef.current?.({
        type: 'acp_context_usage',
        conversation_id: 'conv-1',
        msg_id: '',
        data: { used: 50_000, size: 200_000, _meta: { 'aionui/contextUsage': freshness } },
      } as unknown as IResponseMessage)
    );
    await act(async () => {
      snapshot.resolve({
        used: 100,
        size: 1_000_000,
        _meta: {
          'aionui/contextUsage': { ...freshness, status: 'current', turn_id: 'turn-old', status_changed_at: 100 },
        },
      });
      await snapshot.promise;
    });
    expect(result.current.tokenUsage?.freshness?.status).toBe('pending');
    expect(result.current.tokenUsage?.total_tokens).toBe(50_000);
    expect(result.current.context_limit).toBe(200_000);
  });

  it('survives a failing usage snapshot request without touching indicator state', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    getUsageInvokeMock.mockRejectedValue(new Error('no active task'));

    const { result } = renderHook(() => useAcpMessage('conv-1'));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });
    expect(result.current.tokenUsage).toBeNull();
    expect(result.current.context_limit).toBe(0);
  });

  it('preserves the turn start timestamp when switching away and back to a running conversation', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const { result, rerender } = renderHook(({ id }) => useAcpMessage(id), {
      initialProps: { id: 'conv-1' },
    });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });
    expect(result.current.turnStartedAtMs).toBeNull();

    // User sends a message at t=100s — the send box flips aiProcessing on.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    act(() => {
      result.current.setAiProcessing(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);

    // Switch to another conversation while the backend keeps processing conv-1.
    vi.mocked(getConversationOrNull).mockImplementation((id: string) =>
      Promise.resolve(id === 'conv-1' ? ({ runtime: { is_processing: true } } as never) : null)
    );
    nowSpy.mockReturnValue(200_000);
    rerender({ id: 'conv-2' });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });
    expect(result.current.turnStartedAtMs).toBeNull();

    // Switch back — hydration restores processing state with the ORIGINAL start
    // time, so the elapsed indicator does not restart from zero.
    rerender({ id: 'conv-1' });
    await waitFor(() => {
      expect(result.current.aiProcessing).toBe(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);
    nowSpy.mockRestore();
  });

  it('clears the turn start timestamp when the turn finishes', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const { result } = renderHook(() => useAcpMessage('conv-1'));
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    act(() => {
      result.current.setAiProcessing(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'finish',
        data: null,
        msg_id: 'msg-1',
        conversation_id: 'conv-1',
      });
    });
    expect(result.current.turnStartedAtMs).toBeNull();

    // The next turn gets a fresh origin instead of inheriting the stale one.
    nowSpy.mockReturnValue(300_000);
    act(() => {
      result.current.setAiProcessing(true);
    });
    expect(result.current.turnStartedAtMs).toBe(300_000);
    nowSpy.mockRestore();
  });

  it('drops a stale turn start timestamp when hydration reports the conversation idle', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const { result, rerender } = renderHook(({ id }) => useAcpMessage(id), {
      initialProps: { id: 'conv-1' },
    });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    act(() => {
      result.current.setAiProcessing(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);
    nowSpy.mockRestore();

    // Turn ends while the user is on another conversation: switching back finds
    // the backend idle, so the recorded origin must be discarded.
    rerender({ id: 'conv-2' });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });
    rerender({ id: 'conv-1' });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });
    expect(result.current.aiProcessing).toBe(false);
    expect(result.current.turnStartedAtMs).toBeNull();

    // A later turn starts from its own send time, not the stale origin.
    const nowSpy2 = vi.spyOn(Date, 'now').mockReturnValue(500_000);
    act(() => {
      result.current.setAiProcessing(true);
    });
    expect(result.current.turnStartedAtMs).toBe(500_000);
    nowSpy2.mockRestore();
  });
});

describe('tokenUsageFromAcpUsage', () => {
  it('maps used, cost, and _meta breakdown from a UsageUpdate payload', () => {
    const usage = tokenUsageFromAcpUsage({
      used: 14_118,
      cost: { amount: 0.42, currency: 'USD' },
      _meta: {
        input_tokens: 14_088,
        output_tokens: 30,
        cached_read_tokens: 14_080,
        not_a_counter: 'ignore-me',
      },
    });

    expect(usage.total_tokens).toBe(14_118);
    expect(usage.cost).toEqual({ amount: 0.42, currency: 'USD' });
    expect(usage.breakdown).toEqual({
      input_tokens: 14_088,
      output_tokens: 30,
      cached_read_tokens: 14_080,
    });
  });

  it('omits cost and breakdown when the payload carries neither', () => {
    const usage = tokenUsageFromAcpUsage({ used: 12_600 });
    expect(usage).toEqual({ total_tokens: 12_600 });
  });

  it('drops a zero-amount cost as unreported', () => {
    const usage = tokenUsageFromAcpUsage({ used: 10, cost: { amount: 0, currency: 'USD' } });
    expect(usage.cost).toBeUndefined();
  });
});
