/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

vi.mock('electron-log/main', () => ({
  default: {
    functions: {},
    hooks: [],
    initialize: vi.fn(),
    transports: {
      console: { level: undefined },
      file: {
        fileName: undefined,
        level: undefined,
        maxSize: undefined,
        resolvePathFn: undefined,
      },
    },
  },
}));

import {
  buildDatedLogFileName,
  cleanupExpiredDatedLogDirectories,
  resolveConsoleLogLevel,
} from '@/process/utils/configureConsoleLog';

describe('configureConsoleLog', () => {
  it('uses year/month/day directories for frontend log files', () => {
    const date = new Date(Date.UTC(2026, 6, 2, 12));

    expect(buildDatedLogFileName(date)).toBe('2026/07/02/2026-07-02.log');
  });

  it('deletes expired dated partitions while preserving the retention boundary and unknown directories', () => {
    const logsRoot = mkdtempSync(path.join(os.tmpdir(), 'aionui-log-retention-'));
    const expired = path.join(logsRoot, '2026/08/28');
    const boundary = path.join(logsRoot, '2026/08/29');
    const current = path.join(logsRoot, '2026/09/11');
    const unknown = path.join(logsRoot, 'manual');

    try {
      for (const directory of [expired, boundary, current, unknown]) {
        mkdirSync(directory, { recursive: true });
        writeFileSync(path.join(directory, 'keep.log'), 'log');
      }

      cleanupExpiredDatedLogDirectories(logsRoot, new Date(2026, 8, 11, 12), 14);

      expect(existsSync(expired)).toBe(false);
      expect(existsSync(boundary)).toBe(true);
      expect(existsSync(current)).toBe(true);
      expect(existsSync(unknown)).toBe(true);
    } finally {
      rmSync(logsRoot, { recursive: true, force: true });
    }
  });
});

describe('resolveConsoleLogLevel', () => {
  it('keeps console output in dev when AIONUI_CONSOLE_LOG is unset', () => {
    expect(resolveConsoleLogLevel({})).toBe('silly');
  });

  it.each(['0', 'false', 'off', 'OFF', ' 0 '])('silences stdio for AIONUI_CONSOLE_LOG=%s', (value) => {
    expect(resolveConsoleLogLevel({ AIONUI_CONSOLE_LOG: value })).toBe(false);
  });

  it.each(['1', 'true', 'on'])('forces stdio for AIONUI_CONSOLE_LOG=%s', (value) => {
    expect(resolveConsoleLogLevel({ AIONUI_CONSOLE_LOG: value })).toBe('silly');
  });

  it('falls back to the default for an unrecognized value', () => {
    expect(resolveConsoleLogLevel({ AIONUI_CONSOLE_LOG: 'maybe' })).toBe('silly');
  });
});
