/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type MindNProgressRunnerCredential = {
  apiUrl: string;
  machineId: string;
  label: string;
  token: string;
};

export function normalizeMindNProgressApiUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('MindNProgress server URL is required.');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('MindNProgress server URL is invalid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('MindNProgress server URL must use http or https.');
  }
  if (url.username || url.password) throw new Error('MindNProgress server URL must not contain credentials.');
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export function normalizeRunnerCredential(value: unknown): MindNProgressRunnerCredential {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Runner credential is invalid.');
  const record = value as Record<string, unknown>;
  const machineId = typeof record.machineId === 'string' ? record.machineId.trim().toLowerCase() : '';
  const label = typeof record.label === 'string' ? record.label.trim().slice(0, 60) : '';
  const token = typeof record.token === 'string' ? record.token.trim() : '';
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(machineId) || !token.startsWith('mnprn_')) {
    throw new Error('Runner credential is invalid.');
  }
  return {
    apiUrl: normalizeMindNProgressApiUrl(record.apiUrl),
    machineId,
    label: label || machineId,
    token,
  };
}
