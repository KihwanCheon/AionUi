/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Spec for the rolling-log retention sweep: log files are kept for a bounded
 * number of days and a bounded total size, and the currently active (today's)
 * files are never removed while the app is writing to them.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { DEFAULT_LOG_MAX_TOTAL_BYTES, DEFAULT_LOG_RETENTION_DAYS, pruneLogDirs } from '@/process/utils/logRetention';

const NOW = new Date(2026, 8, 11, 12, 0, 0);

function dateKeyDaysAgo(days: number): string {
  const date = new Date(NOW);
  date.setDate(date.getDate() - days);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Write `<root>/YYYY/MM/DD/YYYY-MM-DD.<suffix>` with `bytes` of content. */
function writeDatedLog(root: string, daysAgo: number, suffix: string, bytes = 16): string {
  const [year, month, day] = dateKeyDaysAgo(daysAgo).split('-');
  const dir = path.join(root, year, month, day);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${year}-${month}-${day}.${suffix}`);
  writeFileSync(filePath, 'x'.repeat(bytes));
  return filePath;
}

function withTempRoot<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(path.join(tmpdir(), 'aionui-log-retention-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('pruneLogDirs — age retention', () => {
  it('keeps files inside the retention window and deletes older ones', () => {
    withTempRoot((root) => {
      const fresh = writeDatedLog(root, 0, 'log');
      const edge = writeDatedLog(root, 9, 'aioncore.log');
      const stale = writeDatedLog(root, 10, 'aionrs.log');
      const ancient = writeDatedLog(root, 40, 'log');

      const result = pruneLogDirs([root], { maxAgeDays: 10, maxTotalBytes: DEFAULT_LOG_MAX_TOTAL_BYTES, now: NOW });

      expect(existsSync(fresh)).toBe(true);
      expect(existsSync(edge)).toBe(true);
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(ancient)).toBe(false);
      expect(result.removedFiles).toBe(2);
    });
  });

  it('covers every rolling-log flavour written under the log root', () => {
    withTempRoot((root) => {
      const electronRolled = writeDatedLog(root, 20, 'old.log');
      const backend = writeDatedLog(root, 20, 'aioncore.log');
      const aionrs = writeDatedLog(root, 20, 'aionrs.log');
      const launcher = writeDatedLog(root, 20, 'stdio.log');

      pruneLogDirs([root], { maxAgeDays: 10, maxTotalBytes: DEFAULT_LOG_MAX_TOTAL_BYTES, now: NOW });

      for (const file of [electronRolled, backend, aionrs, launcher]) {
        expect(existsSync(file)).toBe(false);
      }
    });
  });

  it('leaves non-log files alone', () => {
    withTempRoot((root) => {
      const dir = path.join(root, '2020', '01', '01');
      mkdirSync(dir, { recursive: true });
      const keep = path.join(dir, 'notes.txt');
      writeFileSync(keep, 'keep me');

      pruneLogDirs([root], { maxAgeDays: 10, maxTotalBytes: DEFAULT_LOG_MAX_TOTAL_BYTES, now: NOW });

      expect(existsSync(keep)).toBe(true);
    });
  });

  it('removes date directories left empty by the sweep', () => {
    withTempRoot((root) => {
      writeDatedLog(root, 30, 'log');

      pruneLogDirs([root], { maxAgeDays: 10, maxTotalBytes: DEFAULT_LOG_MAX_TOTAL_BYTES, now: NOW });

      expect(readdirSync(root)).toEqual([]);
    });
  });
});

describe('pruneLogDirs — total size cap', () => {
  it('deletes oldest-first until the total fits the cap', () => {
    withTempRoot((root) => {
      const oldest = writeDatedLog(root, 5, 'log', 400);
      const middle = writeDatedLog(root, 3, 'log', 400);
      const newest = writeDatedLog(root, 1, 'log', 400);

      const result = pruneLogDirs([root], { maxAgeDays: 10, maxTotalBytes: 900, now: NOW });

      expect(existsSync(oldest)).toBe(false);
      expect(existsSync(middle)).toBe(true);
      expect(existsSync(newest)).toBe(true);
      expect(result.totalBytesAfter).toBeLessThanOrEqual(900);
    });
  });

  it("never deletes today's files, even when they alone exceed the cap", () => {
    withTempRoot((root) => {
      const active = writeDatedLog(root, 0, 'aioncore.log', 4096);

      const result = pruneLogDirs([root], { maxAgeDays: 10, maxTotalBytes: 1024, now: NOW });

      expect(existsSync(active)).toBe(true);
      expect(result.totalBytesAfter).toBe(4096);
    });
  });

  it('applies the cap across all log roots together', () => {
    withTempRoot((rootA) => {
      withTempRoot((rootB) => {
        const oldestInA = writeDatedLog(rootA, 6, 'log', 500);
        const newerInB = writeDatedLog(rootB, 2, 'log', 500);

        pruneLogDirs([rootA, rootB], { maxAgeDays: 10, maxTotalBytes: 600, now: NOW });

        expect(existsSync(oldestInA)).toBe(false);
        expect(existsSync(newerInB)).toBe(true);
      });
    });
  });
});

describe('pruneLogDirs — robustness', () => {
  it('ignores log roots that do not exist', () => {
    const missing = path.join(tmpdir(), 'aionui-log-retention-missing-dir');

    expect(() => pruneLogDirs([missing], { maxAgeDays: 10, maxTotalBytes: 1024, now: NOW })).not.toThrow();
  });

  it('de-duplicates a log root listed twice', () => {
    withTempRoot((root) => {
      writeDatedLog(root, 1, 'log', 100);

      const result = pruneLogDirs([root, path.join(root, '.')], {
        maxAgeDays: 10,
        maxTotalBytes: DEFAULT_LOG_MAX_TOTAL_BYTES,
        now: NOW,
      });

      expect(result.totalBytesAfter).toBe(100);
    });
  });
});

describe('retention defaults', () => {
  it('keeps 10 days and at most 2 GB', () => {
    expect(DEFAULT_LOG_RETENTION_DAYS).toBe(10);
    expect(DEFAULT_LOG_MAX_TOTAL_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });
});
