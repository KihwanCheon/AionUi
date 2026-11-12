/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fork: remove the Claude transcripts left by the usage probe. Each probe run
 * is an interactive Claude session that only opens `/usage`; without cleanup
 * one transcript per run accumulates.
 */
import { readdirSync, readFileSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const MAX_PROBE_TRANSCRIPT_BYTES = 4096;
const PROBE_ENTRY_TYPES = new Set(['mode', 'permission-mode', 'session-owner', 'system', 'last-prompt', 'cost-state']);

/** Claude stores a folder's sessions under `projects/<path with non-alphanumerics as "-">`. */
export const claudeProjectDirectory = (configDir: string, workingDirectory: string): string =>
  join(configDir, 'projects', workingDirectory.replace(/[^a-zA-Z0-9]/g, '-'));

/**
 * Project folders that may hold the probe's sessions. On macOS the data folder
 * is reached through a home-directory symlink while Claude records the resolved
 * path, so both spellings are covered.
 */
export const probeProjectDirectories = (
  configDir: string,
  workingDirectory: string,
  resolvePath: (path: string) => string = realpathSync
): string[] => {
  const paths = [workingDirectory];
  try {
    paths.push(resolvePath(workingDirectory));
  } catch {
    // The folder may not exist yet; the given path is still checked.
  }
  return [...new Set(paths.map((path) => claudeProjectDirectory(configDir, path)))];
};

/**
 * True only for a transcript holding nothing but local `/usage` commands and
 * session bookkeeping: no user or assistant message and no other command.
 */
export const isProbeTranscript = (text: string): boolean => {
  let usageCommand = false;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry: { type?: unknown; subtype?: unknown; content?: unknown };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      return false;
    }
    if (typeof entry.type !== 'string' || !PROBE_ENTRY_TYPES.has(entry.type)) return false;
    if (entry.type !== 'system') continue;
    if (entry.subtype !== 'local_command') return false;
    const content = typeof entry.content === 'string' ? entry.content : '';
    const commands = [...content.matchAll(/<command-name>([^<]*)<\/command-name>/g)].map((match) => match[1].trim());
    if (commands.some((command) => command !== '/usage')) return false;
    if (commands.includes('/usage')) usageCommand = true;
  }
  return usageCommand;
};

/** Delete probe transcripts older than `minAgeMs` in one project folder; returns the count. */
export const removeProbeTranscripts = (projectDirectory: string, minAgeMs: number, now = Date.now()): number => {
  let names: string[];
  try {
    names = readdirSync(projectDirectory).filter((name) => name.endsWith('.jsonl'));
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const path = join(projectDirectory, name);
    try {
      const stat = statSync(path);
      if (stat.size > MAX_PROBE_TRANSCRIPT_BYTES || now - stat.mtimeMs < minAgeMs) continue;
      if (!isProbeTranscript(readFileSync(path, 'utf8'))) continue;
      unlinkSync(path);
      removed += 1;
    } catch {
      // A transcript that disappears or is locked mid-check is left for the next sweep.
    }
  }
  return removed;
};
