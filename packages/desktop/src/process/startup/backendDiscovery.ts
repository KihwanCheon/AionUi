/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const AIONUI_BACKEND_DISCOVERY_FILE = 'aionui-backend.json';

export type BackendDiscoveryRecord = {
  schemaVersion: 1;
  host: '127.0.0.1';
  port: number;
  pid: number;
  updatedAt: string;
};

type BackendDiscoveryOptions = {
  tempDirectory?: string;
  pid?: number;
  now?: () => Date;
  onProcessExit?: (cleanup: () => void) => void;
};

const EXIT_CLEANUP_REGISTRATION = '__aionuiBackendDiscoveryExitCleanupRegistered';

type ProcessWithBackendDiscoveryCleanup = NodeJS.Process & {
  __aionuiBackendDiscoveryExitCleanupRegistered?: boolean;
};

export function getBackendDiscoveryPath(tempDirectory = tmpdir()): string {
  return path.join(tempDirectory, AIONUI_BACKEND_DISCOVERY_FILE);
}

export function publishBackendDiscovery(port: number, options: BackendDiscoveryOptions = {}): BackendDiscoveryRecord {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid AionUi backend port: ${port}`);
  }

  const pid = options.pid ?? process.pid;
  if (!Number.isInteger(pid) || pid < 1) {
    throw new Error(`Invalid AionUi process id: ${pid}`);
  }

  const record: BackendDiscoveryRecord = {
    schemaVersion: 1,
    host: '127.0.0.1',
    port,
    pid,
    updatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  const discoveryPath = getBackendDiscoveryPath(options.tempDirectory);
  const pendingPath = `${discoveryPath}.${pid}.tmp`;

  writeFileSync(pendingPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    renameSync(pendingPath, discoveryPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') {
      rmSync(pendingPath, { force: true });
      throw error;
    }
    rmSync(discoveryPath, { force: true });
    renameSync(pendingPath, discoveryPath);
  }

  registerExitCleanup(options);
  return record;
}

function registerExitCleanup(options: BackendDiscoveryOptions): void {
  const cleanup = () => {
    clearBackendDiscovery({
      tempDirectory: options.tempDirectory,
      pid: options.pid,
    });
  };

  if (options.onProcessExit) {
    options.onProcessExit(cleanup);
    return;
  }
  const currentProcess = process as ProcessWithBackendDiscoveryCleanup;
  if (options.tempDirectory || options.pid !== undefined || currentProcess[EXIT_CLEANUP_REGISTRATION]) return;

  currentProcess[EXIT_CLEANUP_REGISTRATION] = true;
  process.once('exit', cleanup);
}

export function clearBackendDiscovery(options: Omit<BackendDiscoveryOptions, 'now'> = {}): boolean {
  const discoveryPath = getBackendDiscoveryPath(options.tempDirectory);
  const pid = options.pid ?? process.pid;

  try {
    const record = JSON.parse(readFileSync(discoveryPath, 'utf8')) as Partial<BackendDiscoveryRecord>;
    if (record.pid !== pid) {
      return false;
    }
    rmSync(discoveryPath, { force: true });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    return false;
  }
}
