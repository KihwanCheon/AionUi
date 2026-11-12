/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Query and cache Codex's structured app-server rate-limit response. */
import type { CodexRateLimitWindow, CodexUsageSnapshot } from '@/common/types/platform/codexUsage';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';

const DEFAULT_SUCCESS_TTL_MS = 60_000;
const DEFAULT_FAILURE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_STDOUT_BUFFER_CHARS = 256 * 1024;
const INITIALIZE_REQUEST_ID = 0;
const RATE_LIMITS_REQUEST_ID = 1;

type JsonObject = Record<string, unknown>;

type CacheEntry = {
  expiresAt: number;
  value: CodexUsageSnapshot | null;
};

export type SpawnCodexProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export type CodexUsageProbeOptions = {
  args?: readonly string[];
  command?: string;
  env?: NodeJS.ProcessEnv;
  failureTtlMs?: number;
  now?: () => number;
  platform?: NodeJS.Platform;
  spawnProcess?: SpawnCodexProcess;
  successTtlMs?: number;
  timeoutMs?: number;
};

const asObject = (value: unknown): JsonObject | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const parseWindow = (value: unknown): CodexRateLimitWindow | undefined => {
  const window = asObject(value);
  if (!window) return undefined;

  const usedPercent = finiteNumber(window.usedPercent);
  if (usedPercent === undefined) return undefined;

  const windowDurationMins = finiteNumber(window.windowDurationMins);
  const resetsAt = finiteNumber(window.resetsAt);
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    ...(windowDurationMins !== undefined && windowDurationMins > 0 ? { windowDurationMins } : {}),
    ...(resetsAt !== undefined && resetsAt > 0 ? { resetsAt } : {}),
  };
};

const isShorterWindow = (candidate: CodexRateLimitWindow, than: CodexRateLimitWindow): boolean =>
  candidate.windowDurationMins !== undefined &&
  than.windowDurationMins !== undefined &&
  candidate.windowDurationMins < than.windowDurationMins;

/**
 * Parse the structured `account/rateLimits/read` result. The installed Codex
 * app-server schema exposes primary/secondary windows of the main `rateLimits`
 * bucket; model-specific buckets stay out of the titlebar. The longest window is
 * the weekly limit and a strictly shorter one (normally 5 hours) the session
 * limit. Plans without a 5-hour limit report a single window, so `session` is
 * then absent.
 */
export const parseCodexRateLimitsResult = (value: unknown, now = Date.now()): CodexUsageSnapshot | null => {
  const result = asObject(value);
  const rateLimits = asObject(result?.rateLimits);
  if (!rateLimits) return null;

  const windows = [parseWindow(rateLimits.primary), parseWindow(rateLimits.secondary)].filter(
    (window): window is CodexRateLimitWindow => Boolean(window)
  );
  if (windows.length === 0) return null;

  const weekly = windows.reduce((longest, candidate) =>
    (candidate.windowDurationMins ?? 0) > (longest.windowDurationMins ?? 0) ? candidate : longest
  );
  const session = windows.find((window) => window !== weekly && isShorterWindow(window, weekly));
  const reachedType = rateLimits.rateLimitReachedType;
  const highestUsage = Math.max(weekly.usedPercent, session?.usedPercent ?? 0);

  return {
    weekly,
    ...(session ? { session } : {}),
    limitReached: typeof reachedType === 'string' ? reachedType.length > 0 : highestUsage >= 100,
    updatedAt: now,
  };
};

export const resolveCodexAppServerCommand = (
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): { command: string; args: readonly string[] } =>
  platform === 'win32'
    ? {
        command: env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', 'codex app-server'],
      }
    : {
        command: 'codex',
        args: ['app-server'],
      };

export class CodexUsageProbe {
  readonly #args: readonly string[];
  readonly #command: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #failureTtlMs: number;
  readonly #now: () => number;
  readonly #spawnProcess: SpawnCodexProcess;
  readonly #successTtlMs: number;
  readonly #timeoutMs: number;

  #cache: CacheEntry | undefined;
  #inFlight: Promise<CodexUsageSnapshot | null> | undefined;

  constructor(options: CodexUsageProbeOptions = {}) {
    const env = options.env ?? process.env;
    const defaults = resolveCodexAppServerCommand(options.platform ?? process.platform, env);
    this.#args = options.args ?? defaults.args;
    this.#command = options.command ?? defaults.command;
    this.#env = env;
    this.#failureTtlMs = options.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS;
    this.#now = options.now ?? Date.now;
    this.#spawnProcess =
      options.spawnProcess ??
      ((command, args, spawnOptions) => spawn(command, args, spawnOptions) as ChildProcessWithoutNullStreams);
    this.#successTtlMs = options.successTtlMs ?? DEFAULT_SUCCESS_TTL_MS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getUsage(): Promise<CodexUsageSnapshot | null> {
    const now = this.#now();
    if (this.#cache && this.#cache.expiresAt > now) return this.#cache.value;
    if (this.#inFlight) return this.#inFlight;

    const request = this.#runProbe()
      .then((value) => {
        this.#cache = {
          value,
          expiresAt: this.#now() + (value ? this.#successTtlMs : this.#failureTtlMs),
        };
        return value;
      })
      .catch((error: unknown): CodexUsageSnapshot | null => {
        console.warn('[CodexUsageProbe] Unable to refresh Codex plan usage', {
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

  #runProbe(): Promise<CodexUsageSnapshot | null> {
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.#spawnProcess(this.#command, this.#args, {
          env: this.#env,
          stdio: 'pipe',
          windowsHide: true,
        });
      } catch (error) {
        reject(error);
        return;
      }

      let stdoutBuffer = '';
      let exited = false;
      let settled = false;
      let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

      const closeInput = (): void => {
        if (!child.stdin.destroyed) child.stdin.end();
        shutdownTimer = setTimeout(() => {
          if (!exited) child.kill();
        }, 1_000);
        shutdownTimer.unref?.();
      };

      const finish = (value: CodexUsageSnapshot | null, error?: Error): void => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        closeInput();
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };

      const send = (message: JsonObject): void => {
        if (settled || child.stdin.destroyed) return;
        child.stdin.write(`${JSON.stringify(message)}\n`);
      };

      const handleLine = (line: string): void => {
        let message: JsonObject | undefined;
        try {
          message = asObject(JSON.parse(line));
        } catch {
          return;
        }
        if (!message) return;

        if (message.id === INITIALIZE_REQUEST_ID) {
          if (message.error) {
            finish(null, new Error('Codex app-server initialization failed'));
            return;
          }
          send({ method: 'initialized', params: {} });
          send({ method: 'account/rateLimits/read', id: RATE_LIMITS_REQUEST_ID });
          return;
        }

        if (message.id !== RATE_LIMITS_REQUEST_ID) return;
        if (message.error) {
          finish(null, new Error('Codex rate-limit request failed'));
          return;
        }
        finish(parseCodexRateLimitsResult(message.result, this.#now()));
      };

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdoutBuffer = `${stdoutBuffer}${chunk.toString()}`.slice(-MAX_STDOUT_BUFFER_CHARS);
        let newline = stdoutBuffer.indexOf('\n');
        while (newline >= 0) {
          const line = stdoutBuffer.slice(0, newline).trim();
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          if (line) handleLine(line);
          newline = stdoutBuffer.indexOf('\n');
        }
      });

      // Drain stderr without retaining provider output or credentials in memory/logs.
      child.stdin.on('error', () => {});
      child.stderr.on('data', () => {});
      child.on('error', (error) => finish(null, error));
      child.on('close', () => {
        exited = true;
        if (shutdownTimer) clearTimeout(shutdownTimer);
        if (!settled) finish(null, new Error('Codex app-server exited before returning rate limits'));
      });

      timeoutTimer = setTimeout(() => finish(null, new Error('Codex rate-limit request timed out')), this.#timeoutMs);

      send({
        method: 'initialize',
        id: INITIALIZE_REQUEST_ID,
        params: {
          clientInfo: {
            name: 'aionui',
            title: 'AionUi',
            version: '1.0.0',
          },
        },
      });
    });
  }
}
