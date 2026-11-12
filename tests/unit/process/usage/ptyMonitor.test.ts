/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { parsePtyOwners, PtyMonitorService } from '@process/usage/ptyMonitor';

const lsofOutput = [
  'p100',
  'cElectron',
  'f74',
  'n/dev/ptmx',
  'f76',
  'n/dev/ptmx',
  'p200',
  'cTerminal',
  'f9',
  'n/dev/ptmx',
].join('\n');

describe('parsePtyOwners', () => {
  it('groups PTY masters by process and sorts the largest owners first', () => {
    expect(parsePtyOwners(lsofOutput)).toEqual([
      { pid: 100, processName: 'Electron', count: 2 },
      { pid: 200, processName: 'Terminal', count: 1 },
    ]);
  });

  it('ignores malformed records and unrelated device names', () => {
    expect(parsePtyOwners('pbad\ncUnknown\nf1\nn/dev/ptmx\np9\ncShell\nf2\nn/dev/null')).toEqual([]);
  });
});

describe('PtyMonitorService', () => {
  it('refreshes immediately and schedules the next census after 30 seconds', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const service = new PtyMonitorService({
      platform: 'darwin',
      readLsof: async () => lsofOutput,
      readLimit: async () => 511,
      onProcessExit: vi.fn(),
    });

    service.start();
    await service.refresh();
    await Promise.resolve();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    service.stop();
    setTimeoutSpy.mockRestore();
  });

  it('maps active launches and exposes untracked Electron PTYs without terminating anything', async () => {
    const service = new PtyMonitorService({
      platform: 'darwin',
      ownerPid: 100,
      idFactory: () => 'launch-1',
      now: () => 1_000,
      readLsof: async () => lsofOutput,
      readLimit: async () => 511,
    });

    const launchId = service.trackLaunch({
      purpose: 'claude-usage-probe',
      conversationId: 'conv-1',
      conversationName: 'PTY investigation',
      childPid: 300,
    });
    const active = await service.refresh();

    expect(launchId).toBe('launch-1');
    expect(active).toMatchObject({
      state: 'ready',
      limit: 511,
      totalCount: 3,
      aionUiCount: 2,
      trackedActiveCount: 1,
      suspectedUntrackedCount: 1,
    });
    expect(active.activeLaunches).toEqual([
      expect.objectContaining({ id: 'launch-1', conversationId: 'conv-1', childPid: 300 }),
    ]);

    service.finishLaunch(launchId, 'exit');
    const closed = await service.refresh();
    expect(closed.trackedActiveCount).toBe(0);
    expect(closed.suspectedUntrackedCount).toBe(2);
    expect(closed.activeLaunches).toEqual([]);
  });

  it('reports unsupported platforms without running macOS commands', async () => {
    const readLsof = vi.fn(async () => lsofOutput);
    const readLimit = vi.fn(async () => 511);
    const service = new PtyMonitorService({ platform: 'linux', readLsof, readLimit });

    await expect(service.refresh()).resolves.toMatchObject({ state: 'unsupported' });
    expect(readLsof).not.toHaveBeenCalled();
    expect(readLimit).not.toHaveBeenCalled();
  });

  it('reports unavailable when the system census fails and preserves tracked launch context', async () => {
    const service = new PtyMonitorService({
      platform: 'darwin',
      idFactory: () => 'launch-2',
      readLsof: async () => {
        throw new Error('lsof unavailable');
      },
      readLimit: async () => 511,
    });
    service.trackLaunch({ purpose: 'claude-usage-probe', childPid: 301 });

    const snapshot = await service.refresh();
    expect(snapshot.state).toBe('unavailable');
    expect(snapshot.activeLaunches).toEqual([expect.objectContaining({ id: 'launch-2', childPid: 301 })]);
    expect(snapshot.suspectedUntrackedCount).toBeNull();
  });
});
