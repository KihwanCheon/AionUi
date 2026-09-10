/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Redirect main-process console output to electron-log so that all
 * console.log / console.warn / console.error calls are persisted to
 * daily log files on disk.
 *
 * Log file location (managed by electron-log):
 *   - macOS:   ~/Library/Logs/AionUi/YYYY/MM/DD/YYYY-MM-DD.log
 *   - Windows: %USERPROFILE%\AppData\Roaming\AionUi\logs\YYYY\MM\DD\YYYY-MM-DD.log
 *   - Linux:   ~/.config/AionUi/logs/YYYY/MM/DD/YYYY-MM-DD.log
 *
 * Users can share the relevant date's file for debugging (#1157).
 *
 * Must be imported as early as possible in the main process entry point,
 * BEFORE any other module emits console output.
 */

import { app } from 'electron';
import log from 'electron-log/main';
import fs, { type Dirent } from 'node:fs';
import path from 'node:path';

const FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB
const FILE_LOG_LEVEL = 'info';
const CONSOLE_LOG_LEVEL = 'silly';
const LOG_RETENTION_DAYS = 14;
const LOG_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
let nextLogCleanupAt = 0;

type LogPathMessage = {
  date?: Date | number | string;
};

function formatLocalDateParts(date: Date): { year: string; month: string; day: string; dateStr: string } {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return {
    year,
    month,
    day,
    dateStr: `${year}-${month}-${day}`,
  };
}

export function buildDatedLogFileName(date = new Date()): string {
  const { year, month, day, dateStr } = formatLocalDateParts(date);
  return `${year}/${month}/${day}/${dateStr}.log`;
}

function removeDirectoryIfEmpty(directory: string): void {
  try {
    if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  } catch {
    // Best effort: logging must keep working even when cleanup cannot inspect a directory.
  }
}

function parseLogPartitionDate(year: string, month: string, day: string): Date | null {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return null;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    parsed.getFullYear() !== Number(year) ||
    parsed.getMonth() !== Number(month) - 1 ||
    parsed.getDate() !== Number(day)
  ) {
    return null;
  }
  return parsed;
}

export function cleanupExpiredDatedLogDirectories(
  logsRoot: string,
  now = new Date(),
  retentionDays = LOG_RETENTION_DAYS
): void {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Math.max(1, retentionDays) + 1);

  let years: Dirent[];
  try {
    years = fs.readdirSync(logsRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const year of years) {
    if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
    const yearPath = path.join(logsRoot, year.name);
    let months: Dirent[];
    try {
      months = fs.readdirSync(yearPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const month of months) {
      if (!month.isDirectory() || !/^\d{2}$/.test(month.name)) continue;
      const monthPath = path.join(yearPath, month.name);
      let days: Dirent[];
      try {
        days = fs.readdirSync(monthPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const day of days) {
        if (!day.isDirectory()) continue;
        const partitionDate = parseLogPartitionDate(year.name, month.name, day.name);
        if (partitionDate && partitionDate < cutoff) {
          try {
            fs.rmSync(path.join(monthPath, day.name), { recursive: true, force: true });
          } catch {
            // Best effort: a locked log must not interrupt application startup.
          }
        }
      }

      removeDirectoryIfEmpty(monthPath);
    }

    removeDirectoryIfEmpty(yearPath);
  }
}

function maybeCleanupExpiredLogs(logsRoot: string, now: Date): void {
  const nowMs = now.getTime();
  if (nowMs < nextLogCleanupAt) return;
  nextLogCleanupAt = nowMs + LOG_CLEANUP_INTERVAL_MS;
  cleanupExpiredDatedLogDirectories(logsRoot, now);
}

function resolveMessageDate(message?: LogPathMessage): Date {
  const rawDate = message?.date;
  const date = rawDate instanceof Date ? rawDate : rawDate ? new Date(rawDate) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

// Daily log file: e.g. 2026/03/12/2026-03-12.log
log.transports.file.fileName = buildDatedLogFileName();
log.transports.file.resolvePathFn = (variables, message?: LogPathMessage) => {
  const messageDate = resolveMessageDate(message);
  maybeCleanupExpiredLogs(variables.libraryDefaultDir, messageDate);
  const filePath = path.join(variables.libraryDefaultDir, buildDatedLogFileName(messageDate));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return filePath;
};

// --- Main-process logger (frontend) ---
log.transports.file.level = FILE_LOG_LEVEL;
log.transports.file.maxSize = FILE_SIZE_LIMIT;
/**
 * Console (stdio) transport level.
 *
 * `AIONUI_CONSOLE_LOG` overrides the default in both directions:
 *   - `0` / `false` / `off` — silence stdio completely, keep file logs only
 *   - `1` / `true` / `on`   — force console output even in a packaged build
 * Unset keeps the historical behaviour: console in dev, silent when packaged.
 */
export function resolveConsoleLogLevel(env: NodeJS.ProcessEnv = process.env): typeof CONSOLE_LOG_LEVEL | false {
  const override = env.AIONUI_CONSOLE_LOG?.trim().toLowerCase();
  if (override === '0' || override === 'false' || override === 'off') return false;
  if (override === '1' || override === 'true' || override === 'on') return CONSOLE_LOG_LEVEL;
  return app.isPackaged ? false : CONSOLE_LOG_LEVEL;
}

log.transports.console.level = resolveConsoleLogLevel();

const BACKEND_PREFIX = '[aioncore]';

// Strip ANSI escape sequences from a string.
const ANSI_RE = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

const TRACING_LEVEL_MAP: Record<string, string> = {
  TRACE: 'verbose',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};

// Parse tracing output: "2026-04-25T11:17:43.184875Z  INFO target: message"
// Returns { level, body } where body is "target: message" (timestamp and level stripped).
const TRACING_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+([\s\S]*)$/;

function parseTracingLine(raw: string): { level: string; body: string } {
  const clean = raw.replace(ANSI_RE, '');
  const m = TRACING_RE.exec(clean);
  if (m) return { level: TRACING_LEVEL_MAP[m[1]] ?? 'info', body: m[2] };
  return { level: 'info', body: clean };
}

// Clean up backend subprocess log lines: strip tracing timestamps/levels,
// resolve the log level, and keep them in the shared log file.
log.hooks.push((message, _transport) => {
  const first = message.data[0];
  if (typeof first !== 'string' || !first.startsWith(BACKEND_PREFIX)) return message;

  const raw = first.slice(BACKEND_PREFIX.length + 1);
  const { level, body } = parseTracingLine(raw);
  const resolved = level as typeof message.level;

  return { ...message, level: resolved, data: [`${BACKEND_PREFIX} ${body}`, ...message.data.slice(1)] };
});

// Patch global console so every console.log/warn/error from any module
// goes through electron-log (and thus to the file transport).
log.initialize();

// log.initialize() only patches the renderer via preload.
// Explicitly redirect main-process console to electron-log.
Object.assign(console, log.functions);
