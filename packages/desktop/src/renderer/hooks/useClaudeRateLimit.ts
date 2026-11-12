/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore } from 'react';
import { DEFAULT_CLAUDE_ACCOUNT_ID } from '@/common/types/platform/claudeAccount';
import type {
  ClaudeRateLimitInfo,
  ClaudeRateLimitType,
  ClaudeUsageSnapshot,
} from '@/common/types/platform/claudeUsage';

/**
 * Claude subscription rate-limit info, forwarded from the Claude Agent SDK
 * (`rate_limit_event`) by the claude-agent-acp adapter (>= 0.55.0) inside the
 * ACP `usage_update._meta["_claude/rateLimit"]`, then relayed verbatim through
 * AionCore's `acp_context_usage` stream event. Keys stay in the SDK's original
 * camelCase (the stream path is not snake_case-normalized).
 *
 * Only subscription (claude.ai Pro/Max) auth on the `claude` ACP backend emits
 * this; API-key paths never produce it.
 */
export type { ClaudeRateLimitInfo, ClaudeRateLimitType, ClaudeUsageSnapshot };

export type ClaudeRateLimitState = {
  /** 5-hour rolling window — matches `/usage`'s "Current session". */
  session?: ClaudeRateLimitInfo;
  /** 7-day window (all models) — matches `/usage`'s "Current week". */
  weekly?: ClaudeRateLimitInfo;
  /** Timestamp of the last update, or 0 if nothing received yet. */
  updatedAt: number;
};

// Module-level stores keyed by Claude account, then by rateLimitType, so the
// latest value for each window survives component remounts (the titlebar widget
// can unmount/remount freely). Fork: one store per account; a single-account
// setup only ever uses the default key.
type AccountStore = {
  windows: Map<ClaudeRateLimitType, ClaudeRateLimitInfo>;
  updatedAt: number;
  snapshot: ClaudeRateLimitState;
};

const stores = new Map<string, AccountStore>();
const listeners = new Set<() => void>();
const EMPTY_STATE: ClaudeRateLimitState = { updatedAt: 0 };
// Bumped on every store update so a multi-account reader re-renders.
let storesVersion = 0;

const WEEKLY_PRIORITY: ClaudeRateLimitType[] = [
  'seven_day',
  'seven_day_overage_included',
  'seven_day_opus',
  'seven_day_sonnet',
  'overage',
];

const accountKey = (accountId: string | undefined): string => accountId || DEFAULT_CLAUDE_ACCOUNT_ID;

const storeFor = (key: string): AccountStore => {
  let store = stores.get(key);
  if (!store) {
    store = { windows: new Map(), updatedAt: 0, snapshot: EMPTY_STATE };
    stores.set(key, store);
  }
  return store;
};

const derive = (store: AccountStore): ClaudeRateLimitState => ({
  session: store.windows.get('five_hour'),
  weekly: WEEKLY_PRIORITY.map((key) => store.windows.get(key)).find(Boolean),
  updatedAt: store.updatedAt,
});

const mergeRateLimit = (store: AccountStore, info: ClaudeRateLimitInfo | undefined): boolean => {
  if (!info?.rateLimitType) return false;
  store.windows.set(info.rateLimitType, { ...store.windows.get(info.rateLimitType), ...info });
  return true;
};

const publishSnapshot = (store: AccountStore, nextUpdatedAt: number): void => {
  store.updatedAt = nextUpdatedAt;
  // Cached snapshot kept referentially stable between updates so useSyncExternalStore
  // does not loop (getSnapshot must return the same reference when nothing changed).
  store.snapshot = derive(store);
  storesVersion += 1;
  for (const listener of listeners) listener();
};

/**
 * Feed a rate-limit info object into the default account's store. Called from
 * the ACP message stream handler when `_meta["_claude/rateLimit"]` is present.
 */
export const pushClaudeRateLimit = (info: ClaudeRateLimitInfo | undefined | null, accountId?: string): void => {
  const store = storeFor(accountKey(accountId));
  if (!mergeRateLimit(store, info ?? undefined)) return;
  publishSnapshot(store, Date.now());
};

/** Merge the account-wide snapshot returned by the desktop Claude usage probe. */
export const pushClaudeUsageSnapshot = (usage: ClaudeUsageSnapshot | undefined | null): void => {
  if (!usage) return;
  const store = storeFor(accountKey(usage.accountId));
  const sessionChanged = mergeRateLimit(store, usage.session);
  const weeklyChanged = mergeRateLimit(store, usage.weekly);
  if (!sessionChanged && !weeklyChanged) return;
  publishSnapshot(store, usage.updatedAt);
};

const subscribe = (onChange: () => void): (() => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};

/** Non-reactive read of the current state, for tests and non-React consumers. */
export const getClaudeRateLimitSnapshot = (accountId?: string): ClaudeRateLimitState =>
  stores.get(accountKey(accountId))?.snapshot ?? EMPTY_STATE;

/** Subscribe to the latest Claude subscription usage/limit state of one account (default account by default). */
export const useClaudeRateLimit = (accountId?: string): ClaudeRateLimitState => {
  const getSnapshot = (): ClaudeRateLimitState => getClaudeRateLimitSnapshot(accountId);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

const getStoresVersion = (): number => storesVersion;

/** Fork: latest state of several Claude accounts, in the given order. */
export const useClaudeRateLimits = (accountIds: readonly string[]): ClaudeRateLimitState[] => {
  useSyncExternalStore(subscribe, getStoresVersion, getStoresVersion);
  return accountIds.map((accountId) => getClaudeRateLimitSnapshot(accountId));
};
