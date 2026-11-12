/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  CodexUsageProbe,
  parseCodexRateLimitsResult,
  resolveCodexAppServerCommand,
  type SpawnCodexProcess,
} from '@process/usage/codex/usageProbe';

class FakeProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
  readonly writes: string[] = [];

  constructor() {
    super();
    this.stdin.on('data', (chunk) => this.writes.push(chunk.toString()));
  }
}

const rateLimitsResult = {
  rateLimits: {
    limitId: 'codex',
    primary: {
      usedPercent: 28,
      windowDurationMins: 10_080,
      resetsAt: 1_785_902_955,
    },
    secondary: null,
    rateLimitReachedType: null,
  },
  rateLimitsByLimitId: {
    codex_bengalfox: {
      primary: {
        usedPercent: 99,
        windowDurationMins: 10_080,
        resetsAt: 1_786_062_614,
      },
    },
  },
};

describe('parseCodexRateLimitsResult', () => {
  it('reads the 5-hour and weekly main account windows and ignores model-specific buckets', () => {
    expect(
      parseCodexRateLimitsResult(
        {
          ...rateLimitsResult,
          rateLimits: {
            ...rateLimitsResult.rateLimits,
            primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 100 },
            secondary: { usedPercent: 28, windowDurationMins: 10_080, resetsAt: 200 },
          },
        },
        300
      )
    ).toEqual({
      weekly: {
        usedPercent: 28,
        windowDurationMins: 10_080,
        resetsAt: 200,
      },
      session: {
        usedPercent: 10,
        windowDurationMins: 300,
        resetsAt: 100,
      },
      limitReached: false,
      updatedAt: 300,
    });
  });

  it('keeps a weekly-only snapshot when the plan reports a single window', () => {
    const usage = parseCodexRateLimitsResult(rateLimitsResult, 300);
    expect(usage).toEqual({
      weekly: { usedPercent: 28, windowDurationMins: 10_080, resetsAt: 1_785_902_955 },
      limitReached: false,
      updatedAt: 300,
    });
    expect(usage).not.toHaveProperty('session');
  });

  it('does not guess a 5-hour window when window durations are missing', () => {
    expect(
      parseCodexRateLimitsResult({
        rateLimits: { primary: { usedPercent: 10 }, secondary: { usedPercent: 28 } },
      })
    ).not.toHaveProperty('session');
  });

  it('treats an exhausted 5-hour window as a reached limit', () => {
    expect(
      parseCodexRateLimitsResult({
        rateLimits: {
          primary: { usedPercent: 100, windowDurationMins: 300 },
          secondary: { usedPercent: 40, windowDurationMins: 10_080 },
          rateLimitReachedType: null,
        },
      })
    ).toMatchObject({ session: { usedPercent: 100 }, weekly: { usedPercent: 40 }, limitReached: true });
  });

  it('rejects responses without a structured usage window', () => {
    expect(parseCodexRateLimitsResult({ rateLimits: { primary: null } })).toBeNull();
  });
});

describe('CodexUsageProbe', () => {
  it('initializes app-server, reads rate limits, and caches concurrent reads', async () => {
    const child = new FakeProcess();
    const spawnProcess = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams) as SpawnCodexProcess;
    const probe = new CodexUsageProbe({
      command: process.execPath,
      args: ['app-server'],
      now: () => 400,
      spawnProcess,
    });

    const first = probe.getUsage();
    const concurrent = probe.getUsage();
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(child.writes.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({ method: 'initialize', id: 0 })
    );

    child.stdout.write(`${JSON.stringify({ id: 0, result: { userAgent: 'test' } })}\n`);
    expect(child.writes.map((line) => JSON.parse(line))).toContainEqual({ method: 'initialized', params: {} });
    expect(child.writes.map((line) => JSON.parse(line))).toContainEqual({
      method: 'account/rateLimits/read',
      id: 1,
    });

    child.stdout.write(`${JSON.stringify({ id: 1, result: rateLimitsResult })}\n`);

    await expect(first).resolves.toMatchObject({
      weekly: { usedPercent: 28, windowDurationMins: 10_080 },
      limitReached: false,
    });
    await expect(concurrent).resolves.toMatchObject({ weekly: { usedPercent: 28 } });
    await expect(probe.getUsage()).resolves.toMatchObject({ weekly: { usedPercent: 28 } });
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('caches failures without logging raw server output', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const child = new FakeProcess();
    const spawnProcess = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams) as SpawnCodexProcess;
    const probe = new CodexUsageProbe({
      command: process.execPath,
      args: ['app-server'],
      spawnProcess,
    });

    const first = probe.getUsage();
    child.stdout.write(`${JSON.stringify({ id: 0, error: { message: 'secret provider detail' } })}\n`);
    await expect(first).resolves.toBeNull();
    await expect(probe.getUsage()).resolves.toBeNull();

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[CodexUsageProbe] Unable to refresh Codex plan usage',
      expect.objectContaining({ reason: 'Codex app-server initialization failed' })
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret provider detail');
    warn.mockRestore();
  });

  it('retries a failed probe after the one-minute failure cache expires', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let now = 1_700_000_000_000;
      const firstChild = new FakeProcess();
      const secondChild = new FakeProcess();
      const children = [firstChild, secondChild];
      const spawnProcess = vi.fn(
        () => children.shift() as unknown as ChildProcessWithoutNullStreams
      ) as SpawnCodexProcess;
      const probe = new CodexUsageProbe({
        command: process.execPath,
        args: ['app-server'],
        now: () => now,
        spawnProcess,
      });

      const first = probe.getUsage();
      firstChild.stdout.write(`${JSON.stringify({ id: 0, error: { message: 'temporary failure' } })}\n`);
      await expect(first).resolves.toBeNull();

      now += 59_999;
      await expect(probe.getUsage()).resolves.toBeNull();
      expect(spawnProcess).toHaveBeenCalledTimes(1);

      now += 1;
      const retried = probe.getUsage();
      expect(spawnProcess).toHaveBeenCalledTimes(2);
      secondChild.stdout.write(`${JSON.stringify({ id: 0, error: { message: 'temporary failure' } })}\n`);
      await expect(retried).resolves.toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('resolveCodexAppServerCommand', () => {
  it('uses the Windows command shim without shell interpolation from user data', () => {
    expect(resolveCodexAppServerCommand('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'codex app-server'],
    });
  });

  it('launches the executable directly on Unix platforms', () => {
    expect(resolveCodexAppServerCommand('linux', {})).toEqual({
      command: 'codex',
      args: ['app-server'],
    });
  });
});
