/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ClaudeUsageRequest, ClaudeUsageSnapshot } from '@/common/types/platform/claudeUsage';
import type { CodexUsageRequest, CodexUsageSnapshot } from '@/common/types/platform/codexUsage';
import { bridge } from './bridge';

export const subscriptionUsageBridge = {
  getClaude: bridge.buildProvider<ClaudeUsageSnapshot | null, ClaudeUsageRequest>('system-settings:get-claude-usage'),
  getCodex: bridge.buildProvider<CodexUsageSnapshot | null, CodexUsageRequest>('system-settings:get-codex-usage'),
  claudeChanged: bridge.buildEmitter<ClaudeUsageSnapshot>('system-settings:claude-usage-changed'),
  codexChanged: bridge.buildEmitter<CodexUsageSnapshot>('system-settings:codex-usage-changed'),
};
