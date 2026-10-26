/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  createClaudeProviderState,
  createCodexProviderState,
  createSubscriptionUsageSnapshot,
  normalizeClaudeSubscriptionUsage,
  normalizeCodexSubscriptionUsage,
  normalizeUsedPercent,
} from '@process/usage/snapshot';

describe('subscription usage normalization', () => {
  it('normalizes Claude ratios and reset epochs for external consumers', () => {
    expect(
      normalizeClaudeSubscriptionUsage(
        {
          session: { utilization: 0.23, resetsAt: 1_800_000_000 },
          weekly: { utilization: 41, resetsAt: 1_800_000_000_000 },
          updatedAt: 1_700_000_000_000,
        },
        1
      )
    ).toEqual({
      state: 'ready',
      updatedAt: new Date(1_700_000_000_000).toISOString(),
      session: {
        usedPercent: 23,
        resetsAt: new Date(1_800_000_000_000).toISOString(),
      },
      weekly: {
        usedPercent: 41,
        resetsAt: new Date(1_800_000_000_000).toISOString(),
      },
    });
  });

  it('serializes unknown Codex reset and duration values as null', () => {
    expect(
      normalizeCodexSubscriptionUsage(
        {
          weekly: { usedPercent: 18 },
          limitReached: false,
          updatedAt: 1_700_000_000_000,
        },
        1
      )
    ).toMatchObject({
      weekly: {
        usedPercent: 18,
        resetsAt: null,
        windowDurationMins: null,
      },
    });
  });

  it('keeps exact one-percent values from Claude CLI and Codex app-server as one percent', () => {
    const claude = normalizeClaudeSubscriptionUsage(
      {
        session: { utilization: 1, utilizationUnit: 'percent' },
        updatedAt: 1_700_000_000_000,
      },
      1
    );
    const codex = normalizeCodexSubscriptionUsage(
      {
        weekly: { usedPercent: 1 },
        limitReached: false,
        updatedAt: 1_700_000_000_000,
      },
      1
    );

    expect(claude?.session?.usedPercent).toBe(1);
    expect(codex?.weekly?.usedPercent).toBe(1);
  });

  it('still converts explicit ratio values to percentages', () => {
    expect(normalizeUsedPercent(1, 'ratio')).toBe(100);
    expect(normalizeUsedPercent(0.01, 'ratio')).toBe(1);
  });

  it('rejects unusable provider values and clamps percentages to the public range', () => {
    expect(normalizeUsedPercent(Number.NaN)).toBeNull();
    expect(normalizeUsedPercent(4_000)).toBe(100);
    expect(
      normalizeClaudeSubscriptionUsage(
        {
          session: { utilization: Number.NaN },
          updatedAt: 1,
        },
        1
      )
    ).toBeNull();
  });
});

describe('subscription usage state derivation', () => {
  const now = new Date('2026-07-31T12:34:50.000Z');

  it('reports loading with the consumer retry interval before either provider is ready', () => {
    const snapshot = createSubscriptionUsageSnapshot(
      createClaudeProviderState('loading'),
      createCodexProviderState('loading'),
      now,
      2_000
    );

    expect(snapshot.state).toBe('loading');
    expect(snapshot.updatedAt).toBeNull();
    expect(snapshot.retryAfterMs).toBe(2_000);
  });

  it('reports partial while one provider is ready', () => {
    const claude = {
      ...createClaudeProviderState('ready'),
      updatedAt: '2026-07-31T12:34:56.000Z',
    };
    const snapshot = createSubscriptionUsageSnapshot(claude, createCodexProviderState('loading'), now, 2_000);

    expect(snapshot.state).toBe('partial');
  });

  it('reports unavailable after both providers finish without data', () => {
    const snapshot = createSubscriptionUsageSnapshot(
      createClaudeProviderState('unavailable'),
      createCodexProviderState('unavailable'),
      now,
      2_000
    );

    expect(snapshot.state).toBe('unavailable');
    expect(snapshot.retryAfterMs).toBeNull();
  });
});

describe('subscription usage Claude accounts', () => {
  const now = new Date('2026-07-31T12:34:50.000Z');
  const accountUsage = (id: string, number: number) => ({
    ...createClaudeProviderState('unavailable'),
    id,
    number,
    label: id,
  });

  it('omits the account list for a single account so the published shape is unchanged', () => {
    const snapshot = createSubscriptionUsageSnapshot(
      createClaudeProviderState('unavailable'),
      createCodexProviderState('unavailable'),
      now,
      2_000,
      [accountUsage('default', 1)]
    );

    expect('claudeAccounts' in snapshot).toBe(false);
    expect(snapshot.schemaVersion).toBe(1);
  });

  it('adds every account in shared order with two or more accounts', () => {
    const snapshot = createSubscriptionUsageSnapshot(
      createClaudeProviderState('unavailable'),
      createCodexProviderState('unavailable'),
      now,
      2_000,
      [accountUsage('default', 1), accountUsage('max', 2)]
    );

    expect(snapshot.claudeAccounts?.map((account) => account.number)).toEqual([1, 2]);
  });
});
