/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const probeEnvs: Array<NodeJS.ProcessEnv | undefined> = [];
const getUsageMock = vi.fn();
const getClaudeAccountsMock = vi.fn();

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  statSync: () => ({ isDirectory: () => true }),
}));
vi.mock('@process/usage/claude/usageProbe', () => ({
  ClaudeUsageProbe: class {
    constructor(options: { env?: NodeJS.ProcessEnv } = {}) {
      probeEnvs.push(options.env);
    }
    getUsage(cwd: string) {
      return getUsageMock(cwd);
    }
  },
}));
vi.mock('@process/usage/claude/claudeAccounts', () => ({
  getClaudeAccounts: () => getClaudeAccountsMock(),
}));

const usage = { session: { utilization: 10 }, updatedAt: 1 };

describe('getClaudeUsage per Claude account', () => {
  beforeEach(() => {
    vi.resetModules();
    probeEnvs.length = 0;
    getUsageMock.mockReset();
    getUsageMock.mockResolvedValue(usage);
    getClaudeAccountsMock.mockReset();
    getClaudeAccountsMock.mockResolvedValue([
      { id: 'default', number: 1, label: 'Team', is_default: true, share_default_settings: true },
      { id: 'max', number: 2, label: 'Max', is_default: false, share_default_settings: true, config_dir: 'C:\\max' },
    ]);
  });

  it('keeps the default account on the untagged process-env probe', async () => {
    const { getClaudeUsage } = await import('@process/usage/claude');
    expect(await getClaudeUsage('C:\\work')).toEqual(usage);
    expect(await getClaudeUsage('C:\\work', 'default')).toEqual(usage);
    expect(probeEnvs).toEqual([undefined]);
    expect(getClaudeAccountsMock).not.toHaveBeenCalled();
  });

  it('probes a non-default account with its own CLAUDE_CONFIG_DIR and tags the result', async () => {
    const { getClaudeUsage } = await import('@process/usage/claude');
    expect(await getClaudeUsage('C:\\work', 'max')).toEqual({ ...usage, accountId: 'max' });
    expect(probeEnvs.at(-1)?.CLAUDE_CONFIG_DIR).toBe('C:\\max');
  });

  it('normalizes a Windows-style Path key so the account probe can find the CLI', async () => {
    // Restored by hand: on Windows `PATH` and `Path` are the same variable.
    const originalPath = process.env.PATH;
    delete process.env.PATH;
    process.env.Path = 'C:\\bin';
    try {
      const { getClaudeUsage } = await import('@process/usage/claude');
      await getClaudeUsage('C:\\work', 'max');
      const env = probeEnvs.at(-1) ?? {};
      expect(env.PATH).toBe('C:\\bin');
      expect(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH')).toEqual(['PATH']);
    } finally {
      delete process.env.Path;
      if (originalPath !== undefined) process.env.PATH = originalPath;
    }
  });

  it('returns null for an unknown account instead of the default account usage', async () => {
    const { getClaudeUsage } = await import('@process/usage/claude');
    expect(await getClaudeUsage('C:\\work', 'gone')).toBeNull();
    expect(getUsageMock).not.toHaveBeenCalled();
  });
});
