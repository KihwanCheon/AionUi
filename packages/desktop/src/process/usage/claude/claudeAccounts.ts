/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Claude accounts as seen by the usage probes (personal fork). */
import { httpGet } from '@/common/adapter/httpBridge';
import type { ClaudeAccount } from '@/common/types/platform/claudeAccount';

const CACHE_TTL_MS = 30_000;
const listAccounts = httpGet<ClaudeAccount[]>('/api/claude-accounts');

let cache: { expiresAt: number; accounts: ClaudeAccount[] } | undefined;

/**
 * Accounts in shared order. A backend without the account routes, or any
 * failure, yields the previous list or an empty one (single-account behavior).
 */
export const getClaudeAccounts = async (now: number = Date.now()): Promise<ClaudeAccount[]> => {
  if (cache && cache.expiresAt > now) return cache.accounts;
  try {
    const accounts = await listAccounts.invoke();
    cache = { expiresAt: now + CACHE_TTL_MS, accounts: Array.isArray(accounts) ? accounts : [] };
  } catch {
    cache = { expiresAt: now + CACHE_TTL_MS, accounts: cache?.accounts ?? [] };
  }
  return cache.accounts;
};

export const resetClaudeAccountsCacheForTest = (): void => {
  cache = undefined;
};
