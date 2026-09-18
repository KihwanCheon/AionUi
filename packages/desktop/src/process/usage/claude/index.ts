/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Claude subscription-usage probe entry point. */
import type { ClaudeUsageSnapshot } from '@/common/types/platform/claudeUsage';
import type { PtyLaunchContext } from '@/common/types/platform/subscriptionUsage';
import { statSync } from 'node:fs';
import { ClaudeUsageProbe } from './usageProbe';

let probe: ClaudeUsageProbe | undefined;

const getProbe = (): ClaudeUsageProbe => {
  probe ??= new ClaudeUsageProbe();
  return probe;
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export const getClaudeUsage = (cwd: string, context?: PtyLaunchContext): Promise<ClaudeUsageSnapshot | null> => {
  const workspace = cwd.trim();
  if (!workspace || !isDirectory(workspace)) return Promise.resolve(null);
  return getProbe().getUsage(workspace, context);
};
