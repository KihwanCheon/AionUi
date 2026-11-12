/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { formatClaudeUsagePillPercentages } from '@/renderer/components/layout/Titlebar/ClaudeUsageIndicator';
import {
  getSubscriptionUsageTone,
  isSubscriptionUsageFresh,
  SUBSCRIPTION_USAGE_STALE_AFTER_MS,
} from '@/renderer/components/layout/Titlebar/subscriptionUsageTone';

describe('formatClaudeUsagePillPercentages', () => {
  it('shows the five-hour and weekly percentages together', () => {
    expect(formatClaudeUsagePillPercentages(31, 24)).toBe('31% · 24%');
  });

  it('keeps the available percentage when only one quota reports it', () => {
    expect(formatClaudeUsagePillPercentages(undefined, 24)).toBe('24%');
    expect(formatClaudeUsagePillPercentages(0.31, undefined)).toBe('31%');
  });

  it('does not reinterpret an exact one-percent CLI value as a full ratio', () => {
    expect(formatClaudeUsagePillPercentages(1, 30, 'percent', 'percent')).toBe('1% · 30%');
  });

  it('keeps explicit ratio values compatible with ACP rate-limit events', () => {
    expect(formatClaudeUsagePillPercentages(1, 0.3, 'ratio', 'ratio')).toBe('100% · 30%');
  });

  it('shows an exact over-limit percentage without clamping the label', () => {
    expect(formatClaudeUsagePillPercentages(103, 37, 'percent', 'percent')).toBe('103% · 37%');
  });

  it('returns undefined when neither quota reports a percentage', () => {
    expect(formatClaudeUsagePillPercentages(undefined, undefined)).toBeUndefined();
  });
});

describe('subscription usage freshness', () => {
  it('hides a snapshot when it reaches five minutes old', () => {
    const updatedAt = 1_700_000_000_000;

    expect(isSubscriptionUsageFresh(updatedAt, updatedAt + SUBSCRIPTION_USAGE_STALE_AFTER_MS - 1)).toBe(true);
    expect(isSubscriptionUsageFresh(updatedAt, updatedAt + SUBSCRIPTION_USAGE_STALE_AFTER_MS)).toBe(false);
  });

  it('rejects missing or invalid timestamps', () => {
    expect(isSubscriptionUsageFresh(0, 1)).toBe(false);
    expect(isSubscriptionUsageFresh(Number.NaN, 1)).toBe(false);
  });
});

describe('getSubscriptionUsageTone', () => {
  it.each([
    [79, 'normal'],
    [80, 'warning'],
    [99, 'warning'],
    [100, 'limit'],
    [103, 'limit'],
  ] as const)('classifies %s percent as %s', (usedPercent, expected) => {
    expect(getSubscriptionUsageTone(usedPercent)).toBe(expected);
  });

  it('uses the highest available finite percentage', () => {
    expect(getSubscriptionUsageTone(97, 39)).toBe('warning');
    expect(getSubscriptionUsageTone(Number.NaN, undefined, 15)).toBe('normal');
  });
});
