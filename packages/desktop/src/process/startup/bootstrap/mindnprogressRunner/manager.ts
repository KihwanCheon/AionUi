/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, net, safeStorage, utilityProcess, type UtilityProcess } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IMindNProgressRunnerPairRequest, IMindNProgressRunnerStatus } from '@/common/adapter/ipcBridge';
import {
  normalizeMindNProgressApiUrl,
  normalizeRunnerCredential,
  type MindNProgressRunnerCredential,
} from './credential';

type StoredCredentialEnvelope = {
  schemaVersion: 1;
  ciphertext: string;
};

type PairingExchangeResponse = {
  schemaVersion?: unknown;
  apiUrl?: unknown;
  machineId?: unknown;
  label?: unknown;
  token?: unknown;
  error?: unknown;
};

type RunnerProcessEvent =
  | { type: 'connected'; label: string; connectedAt: string }
  | { type: 'connection-error'; message: string; authenticationFailed: boolean }
  | { type: 'stopped' };

const CREDENTIAL_FILE_NAME = 'mindnprogress-runner.json';
const PAIRING_CODE_PATTERN = /^mnppair_[A-Za-z0-9_-]{20,100}$/;
const STOP_TIMEOUT_MS = 5_000;
const RESTART_DELAY_MS = 3_000;

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRunnerProcessEvent(value: unknown): value is RunnerProcessEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'connected' || type === 'connection-error' || type === 'stopped';
}

class MindNProgressRunnerManager {
  private credential: MindNProgressRunnerCredential | null = null;
  private child: UtilityProcess | null = null;
  private localAionUiUrl: string | null = null;
  private stopRequested = false;
  private authenticationFailed = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopWaiter: Promise<void> | null = null;
  private listeners = new Set<(status: IMindNProgressRunnerStatus) => void>();
  private status: IMindNProgressRunnerStatus = {
    configured: false,
    secureStorageAvailable: false,
    state: 'not-configured',
    apiUrl: null,
    machineId: null,
    label: null,
    lastConnectedAt: null,
    lastError: null,
  };

  onStatusChanged(listener: (status: IMindNProgressRunnerStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): IMindNProgressRunnerStatus {
    return { ...this.status };
  }

  private publish(patch: Partial<IMindNProgressRunnerStatus>): void {
    this.status = { ...this.status, ...patch };
    const snapshot = this.getStatus();
    for (const listener of this.listeners) listener(snapshot);
  }

  private secureStorageAvailable(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false;
    try {
      return safeStorage.getSelectedStorageBackend() !== 'basic_text';
    } catch {
      return true;
    }
  }

  private credentialPath(): string {
    return path.join(app.getPath('userData'), CREDENTIAL_FILE_NAME);
  }

  private runnerEntryPath(): string {
    const mainModuleDir =
      typeof require !== 'undefined' && require.main?.filename ? path.dirname(require.main.filename) : __dirname;
    const baseDir = path.basename(mainModuleDir) === 'chunks' ? path.dirname(mainModuleDir) : mainModuleDir;
    const readableBaseDir = app.isPackaged ? baseDir.replace('app.asar', 'app.asar.unpacked') : baseDir;
    return path.resolve(readableBaseDir, 'mindnprogress-runner.js');
  }

  private async readCredential(): Promise<MindNProgressRunnerCredential | null> {
    try {
      const envelope = JSON.parse(await readFile(this.credentialPath(), 'utf8')) as StoredCredentialEnvelope;
      if (envelope.schemaVersion !== 1 || typeof envelope.ciphertext !== 'string') {
        throw new Error('Stored Runner credential has an unsupported format.');
      }
      if (!this.secureStorageAvailable()) throw new Error('Secure credential storage is unavailable.');
      const decrypted = safeStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64'));
      return normalizeRunnerCredential(JSON.parse(decrypted));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw error;
    }
  }

  private async writeCredential(credential: MindNProgressRunnerCredential): Promise<void> {
    if (!this.secureStorageAvailable()) throw new Error('Secure credential storage is unavailable on this system.');
    const credentialPath = this.credentialPath();
    await mkdir(path.dirname(credentialPath), { recursive: true });
    const envelope: StoredCredentialEnvelope = {
      schemaVersion: 1,
      ciphertext: safeStorage.encryptString(JSON.stringify(credential)).toString('base64'),
    };
    const temporaryPath = `${credentialPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, credentialPath);
  }

  async initialize(localAionUiPort: number): Promise<void> {
    this.localAionUiUrl = `http://127.0.0.1:${localAionUiPort}`;
    const secureStorageAvailable = this.secureStorageAvailable();
    this.publish({ secureStorageAvailable });
    if (!secureStorageAvailable) {
      this.publish({ state: 'error', lastError: 'Secure credential storage is unavailable on this system.' });
      return;
    }
    try {
      this.credential = await this.readCredential();
    } catch (error) {
      this.publish({ state: 'error', lastError: safeErrorMessage(error) });
      return;
    }
    if (!this.credential) {
      this.publish({ configured: false, state: 'not-configured', lastError: null });
      return;
    }
    this.publish({
      configured: true,
      apiUrl: this.credential.apiUrl,
      machineId: this.credential.machineId,
      label: this.credential.label,
    });
    this.startChild();
  }

  private startChild(): void {
    if (this.child || !this.credential || !this.localAionUiUrl) return;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.stopRequested = false;
    this.authenticationFailed = false;
    this.publish({ state: 'starting', lastError: null });

    try {
      const credential = this.credential;
      const child = utilityProcess.fork(this.runnerEntryPath(), [], {
        serviceName: 'MindNProgress Runner',
        stdio: 'ignore',
        env: {
          ...process.env,
          MNP_RUNNER_API_URL: credential.apiUrl,
          MNP_RUNNER_MACHINE_ID: credential.machineId,
          MNP_RUNNER_TOKEN: credential.token,
          MNP_RUNNER_AIONUI_URL: this.localAionUiUrl,
        },
      });
      this.child = child;
      child.on('message', (message: unknown) => this.handleChildMessage(child, message));
      child.once('exit', (code) => this.handleChildExit(child, code));
    } catch (error) {
      this.child = null;
      this.publish({ state: 'error', lastError: safeErrorMessage(error) });
      this.scheduleRestart();
    }
  }

  private handleChildMessage(child: UtilityProcess, message: unknown): void {
    if (child !== this.child || !isRunnerProcessEvent(message)) return;
    if (message.type === 'connected') {
      this.publish({
        state: 'connected',
        label: message.label,
        lastConnectedAt: message.connectedAt,
        lastError: null,
      });
      return;
    }
    if (message.type === 'connection-error') {
      this.authenticationFailed = message.authenticationFailed;
      this.publish({ state: 'error', lastError: message.message });
      return;
    }
    this.publish({ state: 'stopped' });
  }

  private handleChildExit(child: UtilityProcess, code: number): void {
    if (child !== this.child) return;
    this.child = null;
    if (this.stopRequested || !this.credential) return;
    if (this.authenticationFailed) {
      this.publish({ state: 'error' });
      return;
    }
    this.publish({
      state: 'reconnecting',
      lastError: code === 0 ? 'Runner stopped unexpectedly.' : `Runner exited unexpectedly (${code}).`,
    });
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.restartTimer || this.stopRequested || !this.credential) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.startChild();
    }, RESTART_DELAY_MS);
  }

  private async stopChild(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    if (!child) return;
    this.stopRequested = true;
    if (this.stopWaiter) return this.stopWaiter;
    this.stopWaiter = new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        if (child === this.child) child.kill();
        finish();
      }, STOP_TIMEOUT_MS);
      child.once('exit', finish);
      // Electron.UtilityProcess uses a one-argument IPC API; this is not Window.postMessage.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      child.postMessage({ type: 'stop' });
    }).finally(() => {
      this.stopWaiter = null;
      if (this.child === child) this.child = null;
    });
    return this.stopWaiter;
  }

  async pair(request: IMindNProgressRunnerPairRequest): Promise<IMindNProgressRunnerStatus> {
    if (!this.localAionUiUrl) throw new Error('AionUi backend is not ready yet.');
    if (!this.secureStorageAvailable()) throw new Error('Secure credential storage is unavailable on this system.');
    const apiUrl = normalizeMindNProgressApiUrl(request.apiUrl);
    const pairingCode = request.pairingCode.trim();
    const expectedMachineId = request.expectedMachineId.trim().toLowerCase();
    if (!PAIRING_CODE_PATTERN.test(pairingCode)) throw new Error('The pairing link is invalid or incomplete.');
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(expectedMachineId)) {
      throw new Error('The pairing link has an invalid machine ID.');
    }

    const response = await net.fetch(`${apiUrl}/api/machines/runner/pairing/exchange`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as PairingExchangeResponse;
    if (!response.ok) {
      const message = typeof body.error === 'string' ? body.error : `Pairing failed (${response.status}).`;
      throw new Error(message);
    }
    if (body.schemaVersion !== 1) throw new Error('The MindNProgress pairing response is not supported.');
    const credential = normalizeRunnerCredential(body);
    if (credential.apiUrl !== apiUrl) {
      throw new Error('The MindNProgress server returned a different Runner address.');
    }
    if (credential.machineId !== expectedMachineId) {
      throw new Error('The MindNProgress server returned a different machine ID.');
    }

    await this.stopChild();
    await this.writeCredential(credential);
    this.credential = credential;
    this.publish({
      configured: true,
      secureStorageAvailable: true,
      apiUrl: credential.apiUrl,
      machineId: credential.machineId,
      label: credential.label,
      state: 'starting',
      lastConnectedAt: null,
      lastError: null,
    });
    this.startChild();
    return this.getStatus();
  }

  async restart(): Promise<IMindNProgressRunnerStatus> {
    if (!this.credential) throw new Error('MindNProgress Runner is not configured.');
    await this.stopChild();
    this.startChild();
    return this.getStatus();
  }

  async disconnect(): Promise<IMindNProgressRunnerStatus> {
    await this.stopChild();
    await rm(this.credentialPath(), { force: true });
    this.credential = null;
    this.stopRequested = false;
    this.publish({
      configured: false,
      state: 'not-configured',
      apiUrl: null,
      machineId: null,
      label: null,
      lastConnectedAt: null,
      lastError: null,
    });
    return this.getStatus();
  }

  async shutdown(): Promise<void> {
    await this.stopChild();
    if (this.credential) this.publish({ state: 'stopped' });
  }
}

export const mindNProgressRunnerManager = new MindNProgressRunnerManager();
