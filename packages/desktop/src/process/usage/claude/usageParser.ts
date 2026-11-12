/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Parse the interactive Claude `/usage` screen into provider-neutral window data. */
import type {
  ClaudeRateLimitInfo,
  ClaudeRateLimitType,
  ClaudeUsageSnapshot,
} from '@/common/types/platform/claudeUsage';

const MONTHS = new Map([
  ['jan', 0],
  ['january', 0],
  ['feb', 1],
  ['february', 1],
  ['mar', 2],
  ['march', 2],
  ['apr', 3],
  ['april', 3],
  ['may', 4],
  ['jun', 5],
  ['june', 5],
  ['jul', 6],
  ['july', 6],
  ['aug', 7],
  ['august', 7],
  ['sep', 8],
  ['september', 8],
  ['oct', 9],
  ['october', 9],
  ['nov', 10],
  ['november', 10],
  ['dec', 11],
  ['december', 11],
]);

const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);
const OSC_SEQUENCE = new RegExp(
  `${ESCAPE_CHARACTER}\\][^${BELL_CHARACTER}]*(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`,
  'g'
);
const CSI_SEQUENCE = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, 'g');
const USED_PERCENT = /(\d+(?:\.\d+)?)%\s+used/i;

type Clock = {
  hours: number;
  minutes: number;
};

export const stripClaudeUsageTerminalOutput = (value: string): string =>
  value.replace(OSC_SEQUENCE, '').replace(CSI_SEQUENCE, '').replace(/\r/g, '\n');

const parseClock = (value: string): Clock | undefined => {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!match) return undefined;

  const rawHours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (rawHours < 1 || rawHours > 12 || minutes < 0 || minutes > 59) return undefined;

  const period = match[3].toLowerCase();
  const hours = (rawHours % 12) + (period === 'pm' ? 12 : 0);
  return { hours, minutes };
};

const withClock = (date: Date, clock: Clock): Date => {
  const result = new Date(date);
  result.setHours(clock.hours, clock.minutes, 0, 0);
  return result;
};

/**
 * Parse the human-readable reset timestamp emitted by Claude Code `/usage`.
 *
 * Verified against a live Claude Code 2.1.220 PTY capture on 2026-07-31:
 * - `Resets 8:30am (Asia/Seoul)`
 * - `Resets Aug 4, 9pm (Asia/Seoul)`
 */
export const parseClaudeUsageResetAt = (value: string, now: Date): number | undefined => {
  const withoutZone = value.replace(/\s+\([^)]+\)\s*$/, '').trim();

  const directClock = parseClock(withoutZone);
  if (directClock) {
    let candidate = withClock(now, directClock);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime();
  }

  const relativeMatch = withoutZone.match(/^(today|tomorrow),?\s+(.+)$/i);
  if (relativeMatch) {
    const clock = parseClock(relativeMatch[2]);
    if (!clock) return undefined;
    const candidate = withClock(now, clock);
    if (relativeMatch[1].toLowerCase() === 'tomorrow') {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime() > now.getTime() ? candidate.getTime() : undefined;
  }

  const datedMatch = withoutZone.match(/^([a-z]+)\s+(\d{1,2}),?\s+(.+)$/i);
  if (!datedMatch) return undefined;

  const month = MONTHS.get(datedMatch[1].toLowerCase());
  const day = Number(datedMatch[2]);
  const clock = parseClock(datedMatch[3]);
  if (month === undefined || !clock || day < 1 || day > 31) return undefined;

  let candidate = new Date(now.getFullYear(), month, day, clock.hours, clock.minutes, 0, 0);
  if (candidate.getMonth() !== month || candidate.getDate() !== day) return undefined;

  if (candidate.getTime() <= now.getTime()) {
    const sameCalendarDay = candidate.getMonth() === now.getMonth() && candidate.getDate() === now.getDate();
    if (sameCalendarDay) return undefined;
    candidate = new Date(now.getFullYear() + 1, month, day, clock.hours, clock.minutes, 0, 0);
  }
  return candidate.getTime();
};

const parseBucket = (
  lines: string[],
  heading: RegExp,
  rateLimitType: ClaudeRateLimitType,
  now: Date
): ClaudeRateLimitInfo | undefined => {
  const headingIndex = lines.findIndex((line) => heading.test(line));
  if (headingIndex < 0) return undefined;

  const section = lines.slice(headingIndex + 1, headingIndex + 8);
  const percentLine = section.find((line) => USED_PERCENT.test(line));
  const match = percentLine?.match(USED_PERCENT);
  if (!match) return undefined;

  const utilization = Number(match[1]);
  if (!Number.isFinite(utilization) || utilization < 0) return undefined;

  const resetLine = section.find((line) => /^resets\s+/i.test(line));
  const resetsAt = resetLine ? parseClaudeUsageResetAt(resetLine.replace(/^resets\s+/i, ''), now) : undefined;

  return {
    rateLimitType,
    utilization,
    utilizationUnit: 'percent',
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
};

/**
 * Parse the plan-limit section from Claude Code's screen-reader-friendly
 * `/usage` view. Returns partial data when only one bucket is available.
 */
export const parseClaudeUsageOutput = (raw: string, now = new Date()): ClaudeUsageSnapshot | null => {
  const lines = stripClaudeUsageTerminalOutput(raw)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const session = parseBucket(lines, /^current session$/i, 'five_hour', now);
  const weekly = parseBucket(lines, /^current week(?:\s+\(all models\))?$/i, 'seven_day', now);
  if (!session && !weekly) return null;

  return {
    ...(session ? { session } : {}),
    ...(weekly ? { weekly } : {}),
    updatedAt: now.getTime(),
  };
};
