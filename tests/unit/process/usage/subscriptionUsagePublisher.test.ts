/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeUsageSnapshot } from '@/common/types/platform/claudeUsage';
import type { CodexUsageSnapshot } from '@/common/types/platform/codexUsage';
import type { SubscriptionUsageSnapshot } from '@/common/types/platform/subscriptionUsage';
import {
  SubscriptionUsagePublisher,
  type SubscriptionUsageConversation,
} from '@process/usage/subscriptionUsagePublisher';

const claudeUsage: ClaudeUsageSnapshot = {
  session: { utilization: 23, resetsAt: 1_800_000_000 },
  weekly: { utilization: 41, resetsAt: 1_800_100_000 },
  updatedAt: 1_700_000_001_000,
};

const codexUsage: CodexUsageSnapshot = {
  weekly: {
    usedPercent: 18,
    resetsAt: 1_800_200_000,
    windowDurationMins: 10_080,
  },
  limitReached: false,
  updatedAt: 1_700_000_002_000,
};

const conversation: SubscriptionUsageConversation = {
  id: 'private-conversation-id',
  type: 'acp',
  backend: 'claude',
  modifiedAt: 10,
  workspace: 'C:\\private-workspace',
  isHealthCheck: false,
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const captureSnapshots = () => {
  const snapshots: SubscriptionUsageSnapshot[] = [];
  return {
    snapshots,
    writeSnapshot: (value: SubscriptionUsageSnapshot): string => {
      snapshots.push(structuredClone(value));
      return JSON.stringify(value);
    },
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('SubscriptionUsagePublisher background refresh', () => {
  it('publishes loading, partial, and ready states without a mounted titlebar', async () => {
    vi.useFakeTimers();
    const claude = deferred<ClaudeUsageSnapshot | null>();
    const codex = deferred<CodexUsageSnapshot | null>();
    const capture = captureSnapshots();
    const publisher = new SubscriptionUsagePublisher({
      clearSnapshot: () => {},
      getClaudeUsage: () => claude.promise,
      getCodexUsage: () => codex.promise,
      initialRefreshDelayMs: 0,
      isDirectory: () => true,
      listConversations: async () => [conversation],
      now: () => new Date('2026-07-31T12:34:50.000Z'),
      onProcessExit: () => {},
      writeSnapshot: capture.writeSnapshot,
    });

    publisher.start();
    expect(capture.snapshots.at(-1)?.state).toBe('loading');
    await vi.advanceTimersByTimeAsync(0);

    claude.resolve(claudeUsage);
    await flushPromises();
    expect(capture.snapshots.at(-1)?.state).toBe('partial');

    codex.resolve(codexUsage);
    await flushPromises();
    expect(capture.snapshots.at(-1)?.state).toBe('ready');
    publisher.stop();
  });

  it('marks both providers unavailable when there is no ACP context', async () => {
    vi.useFakeTimers();
    const capture = captureSnapshots();
    const getClaudeUsage = vi.fn();
    const getCodexUsage = vi.fn();
    const publisher = new SubscriptionUsagePublisher({
      clearSnapshot: () => {},
      getClaudeUsage,
      getCodexUsage,
      initialRefreshDelayMs: 0,
      listConversations: async () => [],
      onProcessExit: () => {},
      writeSnapshot: capture.writeSnapshot,
    });

    publisher.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(capture.snapshots.at(-1)?.state).toBe('unavailable');
    expect(getClaudeUsage).not.toHaveBeenCalled();
    expect(getCodexUsage).not.toHaveBeenCalled();
    publisher.stop();
  });

  it('waits for backend readiness before querying usage providers', async () => {
    vi.useFakeTimers();
    let isReady = false;
    const capture = captureSnapshots();
    const getCodexUsage = vi.fn(async () => codexUsage);
    const listConversations = vi.fn(async () => [conversation]);
    const publisher = new SubscriptionUsagePublisher({
      clearSnapshot: () => {},
      getClaudeUsage: async () => claudeUsage,
      getCodexUsage,
      initialRefreshDelayMs: 0,
      isDirectory: () => true,
      isRefreshReady: () => isReady,
      listConversations,
      loadingRetryMs: 2_000,
      onProcessExit: () => {},
      writeSnapshot: capture.writeSnapshot,
    });

    publisher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(listConversations).not.toHaveBeenCalled();

    isReady = true;
    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();

    expect(listConversations).toHaveBeenCalledTimes(1);
    expect(getCodexUsage).toHaveBeenCalledTimes(1);
    publisher.stop();
  });

  it('does not include context or credential data in the public snapshot', async () => {
    vi.useFakeTimers();
    const capture = captureSnapshots();
    const publisher = new SubscriptionUsagePublisher({
      clearSnapshot: () => {},
      getClaudeUsage: async () => claudeUsage,
      getCodexUsage: async () => codexUsage,
      initialRefreshDelayMs: 0,
      isDirectory: () => true,
      listConversations: async () => [conversation],
      onProcessExit: () => {},
      writeSnapshot: capture.writeSnapshot,
    });

    publisher.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    const serialized = JSON.stringify(capture.snapshots.at(-1));

    expect(serialized).not.toContain(conversation.id);
    expect(serialized).not.toContain(conversation.workspace);
    expect(serialized).not.toMatch(/token|apiKey|authorization/i);
    publisher.stop();
  });

  it('keeps the last successful values and timestamps after later provider failures', async () => {
    const capture = captureSnapshots();
    const getClaudeUsage = vi.fn().mockResolvedValueOnce(claudeUsage).mockResolvedValueOnce(null);
    const getCodexUsage = vi.fn().mockResolvedValueOnce(codexUsage).mockResolvedValueOnce(null);
    const publisher = new SubscriptionUsagePublisher({
      clearSnapshot: () => {},
      getClaudeUsage,
      getCodexUsage,
      onProcessExit: () => {},
      writeSnapshot: capture.writeSnapshot,
    });

    publisher.start();
    await publisher.readClaudeUsage(conversation.workspace ?? '');
    await publisher.readCodexUsage();
    const successfulSnapshot = capture.snapshots.at(-1);
    const successfulWriteCount = capture.snapshots.length;

    await publisher.readClaudeUsage(conversation.workspace ?? '');
    await publisher.readCodexUsage();

    expect(capture.snapshots).toHaveLength(successfulWriteCount);
    expect(capture.snapshots.at(-1)?.updatedAt).toBe(successfulSnapshot?.updatedAt);
    publisher.stop();
  });

  it('waits two minutes between completed background refreshes', async () => {
    vi.useFakeTimers();
    const capture = captureSnapshots();
    const getCodexUsage = vi.fn(async () => codexUsage);
    const publisher = new SubscriptionUsagePublisher({
      clearSnapshot: () => {},
      getClaudeUsage: async () => claudeUsage,
      getCodexUsage,
      initialRefreshDelayMs: 0,
      isDirectory: () => true,
      listConversations: async () => [conversation],
      onProcessExit: () => {},
      writeSnapshot: capture.writeSnapshot,
    });

    publisher.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(getCodexUsage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(119_999);
    expect(getCodexUsage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(getCodexUsage).toHaveBeenCalledTimes(2);
    publisher.stop();
  });

  it('notifies renderer listeners as soon as fresh provider values are published', async () => {
    const capture = captureSnapshots();
    const onClaudeUsage = vi.fn();
    const onCodexUsage = vi.fn();
    const publisher = new SubscriptionUsagePublisher({
      clearSnapshot: () => {},
      getClaudeUsage: async () => claudeUsage,
      getCodexUsage: async () => codexUsage,
      onClaudeUsage,
      onCodexUsage,
      onProcessExit: () => {},
      writeSnapshot: capture.writeSnapshot,
    });

    publisher.start();
    await publisher.readClaudeUsage(conversation.workspace ?? '');
    await publisher.readCodexUsage();

    expect(onClaudeUsage).toHaveBeenCalledWith(claudeUsage);
    expect(onCodexUsage).toHaveBeenCalledWith(codexUsage);
    publisher.stop();
  });

  it('prefers a Claude ACP workspace when no active conversation is known yet', async () => {
    vi.useFakeTimers();
    const capture = captureSnapshots();
    const getClaudeUsage = vi.fn(async () => claudeUsage);
    const publisher = new SubscriptionUsagePublisher({
      clearSnapshot: () => {},
      getClaudeUsage,
      getCodexUsage: async () => codexUsage,
      initialRefreshDelayMs: 0,
      isDirectory: () => true,
      listConversations: async () => [
        { ...conversation, id: 'newer-codex', backend: 'codex', modifiedAt: 20, workspace: 'C:\\codex-workspace' },
        conversation,
      ],
      onProcessExit: () => {},
      writeSnapshot: capture.writeSnapshot,
    });

    publisher.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();

    expect(getClaudeUsage).toHaveBeenCalledWith(conversation.workspace);
    publisher.stop();
  });

  it('removes the owned snapshot through the registered exit cleanup', () => {
    const capture = captureSnapshots();
    const clearSnapshot = vi.fn();
    let exitCleanup: (() => void) | undefined;
    const publisher = new SubscriptionUsagePublisher({
      clearSnapshot,
      onProcessExit: (cleanup) => {
        exitCleanup = cleanup;
      },
      writeSnapshot: capture.writeSnapshot,
    });

    publisher.start();
    exitCleanup?.();

    expect(clearSnapshot).toHaveBeenCalledWith(JSON.stringify(capture.snapshots[0]));
  });

  it('does not interrupt startup when the snapshot file cannot be written', () => {
    const logWarn = vi.fn();
    const publisher = new SubscriptionUsagePublisher({
      clearSnapshot: () => {},
      logWarn,
      onProcessExit: () => {},
      writeSnapshot: () => {
        throw new Error('disk unavailable');
      },
    });

    expect(() => publisher.start()).not.toThrow();
    expect(logWarn).toHaveBeenCalledWith('[SubscriptionUsagePublisher] Unable to publish usage snapshot');
    publisher.stop();
  });
});

describe('SubscriptionUsagePublisher Claude accounts', () => {
  const accounts = [
    { id: 'default', number: 1, label: 'Team', is_default: true, share_default_settings: true },
    { id: 'max', number: 2, label: 'Max', is_default: false, share_default_settings: true, config_dir: 'C:\\max' },
  ];
  const maxUsage: ClaudeUsageSnapshot = {
    session: { utilization: 7, resetsAt: 1_800_000_500 },
    weekly: { utilization: 12, resetsAt: 1_800_100_500 },
    updatedAt: 1_700_000_003_000,
    accountId: 'max',
  };

  const createPublisher = (options: {
    accountsList: typeof accounts;
    getClaudeUsage: (cwd: string, accountId?: string) => Promise<ClaudeUsageSnapshot | null>;
    onClaudeUsage?: (usage: ClaudeUsageSnapshot) => void;
  }) => {
    const capture = captureSnapshots();
    const publisher = new SubscriptionUsagePublisher({
      clearSnapshot: () => {},
      getClaudeAccounts: async () => options.accountsList,
      getClaudeUsage: options.getClaudeUsage,
      getCodexUsage: async () => codexUsage,
      initialRefreshDelayMs: 0,
      isDirectory: () => true,
      listConversations: async () => [
        conversation,
        { ...conversation, id: 'max-conversation', workspace: 'C:\\max-workspace', claudeAccountId: 'max' },
      ],
      now: () => new Date('2026-07-31T12:34:50.000Z'),
      onClaudeUsage: options.onClaudeUsage ?? (() => {}),
      onCodexUsage: () => {},
      onProcessExit: () => {},
      writeSnapshot: capture.writeSnapshot,
    });
    return { publisher, capture };
  };

  it('keeps the single-account snapshot shape when only one account exists', async () => {
    vi.useFakeTimers();
    const getClaudeUsage = vi.fn(async () => claudeUsage);
    const { publisher, capture } = createPublisher({ accountsList: accounts.slice(0, 1), getClaudeUsage });

    publisher.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();

    expect(capture.snapshots.at(-1)?.claudeAccounts).toBeUndefined();
    expect(getClaudeUsage).toHaveBeenCalledTimes(1);
    expect(getClaudeUsage.mock.calls[0]).toEqual(['C:\\private-workspace']);
    publisher.stop();
  });

  it('probes each account from its own conversation and keeps claude as the default account', async () => {
    vi.useFakeTimers();
    const getClaudeUsage = vi.fn(async (_cwd: string, accountId?: string) =>
      accountId === 'max' ? maxUsage : claudeUsage
    );
    const { publisher, capture } = createPublisher({ accountsList: accounts, getClaudeUsage });

    publisher.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();

    expect(getClaudeUsage).toHaveBeenCalledWith('C:\\max-workspace', 'max');
    const snapshot = capture.snapshots.at(-1)!;
    expect(snapshot.claude.session?.usedPercent).toBe(23);
    expect(snapshot.claudeAccounts?.map((account) => [account.number, account.session?.usedPercent])).toEqual([
      [1, 23],
      [2, 7],
    ]);
    publisher.stop();
  });

  it('tags account usage for renderer listeners and never overwrites the default account', async () => {
    const onClaudeUsage = vi.fn();
    const { publisher, capture } = createPublisher({
      accountsList: accounts,
      getClaudeUsage: async () => maxUsage,
      onClaudeUsage,
    });
    publisher.start();

    await publisher.readClaudeUsage('C:\\max-workspace', 'max');

    expect(onClaudeUsage).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'max' }));
    expect(capture.snapshots.at(-1)?.claude.state).toBe('loading');
    publisher.stop();
  });

  it('forwards the PTY launch context on both the default and the account probe paths', async () => {
    const getClaudeUsage = vi.fn(async (_cwd: string, accountId?: string) =>
      accountId === 'max' ? maxUsage : claudeUsage
    );
    const { publisher } = createPublisher({ accountsList: accounts, getClaudeUsage });
    const context = { conversationId: 'conversation-1', conversationName: 'Usage check' };

    await publisher.readClaudeUsage('C:\\workspace', undefined, context);
    await publisher.readClaudeUsage('C:\\workspace', 'default', context);
    await publisher.readClaudeUsage('C:\\max-workspace', 'max', context);
    await publisher.readClaudeUsage('C:\\max-workspace', 'max');

    expect(getClaudeUsage.mock.calls).toEqual([
      ['C:\\workspace', undefined, context],
      ['C:\\workspace', undefined, context],
      ['C:\\max-workspace', 'max', context],
      ['C:\\max-workspace', 'max'],
    ]);
    publisher.stop();
  });

  it('marks a failing account unavailable without touching the default account', async () => {
    const { publisher, capture } = createPublisher({
      accountsList: accounts,
      getClaudeUsage: async () => null,
    });
    publisher.start();

    await publisher.readClaudeUsage('C:\\max-workspace', 'max');

    expect(capture.snapshots.at(-1)?.claude.state).toBe('loading');
    publisher.stop();
  });
});
