/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { statSync } from 'node:fs';
import { ipcBridge } from '@/common';
import { subscriptionUsageBridge } from '@/common/platform/subscriptionUsageBridge';
import { DEFAULT_CLAUDE_ACCOUNT_ID, type ClaudeAccount } from '@/common/types/platform/claudeAccount';
import type { ClaudeUsageSnapshot } from '@/common/types/platform/claudeUsage';
import type { CodexUsageSnapshot } from '@/common/types/platform/codexUsage';
import type {
  ClaudeAccountSubscriptionUsage,
  ClaudeSubscriptionUsage,
  CodexSubscriptionUsage,
  SubscriptionUsageSnapshot,
} from '@/common/types/platform/subscriptionUsage';
import { getClaudeUsage } from './claude';
import { getClaudeAccounts } from './claude/claudeAccounts';
import { getCodexUsage } from './codex';
import {
  createClaudeProviderState,
  createCodexProviderState,
  createSubscriptionUsageSnapshot,
  normalizeClaudeSubscriptionUsage,
  normalizeCodexSubscriptionUsage,
} from './snapshot';
import { clearSubscriptionUsageSnapshot, writeSubscriptionUsageSnapshot } from './subscriptionUsageFile';

const DEFAULT_LOADING_RETRY_MS = 2_000;
const DEFAULT_INITIAL_REFRESH_DELAY_MS = 2_000;
const DEFAULT_REFRESH_INTERVAL_MS = 120_000;
const CLAUDE_FAILURE_RETRY_MS = 30_000;
const CONVERSATION_LOOKUP_LIMIT = 10_000;

export type SubscriptionUsageConversation = {
  id: string;
  type: string;
  backend?: string;
  modifiedAt: number;
  workspace?: string;
  isHealthCheck: boolean;
  /** Fork: non-default Claude account bound to the conversation. */
  claudeAccountId?: string;
};

type SubscriptionUsagePublisherOptions = {
  clearSnapshot?: (expectedContent: string | undefined) => void;
  getClaudeUsage?: (cwd: string, accountId?: string) => Promise<ClaudeUsageSnapshot | null>;
  getClaudeAccounts?: () => Promise<ClaudeAccount[]>;
  getCodexUsage?: () => Promise<CodexUsageSnapshot | null>;
  initialRefreshDelayMs?: number;
  isDirectory?: (path: string) => boolean;
  isRefreshReady?: () => boolean;
  listConversations?: () => Promise<SubscriptionUsageConversation[]>;
  loadingRetryMs?: number;
  logWarn?: (message: string) => void;
  now?: () => Date;
  onClaudeUsage?: (usage: ClaudeUsageSnapshot) => void;
  onCodexUsage?: (usage: CodexUsageSnapshot) => void;
  onProcessExit?: (cleanup: () => void) => void;
  refreshIntervalMs?: number;
  writeSnapshot?: (snapshot: SubscriptionUsageSnapshot) => string;
};

type RefreshJob = {
  read: () => Promise<unknown>;
  failureDelayMs: number;
  timer?: ReturnType<typeof setTimeout>;
};

const defaultListConversations = async (): Promise<SubscriptionUsageConversation[]> => {
  const result = await ipcBridge.database.getUserConversations.invoke({ limit: CONVERSATION_LOOKUP_LIMIT });
  return (result.items ?? []).map((conversation) => {
    const extra = conversation.extra as
      | { backend?: string; is_health_check?: boolean; workspace?: string; claude_account_id?: string }
      | undefined;
    return {
      id: conversation.id,
      type: conversation.type,
      backend: extra?.backend,
      modifiedAt: conversation.modified_at,
      workspace: extra?.workspace,
      isHealthCheck: extra?.is_health_check === true,
      claudeAccountId: extra?.claude_account_id,
    };
  });
};

const defaultIsDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const updatedAtValue = (value: string | null): number => {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export class SubscriptionUsagePublisher {
  readonly #clearSnapshot: (expectedContent: string | undefined) => void;
  readonly #getClaudeUsage: (cwd: string, accountId?: string) => Promise<ClaudeUsageSnapshot | null>;
  readonly #getClaudeAccounts: () => Promise<ClaudeAccount[]>;
  readonly #getCodexUsage: () => Promise<CodexUsageSnapshot | null>;
  readonly #initialRefreshDelayMs: number;
  readonly #isDirectory: (path: string) => boolean;
  readonly #isRefreshReady: () => boolean;
  readonly #listConversations: () => Promise<SubscriptionUsageConversation[]>;
  readonly #loadingRetryMs: number;
  readonly #logWarn: (message: string) => void;
  readonly #now: () => Date;
  readonly #onClaudeUsage: (usage: ClaudeUsageSnapshot) => void;
  readonly #onCodexUsage: (usage: CodexUsageSnapshot) => void;
  readonly #onProcessExit: (cleanup: () => void) => void;
  readonly #refreshIntervalMs: number;
  readonly #writeSnapshot: (snapshot: SubscriptionUsageSnapshot) => string;

  #activeConversationId: string | undefined;
  #claude: ClaudeSubscriptionUsage = createClaudeProviderState('loading');
  // Fork: non-default Claude accounts. Both stay empty with a single account.
  #accounts: ClaudeAccount[] = [];
  #claudeAccounts = new Map<string, ClaudeSubscriptionUsage>();
  #codex: CodexSubscriptionUsage = createCodexProviderState('loading');
  #lastPublishedContent: string | undefined;
  #refreshInFlight = false;
  #started = false;
  #stopped = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #jobs = new Map<string, RefreshJob>();

  constructor(options: SubscriptionUsagePublisherOptions = {}) {
    this.#clearSnapshot =
      options.clearSnapshot ?? ((expectedContent) => void clearSubscriptionUsageSnapshot({ expectedContent }));
    this.#getClaudeUsage = options.getClaudeUsage ?? getClaudeUsage;
    this.#getClaudeAccounts = options.getClaudeAccounts ?? getClaudeAccounts;
    this.#getCodexUsage = options.getCodexUsage ?? getCodexUsage;
    this.#initialRefreshDelayMs = options.initialRefreshDelayMs ?? DEFAULT_INITIAL_REFRESH_DELAY_MS;
    this.#isDirectory = options.isDirectory ?? defaultIsDirectory;
    this.#isRefreshReady = options.isRefreshReady ?? (() => true);
    this.#listConversations = options.listConversations ?? defaultListConversations;
    this.#loadingRetryMs = options.loadingRetryMs ?? DEFAULT_LOADING_RETRY_MS;
    this.#logWarn = options.logWarn ?? console.warn;
    this.#now = options.now ?? (() => new Date());
    this.#onClaudeUsage = options.onClaudeUsage ?? subscriptionUsageBridge.claudeChanged.emit;
    this.#onCodexUsage = options.onCodexUsage ?? subscriptionUsageBridge.codexChanged.emit;
    this.#onProcessExit = options.onProcessExit ?? ((cleanup) => process.once('exit', cleanup));
    this.#refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.#writeSnapshot = options.writeSnapshot ?? writeSubscriptionUsageSnapshot;
  }

  start(): void {
    if (this.#started || this.#stopped) return;
    this.#started = true;
    this.#onProcessExit(() => this.stop());
    this.#publish();
    this.#schedule(this.#initialRefreshDelayMs);
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#reconcileJobs(new Map());
    this.#clearSnapshot(this.#lastPublishedContent);
  }

  noteActiveAcpConversation(conversationId: string): void {
    this.#activeConversationId = conversationId;
  }

  async readClaudeUsage(cwd: string, accountId?: string): Promise<ClaudeUsageSnapshot | null> {
    if (accountId && accountId !== DEFAULT_CLAUDE_ACCOUNT_ID) {
      return this.#readClaudeAccountUsage(cwd, accountId);
    }
    let usage: ClaudeUsageSnapshot | null;
    try {
      usage = await this.#getClaudeUsage(cwd);
    } catch {
      this.#logWarn('[SubscriptionUsagePublisher] Claude usage refresh failed accountId=default');
      usage = null;
    }

    if (this.#stopped) return usage;
    if (usage) {
      this.#recordClaude(usage);
    } else {
      this.#markClaudeUnavailable();
    }
    return usage;
  }

  async #readClaudeAccountUsage(cwd: string, accountId: string): Promise<ClaudeUsageSnapshot | null> {
    let usage: ClaudeUsageSnapshot | null;
    try {
      usage = await this.#getClaudeUsage(cwd, accountId);
    } catch {
      this.#logWarn(`[SubscriptionUsagePublisher] Claude account usage refresh failed accountId=${accountId}`);
      usage = null;
    }

    if (this.#stopped) return usage;
    const current = this.#claudeAccounts.get(accountId);
    const normalized = usage ? normalizeClaudeSubscriptionUsage(usage, this.#now().getTime()) : null;
    if (!usage || !normalized) {
      if (current?.state !== 'ready') {
        this.#claudeAccounts.set(accountId, createClaudeProviderState('unavailable'));
        this.#publish();
      }
      return usage;
    }
    if (current?.state === 'ready' && updatedAtValue(current.updatedAt) >= updatedAtValue(normalized.updatedAt)) {
      return usage;
    }
    this.#claudeAccounts.set(accountId, normalized);
    this.#publish();
    try {
      this.#onClaudeUsage({ ...usage, accountId });
    } catch {
      this.#logWarn('[SubscriptionUsagePublisher] Unable to notify Claude usage listeners');
    }
    return usage;
  }

  async readCodexUsage(): Promise<CodexUsageSnapshot | null> {
    let usage: CodexUsageSnapshot | null;
    try {
      usage = await this.#getCodexUsage();
    } catch {
      this.#logWarn('[SubscriptionUsagePublisher] Codex usage refresh failed');
      usage = null;
    }

    if (this.#stopped) return usage;
    if (usage) {
      this.#recordCodex(usage);
    } else {
      this.#markCodexUnavailable();
    }
    return usage;
  }

  #recordClaude(usage: ClaudeUsageSnapshot): void {
    const normalized = normalizeClaudeSubscriptionUsage(usage, this.#now().getTime());
    if (!normalized) {
      this.#markClaudeUnavailable();
      return;
    }
    if (
      this.#claude.state === 'ready' &&
      updatedAtValue(this.#claude.updatedAt) >= updatedAtValue(normalized.updatedAt)
    ) {
      return;
    }
    this.#claude = normalized;
    this.#publish();
    try {
      this.#onClaudeUsage(usage);
    } catch {
      this.#logWarn('[SubscriptionUsagePublisher] Unable to notify Claude usage listeners');
    }
  }

  #recordCodex(usage: CodexUsageSnapshot): void {
    const normalized = normalizeCodexSubscriptionUsage(usage, this.#now().getTime());
    if (!normalized) {
      this.#markCodexUnavailable();
      return;
    }
    if (
      this.#codex.state === 'ready' &&
      updatedAtValue(this.#codex.updatedAt) >= updatedAtValue(normalized.updatedAt)
    ) {
      return;
    }
    this.#codex = normalized;
    this.#publish();
    try {
      this.#onCodexUsage(usage);
    } catch {
      this.#logWarn('[SubscriptionUsagePublisher] Unable to notify Codex usage listeners');
    }
  }

  #markClaudeLoading(): void {
    if (this.#claude.state === 'ready' || this.#claude.state === 'loading') return;
    this.#claude = createClaudeProviderState('loading');
    this.#publish();
  }

  #markCodexLoading(): void {
    if (this.#codex.state === 'ready' || this.#codex.state === 'loading') return;
    this.#codex = createCodexProviderState('loading');
    this.#publish();
  }

  #markClaudeUnavailable(): void {
    if (this.#claude.state === 'ready' || this.#claude.state === 'unavailable') return;
    this.#claude = createClaudeProviderState('unavailable');
    this.#publish();
  }

  #markCodexUnavailable(): void {
    if (this.#codex.state === 'ready' || this.#codex.state === 'unavailable') return;
    this.#codex = createCodexProviderState('unavailable');
    this.#publish();
  }

  #publish(): void {
    if (!this.#started || this.#stopped) return;
    const snapshot = createSubscriptionUsageSnapshot(
      this.#claude,
      this.#codex,
      this.#now(),
      this.#loadingRetryMs,
      this.#accountUsages()
    );
    try {
      this.#lastPublishedContent = this.#writeSnapshot(snapshot);
    } catch {
      this.#logWarn('[SubscriptionUsagePublisher] Unable to publish usage snapshot');
    }
  }

  /** Every account in shared order, or `undefined` with a single account. */
  #accountUsages(): ClaudeAccountSubscriptionUsage[] | undefined {
    if (this.#accounts.length < 2) return undefined;
    return this.#accounts.map((account) => ({
      ...(account.id === DEFAULT_CLAUDE_ACCOUNT_ID
        ? this.#claude
        : (this.#claudeAccounts.get(account.id) ?? createClaudeProviderState('loading'))),
      id: account.id,
      number: account.number,
      label: account.label,
    }));
  }

  async #refreshClaudeAccounts(): Promise<void> {
    try {
      this.#accounts = await this.#getClaudeAccounts();
    } catch {
      // A transient settings read failure must not remove known accounts.
      this.#logWarn('[SubscriptionUsagePublisher] Unable to refresh Claude accounts');
    }
  }

  // Each provider/account owns its next refresh. A slow PTY must not hold
  // the other accounts (or Codex) behind a shared Promise.all barrier.
  #reconcileJobs(requested: Map<string, RefreshJob>): void {
    for (const [key, job] of this.#jobs) {
      if (requested.has(key)) continue;
      if (job.timer) clearTimeout(job.timer);
      this.#jobs.delete(key);
    }
    if (this.#stopped) return;
    for (const [key, job] of requested) {
      const existing = this.#jobs.get(key);
      if (existing) existing.read = job.read;
      else {
        this.#jobs.set(key, job);
        void this.#runJob(key, job);
      }
    }
  }

  async #runJob(key: string, job: RefreshJob): Promise<void> {
    if (this.#stopped || this.#jobs.get(key) !== job) return;
    let delay = this.#loadingRetryMs;
    try {
      if (this.#isRefreshReady()) {
        delay = job.failureDelayMs;
        if (await job.read()) delay = this.#refreshIntervalMs;
      }
    } catch {
      this.#logWarn(`[SubscriptionUsagePublisher] Usage refresh failed provider=${key}`);
    } finally {
      if (!this.#stopped && this.#jobs.get(key) === job) {
        job.timer = setTimeout(() => void this.#runJob(key, job), delay);
        job.timer.unref?.();
      }
    }
  }

  #schedule(delayMs: number): void {
    if (this.#stopped) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#refresh();
    }, delayMs);
    this.#timer.unref?.();
  }

  async #refresh(): Promise<void> {
    if (this.#stopped || this.#refreshInFlight) return;
    this.#refreshInFlight = true;
    let nextDelay = this.#loadingRetryMs;

    try {
      if (!this.#isRefreshReady()) return;

      await this.#refreshClaudeAccounts();
      const conversations = (await this.#listConversations())
        .filter((conversation) => conversation.type === 'acp' && !conversation.isHealthCheck)
        .toSorted((left, right) => right.modifiedAt - left.modifiedAt);
      if (this.#stopped) return;
      nextDelay = this.#refreshIntervalMs;
      const activeConversation = conversations.find((conversation) => conversation.id === this.#activeConversationId);
      const remainingConversations = conversations.filter((conversation) => conversation !== activeConversation);
      const claudeConversations = remainingConversations.filter((conversation) => conversation.backend === 'claude');
      const otherConversations = remainingConversations.filter((conversation) => conversation.backend !== 'claude');
      const preferredConversations = [
        ...(activeConversation ? [activeConversation] : []),
        ...claudeConversations,
        ...otherConversations,
      ];
      const workspaceConversation = preferredConversations.find((conversation) => {
        const workspace = conversation.workspace?.trim();
        return Boolean(workspace && this.#isDirectory(workspace));
      });

      if (conversations.length === 0) {
        this.#reconcileJobs(new Map());
        this.#markClaudeUnavailable();
        this.#markCodexUnavailable();
        return;
      }

      this.#markCodexLoading();
      const jobs = new Map<string, RefreshJob>([
        ['codex', { read: () => this.readCodexUsage(), failureDelayMs: this.#refreshIntervalMs }],
      ]);
      const workspace = workspaceConversation?.workspace?.trim();
      if (workspace) {
        this.#markClaudeLoading();
        jobs.set('claude:default', {
          read: () => this.readClaudeUsage(workspace),
          failureDelayMs: CLAUDE_FAILURE_RETRY_MS,
        });
      } else {
        this.#markClaudeUnavailable();
      }
      // Fork: each non-default account is probed from its own most recent conversation.
      for (const account of this.#accounts) {
        if (account.id === DEFAULT_CLAUDE_ACCOUNT_ID) continue;
        const accountWorkspace = preferredConversations
          .filter((conversation) => conversation.claudeAccountId === account.id)
          .map((conversation) => conversation.workspace?.trim())
          .find((candidate): candidate is string => Boolean(candidate && this.#isDirectory(candidate)));
        if (accountWorkspace)
          jobs.set(`claude:${account.id}`, {
            read: () => this.readClaudeUsage(accountWorkspace, account.id),
            failureDelayMs: CLAUDE_FAILURE_RETRY_MS,
          });
      }
      this.#reconcileJobs(jobs);
      this.#publish();
    } catch {
      this.#logWarn('[SubscriptionUsagePublisher] Unable to resolve an ACP usage context');
    } finally {
      this.#refreshInFlight = false;
      this.#schedule(nextDelay);
    }
  }
}

let sharedPublisher: SubscriptionUsagePublisher | undefined;

export const getSubscriptionUsagePublisher = (): SubscriptionUsagePublisher => {
  sharedPublisher ??= new SubscriptionUsagePublisher({
    isRefreshReady: () => {
      const backendPort = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
      return typeof backendPort === 'number' && backendPort > 0;
    },
  });
  return sharedPublisher;
};
