import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUnlinkedConversations } from '@/renderer/pages/conversation/GroupedHistory/components/MnpUnlinkedConversationsModal/useUnlinkedConversations';
import { emitter } from '@/renderer/utils/emitter';
import { conversation, deferred, link } from './fixtures';

vi.mock('@/common', () => ({ ipcBridge: { sidebar: { archive: { invoke: vi.fn() } } } }));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));

const makeApi = () => ({ lookup: vi.fn(async (id: string) => link(id)), archive: vi.fn(async (_id: string) => {}) });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MnP unlinked conversation archive', () => {
  it('excludes linked, failed, malformed and mismatched lookups from the archive list', async () => {
    const api = makeApi();
    api.lookup.mockImplementation(async (id) => {
      if (id === 'error') throw new Error('offline');
      if (id === 'malformed') return { ...link(id), exists: undefined as unknown as boolean };
      if (id === 'wrong-id') return link('another');
      return link(id, id === 'linked');
    });
    const conversations = ['unlinked', 'linked', 'error', 'malformed', 'wrong-id'].map(conversation);
    const { result } = renderHook(() => useUnlinkedConversations(conversations, api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unlinked.map(({ id }) => id)).toEqual(['unlinked']);
    expect(result.current.failedCount).toBe(3);
  });

  it('makes a failed lookup selectable after a successful retry', async () => {
    const api = makeApi();
    api.lookup.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useUnlinkedConversations([conversation('a')], api));
    await waitFor(() => expect(result.current.failedCount).toBe(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.unlinked.map(({ id }) => id)).toEqual(['a']));
    expect(result.current.failedCount).toBe(0);
  });

  it('does not archive a conversation linked after opening the dialog', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useUnlinkedConversations([conversation('a')], api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.lookup.mockResolvedValue(link('a', true));
    await act(() => result.current.archive(['a']));
    expect(api.archive).not.toHaveBeenCalled();
    expect(result.current.unlinked).toEqual([]);
  });

  it('does not archive when the last link check fails', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useUnlinkedConversations([conversation('a')], api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.lookup.mockRejectedValue(new Error('offline'));
    await act(() => result.current.archive(['a']));
    expect(api.archive).not.toHaveBeenCalled();
    expect(result.current.failedCount).toBe(1);
  });

  it('retains only failed archives and their selection for retry', async () => {
    const api = makeApi();
    api.archive.mockImplementation(async (id) => {
      if (id === 'b') throw new Error('write failed');
    });
    const { result, rerender } = renderHook(({ ids }) => useUnlinkedConversations(ids.map(conversation), api), {
      initialProps: { ids: ['a', 'b'] },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.selectAll(true));
    await act(() => result.current.archive(result.current.selectedIds));
    rerender({ ids: ['b'] });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unlinked.map(({ id }) => id)).toEqual(['b']);
    expect(result.current.selectedIds).toEqual(['b']);
    expect(result.current.statuses.b).toBe('archiveFailed');
    expect(emitter.emit).toHaveBeenCalledWith('chat.history.refresh');
  });

  it('does not submit duplicate archives while an archive is in flight', async () => {
    const api = makeApi();
    const pending = deferred<void>();
    api.archive.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useUnlinkedConversations([conversation('a')], api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let first!: Promise<void>;
    act(() => {
      first = result.current.archive(['a']);
    });
    await waitFor(() => expect(api.archive).toHaveBeenCalledTimes(1));
    await act(() => result.current.archive(['a']));
    await act(async () => {
      pending.resolve();
      await first;
    });
    expect(api.archive).toHaveBeenCalledTimes(1);
  });

  it('limits concurrent lookups and stops queued work when the dialog closes', async () => {
    const api = makeApi();
    const pending = deferred<ReturnType<typeof link>>();
    api.lookup.mockReturnValue(pending.promise);
    const { unmount } = renderHook(() =>
      useUnlinkedConversations(
        Array.from({ length: 12 }, (_, n) => conversation(`${n}`)),
        api
      )
    );
    await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(4));
    unmount();
    await act(async () => {
      pending.resolve(link('0'));
    });
    expect(api.lookup).toHaveBeenCalledTimes(4);
  });

  it('ignores a previous group lookup completing after the group changes', async () => {
    const api = makeApi();
    const pending = deferred<ReturnType<typeof link>>();
    api.lookup.mockImplementation((id) => (id === 'old' ? pending.promise : Promise.resolve(link(id, true))));
    const { result, rerender } = renderHook(({ id }) => useUnlinkedConversations([conversation(id)], api), {
      initialProps: { id: 'old' },
    });
    rerender({ id: 'new' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      pending.resolve(link('old'));
    });
    expect(result.current.unlinked).toEqual([]);
    expect(result.current.statuses).toEqual({ new: 'linked' });
  });

  it('ignores archive requests for IDs outside the current group', async () => {
    const api = makeApi();
    const { result } = renderHook(() => useUnlinkedConversations([conversation('a')], api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.archive(['other']));
    expect(api.archive).not.toHaveBeenCalled();
  });

  it('preserves a failed archive when a new conversation arrives during processing', async () => {
    const api = makeApi();
    const pending = deferred<void>();
    api.archive.mockImplementation(async () => {
      await pending.promise;
      throw new Error('write failed');
    });
    const { result, rerender } = renderHook(({ ids }) => useUnlinkedConversations(ids.map(conversation), api), {
      initialProps: { ids: ['a'] },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.selectAll(true));
    let request!: Promise<void>;
    act(() => {
      request = result.current.archive(['a']);
    });
    await waitFor(() => expect(api.archive).toHaveBeenCalledTimes(1));
    rerender({ ids: ['a', 'b'] });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      pending.resolve();
      await request;
    });
    expect(result.current.statuses.a).toBe('archiveFailed');
    expect(result.current.selectedIds).toEqual(['a']);
  });
});
