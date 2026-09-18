/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Run and cache the interactive Claude subscription-usage probe. */
import type { ClaudeUsageSnapshot } from '@/common/types/platform/claudeUsage';
import type {
  PtyLaunchCloseReason,
  PtyLaunchContext,
  PtyLaunchSnapshot,
} from '@/common/types/platform/subscriptionUsage';
import { existsSync } from 'node:fs';
import { delimiter, extname, join, win32 } from 'node:path';
import { spawn, type IPty } from 'node-pty';
import { getPtyMonitorService } from '../ptyMonitor';
import { parseClaudeUsageOutput, stripClaudeUsageTerminalOutput } from './usageParser';

const DEFAULT_SUCCESS_TTL_MS = 120_000;
const DEFAULT_FAILURE_TTL_MS = 120_000;
const DEFAULT_COMMAND_DELAY_MS = 25_000;
const DEFAULT_READY_COMMAND_DELAY_MS = 12_000;
const DEFAULT_EXIT_COMMAND_DELAY_MS = 1_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CAPTURE_CHARS = 256 * 1024;
const TRUST_CONFIRMATION = /quick safety check|trust this folder/i;
const USAGE_DIALOG_DISMISSED = /settings dialog dismissed/i;

export type SpawnPty = typeof spawn;

export type ClaudeUsageProbeOptions = {
  command?: string;
  commandDelayMs?: number;
  env?: NodeJS.ProcessEnv;
  exitCommandDelayMs?: number;
  failureTtlMs?: number;
  now?: () => number;
  readyCommandDelayMs?: number;
  spawnPty?: SpawnPty;
  successTtlMs?: number;
  timeoutMs?: number;
  trackPtyLaunch?: (launch: Omit<PtyLaunchSnapshot, 'id' | 'startedAt'>) => string;
  finishPtyLaunch?: (launchId: string, reason: PtyLaunchCloseReason) => void;
};

type CacheEntry = {
  expiresAt: number;
  value: ClaudeUsageSnapshot | null;
};

const executableExtensions = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] => {
  if (platform !== 'win32') return [''];
  const configured = env.PATHEXT?.split(';').filter(Boolean) ?? ['.COM', '.EXE', '.BAT', '.CMD'];
  return ['', ...configured];
};

/**
 * Resolve an executable before passing it to node-pty. On Windows, ConPTY does
 * not perform PATHEXT lookup for a bare command name.
 */
export const resolveExecutableFromPath = (
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  pathExists: (path: string) => boolean = existsSync
): string | undefined => {
  if (command.includes('/') || command.includes('\\')) {
    return pathExists(command) ? command : undefined;
  }

  const extensions = extname(command) ? [''] : executableExtensions(env, platform);
  const pathDelimiter = platform === 'win32' ? ';' : delimiter;
  const pathEntries = env.PATH?.split(pathDelimiter).map((entry) => entry.replace(/^"|"$/g, '').trim()) ?? [];
  for (const pathEntry of pathEntries) {
    if (!pathEntry) continue;
    for (const extension of extensions) {
      const candidate =
        platform === 'win32'
          ? win32.join(pathEntry, `${command}${extension}`)
          : join(pathEntry, `${command}${extension}`);
      if (pathExists(candidate)) return candidate;
    }
  }
  return undefined;
};

export class ClaudeUsageProbe {
  readonly #command: string;
  readonly #commandDelayMs: number;
  readonly #env: NodeJS.ProcessEnv;
  readonly #exitCommandDelayMs: number;
  readonly #failureTtlMs: number;
  readonly #now: () => number;
  readonly #readyCommandDelayMs: number;
  readonly #spawnPty: SpawnPty;
  readonly #successTtlMs: number;
  readonly #timeoutMs: number;
  readonly #trackPtyLaunch: (launch: Omit<PtyLaunchSnapshot, 'id' | 'startedAt'>) => string;
  readonly #finishPtyLaunch: (launchId: string, reason: PtyLaunchCloseReason) => void;

  #cache: CacheEntry | undefined;
  #inFlight: Promise<ClaudeUsageSnapshot | null> | undefined;

  constructor(options: ClaudeUsageProbeOptions = {}) {
    this.#command = options.command ?? 'claude';
    this.#commandDelayMs = options.commandDelayMs ?? DEFAULT_COMMAND_DELAY_MS;
    this.#env = options.env ?? process.env;
    this.#exitCommandDelayMs = options.exitCommandDelayMs ?? DEFAULT_EXIT_COMMAND_DELAY_MS;
    this.#failureTtlMs = options.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS;
    this.#now = options.now ?? Date.now;
    this.#readyCommandDelayMs = options.readyCommandDelayMs ?? DEFAULT_READY_COMMAND_DELAY_MS;
    this.#spawnPty = options.spawnPty ?? spawn;
    this.#successTtlMs = options.successTtlMs ?? DEFAULT_SUCCESS_TTL_MS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#trackPtyLaunch = options.trackPtyLaunch ?? ((launch) => getPtyMonitorService().trackLaunch(launch));
    this.#finishPtyLaunch =
      options.finishPtyLaunch ?? ((launchId, reason) => getPtyMonitorService().finishLaunch(launchId, reason));
  }

  async getUsage(cwd: string, context: PtyLaunchContext = {}): Promise<ClaudeUsageSnapshot | null> {
    const now = this.#now();
    if (this.#cache && this.#cache.expiresAt > now) return this.#cache.value;
    if (this.#inFlight) return this.#inFlight;

    const request = this.#runProbe(cwd, context)
      .then((value) => {
        this.#cache = {
          value,
          expiresAt: this.#now() + (value ? this.#successTtlMs : this.#failureTtlMs),
        };
        return value;
      })
      .catch((error: unknown): ClaudeUsageSnapshot | null => {
        console.warn('[ClaudeUsageProbe] Unable to refresh Claude plan usage', {
          reason: error instanceof Error ? error.message : String(error),
        });
        this.#cache = {
          value: null,
          expiresAt: this.#now() + this.#failureTtlMs,
        };
        return null;
      })
      .finally(() => {
        if (this.#inFlight === request) this.#inFlight = undefined;
      });

    this.#inFlight = request;
    return request;
  }

  #runProbe(cwd: string, context: PtyLaunchContext): Promise<ClaudeUsageSnapshot | null> {
    const executable = resolveExecutableFromPath(this.#command, this.#env);
    if (!executable) {
      return Promise.reject(new Error('Claude executable was not found on PATH'));
    }

    return new Promise((resolve, reject) => {
      let terminal: IPty;
      try {
        terminal = this.#spawnPty(executable, ['--ax-screen-reader', '--safe-mode'], {
          cwd,
          env: this.#env,
          name: 'xterm-256color',
          cols: 120,
          rows: 50,
        });
      } catch (error) {
        reject(error);
        return;
      }

      let launchId: string | undefined;
      try {
        launchId = this.#trackPtyLaunch({
          purpose: 'claude-usage-probe',
          conversationId: context.conversationId,
          conversationName: context.conversationName,
          childPid: terminal.pid,
        });
      } catch {
        // Monitoring must never interfere with subscription usage collection.
      }

      let captured = '';
      let completedSnapshot: ClaudeUsageSnapshot | undefined;
      let commandSent = false;
      let cleanupQueued = false;
      let exited = false;
      let settled = false;
      let trustConfirmed = false;
      let dataSubscription: { dispose(): void } | undefined;
      let exitSubscription: { dispose(): void } | undefined;
      let commandTimer: ReturnType<typeof setTimeout> | undefined;
      let readyCommandTimer: ReturnType<typeof setTimeout> | undefined;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = (
        value: ClaudeUsageSnapshot | null,
        error?: Error,
        reason: PtyLaunchCloseReason = 'completed'
      ): void => {
        if (settled) return;
        settled = true;
        if (commandTimer) clearTimeout(commandTimer);
        if (readyCommandTimer) clearTimeout(readyCommandTimer);
        if (cleanupTimer) clearTimeout(cleanupTimer);
        if (shutdownTimer) clearTimeout(shutdownTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        dataSubscription?.dispose();
        exitSubscription?.dispose();
        try {
          // node-pty's Windows exit event closes its streams but does not
          // release the ConPTY agent. Always kill the terminal so conhost.exe
          // cannot accumulate after otherwise clean Claude exits.
          terminal.kill();
        } catch {
          // The PTY may already have been fully released.
        }
        if (launchId) {
          try {
            this.#finishPtyLaunch(launchId, reason);
          } catch {
            // Monitoring must never interfere with subscription usage collection.
          }
        }
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };

      const writeIfActive = (value: string): boolean => {
        if (settled || exited) return false;
        try {
          terminal.write(value);
          return true;
        } catch {
          return false;
        }
      };

      const sendUsageCommand = (): void => {
        if (commandSent || !writeIfActive('/usage\r')) return;
        commandSent = true;
        if (commandTimer) clearTimeout(commandTimer);
        if (readyCommandTimer) clearTimeout(readyCommandTimer);
      };

      const scheduleFallbackCommand = (): void => {
        if (commandTimer) clearTimeout(commandTimer);
        commandTimer = setTimeout(sendUsageCommand, this.#commandDelayMs);
      };

      const scheduleReadyCommand = (): void => {
        if (commandSent || settled || exited) return;
        if (readyCommandTimer) clearTimeout(readyCommandTimer);
        readyCommandTimer = setTimeout(sendUsageCommand, this.#readyCommandDelayMs);
      };

      const closeGracefully = (snapshot: ClaudeUsageSnapshot): void => {
        if (completedSnapshot) return;
        completedSnapshot = snapshot;
        if (commandTimer) clearTimeout(commandTimer);
        if (readyCommandTimer) clearTimeout(readyCommandTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);

        // `/usage` is a settings dialog. Close it before releasing the PTY.
        // Letting Claude exit first can strand the Windows ConPTY host because
        // node-pty can no longer enumerate the finished console session.
        writeIfActive('\u001b');
        shutdownTimer = setTimeout(() => finish(snapshot, undefined, 'shutdown-timeout'), DEFAULT_SHUTDOWN_TIMEOUT_MS);
      };

      dataSubscription = terminal.onData((chunk) => {
        captured = `${captured}${chunk}`.slice(-MAX_CAPTURE_CHARS);
        const plainOutput = stripClaudeUsageTerminalOutput(captured);
        if (!trustConfirmed && TRUST_CONFIRMATION.test(plainOutput)) {
          trustConfirmed = true;
          writeIfActive('y\r');
          scheduleFallbackCommand();
          return;
        }

        if (completedSnapshot) {
          if (!cleanupQueued && USAGE_DIALOG_DISMISSED.test(plainOutput)) {
            cleanupQueued = true;
            const snapshot = completedSnapshot;
            cleanupTimer = setTimeout(() => {
              finish(snapshot, undefined, 'completed');
            }, this.#exitCommandDelayMs);
          }
          return;
        }

        const snapshot = parseClaudeUsageOutput(captured, new Date(this.#now()));
        if (snapshot?.session && snapshot.weekly) {
          closeGracefully(snapshot);
        } else if (plainOutput.trim()) {
          // Claude startup time varies with local configuration. Send /usage
          // after the interactive screen has become quiet, while retaining the
          // fixed delay as a fallback for CLI versions with no readable prompt.
          scheduleReadyCommand();
        }
      });

      exitSubscription = terminal.onExit(() => {
        exited = true;
        finish(completedSnapshot ?? parseClaudeUsageOutput(captured, new Date(this.#now())), undefined, 'exit');
      });

      scheduleFallbackCommand();

      timeoutTimer = setTimeout(() => {
        const partial = parseClaudeUsageOutput(captured, new Date(this.#now()));
        finish(partial, partial ? undefined : new Error('Claude usage probe timed out'), 'timeout');
      }, this.#timeoutMs);
    });
  }
}
