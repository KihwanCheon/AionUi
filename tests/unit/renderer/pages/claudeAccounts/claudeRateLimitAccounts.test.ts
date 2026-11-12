/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Claude rate-limit store per account', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('keeps untagged usage on the default account exactly as before', async () => {
    const { getClaudeRateLimitSnapshot, pushClaudeUsageSnapshot } = await import('@/renderer/hooks/useClaudeRateLimit');
    pushClaudeUsageSnapshot({ session: { rateLimitType: 'five_hour', utilization: 30 }, updatedAt: 5 });

    expect(getClaudeRateLimitSnapshot().session?.utilization).toBe(30);
    expect(getClaudeRateLimitSnapshot('default').updatedAt).toBe(5);
  });

  it('does not mix another account into the default account', async () => {
    const { getClaudeRateLimitSnapshot, pushClaudeUsageSnapshot } = await import('@/renderer/hooks/useClaudeRateLimit');
    pushClaudeUsageSnapshot({ session: { rateLimitType: 'five_hour', utilization: 30 }, updatedAt: 5 });
    pushClaudeUsageSnapshot({
      session: { rateLimitType: 'five_hour', utilization: 80 },
      updatedAt: 9,
      accountId: 'max',
    });

    expect(getClaudeRateLimitSnapshot().session?.utilization).toBe(30);
    expect(getClaudeRateLimitSnapshot('max').session?.utilization).toBe(80);
  });

  it('returns a stable empty state for an account without data', async () => {
    const { getClaudeRateLimitSnapshot } = await import('@/renderer/hooks/useClaudeRateLimit');
    expect(getClaudeRateLimitSnapshot('unknown')).toBe(getClaudeRateLimitSnapshot('unknown'));
    expect(getClaudeRateLimitSnapshot('unknown').updatedAt).toBe(0);
  });
});
