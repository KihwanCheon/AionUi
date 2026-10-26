/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type SubscriptionUsageState = 'loading' | 'ready' | 'partial' | 'unavailable';

export type ProviderUsageState = 'loading' | 'ready' | 'unavailable';

export type SubscriptionUsageWindow = {
  usedPercent: number;
  resetsAt: string | null;
};

export type ClaudeSubscriptionUsage = {
  state: ProviderUsageState;
  updatedAt: string | null;
  session: SubscriptionUsageWindow | null;
  weekly: SubscriptionUsageWindow | null;
};

export type CodexSubscriptionUsage = {
  state: ProviderUsageState;
  updatedAt: string | null;
  weekly:
    | (SubscriptionUsageWindow & {
        windowDurationMins: number | null;
      })
    | null;
  limitReached: boolean;
};

export type SubscriptionUsageSnapshot = {
  schemaVersion: 1;
  state: SubscriptionUsageState;
  generatedAt: string;
  updatedAt: string | null;
  retryAfterMs: number | null;
  claude: ClaudeSubscriptionUsage;
  codex: CodexSubscriptionUsage;
  /**
   * Fork: every Claude account in shared order, present only with two or more
   * accounts. `claude` above always remains the default account.
   */
  claudeAccounts?: ClaudeAccountSubscriptionUsage[];
};

export type ClaudeAccountSubscriptionUsage = ClaudeSubscriptionUsage & {
  id: string;
  number: number;
  label: string;
};
