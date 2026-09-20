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
  limitReached: boolean;
  updatedAt: number;
};

export type CodexUsageRequest = {
  /** Existing conversation used to validate and prioritize the account-wide lookup. */
  conversationId?: string;
};
