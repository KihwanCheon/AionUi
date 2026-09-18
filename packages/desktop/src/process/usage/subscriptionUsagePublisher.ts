/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { statSync } from 'node:fs';
import { ipcBridge } from '@/common';
import { subscriptionUsageBridge } from '@/common/platform/subscriptionUsageBridge';
import type { ClaudeUsageSnapshot } from '@/common/types/platform/claudeUsage';
import type { CodexUsageSnapshot } from '@/common/types/platform/codexUsage';
import type {
  ClaudeSubscriptionUsage,
  CodexSubscriptionUsage,
  SubscriptionUsageSnapshot,
  PtyLaunchContext,
} from '@/common/types/platform/subscriptionUsage';
import { getClaudeUsage } from './claude';
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
const CONVERSATION_LOOKUP_LIMIT = 10_000;

export type SubscriptionUsageConversation = {
  id: string;
  type: string;
  backend?: string;
  modifiedAt: number;
  workspace?: string;
  isHealthCheck: boolean;
};

type SubscriptionUsagePublisherOptions = {
  clearSnapshot?: (expectedContent: string | undefined) => void;
  getClaudeUsage?: (cwd: string, context?: PtyLaunchContext) => Promise<ClaudeUsageSnapshot | null>;
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

const defaultListConversations = async (): Promise<SubscriptionUsageConversation[]> => {
  const result = await ipcBridge.database.getUserConversations.invoke({ limit: CONVERSATION_LOOKUP_LIMIT });
  return (result.items ?? []).map((conversation) => {
    const extra = conversation.extra as { backend?: string; is_health_check?: boolean; workspace?: string } | undefined;
    return {
      id: conversation.id,
      type: conversation.type,
      backend: extra?.backend,
      modifiedAt: conversation.modified_at,
      workspace: extra?.workspace,
      isHealthCheck: extra?.is_health_check === true,
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
  readonly #getClaudeUsage: (cwd: string, context?: PtyLaunchContext) => Promise<ClaudeUsageSnapshot | null>;
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
  #codex: CodexSubscriptionUsage = createCodexProviderState('loading');
  #lastPublishedContent: string | undefined;
  #refreshInFlight = false;
  #started = false;
  #stopped = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: SubscriptionUsagePublisherOptions = {}) {
    this.#clearSnapshot =
      options.clearSnapshot ?? ((expectedContent) => void clearSubscriptionUsageSnapshot({ expectedContent }));
    this.#getClaudeUsage = options.getClaudeUsage ?? getClaudeUsage;
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
    this.#clearSnapshot(this.#lastPublishedContent);
  }

  noteActiveAcpConversation(conversationId: string): void {
    this.#activeConversationId = conversationId;
  }

  async readClaudeUsage(cwd: string, context?: PtyLaunchContext): Promise<ClaudeUsageSnapshot | null> {
    let usage: ClaudeUsageSnapshot | null;
    try {
      usage = context ? await this.#getClaudeUsage(cwd, context) : await this.#getClaudeUsage(cwd);
    } catch {
      this.#logWarn('[SubscriptionUsagePublisher] Claude usage refresh failed');
      usage = null;
    }

    if (usage) {
      this.#recordClaude(usage);
    } else {
      this.#markClaudeUnavailable();
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
    const snapshot = createSubscriptionUsageSnapshot(this.#claude, this.#codex, this.#now(), this.#loadingRetryMs);
    try {
      this.#lastPublishedContent = this.#writeSnapshot(snapshot);
    } catch {
      this.#logWarn('[SubscriptionUsagePublisher] Unable to publish usage snapshot');
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

    try {
      if (!this.#isRefreshReady()) return;

      const conversations = (await this.#listConversations())
        .filter((conversation) => conversation.type === 'acp' && !conversation.isHealthCheck)
        .toSorted((left, right) => right.modifiedAt - left.modifiedAt);
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
        this.#markClaudeUnavailable();
        this.#markCodexUnavailable();
        return;
      }

      this.#markCodexLoading();
      const refreshes: Promise<unknown>[] = [this.readCodexUsage()];
      const workspace = workspaceConversation?.workspace?.trim();
      if (workspace) {
        this.#markClaudeLoading();
        refreshes.push(this.readClaudeUsage(workspace));
      } else {
        this.#markClaudeUnavailable();
      }
      await Promise.all(refreshes);
    } catch {
      this.#logWarn('[SubscriptionUsagePublisher] Unable to resolve an ACP usage context');
    } finally {
      this.#refreshInFlight = false;
      const hasLoadingProvider = this.#claude.state === 'loading' || this.#codex.state === 'loading';
      this.#schedule(hasLoadingProvider ? this.#loadingRetryMs : this.#refreshIntervalMs);
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
