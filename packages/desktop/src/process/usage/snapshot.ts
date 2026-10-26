/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ClaudeUsageSnapshot, ClaudeUtilizationUnit } from '@/common/types/platform/claudeUsage';
import type { CodexUsageSnapshot } from '@/common/types/platform/codexUsage';
import type {
  ClaudeAccountSubscriptionUsage,
  ClaudeSubscriptionUsage,
  CodexSubscriptionUsage,
  ProviderUsageState,
  SubscriptionUsageSnapshot,
  SubscriptionUsageState,
  SubscriptionUsageWindow,
} from '@/common/types/platform/subscriptionUsage';

const isoFromMilliseconds = (value: number): string | null => {
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const isoFromEpoch = (value: number | undefined): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return isoFromMilliseconds(value < 1e12 ? value * 1000 : value);
};

type UsageValueUnit = ClaudeUtilizationUnit | 'auto';

export const normalizeUsedPercent = (value: number | undefined, unit: UsageValueUnit = 'auto'): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const percent = unit === 'ratio' ? value * 100 : unit === 'percent' ? value : value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent)));
};

const normalizeClaudeWindow = (
  value: ClaudeUsageSnapshot['session'] | ClaudeUsageSnapshot['weekly']
): SubscriptionUsageWindow | null => {
  const usedPercent = normalizeUsedPercent(value?.utilization, value?.utilizationUnit ?? 'auto');
  if (usedPercent === null) return null;
  return {
    usedPercent,
    resetsAt: isoFromEpoch(value?.resetsAt),
  };
};

export const normalizeClaudeSubscriptionUsage = (
  usage: ClaudeUsageSnapshot,
  fallbackUpdatedAt: number
): ClaudeSubscriptionUsage | null => {
  const session = normalizeClaudeWindow(usage.session);
  const weekly = normalizeClaudeWindow(usage.weekly);
  if (!session && !weekly) return null;

  return {
    state: 'ready',
    updatedAt: isoFromMilliseconds(usage.updatedAt) ?? isoFromMilliseconds(fallbackUpdatedAt),
    session,
    weekly,
  };
};

export const normalizeCodexSubscriptionUsage = (
  usage: CodexUsageSnapshot,
  fallbackUpdatedAt: number
): CodexSubscriptionUsage | null => {
  const usedPercent = normalizeUsedPercent(usage.weekly.usedPercent, 'percent');
  if (usedPercent === null) return null;

  const windowDurationMins = usage.weekly.windowDurationMins;
  return {
    state: 'ready',
    updatedAt: isoFromMilliseconds(usage.updatedAt) ?? isoFromMilliseconds(fallbackUpdatedAt),
    weekly: {
      usedPercent,
      resetsAt: isoFromEpoch(usage.weekly.resetsAt),
      windowDurationMins:
        typeof windowDurationMins === 'number' && Number.isFinite(windowDurationMins) && windowDurationMins > 0
          ? windowDurationMins
          : null,
    },
    limitReached: usage.limitReached,
  };
};

export const createClaudeProviderState = (state: ProviderUsageState): ClaudeSubscriptionUsage => ({
  state,
  updatedAt: null,
  session: null,
  weekly: null,
});

export const createCodexProviderState = (state: ProviderUsageState): CodexSubscriptionUsage => ({
  state,
  updatedAt: null,
  weekly: null,
  limitReached: false,
});

const deriveState = (claude: ClaudeSubscriptionUsage, codex: CodexSubscriptionUsage): SubscriptionUsageState => {
  const readyCount = Number(claude.state === 'ready') + Number(codex.state === 'ready');
  if (readyCount === 2) return 'ready';
  if (readyCount === 1) return 'partial';
  return claude.state === 'loading' || codex.state === 'loading' ? 'loading' : 'unavailable';
};

export const createSubscriptionUsageSnapshot = (
  claude: ClaudeSubscriptionUsage,
  codex: CodexSubscriptionUsage,
  generatedAt: Date,
  loadingRetryAfterMs: number,
  claudeAccounts?: ClaudeAccountSubscriptionUsage[]
): SubscriptionUsageSnapshot => {
  const updatedAt = [claude.updatedAt, codex.updatedAt]
    .filter((value): value is string => Boolean(value))
    .toSorted()
    .at(-1);
  const state = deriveState(claude, codex);

  return {
    schemaVersion: 1,
    state,
    generatedAt: generatedAt.toISOString(),
    updatedAt: updatedAt ?? null,
    retryAfterMs: claude.state === 'loading' || codex.state === 'loading' ? loadingRetryAfterMs : null,
    claude,
    codex,
    // Fork: additive only with two or more Claude accounts; schemaVersion stays 1.
    ...(claudeAccounts && claudeAccounts.length >= 2 ? { claudeAccounts } : {}),
  };
};
