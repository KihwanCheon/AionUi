import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDoorayCompletionReadPolicy,
  isDoorayProposalConversation,
} from '@/renderer/pages/conversation/GroupedHistory/utils/doorayCompletionRead';

const proposal = (id = 'proposal', phase = 'review') => ({
  id,
  extra: { mnpDoorayResponseId: 'dooray-request', mnpDoorayOperationId: `dooray-request-${phase}-0` },
});

const fixture = () => {
  const loadConversation = vi.fn<Parameters<typeof createDoorayCompletionReadPolicy>[0]['loadConversation']>();
  const unread = new Set<string>();
  const policy = createDoorayCompletionReadPolicy({
    loadConversation,
    markUnread: (id) => unread.add(id),
    clearUnread: (id) => unread.delete(id),
  });
  return { policy, loadConversation, unread };
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.useRealTimers());

describe('Dooray proposal metadata', () => {
  it.each(['route', 'review'])('recognizes a dedicated %s conversation', (phase) => {
    expect(isDoorayProposalConversation(proposal('proposal', phase))).toBe(true);
  });

  it.each([
    undefined,
    null,
    [],
    'dooray-request',
    {},
    { mnpDoorayResponseId: '' },
    { mnpDoorayResponseId: ' ', mnpDoorayOperationId: ' -route-0' },
    { mnpDoorayResponseId: 'dooray-request' },
    { mnpDoorayOperationId: 'dooray-request-route-0' },
    { mnpDoorayResponseId: 1, mnpDoorayOperationId: '1-route-0' },
    { mnpDoorayResponseId: 'dooray-request', mnpDoorayOperationId: 1 },
    { mnpDoorayResponseId: 'dooray-request', mnpDoorayOperationId: 'another-request-route-0' },
    { mnpDoorayResponseId: 'dooray-request', mnpDoorayOperationId: 'dooray-request-' },
    { purpose: 'dooray-response', responseId: 'dooray-request' },
    { workspace: 'C:/data/_dooray-response-workspaces/owner/Dooray AI 대응' },
  ])('does not auto-read unmarked or malformed metadata: %j', (extra) => {
    expect(isDoorayProposalConversation({ id: 'ordinary', extra })).toBe(false);
  });
});

describe('completion policy reconciliation', () => {
  it('clears existing proposal dots but preserves ordinary unread completions', () => {
    const { policy, unread } = fixture();
    unread.add('proposal').add('ordinary');
    policy.reconcile([proposal(), { id: 'ordinary' }]);
    expect([...unread]).toEqual(['ordinary']);
  });

  it('keeps new and repeated proposal completions read without fetching messages', () => {
    const { policy, unread, loadConversation } = fixture();
    policy.reconcile([proposal()]);
    policy.markCompletion('proposal');
    policy.markCompletion('proposal');
    expect(unread.size).toBe(0);
    expect(loadConversation).not.toHaveBeenCalled();
  });

  it('does not auto-read an ordinary conversation after proposal metadata is removed', () => {
    const { policy, unread } = fixture();
    policy.reconcile([proposal()]);
    policy.reconcile([{ id: 'proposal' }]);
    policy.markCompletion('proposal');
    expect([...unread]).toEqual(['proposal']);
  });

  it('retains known policy when a later list omits the conversation', () => {
    const { policy, unread } = fixture();
    policy.reconcile([proposal()]);
    policy.reconcile([]);
    policy.markCompletion('proposal');
    expect(unread.size).toBe(0);
  });

  it('clears unread without forgetting the metadata policy for the next completion', () => {
    const { policy, unread, loadConversation } = fixture();
    policy.reconcile([{ id: 'ordinary' }]);
    policy.markCompletion('ordinary');
    policy.clearCompletion('ordinary');
    expect(unread.size).toBe(0);
    policy.markCompletion('ordinary');
    expect([...unread]).toEqual(['ordinary']);
    expect(loadConversation).not.toHaveBeenCalled();
  });

  it('forgets metadata on deletion so a reused id is classified again', async () => {
    const { policy, unread, loadConversation } = fixture();
    policy.reconcile([proposal()]);
    policy.forget('proposal');
    loadConversation.mockResolvedValue({ id: 'proposal' });
    policy.markCompletion('proposal');
    await flush();
    expect(loadConversation).toHaveBeenCalledExactlyOnceWith('proposal');
    expect([...unread]).toEqual(['proposal']);
  });
});

describe('completion before metadata', () => {
  it('defers duplicate terminal events and auto-reads after one metadata lookup', async () => {
    const { policy, unread, loadConversation } = fixture();
    loadConversation.mockResolvedValue(proposal());
    policy.markCompletion('proposal');
    policy.markCompletion('proposal');
    expect(unread.size).toBe(0);
    await flush();
    expect(loadConversation).toHaveBeenCalledTimes(1);
    expect(unread.size).toBe(0);
  });

  it('restores an ordinary unread completion once its metadata arrives', async () => {
    const { policy, unread, loadConversation } = fixture();
    loadConversation.mockResolvedValue({ id: 'ordinary' });
    policy.markCompletion('ordinary');
    await flush();
    expect([...unread]).toEqual(['ordinary']);
  });

  it.each([null, undefined, proposal('wrong-id')])('fails open on an invalid lookup result: %j', async (result) => {
    const { policy, unread, loadConversation } = fixture();
    loadConversation.mockResolvedValue(result);
    policy.markCompletion('ordinary');
    await flush();
    expect([...unread]).toEqual(['ordinary']);
  });

  it('preserves the notification on lookup failure, then clears it on a successful list refresh', async () => {
    const { policy, unread, loadConversation } = fixture();
    loadConversation.mockRejectedValue(new Error('offline'));
    policy.markCompletion('proposal');
    await flush();
    expect([...unread]).toEqual(['proposal']);
    policy.reconcile([proposal()]);
    expect(unread.size).toBe(0);
  });

  it('does not silently lose completion when the lookup hangs', async () => {
    vi.useFakeTimers();
    const { policy, unread, loadConversation } = fixture();
    loadConversation.mockImplementation(() => new Promise(() => {}));
    policy.markCompletion('ordinary');
    await vi.advanceTimersByTimeAsync(5000);
    expect([...unread]).toEqual(['ordinary']);
  });

  it.each(['clearCompletion', 'forget'] as const)(
    'does not restore unread after %s while a lookup is pending',
    async (action) => {
      const { policy, unread, loadConversation } = fixture();
      loadConversation.mockResolvedValue({ id: 'ordinary' });
      policy.markCompletion('ordinary');
      policy[action]('ordinary');
      await flush();
      expect(unread.size).toBe(0);
    }
  );

  it('does not let a cancelled lookup settle a newer completion for the same conversation', async () => {
    const { policy, unread, loadConversation } = fixture();
    let resolveOld!: (value: { id: string }) => void;
    let resolveNew!: (value: ReturnType<typeof proposal>) => void;
    loadConversation
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveNew = resolve)));
    policy.markCompletion('proposal');
    await flush();
    policy.clearCompletion('proposal');
    policy.markCompletion('proposal');
    await flush();
    resolveOld({ id: 'proposal' });
    await flush();
    expect(unread.size).toBe(0);
    resolveNew(proposal());
    await flush();
    expect(unread.size).toBe(0);
    expect(loadConversation).toHaveBeenCalledTimes(2);
  });

  it('discards stale lookup completion after a list has resolved the pending policy', async () => {
    const { policy, unread, loadConversation } = fixture();
    loadConversation.mockResolvedValue({ id: 'proposal' });
    policy.markCompletion('proposal');
    policy.reconcile([proposal()]);
    await flush();
    expect(unread.size).toBe(0);
  });

  it('applies pending ordinary completion when a list arrives before the lookup', async () => {
    const { policy, unread, loadConversation } = fixture();
    loadConversation.mockResolvedValue(proposal('ordinary'));
    policy.markCompletion('ordinary');
    policy.reconcile([{ id: 'ordinary' }]);
    await flush();
    expect([...unread]).toEqual(['ordinary']);
  });
});
