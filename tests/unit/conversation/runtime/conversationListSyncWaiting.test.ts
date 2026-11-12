/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createWaitingConfirmationSync } from '@/renderer/pages/conversation/GroupedHistory/utils/waitingConfirmationSync';
import {
  applyWaitingConfirmationTransition,
  extractConfirmationId,
  isWaitingConfirmationStreamMessage,
  RUNTIME_PENDING_CONFIRMATION_ID,
  shouldReconcileMarkWaiting,
} from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';

describe('isWaitingConfirmationStreamMessage', () => {
  it.each(['permission', 'acp_permission', 'ask'])('treats %s as a waiting-confirmation frame', (type) => {
    expect(isWaitingConfirmationStreamMessage(type)).toBe(true);
  });

  it.each(['content', 'tool_call', 'finish', 'thinking', 'plan'])('does not treat %s as waiting', (type) => {
    expect(isWaitingConfirmationStreamMessage(type)).toBe(false);
  });
});

describe('extractConfirmationId', () => {
  it('reads request_id from an ask frame', () => {
    expect(extractConfirmationId({ type: 'ask', data: { request_id: 'req-1', questions: [] } })).toBe('req-1');
  });

  it('prefers call_id on a permission frame', () => {
    expect(extractConfirmationId({ type: 'permission', data: { id: 'conf-1', call_id: 'call-1' } })).toBe('call-1');
  });

  it('falls back to id on a permission frame without call_id', () => {
    expect(extractConfirmationId({ type: 'permission', data: { id: 'conf-1' } })).toBe('conf-1');
  });

  it('reads tool_call.tool_call_id from an acp_permission frame', () => {
    expect(extractConfirmationId({ type: 'acp_permission', data: { tool_call: { tool_call_id: 'tc-1' } } })).toBe(
      'tc-1'
    );
  });

  it('returns undefined when the id field is missing', () => {
    expect(extractConfirmationId({ type: 'acp_permission', data: { tool_call: {} } })).toBeUndefined();
    expect(extractConfirmationId({ type: 'ask', data: {} })).toBeUndefined();
    expect(extractConfirmationId({ type: 'permission', data: undefined })).toBeUndefined();
  });

  it('returns undefined for a non-confirmation frame', () => {
    expect(extractConfirmationId({ type: 'content', data: { call_id: 'x' } })).toBeUndefined();
  });
});

describe('applyWaitingConfirmationTransition', () => {
  it('adds a confirmation id on mark', () => {
    const next = applyWaitingConfirmationTransition(new Set(), { kind: 'mark', confirmationId: 'a' });
    expect([...next]).toEqual(['a']);
  });

  it('removes a confirmation id on unmark, emptying the set', () => {
    const next = applyWaitingConfirmationTransition(new Set(['a']), { kind: 'unmark', confirmationId: 'a' });
    expect(next.size).toBe(0);
  });

  it('keeps other pending ids when one of several is unmarked', () => {
    const next = applyWaitingConfirmationTransition(new Set(['a', 'b']), { kind: 'unmark', confirmationId: 'a' });
    expect([...next]).toEqual(['b']);
  });

  it('drops the runtime sentinel on any unmark (a concrete resolution invalidates the guess)', () => {
    const next = applyWaitingConfirmationTransition(new Set([RUNTIME_PENDING_CONFIRMATION_ID]), {
      kind: 'unmark',
      confirmationId: 'some-unknown-id',
    });
    expect(next.size).toBe(0);
  });

  it('empties the set on clear', () => {
    const next = applyWaitingConfirmationTransition(new Set(['a', 'b']), { kind: 'clear' });
    expect(next.size).toBe(0);
  });

  it('does not mutate the input set', () => {
    const current = new Set(['a']);
    applyWaitingConfirmationTransition(current, { kind: 'mark', confirmationId: 'b' });
    expect([...current]).toEqual(['a']);
  });
});

describe('shouldReconcileMarkWaiting', () => {
  it('marks waiting when the runtime reports pending confirmations', () => {
    expect(shouldReconcileMarkWaiting(1)).toBe(true);
  });

  it('does not mark when there are no pending confirmations', () => {
    expect(shouldReconcileMarkWaiting(0)).toBe(false);
  });
});

describe('pending confirmation reconciliation', () => {
  it('clears a stale waiting mark when the server has no pending requests', async () => {
    const replace = vi.fn();
    const sync = createWaitingConfirmationSync({ load: async () => [], replace });
    await sync.refresh('claude');
    expect(replace).toHaveBeenCalledWith('claude', []);
  });

  it('does not revive a request whose resolution arrived before its stream frame', async () => {
    const replace = vi.fn();
    const sync = createWaitingConfirmationSync({ load: async () => ['resolved', 'waiting'], replace });
    sync.resolve('claude', 'resolved');
    await sync.refresh('claude');
    expect(sync.mark('claude', 'resolved')).toBe(false);
    expect(replace).toHaveBeenLastCalledWith('claude', ['waiting']);
  });

  it('discards an old empty snapshot when a new request arrives during the lookup', async () => {
    const first = Promise.withResolvers<string[]>();
    const second = Promise.withResolvers<string[]>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const replace = vi.fn();
    const sync = createWaitingConfirmationSync({ load, replace });
    const refresh = sync.refresh('claude');
    sync.mark('claude', 'new');
    first.resolve([]);
    await Promise.resolve();
    expect(replace).not.toHaveBeenCalled();
    second.resolve(['new']);
    await refresh;
    expect(replace).toHaveBeenCalledExactlyOnceWith('claude', ['new']);
  });

  it('preserves the badge after lookup failure and can recover on a later refresh', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    const replace = vi.fn();
    const sync = createWaitingConfirmationSync({ load, replace });
    await sync.refresh('claude');
    expect(replace).not.toHaveBeenCalled();
    await sync.refresh('claude');
    expect(replace).toHaveBeenCalledWith('claude', []);
  });

  it('ignores an outstanding lookup after a turn ends or a conversation is deleted', async () => {
    const pending = Promise.withResolvers<string[]>();
    const replace = vi.fn();
    const sync = createWaitingConfirmationSync({ load: () => pending.promise, replace });
    const refresh = sync.refresh('claude');
    sync.forget('claude');
    pending.resolve(['old']);
    await refresh;
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not suppress a pending request in another conversation with the same id', () => {
    const sync = createWaitingConfirmationSync({ load: async () => [], replace: vi.fn() });
    sync.resolve('first', 'request');
    expect(sync.mark('second', 'request')).toBe(true);
  });
});
