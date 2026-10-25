/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/utils/emitter', () => ({
  addEventListener: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getUserConversations: { invoke: vi.fn().mockResolvedValue({ items: [] }) },
    },
    application: {
      writeRendererLog: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
    conversation: {
      listChanged: { on: vi.fn() },
      responseStream: { on: vi.fn() },
      turnCompleted: { on: vi.fn() },
      confirmation: { remove: { on: vi.fn() } },
    },
  },
}));

import { useConversationListSync } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';
import type { TChatConversation } from '@/common/config/storage';

const STORAGE_KEY = 'conversation-manual-unread-ids';

describe('useConversationListSync manual unread persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('isManualUnread reflects the persisted set and survives a reload', () => {
    const { result, unmount } = renderHook(() => useConversationListSync());

    act(() => {
      result.current.markManualUnread('conv-1');
    });
    expect(result.current.isManualUnread('conv-1')).toBe(true);
    expect(result.current.isManualUnread('conv-2')).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['conv-1']));

    unmount();

    // A fresh hook reads the persisted value from localStorage.
    const { result: second } = renderHook(() => useConversationListSync());
    expect(second.current.isManualUnread('conv-1')).toBe(true);
  });

  it('clearManualUnread removes the id and updates localStorage', () => {
    const { result } = renderHook(() => useConversationListSync());

    act(() => {
      result.current.markManualUnread('conv-1');
      result.current.markManualUnread('conv-2');
    });
    expect(result.current.isManualUnread('conv-1')).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['conv-1', 'conv-2']));

    act(() => {
      result.current.clearManualUnread('conv-1');
    });
    expect(result.current.isManualUnread('conv-1')).toBe(false);
    expect(result.current.isManualUnread('conv-2')).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['conv-2']));
  });

  it('ignores malformed stored values', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    const { result } = renderHook(() => useConversationListSync());

    expect(result.current.isManualUnread('conv-1')).toBe(false);
  });
});

describe('conversation list refresh coordination', () => {
  let removeFocusListeners: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    removeFocusListeners = undefined;
  });

  afterEach(() => {
    cleanup();
    removeFocusListeners?.();
    vi.restoreAllMocks();
  });

  const page = (id: string) => ({
    items: [{ id, name: id, type: 'acp', extra: {} } as TChatConversation],
    total: 1,
    has_more: false,
  });

  async function mountPendingList() {
    const { ipcBridge } = await import('@/common');
    type Page = Awaited<ReturnType<typeof ipcBridge.database.getUserConversations.invoke>>;
    let resolve!: (value: Page) => void;
    let reject!: (reason: Error) => void;
    const pending = new Promise<Page>((resolvePending, rejectPending) => {
      resolve = resolvePending;
      reject = rejectPending;
    });
    const list = vi.mocked(ipcBridge.database.getUserConversations.invoke);
    list.mockReset().mockResolvedValue(page('latest')).mockReturnValueOnce(pending);
    const { useConversationListSync: useStore } =
      await import('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync');
    const addListener = vi.spyOn(window, 'addEventListener');
    const view = renderHook(() => useStore());
    const listeners = addListener.mock.calls.filter(([type]) => type === 'focus');
    removeFocusListeners = () => {
      for (const [type, listener, options] of listeners) window.removeEventListener(type, listener, options);
    };
    const changed = vi.mocked(ipcBridge.conversation.listChanged.on).mock.calls.at(-1)?.[0];
    if (!changed) throw new Error('Missing conversation-list listener');
    return { ...view, list, resolve, reject, changed };
  }

  it('shares an in-flight refresh and loads the latest list once after a burst of changes', async () => {
    const { result, list, resolve, changed } = await mountPendingList();
    act(() => {
      for (let i = 0; i < 20; i++) changed({ action: 'updated', conversation_id: `conv-${i}` });
    });
    expect(list).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve(page('older'));
    });

    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.conversations.map((item) => item.id)).toEqual(['latest']);
  });

  it('processes a queued change after a failed refresh and accepts later refreshes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, list, reject, changed } = await mountPendingList();
    act(() => {
      changed({ action: 'updated', conversation_id: 'new' });
    });

    await act(async () => {
      reject(new Error('temporary failure'));
    });

    expect(result.current.conversations.map((item) => item.id)).toEqual(['latest']);
    list.mockResolvedValue(page('newer'));
    await act(async () => {
      changed({ action: 'updated', conversation_id: 'newer' });
    });
    expect(result.current.conversations.map((item) => item.id)).toEqual(['newer']);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('does not schedule a redundant follow-up when no change arrived during the request', async () => {
    const { result, list, resolve } = await mountPendingList();
    await act(async () => {
      resolve(page('initial'));
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.current.conversations.map((item) => item.id)).toEqual(['initial']);
  });
});
