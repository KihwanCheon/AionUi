/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

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

import { buildDatedLogFileName, resolveConsoleLogLevel } from '@/process/utils/configureConsoleLog';

describe('configureConsoleLog', () => {
  it('uses year/month/day directories for frontend log files', () => {
    const date = new Date(Date.UTC(2026, 6, 2, 12));

    expect(buildDatedLogFileName(date)).toBe('2026/07/02/2026-07-02.log');
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
