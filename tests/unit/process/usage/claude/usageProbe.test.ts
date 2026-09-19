/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { IPty } from 'node-pty';
import {
  ClaudeUsageProbe,
  releasePty,
  resolveExecutableFromPath,
  type SpawnPty,
} from '@process/usage/claude/usageProbe';

class FakePty {
  readonly pid = 4321;
  readonly destroy = vi.fn();
  readonly kill = vi.fn();
  readonly write = vi.fn();
  #dataListener: ((data: string) => void) | undefined;
  #exitListener: (() => void) | undefined;

  readonly onData = (listener: (data: string) => void): { dispose(): void } => {
    this.#dataListener = listener;
    return { dispose: vi.fn() };
  };

  readonly onExit = (listener: () => void): { dispose(): void } => {
    this.#exitListener = listener;
    return { dispose: vi.fn() };
  };

  emitData(data: string): void {
    this.#dataListener?.(data);
  }

  emitExit(): void {
    this.#exitListener?.();
  }
}

const completeUsage = `
Current session
25% used
Resets 8:30am
Current week (all models)
24% used
Resets Aug 4, 9pm
`;

const windowsPathExists = (path: string): boolean => path === 'C:\\tools\\claude.EXE';

describe('ClaudeUsageProbe', () => {
  it('waits for startup, runs /usage, releases the live PTY, and caches concurrent reads', async () => {
    vi.useFakeTimers();
    try {
      const terminal = new FakePty();
      const spawnPty = vi.fn(() => terminal as unknown as IPty) as unknown as SpawnPty;
      const now = new Date(2026, 6, 31, 7, 0, 0).getTime();
      const probe = new ClaudeUsageProbe({
        command: process.execPath,
        commandDelayMs: 100,
        exitCommandDelayMs: 50,
        now: () => now,
        spawnPty,
      });

      const first = probe.getUsage(process.cwd());
      const concurrent = probe.getUsage(process.cwd());
      expect(spawnPty).toHaveBeenCalledWith(
        process.execPath,
        ['--ax-screen-reader', '--safe-mode'],
        expect.objectContaining({ cwd: process.cwd() })
      );

      await vi.advanceTimersByTimeAsync(99);
      expect(terminal.write).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(terminal.write).toHaveBeenCalledWith('/usage\r');

      terminal.emitData(completeUsage);
      expect(terminal.write).toHaveBeenCalledWith('\u001b');
      terminal.emitData('Settings dialog dismissed');
      await vi.advanceTimersByTimeAsync(50);
      expect(terminal.write).not.toHaveBeenCalledWith('/exit\r');
      expect(terminal.destroy).toHaveBeenCalledTimes(1);
      expect(terminal.kill).not.toHaveBeenCalled();

      await expect(first).resolves.toMatchObject({
        session: { utilization: 25 },
        weekly: { utilization: 24 },
      });
      await expect(concurrent).resolves.toMatchObject({
        session: { utilization: 25 },
        weekly: { utilization: 24 },
      });
      await expect(probe.getUsage(process.cwd())).resolves.toMatchObject({
        session: { utilization: 25 },
      });
      expect(spawnPty).toHaveBeenCalledTimes(1);
      expect(terminal.destroy).toHaveBeenCalledTimes(1);
      expect(terminal.kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches successful usage for two minutes', async () => {
    let now = new Date(2026, 6, 31, 7, 0, 0).getTime();
    const firstTerminal = new FakePty();
    const secondTerminal = new FakePty();
    const terminals = [firstTerminal, secondTerminal];
    const spawnPty = vi.fn(() => terminals.shift() as unknown as IPty) as unknown as SpawnPty;
    const probe = new ClaudeUsageProbe({
      command: process.execPath,
      now: () => now,
      spawnPty,
    });

    const first = probe.getUsage(process.cwd());
    firstTerminal.emitData(completeUsage);
    firstTerminal.emitExit();
    await expect(first).resolves.toMatchObject({ session: { utilization: 25 } });

    now += 119_999;
    await expect(probe.getUsage(process.cwd())).resolves.toMatchObject({ session: { utilization: 25 } });
    expect(spawnPty).toHaveBeenCalledTimes(1);

    now += 1;
    const refreshed = probe.getUsage(process.cwd());
    expect(spawnPty).toHaveBeenCalledTimes(2);
    secondTerminal.emitData(completeUsage);
    secondTerminal.emitExit();
    await expect(refreshed).resolves.toMatchObject({ session: { utilization: 25 } });
  });

  it('returns and caches null when the executable cannot be resolved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spawnPty = vi.fn();
    const probe = new ClaudeUsageProbe({
      command: 'missing-claude-command',
      env: { PATH: '' },
      spawnPty: spawnPty as unknown as SpawnPty,
    });

    await expect(probe.getUsage(process.cwd())).resolves.toBeNull();
    await expect(probe.getUsage(process.cwd())).resolves.toBeNull();
    expect(spawnPty).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('returns null without attempting PTY cleanup when spawn fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spawnPty = vi.fn(() => {
      throw new Error('forkpty failed');
    });
    const probe = new ClaudeUsageProbe({
      command: process.execPath,
      spawnPty: spawnPty as unknown as SpawnPty,
    });

    await expect(probe.getUsage(process.cwd())).resolves.toBeNull();

    expect(spawnPty).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[ClaudeUsageProbe] Unable to refresh Claude plan usage',
      expect.objectContaining({ reason: 'forkpty failed' })
    );
    warn.mockRestore();
  });

  it('returns partial usage when Claude exits after rendering one bucket', async () => {
    const terminal = new FakePty();
    const spawnPty = vi.fn(() => terminal as unknown as IPty) as unknown as SpawnPty;
    const probe = new ClaudeUsageProbe({
      command: process.execPath,
      spawnPty,
    });

    const result = probe.getUsage(process.cwd());
    terminal.emitData('Current session\n18% used\nResets 11pm\n');
    terminal.emitExit();

    await expect(result).resolves.toMatchObject({
      session: { utilization: 18 },
    });
    expect(terminal.destroy).toHaveBeenCalledTimes(1);
    expect(terminal.kill).not.toHaveBeenCalled();
  });

  it('maps each spawned PTY to its conversation and removes it when the process exits', async () => {
    const terminal = new FakePty();
    const trackPtyLaunch = vi.fn(() => 'launch-1');
    const finishPtyLaunch = vi.fn();
    const probe = new ClaudeUsageProbe({
      command: process.execPath,
      spawnPty: vi.fn(() => terminal as unknown as IPty) as unknown as SpawnPty,
      trackPtyLaunch,
      finishPtyLaunch,
    });

    const result = probe.getUsage(process.cwd(), {
      conversationId: 'conv-1',
      conversationName: 'PTY investigation',
    });
    terminal.emitExit();
    await expect(result).resolves.toBeNull();

    expect(trackPtyLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'claude-usage-probe',
        conversationId: 'conv-1',
        conversationName: 'PTY investigation',
        childPid: 4321,
      })
    );
    expect(finishPtyLaunch).toHaveBeenCalledWith('launch-1', 'exit');
  });

  it('answers an interactive workspace trust prompt once', async () => {
    const terminal = new FakePty();
    const spawnPty = vi.fn(() => terminal as unknown as IPty) as unknown as SpawnPty;
    const probe = new ClaudeUsageProbe({
      command: process.execPath,
      spawnPty,
    });

    const result = probe.getUsage(process.cwd());
    terminal.emitData('Quick safety check\nYes, I trust this folder\nNo, exit\n');
    terminal.emitData('Quick safety check\nYes, I trust this folder\nNo, exit\n');
    terminal.emitExit();

    await expect(result).resolves.toBeNull();
    expect(terminal.write).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith('y\r');
    expect(terminal.destroy).toHaveBeenCalledTimes(1);
    expect(terminal.kill).not.toHaveBeenCalled();
  });

  it('waits for Claude input to become interactive after rendering its screen', async () => {
    vi.useFakeTimers();
    try {
      const terminal = new FakePty();
      const spawnPty = vi.fn(() => terminal as unknown as IPty) as unknown as SpawnPty;
      const probe = new ClaudeUsageProbe({
        command: process.execPath,
        commandDelayMs: 30_000,
        spawnPty,
      });

      const result = probe.getUsage(process.cwd());
      terminal.emitData('Welcome to Claude Code\n');
      await vi.advanceTimersByTimeAsync(11_999);
      expect(terminal.write).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(terminal.write).toHaveBeenCalledTimes(1);
      expect(terminal.write).toHaveBeenCalledWith('/usage\r');

      terminal.emitData(completeUsage);
      terminal.emitExit();
      await expect(result).resolves.toMatchObject({
        session: { utilization: 25 },
        weekly: { utilization: 24 },
      });
      expect(terminal.destroy).toHaveBeenCalledTimes(1);
      expect(terminal.kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not write a delayed command after Claude exits during startup', async () => {
    vi.useFakeTimers();
    try {
      const terminal = new FakePty();
      const spawnPty = vi.fn(() => terminal as unknown as IPty) as unknown as SpawnPty;
      const probe = new ClaudeUsageProbe({
        command: process.execPath,
        commandDelayMs: 100,
        spawnPty,
      });

      const result = probe.getUsage(process.cwd());
      terminal.emitExit();
      await expect(result).resolves.toBeNull();
      await vi.advanceTimersByTimeAsync(100);

      expect(terminal.write).not.toHaveBeenCalled();
      expect(terminal.destroy).toHaveBeenCalledTimes(1);
      expect(terminal.kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows two minutes before timing out', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const terminal = new FakePty();
      const spawnPty = vi.fn(() => terminal as unknown as IPty) as unknown as SpawnPty;
      const probe = new ClaudeUsageProbe({
        command: process.execPath,
        spawnPty,
      });

      const result = probe.getUsage(process.cwd());
      await vi.advanceTimersByTimeAsync(119_999);
      expect(terminal.destroy).not.toHaveBeenCalled();
      expect(terminal.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBeNull();
      expect(terminal.destroy).toHaveBeenCalledTimes(1);
      expect(terminal.kill).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('retries a failed probe after the two-minute failure cache expires', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let now = new Date(2026, 6, 31, 7, 0, 0).getTime();
      const firstTerminal = new FakePty();
      const secondTerminal = new FakePty();
      const terminals = [firstTerminal, secondTerminal];
      const spawnPty = vi.fn(() => terminals.shift() as unknown as IPty) as unknown as SpawnPty;
      const probe = new ClaudeUsageProbe({
        command: process.execPath,
        commandDelayMs: 10_000,
        now: () => now,
        spawnPty,
        timeoutMs: 100,
      });

      const first = probe.getUsage(process.cwd());
      await vi.advanceTimersByTimeAsync(100);
      await expect(first).resolves.toBeNull();
      expect(spawnPty).toHaveBeenCalledTimes(1);
      expect(firstTerminal.destroy).toHaveBeenCalledTimes(1);
      expect(firstTerminal.kill).not.toHaveBeenCalled();

      now += 119_999;
      await expect(probe.getUsage(process.cwd())).resolves.toBeNull();
      expect(spawnPty).toHaveBeenCalledTimes(1);

      now += 1;
      const retried = probe.getUsage(process.cwd());
      expect(spawnPty).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(100);
      await expect(retried).resolves.toBeNull();
      expect(secondTerminal.destroy).toHaveBeenCalledTimes(1);
      expect(secondTerminal.kill).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('releasePty', () => {
  it('destroys Unix PTYs so the master file descriptor is closed', () => {
    const terminal = new FakePty();

    releasePty(terminal as unknown as IPty, 'darwin');

    expect(terminal.destroy).toHaveBeenCalledTimes(1);
    expect(terminal.kill).not.toHaveBeenCalled();
  });

  it('preserves the existing Windows kill path', () => {
    const terminal = new FakePty();

    releasePty(terminal as unknown as IPty, 'win32');

    expect(terminal.destroy).not.toHaveBeenCalled();
    expect(terminal.kill).toHaveBeenCalledTimes(1);
  });

  it('falls back to kill when an alternate Unix PTY implementation has no destroy method', () => {
    const terminal = { kill: vi.fn() } as unknown as IPty;

    releasePty(terminal, 'linux');

    expect(terminal.kill).toHaveBeenCalledTimes(1);
  });

  it('falls back to kill when destroying a Unix PTY throws', () => {
    const terminal = new FakePty();
    terminal.destroy.mockImplementationOnce(() => {
      throw new Error('destroy failed');
    });

    releasePty(terminal as unknown as IPty, 'darwin');

    expect(terminal.destroy).toHaveBeenCalledTimes(1);
    expect(terminal.kill).toHaveBeenCalledTimes(1);
  });
});

describe('resolveExecutableFromPath', () => {
  it('applies PATHEXT lookup before spawning on Windows', () => {
    expect(
      resolveExecutableFromPath(
        'claude',
        {
          PATH: 'C:\\tools',
          PATHEXT: '.COM;.EXE',
        },
        'win32',
        windowsPathExists
      )
    ).toBe('C:\\tools\\claude.EXE');
  });

  it('returns undefined when no candidate exists', () => {
    expect(resolveExecutableFromPath('claude', { PATH: '/bin' }, 'linux', () => false)).toBeUndefined();
  });
});
