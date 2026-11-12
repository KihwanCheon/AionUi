/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type SubscriptionUsageTone = 'normal' | 'warning' | 'limit';

export const SUBSCRIPTION_USAGE_STALE_AFTER_MS = 5 * 60_000;

/** Returns whether a subscription usage snapshot is recent enough to display. */
export const isSubscriptionUsageFresh = (updatedAt: number, now = Date.now()): boolean =>
  Number.isFinite(updatedAt) && updatedAt > 0 && now - updatedAt < SUBSCRIPTION_USAGE_STALE_AFTER_MS;

/** Classifies subscription usage using the highest available percentage. */
export const getSubscriptionUsageTone = (...values: Array<number | null | undefined>): SubscriptionUsageTone => {
  const highest = values.reduce(
    (current, value) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(current, value) : current),
    0
  );

  if (highest >= 100) return 'limit';
  if (highest >= 80) return 'warning';
  return 'normal';
};
