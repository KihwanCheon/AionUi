/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  getClaudeRateLimitSnapshot,
  pushClaudeRateLimit,
  pushClaudeUsageSnapshot,
} from '@/renderer/hooks/useClaudeRateLimit';

// The store is module-level global state, so these assertions run sequentially
// against the accumulating snapshot rather than resetting between cases.
describe('useClaudeRateLimit store', () => {
  it('ignores empty or type-less updates without throwing', () => {
    const before = getClaudeRateLimitSnapshot();
    pushClaudeRateLimit(undefined);
    pushClaudeRateLimit(null);
    pushClaudeRateLimit({ utilization: 0.9 }); // no rateLimitType
    const after = getClaudeRateLimitSnapshot();
    expect(after).toBe(before); // no update → same reference
    expect(after.session).toBeUndefined();
    expect(after.weekly).toBeUndefined();
  });

  it('maps five_hour to session', () => {
    pushClaudeRateLimit({ rateLimitType: 'five_hour', utilization: 0.55, status: 'allowed', resetsAt: 1_700_000_000 });
    const { session } = getClaudeRateLimitSnapshot();
    expect(session?.rateLimitType).toBe('five_hour');
    expect(session?.utilization).toBe(0.55);
  });

  it('resolves weekly by priority: plain seven_day wins over model-specific variants', () => {
    // A model-specific variant arrives first → it is the only weekly window.
    pushClaudeRateLimit({ rateLimitType: 'seven_day_opus', utilization: 0.3 });
    expect(getClaudeRateLimitSnapshot().weekly?.rateLimitType).toBe('seven_day_opus');

    // Once the canonical seven_day window appears, it takes precedence.
    pushClaudeRateLimit({ rateLimitType: 'seven_day', utilization: 0.46, status: 'allowed_warning' });
    expect(getClaudeRateLimitSnapshot().weekly?.rateLimitType).toBe('seven_day');
    expect(getClaudeRateLimitSnapshot().weekly?.status).toBe('allowed_warning');
  });

  it('produces a new snapshot reference on a real update', () => {
    const before = getClaudeRateLimitSnapshot();
    pushClaudeRateLimit({ rateLimitType: 'five_hour', utilization: 0.7 });
    const after = getClaudeRateLimitSnapshot();
    expect(after).not.toBe(before);
    expect(after.session?.utilization).toBe(0.7);
  });

  it('keeps probed utilization when a sparse live event updates the status', () => {
    pushClaudeUsageSnapshot({
      session: {
        rateLimitType: 'five_hour',
        utilization: 31,
        resetsAt: 1_800_000_000,
      },
      updatedAt: Date.now(),
    });
    pushClaudeRateLimit({
      rateLimitType: 'five_hour',
      status: 'allowed_warning',
      resetsAt: 1_800_000_100,
    });

    expect(getClaudeRateLimitSnapshot().session).toMatchObject({
      rateLimitType: 'five_hour',
      utilization: 31,
      status: 'allowed_warning',
      resetsAt: 1_800_000_100,
    });
  });

  it('ignores an empty account-wide snapshot', () => {
    const before = getClaudeRateLimitSnapshot();
    pushClaudeUsageSnapshot(null);
    expect(getClaudeRateLimitSnapshot()).toBe(before);
  });

  it('preserves the provider timestamp for staleness checks', () => {
    const providerUpdatedAt = 1_700_000_123_000;
    pushClaudeUsageSnapshot({
      session: { rateLimitType: 'five_hour', utilization: 31 },
      updatedAt: providerUpdatedAt,
    });

    expect(getClaudeRateLimitSnapshot().updatedAt).toBe(providerUpdatedAt);
  });
});
