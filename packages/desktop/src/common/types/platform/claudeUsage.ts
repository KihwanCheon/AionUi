/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type ClaudeRateLimitType =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_opus'
  | 'seven_day_sonnet'
  | 'seven_day_overage_included'
  | 'overage';

export type ClaudeUtilizationUnit = 'ratio' | 'percent';

export type ClaudeRateLimitInfo = {
  status?: 'allowed' | 'allowed_warning' | 'rejected';
  /** Epoch reset time in seconds or milliseconds. */
  resetsAt?: number;
  rateLimitType?: ClaudeRateLimitType;
  /** Usage ratio represented either as a 0–1 fraction or a 0–100 percentage. */
  utilization?: number;
  /** Explicit unit when the producer knows whether utilization is a ratio or percentage. */
  utilizationUnit?: ClaudeUtilizationUnit;
};

export type ClaudeUsageSnapshot = {
  session?: ClaudeRateLimitInfo;
  weekly?: ClaudeRateLimitInfo;
  updatedAt: number;
  /** Fork: non-default Claude account the usage belongs to; absent = default account. */
  accountId?: string;
};

export type ClaudeUsageRequest = {
  /** Conversation whose canonical Claude workspace will host the CLI probe. */
  conversationId: string;
};
