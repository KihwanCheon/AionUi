/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Codex subscription-usage probe entry point. */
import type { CodexUsageSnapshot } from '@/common/types/platform/codexUsage';
import { CodexUsageProbe } from './usageProbe';

let probe: CodexUsageProbe | undefined;

const getProbe = (): CodexUsageProbe => {
  probe ??= new CodexUsageProbe();
  return probe;
};

export const getCodexUsage = (): Promise<CodexUsageSnapshot | null> => getProbe().getUsage();
