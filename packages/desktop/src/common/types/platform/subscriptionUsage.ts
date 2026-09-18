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
};

export type PtyMonitorState = 'ready' | 'unsupported' | 'unavailable';

export type PtyLaunchPurpose = 'claude-usage-probe';

export type PtyLaunchCloseReason = 'completed' | 'exit' | 'timeout' | 'shutdown-timeout';

export type PtyLaunchContext = {
  conversationId?: string;
  conversationName?: string;
};

export type PtyLaunchSnapshot = PtyLaunchContext & {
  id: string;
  purpose: PtyLaunchPurpose;
  childPid: number;
  startedAt: number;
};

export type PtyOwnerSnapshot = {
  pid: number;
  processName: string;
  count: number;
};

export type PtyMonitorSnapshot = {
  state: PtyMonitorState;
  updatedAt: number;
  limit: number | null;
  totalCount: number | null;
  aionUiPid: number;
  aionUiCount: number | null;
  trackedActiveCount: number;
  suspectedUntrackedCount: number | null;
  owners: PtyOwnerSnapshot[];
  activeLaunches: PtyLaunchSnapshot[];
};
