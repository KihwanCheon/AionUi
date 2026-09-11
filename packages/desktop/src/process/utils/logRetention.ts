/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Retention sweep for the rolling log tree.
 *
 * Both writers roll daily into the same layout under the platform log dir:
 *   - electron-log (main/renderer): `YYYY/MM/DD/YYYY-MM-DD.log` (+ `.old.log`
 *     once a single day passes the per-file size limit)
 *   - aioncore (backend):           `YYYY/MM/DD/YYYY-MM-DD.aioncore.log`
 *                                   `YYYY/MM/DD/YYYY-MM-DD.aionrs.log`
 *
 * Neither writer ever deletes anything, so the tree grows without bound. This
 * module bounds it on two axes: age (days kept) and total size across every
 * log root. Today's files are never removed — they are open in append mode,
 * and unlinking them would leak the inode while the app keeps writing to it.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_LOG_RETENTION_DAYS = 10;
export const DEFAULT_LOG_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LOG_FILE_SUFFIX = '.log';
const DATE_PREFIX_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

export type LogRetentionOptions = {
  /** Days of logs to keep, counting today as day 1. */
  maxAgeDays: number;
  /** Upper bound on the combined size of every retained log file. */
  maxTotalBytes: number;
  /** Injection point for tests; defaults to the current time. */
  now?: Date;
};

export type LogRetentionResult = {
  scannedFiles: number;
  removedFiles: number;
  removedBytes: number;
  totalBytesAfter: number;
};

type LogFile = {
  path: string;
  size: number;
  /** Days since the Unix epoch, derived from the file's log date. */
  day: number;
};

/** Days since the Unix epoch for a local calendar date. */
function toDayNumber(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function dayNumberOf(date: Date): number {
  return toDayNumber(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * The day a log file belongs to. The dated file name is authoritative; a file
 * without one (an ad-hoc capture dropped into the tree) falls back to mtime so
 * it is still subject to retention rather than living forever.
 */
function resolveLogDay(filePath: string, stat: fs.Stats): number {
  const match = DATE_PREFIX_PATTERN.exec(path.basename(filePath));
  if (match) return toDayNumber(Number(match[1]), Number(match[2]), Number(match[3]));
  return dayNumberOf(new Date(stat.mtimeMs));
}

function collectLogFiles(dir: string, out: LogFile[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        collectLogFiles(fullPath, out);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(LOG_FILE_SUFFIX)) continue;
      const stat = fs.statSync(fullPath);
      out.push({ path: fullPath, size: stat.size, day: resolveLogDay(fullPath, stat) });
    } catch {
      // Skip entries that vanish or are unreadable mid-sweep.
    }
  }
}

/** Drop directories the sweep emptied, bottom-up, without touching `root`. */
function removeEmptyDirs(dir: string, root: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    const fullPath = path.join(dir, name);
    try {
      if (fs.statSync(fullPath).isDirectory()) removeEmptyDirs(fullPath, root);
    } catch {
      // Skip unreadable entries.
    }
  }

  if (path.resolve(dir) === path.resolve(root)) return;
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // A concurrent write can repopulate the directory; leave it.
  }
}

function normalizeRoots(dirs: string[]): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    roots.push(resolved);
  }
  return roots;
}

/**
 * Enforce the age and total-size bounds across every given log root.
 * Missing or unreadable roots are skipped — retention must never be the reason
 * the app fails to start.
 */
export function pruneLogDirs(dirs: string[], options: LogRetentionOptions): LogRetentionResult {
  const roots = normalizeRoots(dirs);
  const today = dayNumberOf(options.now ?? new Date());
  const oldestKeptDay = today - Math.max(1, options.maxAgeDays) + 1;

  const files: LogFile[] = [];
  for (const root of roots) collectLogFiles(root, files);

  const result: LogRetentionResult = {
    scannedFiles: files.length,
    removedFiles: 0,
    removedBytes: 0,
    totalBytesAfter: 0,
  };

  const remove = (file: LogFile): boolean => {
    try {
      fs.unlinkSync(file.path);
    } catch {
      return false;
    }
    result.removedFiles += 1;
    result.removedBytes += file.size;
    return true;
  };

  const retained: LogFile[] = [];
  for (const file of files) {
    if (file.day < oldestKeptDay && remove(file)) continue;
    retained.push(file);
  }

  let totalBytes = retained.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > options.maxTotalBytes) {
    // Oldest first, and never the files still being appended to today.
    const evictable = retained
      .filter((file) => file.day < today)
      .toSorted((a, b) => a.day - b.day || a.path.localeCompare(b.path));
    for (const file of evictable) {
      if (totalBytes <= options.maxTotalBytes) break;
      if (remove(file)) totalBytes -= file.size;
    }
  }

  result.totalBytesAfter = totalBytes;
  for (const root of roots) removeEmptyDirs(root, root);
  return result;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

/**
 * Retention bounds, overridable per machine:
 *   AIONUI_LOG_RETENTION_DAYS  — days kept (default 10)
 *   AIONUI_LOG_MAX_TOTAL_MB    — total cap in MB (default 2048)
 */
export function resolveLogRetentionOptions(): LogRetentionOptions {
  return {
    maxAgeDays: readPositiveIntEnv('AIONUI_LOG_RETENTION_DAYS', DEFAULT_LOG_RETENTION_DAYS),
    maxTotalBytes:
      readPositiveIntEnv('AIONUI_LOG_MAX_TOTAL_MB', DEFAULT_LOG_MAX_TOTAL_BYTES / (1024 * 1024)) * 1024 * 1024,
  };
}

/**
 * Sweep now and every 6 hours so a long-running session still rolls off old
 * days. Returns a stop function; failures are logged and swallowed.
 */
export function startLogRetention(getLogDirs: () => string[], options = resolveLogRetentionOptions()): () => void {
  const sweep = (): void => {
    try {
      const result = pruneLogDirs(getLogDirs(), options);
      if (result.removedFiles > 0) {
        console.info(
          `[logRetention] removed ${result.removedFiles} file(s), ${Math.round(result.removedBytes / 1024 / 1024)} MB; ` +
            `${Math.round(result.totalBytesAfter / 1024 / 1024)} MB retained`
        );
      }
    } catch (error) {
      console.warn('[logRetention] sweep failed:', error);
    }
  };

  sweep();
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
