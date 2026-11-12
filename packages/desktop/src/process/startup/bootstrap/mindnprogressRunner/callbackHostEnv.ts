/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tell aioncore which host may receive external-launch completion callbacks.
 *
 * aioncore POSTs to a caller-supplied callback URL, so it allow-lists the host
 * rather than accepting any (SSRF). Loopback covers the single-machine setup.
 * A MindNProgress sub machine is different: its paired server is remote, so
 * MindNProgress sends its own public address as the callback and loopback-only
 * validation rejects it (EXTERNAL_LAUNCH_CALLBACK_INVALID).
 *
 * The value is written into this process's own environment before the backend
 * is spawned; buildSpawnEnv copies the parent environment, so aioncore inherits
 * it without threading another parameter through the launcher.
 *
 * Only the host of the server this machine is actually paired with is added.
 */

export const EXTERNAL_LAUNCH_CALLBACK_HOSTS_ENV = 'AIONUI_EXTERNAL_LAUNCH_CALLBACK_HOSTS';

/** Hostname of the paired MindNProgress server, or null when not usable. */
export function pairedCallbackHost(apiUrl: string | null | undefined): string | null {
  if (!apiUrl) return null;
  try {
    return new URL(apiUrl).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Publish the paired host, or clear the variable when there is no pairing.
 * Clearing matters: a stale host would keep widening the backend's allow list
 * after the Runner is disconnected.
 */
export function applyExternalLaunchCallbackHostEnv(
  apiUrl: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): void {
  const host = pairedCallbackHost(apiUrl);
  if (host) {
    env[EXTERNAL_LAUNCH_CALLBACK_HOSTS_ENV] = host;
    return;
  }
  delete env[EXTERNAL_LAUNCH_CALLBACK_HOSTS_ENV];
}
