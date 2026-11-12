/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type CodexRateLimitWindow = {
  /** Current usage as a 0–100 percentage. */
  usedPercent: number;
  /** Quota window length reported by Codex, in minutes. */
  windowDurationMins?: number;
  /** Unix reset time in seconds. */
  resetsAt?: number;
};

export type CodexUsageSnapshot = {
  /** Longest account-wide Codex quota window, normally the weekly limit. */
  weekly: CodexRateLimitWindow;
  /**
   * Shorter account-wide window reported next to the weekly one, normally the
   * 5-hour limit. Absent when the plan reports a single window, for example
   * after an upgrade removes the 5-hour limit.
   */
  session?: CodexRateLimitWindow;
  limitReached: boolean;
  updatedAt: number;
};

export type CodexUsageRequest = {
  /** Existing conversation used to validate and prioritize the account-wide lookup. */
  conversationId?: string;
};
