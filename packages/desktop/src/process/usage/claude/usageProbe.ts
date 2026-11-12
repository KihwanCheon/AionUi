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
import { existsSync, mkdirSync } from 'node:fs';
import { delimiter, extname, join, win32 } from 'node:path';
import { spawn, type IPty } from 'node-pty';
import { getPtyMonitorService } from '../ptyMonitor';
import { parseClaudeUsageOutput, stripClaudeUsageTerminalOutput } from './usageParser';

const DEFAULT_SUCCESS_TTL_MS = 120_000;
const DEFAULT_FAILURE_TTL_MS = 30_000;
const COMMAND_RETRY_DELAY_MS = 10_000;
const MAX_COMMAND_RETRIES = 2;
const DEFAULT_COMMAND_DELAY_MS = 25_000;
const DEFAULT_READY_COMMAND_DELAY_MS = 12_000;
const DEFAULT_EXIT_COMMAND_DELAY_MS = 1_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_PARTIAL_SETTLE_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CAPTURE_CHARS = 256 * 1024;
const TRUST_CONFIRMATION = /quick safety check|trust this folder/i;
const USAGE_DIALOG_DISMISSED = /settings dialog dismissed/i;

export type SpawnPty = typeof spawn;

type DestroyablePty = IPty & {
  destroy?: () => void;
};

/** Close the PTY transport as well as its child process on Unix-like hosts. */
export const releasePty = (terminal: IPty, platform: NodeJS.Platform = process.platform): void => {
  if (platform !== 'win32') {
    const destroyable = terminal as DestroyablePty;
    const destroy = destroyable.destroy;
    if (typeof destroy === 'function') {
      try {
        destroy.call(terminal);
        return;
      } catch {
        // Fall through so the child is still terminated by alternate implementations.
      }
    }
  }
  terminal.kill();
};

export type ClaudeUsageProbeOptions = {
  accountId?: string;
  command?: string;
  commandDelayMs?: number;
  env?: NodeJS.ProcessEnv;
  exitCommandDelayMs?: number;
  failureTtlMs?: number;
  now?: () => number;
  /** Fork: called after each probe console has been released. */
  onFinished?: () => void;
  /**
   * Fork: how long a `/usage` view showing a single bucket may settle before
   * the read finishes with it. Plans without a 5-hour limit (for example
   * Ultra) only ever show the weekly bucket.
   */
  partialSettleMs?: number;
  readyCommandDelayMs?: number;
  spawnPty?: SpawnPty;
  successTtlMs?: number;
  timeoutMs?: number;
  /**
   * Fork: dedicated folder the probe console starts in, so its session stays
   * out of the user's workspaces. Without it the console starts in the
   * workspace passed to `getUsage`.
   */
  workingDirectory?: () => string;
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

  const pathApi = platform === 'win32' ? win32 : { delimiter, extname, join };
  const extensions = pathApi.extname(command) ? [''] : executableExtensions(env, platform);
  const pathEntries = env.PATH?.split(pathApi.delimiter).map((entry) => entry.replace(/^"|"$/g, '').trim()) ?? [];
  for (const pathEntry of pathEntries) {
    if (!pathEntry) continue;
    for (const extension of extensions) {
      const candidate = pathApi.join(pathEntry, `${command}${extension}`);
      if (pathExists(candidate)) return candidate;
    }
  }
  return undefined;
};

export class ClaudeUsageProbe {
  readonly #accountId: string;
  readonly #command: string;
  readonly #commandDelayMs: number;
  readonly #env: NodeJS.ProcessEnv;
  readonly #exitCommandDelayMs: number;
  readonly #failureTtlMs: number;
  readonly #now: () => number;
  readonly #onFinished: (() => void) | undefined;
  readonly #partialSettleMs: number;
  readonly #readyCommandDelayMs: number;
  readonly #spawnPty: SpawnPty;
  readonly #successTtlMs: number;
  readonly #timeoutMs: number;
  readonly #workingDirectory: (() => string) | undefined;
  readonly #trackPtyLaunch: (launch: Omit<PtyLaunchSnapshot, 'id' | 'startedAt'>) => string;
  readonly #finishPtyLaunch: (launchId: string, reason: PtyLaunchCloseReason) => void;

  #cache: CacheEntry | undefined;
  #inFlight: Promise<ClaudeUsageSnapshot | null> | undefined;

  constructor(options: ClaudeUsageProbeOptions = {}) {
    this.#accountId = options.accountId ?? 'default';
    this.#command = options.command ?? 'claude';
    this.#commandDelayMs = options.commandDelayMs ?? DEFAULT_COMMAND_DELAY_MS;
    this.#env = options.env ?? process.env;
    this.#exitCommandDelayMs = options.exitCommandDelayMs ?? DEFAULT_EXIT_COMMAND_DELAY_MS;
    this.#failureTtlMs = options.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS;
    this.#now = options.now ?? Date.now;
    this.#onFinished = options.onFinished;
    this.#partialSettleMs = options.partialSettleMs ?? DEFAULT_PARTIAL_SETTLE_MS;
    this.#readyCommandDelayMs = options.readyCommandDelayMs ?? DEFAULT_READY_COMMAND_DELAY_MS;
    this.#spawnPty = options.spawnPty ?? spawn;
    this.#successTtlMs = options.successTtlMs ?? DEFAULT_SUCCESS_TTL_MS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#workingDirectory = options.workingDirectory;
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
        // Timeouts already have account/phase diagnostics in finish(). Never
        // log spawn errors verbatim: they can include environment or paths.
        if (!(error instanceof Error && error.message === 'Claude usage probe timed out')) {
          console.warn('[ClaudeUsageProbe] Unable to refresh Claude plan usage', {
            accountId: this.#accountId,
            phase: 'startup',
          });
        }
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
        const directory = this.#workingDirectory?.() ?? cwd;
        if (this.#workingDirectory) mkdirSync(directory, { recursive: true });
        terminal = this.#spawnPty(executable, ['--ax-screen-reader', '--safe-mode'], {
          cwd: directory,
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
      // Output after /usage was sent; a single bucket only counts once it appears here.
      let afterCommand = '';
      let completedSnapshot: ClaudeUsageSnapshot | undefined;
      let commandSent = false;
      let cleanupQueued = false;
      let exited = false;
      let settled = false;
      let trustConfirmed = false;
      let commandAccepted = false;
      let commandRetries = 0;
      let phase = 'startup';
      const startedAt = this.#now();
      let dataSubscription: { dispose(): void } | undefined;
      let exitSubscription: { dispose(): void } | undefined;
      let commandTimer: ReturnType<typeof setTimeout> | undefined;
      let readyCommandTimer: ReturnType<typeof setTimeout> | undefined;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      let partialTimer: ReturnType<typeof setTimeout> | undefined;
      let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;

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
        if (partialTimer) clearTimeout(partialTimer);
        if (shutdownTimer) clearTimeout(shutdownTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (retryTimer) clearTimeout(retryTimer);
        const details = { accountId: this.#accountId, phase, elapsedMs: this.#now() - startedAt, commandRetries };
        if (value) console.info('[ClaudeUsageProbe] Usage refreshed', details);
        else console.warn('[ClaudeUsageProbe] Probe ended without usage', details);
        dataSubscription?.dispose();
        exitSubscription?.dispose();
        try {
          // Unix node-pty kill() only signals the child and leaves the PTY
          // master open. releasePty() closes that transport while preserving
          // the existing Windows ConPTY kill path.
          releasePty(terminal);
        } catch {
          // The PTY may already have been fully released.
        }
        try {
          this.#onFinished?.();
        } catch {
          // Cleanup hooks must not change the probe result.
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

      const scheduleCommandRetry = (): void => {
        if (retryTimer || commandAccepted || completedSnapshot || commandRetries >= MAX_COMMAND_RETRIES) return;
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          if (settled || exited || commandAccepted || completedSnapshot) return;
          const output = stripClaudeUsageTerminalOutput(afterCommand);
          // Screen-reader mode can consume the first Enter in autocomplete. Only
          // retry the exact pending command at the prompt, never a dialog or answer.
          if (
            !/\/usage\s+Show session cost, plan usage, and activity stats/i.test(output) ||
            !/\$\s*\/usage\s*$/.test(output)
          )
            return;
          if (writeIfActive('\r')) {
            commandRetries += 1;
            phase = 'autocomplete';
            console.info('[ClaudeUsageProbe] Retrying pending command Enter', {
              accountId: this.#accountId,
              phase,
              attempt: commandRetries,
              elapsedMs: this.#now() - startedAt,
            });
            scheduleCommandRetry();
          }
        }, COMMAND_RETRY_DELAY_MS);
      };

      const sendUsageCommand = (): void => {
        if (commandSent || !writeIfActive('/usage\r')) return;
        commandSent = true;
        phase = 'command-sent';
        scheduleCommandRetry();
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
        if (partialTimer) clearTimeout(partialTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (retryTimer) clearTimeout(retryTimer);
        phase = 'closing';

        // `/usage` is a settings dialog. Close it before releasing the PTY.
        // Letting Claude exit first can strand the Windows ConPTY host because
        // node-pty can no longer enumerate the finished console session.
        writeIfActive('\u001b');
        shutdownTimer = setTimeout(() => finish(snapshot, undefined, 'shutdown-timeout'), DEFAULT_SHUTDOWN_TIMEOUT_MS);
      };

      // Fork: a plan without a 5-hour limit renders only the weekly bucket, so
      // waiting for both would always run into the timeout. Once /usage shows
      // one bucket, let the view settle briefly and finish with what it shows.
      const schedulePartialClose = (): void => {
        if (partialTimer || !parseClaudeUsageOutput(afterCommand, new Date(this.#now()))) return;
        partialTimer = setTimeout(() => {
          const latest = parseClaudeUsageOutput(afterCommand, new Date(this.#now()));
          if (latest) closeGracefully(latest);
        }, this.#partialSettleMs);
      };

      dataSubscription = terminal.onData((chunk) => {
        captured = `${captured}${chunk}`.slice(-MAX_CAPTURE_CHARS);
        if (commandSent) afterCommand = `${afterCommand}${chunk}`.slice(-MAX_CAPTURE_CHARS);
        const plainOutput = stripClaudeUsageTerminalOutput(captured);
        if (!trustConfirmed && TRUST_CONFIRMATION.test(plainOutput)) {
          trustConfirmed = true;
          phase = 'trust';
          writeIfActive('y\r');
          scheduleFallbackCommand();
          return;
        }

        if (commandSent && !completedSnapshot) {
          const output = stripClaudeUsageTerminalOutput(afterCommand);
          if (/you:\s*\/usage|Settings\s+Status\s+Config\s+Usage|Current (?:session|week)/i.test(output)) {
            commandAccepted = true;
            phase = 'usage-view';
            if (retryTimer) clearTimeout(retryTimer);
          } else {
            scheduleCommandRetry();
          }
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

        // After /usage is sent only its own output is read, so earlier screen text cannot leak in.
        const snapshot = parseClaudeUsageOutput(commandSent ? afterCommand : captured, new Date(this.#now()));
        if (snapshot?.session && snapshot.weekly) {
          closeGracefully(snapshot);
        } else if (commandSent) {
          schedulePartialClose();
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
