/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reconcile wiring: `reconcileGeneratingFromRuntime` lets an authoritative
 * runtime summary (hydrate / send-accepted) relight the sidebar spinner when a
 * WS stream frame was missed (window reload/reconnect race). It must only
 * ever turn the flag ON — clearing stays exclusively with terminal stream
 * frames / turn.completed.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { list, streams, removals, completions } = vi.hoisted(() => ({
  list: vi.fn(),
  streams: new Set<(event: { conversation_id: string; type: string; data: unknown; turn_id?: string }) => void>(),
  removals: new Set<(event: { conversation_id: string; id: string }) => void>(),
  completions: new Set<(event: { session_id: string; turn_id: string; state: string }) => void>(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getUserConversations: { invoke: vi.fn(() => new Promise(() => {})) },
    },
    conversation: {
      listChanged: { on: () => () => {} },
      responseStream: { on: (fn: Parameters<typeof streams.add>[0]) => streams.add(fn) },
      turnCompleted: { on: (fn: Parameters<typeof completions.add>[0]) => completions.add(fn) },
      confirmation: {
        list: { invoke: list },
        remove: { on: (fn: Parameters<typeof removals.add>[0]) => removals.add(fn) },
      },
    },
    application: {
      writeRendererLog: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({ addEventListener: () => () => {} }));

import {
  reconcileGeneratingFromRuntime,
  reconcileWaitingConfirmationFromRuntime,
  useConversationListSync,
} from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';

describe('reconcileGeneratingFromRuntime', () => {
  // Each test uses a distinct conversation id (conv-a/b/c/d) since the store
  // backing this hook is module-level and persists across tests in this file.

  it('marks a conversation generating when isProcessing is true', () => {
    const { result } = renderHook(() => useConversationListSync());

    act(() => {
      reconcileGeneratingFromRuntime('conv-a', true);
    });

    expect(result.current.isConversationGenerating('conv-a')).toBe(true);
  });

  it('does not touch other conversations when reconciling one id', () => {
    const { result } = renderHook(() => useConversationListSync());

    act(() => {
      reconcileGeneratingFromRuntime('conv-b', true);
    });

    expect(result.current.isConversationGenerating('conv-b')).toBe(true);
    expect(result.current.isConversationGenerating('conv-c')).toBe(false);
  });

  it('leaves the generating state unchanged when isProcessing is false', () => {
    const { result } = renderHook(() => useConversationListSync());

    act(() => {
      reconcileGeneratingFromRuntime('conv-d', false);
    });

    expect(result.current.isConversationGenerating('conv-d')).toBe(false);
  });
});

describe('waiting-confirmation sidebar integration', () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue([]);
  });

  const permission = (id: string, request: string) =>
    streams.forEach((fn) =>
      fn({ conversation_id: id, type: 'acp_permission', data: { tool_call: { tool_call_id: request } } })
    );

  it('clears an obsolete runtime waiting count using the actual pending list', async () => {
    const { result } = renderHook(() => useConversationListSync());
    act(() => reconcileWaitingConfirmationFromRuntime('stale-runtime', 1));
    await waitFor(() => expect(result.current.isConversationWaitingConfirmation('stale-runtime')).toBe(false));
    expect(list).toHaveBeenCalledWith({ conversation_id: 'stale-runtime' });
  });

  it('does not relight the badge when an automatically answered frame arrives late', async () => {
    const { result } = renderHook(() => useConversationListSync());
    await act(async () => {
      removals.forEach((fn) => fn({ conversation_id: 'auto-late', id: 'request' }));
    });
    list.mockRejectedValue(new Error('offline'));
    act(() => permission('auto-late', 'request'));
    expect(result.current.isConversationWaitingConfirmation('auto-late')).toBe(false);
  });

  it('keeps a real outstanding question visible after another request was answered', async () => {
    list.mockResolvedValue([{ id: 'question', call_id: 'question' }]);
    const { result } = renderHook(() => useConversationListSync());
    await act(async () => {
      permission('two-requests', 'tool');
      streams.forEach((fn) => fn({ conversation_id: 'two-requests', type: 'ask', data: { request_id: 'question' } }));
      removals.forEach((fn) => fn({ conversation_id: 'two-requests', id: 'tool' }));
    });
    expect(result.current.isConversationWaitingConfirmation('two-requests')).toBe(true);
  });

  it('repairs a missed resolution on window focus after a lookup failure', async () => {
    list.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useConversationListSync());
    await act(async () => permission('missed-resolution', 'request'));
    expect(result.current.isConversationWaitingConfirmation('missed-resolution')).toBe(true);
    list.mockResolvedValue([]);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(result.current.isConversationWaitingConfirmation('missed-resolution')).toBe(false);
  });

  it('ignores a late permission frame from a completed turn', () => {
    const { result } = renderHook(() => useConversationListSync());
    act(() => {
      streams.forEach((fn) => fn({ conversation_id: 'finished-late', type: 'finish', data: {} }));
      permission('finished-late', 'old-request');
    });
    expect(result.current.isConversationWaitingConfirmation('finished-late')).toBe(false);
  });

  it('clears pending badges on turn completion even if the finish frame was missed', async () => {
    list.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useConversationListSync());
    await act(async () => permission('completed-event', 'request'));
    act(() => {
      result.current.setActiveConversation('completed-event');
      completions.forEach((fn) => fn({ session_id: 'completed-event', turn_id: 'turn-1', state: 'ai_waiting_input' }));
    });
    expect(result.current.isConversationWaitingConfirmation('completed-event')).toBe(false);
    act(() => result.current.setActiveConversation(null));
  });
});
