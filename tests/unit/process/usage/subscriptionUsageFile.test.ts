/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SubscriptionUsageSnapshot } from '@/common/types/platform/subscriptionUsage';
import {
  clearSubscriptionUsageSnapshot,
  getSubscriptionUsagePath,
  writeSubscriptionUsageSnapshot,
} from '@process/usage/subscriptionUsageFile';

const tempDirectories: string[] = [];

const createTempDirectory = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), 'aionui-subscription-usage-'));
  tempDirectories.push(directory);
  return directory;
};

const snapshot = (state: SubscriptionUsageSnapshot['state'], generatedAt: string): SubscriptionUsageSnapshot => ({
  schemaVersion: 1,
  state,
  generatedAt,
  updatedAt: null,
  retryAfterMs: state === 'loading' ? 2_000 : null,
  claude: {
    state: state === 'loading' ? 'loading' : 'unavailable',
    updatedAt: null,
    session: null,
    weekly: null,
  },
  codex: {
    state: state === 'loading' ? 'loading' : 'unavailable',
    updatedAt: null,
    weekly: null,
    limitReached: false,
  },
});

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('subscription usage file publication', () => {
  it('replaces a complete JSON file only after the pending file is readable', () => {
    const tempDirectory = createTempDirectory();
    const pid = 1234;
    const initial = snapshot('loading', '2026-07-31T12:34:50.000Z');
    const next = snapshot('unavailable', '2026-07-31T12:34:52.000Z');
    writeSubscriptionUsageSnapshot(initial, { tempDirectory, pid });

    writeSubscriptionUsageSnapshot(next, {
      tempDirectory,
      pid,
      replaceFile: (source, destination) => {
        expect(JSON.parse(readFileSync(source, 'utf8'))).toEqual(next);
        expect(JSON.parse(readFileSync(destination, 'utf8'))).toEqual(initial);
        renameSync(source, destination);
      },
    });

    expect(JSON.parse(readFileSync(getSubscriptionUsagePath(tempDirectory), 'utf8'))).toEqual(next);
  });

  it('preserves the previous snapshot when atomic replacement fails', () => {
    const tempDirectory = createTempDirectory();
    const pid = 1234;
    const initial = snapshot('loading', '2026-07-31T12:34:50.000Z');
    const initialContent = writeSubscriptionUsageSnapshot(initial, { tempDirectory, pid });

    expect(() =>
      writeSubscriptionUsageSnapshot(snapshot('unavailable', '2026-07-31T12:34:52.000Z'), {
        tempDirectory,
        pid,
        replaceFile: () => {
          throw new Error('replace failed');
        },
      })
    ).toThrow('replace failed');
    expect(readFileSync(getSubscriptionUsagePath(tempDirectory), 'utf8')).toBe(initialContent);
    expect(existsSync(`${getSubscriptionUsagePath(tempDirectory)}.${pid}.tmp`)).toBe(false);
  });

  it('removes only the snapshot content published by the current process', () => {
    const tempDirectory = createTempDirectory();
    const pid = 1234;
    const firstContent = writeSubscriptionUsageSnapshot(snapshot('loading', '2026-07-31T12:34:50.000Z'), {
      tempDirectory,
      pid,
    });
    const latestContent = writeSubscriptionUsageSnapshot(snapshot('unavailable', '2026-07-31T12:34:52.000Z'), {
      tempDirectory,
      pid,
    });

    expect(clearSubscriptionUsageSnapshot({ tempDirectory, pid, expectedContent: firstContent })).toBe(false);
    expect(clearSubscriptionUsageSnapshot({ tempDirectory, pid, expectedContent: latestContent })).toBe(true);
    expect(existsSync(getSubscriptionUsagePath(tempDirectory))).toBe(false);
  });
});
