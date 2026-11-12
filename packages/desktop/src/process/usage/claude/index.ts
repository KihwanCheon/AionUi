/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Claude subscription-usage probe entry point. */
import { DEFAULT_CLAUDE_ACCOUNT_ID } from '@/common/types/platform/claudeAccount';
import type { ClaudeUsageSnapshot } from '@/common/types/platform/claudeUsage';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getDataPath } from '@process/utils/utils';
import { getClaudeAccounts } from './claudeAccounts';
import { probeProjectDirectories, removeProbeTranscripts } from './probeSessionCleanup';
import { ClaudeUsageProbe } from './usageProbe';

// One probe (and cache) per Claude account; the default account keeps the original probe.
const probes = new Map<string, ClaudeUsageProbe>();

// Fork: the probe runs in a dedicated folder so its sessions stay out of user
// workspaces, and the transcript each run leaves there is removed shortly after.
const PROBE_TRANSCRIPT_SWEEP_DELAY_MS = 5_000;
const PROBE_TRANSCRIPT_MIN_AGE_MS = 2_000;

const probeWorkingDirectory = (): string => join(getDataPath(), 'claude-usage-probe');

const sweepProbeTranscripts = (env: NodeJS.ProcessEnv | undefined): void => {
  const configDir = (env ?? process.env).CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const timer = setTimeout(() => {
    try {
      for (const directory of probeProjectDirectories(configDir, probeWorkingDirectory())) {
        removeProbeTranscripts(directory, PROBE_TRANSCRIPT_MIN_AGE_MS);
      }
    } catch {
      // Cleanup is best effort; the next run retries.
    }
  }, PROBE_TRANSCRIPT_SWEEP_DELAY_MS);
  timer.unref?.();
};

const getProbe = (accountId: string, env?: NodeJS.ProcessEnv): ClaudeUsageProbe => {
  let probe = probes.get(accountId);
  if (!probe) {
    probe = new ClaudeUsageProbe({
      accountId,
      ...(env ? { env } : {}),
      workingDirectory: probeWorkingDirectory,
      onFinished: () => sweepProbeTranscripts(env),
    });
    probes.set(accountId, probe);
  }
  return probe;
};

/**
 * Process env for a non-default account probe. A plain copy of Windows'
 * case-insensitive `process.env` keeps keys such as `Path`, which the probe's
 * `env.PATH` lookup would miss, so the PATH key is normalized.
 */
const accountProbeEnv = (configDir: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    env[key.toUpperCase() === 'PATH' ? 'PATH' : key] = value;
  }
  env.CLAUDE_CONFIG_DIR = configDir;
  return env;
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Usage for the default account, or for the non-default account `accountId`
 * (probed with its own `CLAUDE_CONFIG_DIR`). An unknown account yields `null`
 * rather than the default account's usage.
 */
export const getClaudeUsage = async (cwd: string, accountId?: string): Promise<ClaudeUsageSnapshot | null> => {
  const workspace = cwd.trim();
  if (!workspace || !isDirectory(workspace)) return null;
  if (!accountId || accountId === DEFAULT_CLAUDE_ACCOUNT_ID) {
    return getProbe(DEFAULT_CLAUDE_ACCOUNT_ID).getUsage(workspace);
  }

  const account = (await getClaudeAccounts()).find((candidate) => candidate.id === accountId);
  if (!account?.config_dir) return null;
  const usage = await getProbe(accountId, accountProbeEnv(account.config_dir)).getUsage(workspace);
  return usage ? { ...usage, accountId } : null;
};
