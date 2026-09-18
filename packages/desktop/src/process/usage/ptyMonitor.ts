/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { subscriptionUsageBridge } from '@/common/platform/subscriptionUsageBridge';
import type {
  PtyLaunchCloseReason,
  PtyLaunchSnapshot,
  PtyMonitorSnapshot,
  PtyOwnerSnapshot,
} from '@/common/types/platform/subscriptionUsage';

const DEFAULT_REFRESH_INTERVAL_MS = 30_000;

type TrackPtyLaunchInput = Omit<PtyLaunchSnapshot, 'id' | 'startedAt'>;

type PtyMonitorServiceOptions = {
  platform?: NodeJS.Platform;
  ownerPid?: number;
  idFactory?: () => string;
  now?: () => number;
  readLsof?: () => Promise<string>;
  readLimit?: () => Promise<number>;
  refreshIntervalMs?: number;
  onSnapshot?: (snapshot: PtyMonitorSnapshot) => void;
  onProcessExit?: (cleanup: () => void) => void;
};

const runCommand = (command: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (!error) {
        resolve(stdout);
        return;
      }
      const code = (error as { code?: string | number }).code;
      if (command === 'lsof' && code === 1 && !stdout.trim()) {
        resolve('');
        return;
      }
      reject(error);
    });
  });

const defaultReadLsof = (): Promise<string> => runCommand('lsof', ['-nP', '-Fpcn', '/dev/ptmx']);

const defaultReadLimit = async (): Promise<number> => {
  const raw = await runCommand('sysctl', ['-n', 'kern.tty.ptmx_max']);
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid kern.tty.ptmx_max value');
  return value;
};

export const parsePtyOwners = (output: string): PtyOwnerSnapshot[] => {
  const owners = new Map<number, PtyOwnerSnapshot>();
  let currentPid: number | undefined;
  let currentProcessName = '';

  for (const line of output.split(/\r?\n/)) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') {
      const pid = Number.parseInt(value, 10);
      currentPid = Number.isInteger(pid) && pid > 0 ? pid : undefined;
      currentProcessName = '';
    } else if (field === 'c') {
      currentProcessName = value;
    } else if (field === 'n' && value === '/dev/ptmx' && currentPid !== undefined) {
      const existing = owners.get(currentPid);
      if (existing) {
        existing.count += 1;
      } else {
        owners.set(currentPid, {
          pid: currentPid,
          processName: currentProcessName || 'Unknown',
          count: 1,
        });
      }
    }
  }

  return [...owners.values()].toSorted((left, right) => right.count - left.count || left.pid - right.pid);
};

export class PtyMonitorService {
  readonly #platform: NodeJS.Platform;
  readonly #ownerPid: number;
  readonly #idFactory: () => string;
  readonly #now: () => number;
  readonly #readLsof: () => Promise<string>;
  readonly #readLimit: () => Promise<number>;
  readonly #refreshIntervalMs: number;
  readonly #onSnapshot: (snapshot: PtyMonitorSnapshot) => void;
  readonly #onProcessExit: (cleanup: () => void) => void;

  #activeLaunches = new Map<string, PtyLaunchSnapshot>();
  #lastSnapshot: PtyMonitorSnapshot;
  #refreshInFlight: Promise<PtyMonitorSnapshot> | undefined;
  #started = false;
  #stopped = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: PtyMonitorServiceOptions = {}) {
    this.#platform = options.platform ?? process.platform;
    this.#ownerPid = options.ownerPid ?? process.pid;
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#now = options.now ?? Date.now;
    this.#readLsof = options.readLsof ?? defaultReadLsof;
    this.#readLimit = options.readLimit ?? defaultReadLimit;
    this.#refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.#onSnapshot = options.onSnapshot ?? (() => undefined);
    this.#onProcessExit = options.onProcessExit ?? ((cleanup) => process.once('exit', cleanup));
    this.#lastSnapshot = this.#createSnapshot(this.#platform === 'darwin' ? 'unavailable' : 'unsupported');
  }

  start(): void {
    if (this.#started || this.#stopped) return;
    this.#started = true;
    this.#onProcessExit(() => this.stop());
    void this.refresh().finally(() => this.#schedule());
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  trackLaunch(input: TrackPtyLaunchInput): string {
    const id = this.#idFactory();
    this.#activeLaunches.set(id, { ...input, id, startedAt: this.#now() });
    this.#publishDerivedSnapshot();
    return id;
  }

  finishLaunch(id: string, _reason: PtyLaunchCloseReason): void {
    if (!this.#activeLaunches.delete(id)) return;
    this.#publishDerivedSnapshot();
  }

  refresh(): Promise<PtyMonitorSnapshot> {
    if (this.#refreshInFlight) return this.#refreshInFlight;
    const request = this.#refresh().finally(() => {
      if (this.#refreshInFlight === request) this.#refreshInFlight = undefined;
    });
    this.#refreshInFlight = request;
    return request;
  }

  async #refresh(): Promise<PtyMonitorSnapshot> {
    if (this.#platform !== 'darwin') {
      this.#lastSnapshot = this.#createSnapshot('unsupported');
      this.#publish();
      return this.#lastSnapshot;
    }

    try {
      const [rawOwners, limit] = await Promise.all([this.#readLsof(), this.#readLimit()]);
      const owners = parsePtyOwners(rawOwners);
      const totalCount = owners.reduce((total, owner) => total + owner.count, 0);
      const aionUiCount = owners.find((owner) => owner.pid === this.#ownerPid)?.count ?? 0;
      this.#lastSnapshot = this.#createSnapshot('ready', {
        limit,
        totalCount,
        aionUiCount,
        owners,
      });
    } catch {
      this.#lastSnapshot = this.#createSnapshot('unavailable');
    }
    this.#publish();
    return this.#lastSnapshot;
  }

  #createSnapshot(
    state: PtyMonitorSnapshot['state'],
    values: {
      limit?: number;
      totalCount?: number;
      aionUiCount?: number;
      owners?: PtyOwnerSnapshot[];
    } = {}
  ): PtyMonitorSnapshot {
    const activeLaunches = [...this.#activeLaunches.values()].toSorted(
      (left, right) => left.startedAt - right.startedAt
    );
    const aionUiCount = state === 'ready' ? (values.aionUiCount ?? 0) : null;
    return {
      state,
      updatedAt: this.#now(),
      limit: state === 'ready' ? (values.limit ?? null) : null,
      totalCount: state === 'ready' ? (values.totalCount ?? 0) : null,
      aionUiPid: this.#ownerPid,
      aionUiCount,
      trackedActiveCount: activeLaunches.length,
      suspectedUntrackedCount: aionUiCount === null ? null : Math.max(0, aionUiCount - activeLaunches.length),
      owners: state === 'ready' ? (values.owners ?? []) : [],
      activeLaunches,
    };
  }

  #publishDerivedSnapshot(): void {
    this.#lastSnapshot = this.#createSnapshot(this.#lastSnapshot.state, {
      limit: this.#lastSnapshot.limit ?? undefined,
      totalCount: this.#lastSnapshot.totalCount ?? undefined,
      aionUiCount: this.#lastSnapshot.aionUiCount ?? undefined,
      owners: this.#lastSnapshot.owners,
    });
    this.#publish();
  }

  #publish(): void {
    try {
      this.#onSnapshot(this.#lastSnapshot);
    } catch {
      // Monitoring must never interfere with agent or usage execution.
    }
  }

  #schedule(): void {
    if (this.#stopped) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.refresh().finally(() => this.#schedule());
    }, this.#refreshIntervalMs);
    this.#timer.unref?.();
  }
}

let sharedMonitor: PtyMonitorService | undefined;

export const getPtyMonitorService = (): PtyMonitorService => {
  sharedMonitor ??= new PtyMonitorService({ onSnapshot: subscriptionUsageBridge.ptyMonitorChanged.emit });
  return sharedMonitor;
};
