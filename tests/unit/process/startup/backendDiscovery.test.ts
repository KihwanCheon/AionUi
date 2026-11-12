/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearBackendDiscovery,
  getBackendDiscoveryPath,
  publishBackendDiscovery,
} from '@/process/startup/backendDiscovery';

const tempDirectories: string[] = [];

function createTempDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'aionui-backend-discovery-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('backend discovery publication', () => {
  it('publishes the latest backend port for other local applications', () => {
    const tempDirectory = createTempDirectory();
    const options = { tempDirectory, pid: 1234, now: () => new Date('2026-07-17T00:00:00.000Z') };

    publishBackendDiscovery(19_860, options);
    publishBackendDiscovery(24_681, options);

    const record = JSON.parse(readFileSync(getBackendDiscoveryPath(tempDirectory), 'utf8'));
    expect(record).toEqual({
      schemaVersion: 1,
      host: '127.0.0.1',
      port: 24_681,
      pid: 1234,
      updatedAt: '2026-07-17T00:00:00.000Z',
    });
  });

  it('does not remove discovery data published by a newer process', () => {
    const tempDirectory = createTempDirectory();
    publishBackendDiscovery(19_860, { tempDirectory, pid: 2222 });

    expect(clearBackendDiscovery({ tempDirectory, pid: 1111 })).toBe(false);
    expect(readFileSync(getBackendDiscoveryPath(tempDirectory), 'utf8')).toContain('19860');
  });

  it('rejects an invalid backend port without publishing discovery data', () => {
    const tempDirectory = createTempDirectory();

    expect(() => publishBackendDiscovery(0, { tempDirectory, pid: 1234 })).toThrow('Invalid AionUi backend port');
    expect(clearBackendDiscovery({ tempDirectory, pid: 1234 })).toBe(false);
  });

  it('removes owned discovery data through the registered process-exit cleanup', () => {
    const tempDirectory = createTempDirectory();
    let cleanup: (() => void) | undefined;

    publishBackendDiscovery(19_860, {
      tempDirectory,
      pid: 1234,
      onProcessExit: (handler) => {
        cleanup = handler;
      },
    });
    cleanup?.();

    expect(() => readFileSync(getBackendDiscoveryPath(tempDirectory), 'utf8')).toThrow();
  });
});
