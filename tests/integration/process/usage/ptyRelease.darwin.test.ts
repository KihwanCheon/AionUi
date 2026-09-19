/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { spawn } from 'node-pty';
import { releasePty } from '@process/usage/claude/usageProbe';

const processPtyMasterFds = (): Set<number> => {
  try {
    const output = execFileSync('lsof', ['-nP', '-Ff', '-a', '-p', String(process.pid), '/dev/ptmx'], {
      encoding: 'utf8',
    });
    return new Set(
      output
        .split(/\r?\n/)
        .filter((line) => /^f\d+$/.test(line))
        .map((line) => Number.parseInt(line.slice(1), 10))
    );
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) return new Set();
    throw error;
  }
};

const waitForPtyFd = async (fd: number, expectedPresent: boolean): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (processPtyMasterFds().has(fd) === expectedPresent) return;
    // eslint-disable-next-line no-await-in-loop -- Polling must observe one descriptor over time.
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(processPtyMasterFds().has(fd)).toBe(expectedPresent);
};

const waitForPtyMasterFds = async (expected: Set<number>): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const actual = processPtyMasterFds();
    if (actual.size === expected.size && [...actual].every((fd) => expected.has(fd))) return;
    // eslint-disable-next-line no-await-in-loop -- Polling must observe the complete descriptor set over time.
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect([...processPtyMasterFds()].toSorted((left, right) => left - right)).toEqual(
    [...expected].toSorted((left, right) => left - right)
  );
};

const waitForProcessExit = async (pid: number): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    // eslint-disable-next-line no-await-in-loop -- Polling must observe one child over time.
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(() => process.kill(pid, 0)).toThrow();
};

const spawnSleepingPty = () =>
  spawn('/bin/sh', ['-c', 'sleep 30'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  });

describe.runIf(process.platform === 'darwin')('releasePty macOS integration', () => {
  it('restores the complete /dev/ptmx descriptor set', async () => {
    const baseline = processPtyMasterFds();
    const terminal = spawnSleepingPty();
    const fd = (terminal as typeof terminal & { fd: number }).fd;

    await waitForPtyFd(fd, true);
    releasePty(terminal, 'darwin');
    await waitForPtyMasterFds(baseline);
    await waitForProcessExit(terminal.pid);
  });

  it('does not accumulate master descriptors across 200 releases', async () => {
    const baseline = processPtyMasterFds();
    for (let index = 0; index < 200; index += 1) {
      const terminal = spawnSleepingPty();
      const fd = (terminal as typeof terminal & { fd: number }).fd;
      // eslint-disable-next-line no-await-in-loop -- Sequential cycles avoid exhausting PTYs during the regression test.
      await waitForPtyFd(fd, true);
      releasePty(terminal, 'darwin');
      // eslint-disable-next-line no-await-in-loop -- Each cycle must prove release before starting the next one.
      await waitForPtyMasterFds(baseline);
      // eslint-disable-next-line no-await-in-loop -- Each cycle must reap its child before continuing.
      await waitForProcessExit(terminal.pid);
    }
  }, 60_000);
});
