/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parseClaudeUsageOutput,
  parseClaudeUsageResetAt,
  stripClaudeUsageTerminalOutput,
} from '@process/usage/claude/usageParser';

const CAPTURED_USAGE_OUTPUT = `
\u001b[2JSettings  Status   Config   Usage   Stats
Session
Usage:                 0 input, 0 output, 0 cache read, 0 cache write
Current session
25% 25% used
Resets 8:30am (Asia/Seoul)
Current week (all models)
24% 24% used
Resets Aug 4, 9pm (Asia/Seoul)
What's contributing to your limits usage?
`;

describe('Claude usage output parser', () => {
  it('parses session and weekly plan limits from the screen-reader view', () => {
    const now = new Date(2026, 6, 31, 7, 0, 0);

    const result = parseClaudeUsageOutput(CAPTURED_USAGE_OUTPUT, now);

    expect(result?.session).toEqual({
      rateLimitType: 'five_hour',
      utilization: 25,
      utilizationUnit: 'percent',
      resetsAt: new Date(2026, 6, 31, 8, 30, 0).getTime(),
    });
    expect(result?.weekly).toEqual({
      rateLimitType: 'seven_day',
      utilization: 24,
      utilizationUnit: 'percent',
      resetsAt: new Date(2026, 7, 4, 21, 0, 0).getTime(),
    });
    expect(result?.updatedAt).toBe(now.getTime());
  });

  it('returns partial data when an account exposes only the current-session bucket', () => {
    const result = parseClaudeUsageOutput(
      `
      Current session
      12% used
      Resets 11pm
      `,
      new Date(2026, 6, 31, 10, 0, 0)
    );

    expect(result?.session?.utilization).toBe(12);
    expect(result?.weekly).toBeUndefined();
  });

  it('preserves current-session usage beyond one hundred percent', () => {
    const result = parseClaudeUsageOutput(`Current session\n103% used\nCurrent week (all models)\n37% used`);

    expect(result?.session?.utilization).toBe(103);
    expect(result?.weekly?.utilization).toBe(37);
  });

  it('returns null for unrelated or malformed output', () => {
    expect(parseClaudeUsageOutput('Claude Code is ready')).toBeNull();
    expect(parseClaudeUsageOutput('Current session\nunknown\nResets soon')).toBeNull();
  });

  it('removes ANSI and OSC terminal control sequences', () => {
    expect(stripClaudeUsageTerminalOutput('\u001b[31mCurrent session\u001b[0m\r\u001b]0;Claude\u0007')).toBe(
      'Current session\n'
    );
  });
});

describe('Claude usage reset parser', () => {
  it('rolls a time-only reset into the next day after the time has passed', () => {
    const now = new Date(2026, 6, 31, 22, 0, 0);
    expect(parseClaudeUsageResetAt('8:30am (Asia/Seoul)', now)).toBe(new Date(2026, 7, 1, 8, 30, 0).getTime());
  });

  it('rolls a dated reset into the next year when needed', () => {
    const now = new Date(2026, 11, 31, 22, 0, 0);
    expect(parseClaudeUsageResetAt('Jan 2, 9pm (Asia/Seoul)', now)).toBe(new Date(2027, 0, 2, 21, 0, 0).getTime());
  });

  it('rejects invalid reset labels instead of inventing a timestamp', () => {
    const now = new Date(2026, 6, 31, 7, 0, 0);
    expect(parseClaudeUsageResetAt('Soon', now)).toBeUndefined();
    expect(parseClaudeUsageResetAt('Feb 31, 9pm', now)).toBeUndefined();
  });
});
