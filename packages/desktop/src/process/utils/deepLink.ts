/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { ipcBridge } from '@/common';
import { AIONUI_PROTOCOL_SCHEME, createBufferedEventRelay, findDeepLinkUrl } from '../startup/bootstrap/protocol';
import { registerRendererReadinessInvalidation } from '../startup/bootstrap/rendererReadiness';
import { describeDeepLinkForLog } from './deepLinkLog';

export const PROTOCOL_SCHEME = AIONUI_PROTOCOL_SCHEME;

type DeepLinkPayload = {
  action: string;
  params: Record<string, string>;
};

/**
 * Parse an aionui:// URL into action and params.
 * Supports two formats:
 *   1. aionui://add-provider?base_url=xxx&api_key=xxx
 *   2. aionui://provider/add?v=1&data=<base64 JSON>  (one-api / new-api style)
 */
export const parseDeepLinkUrl = (url: string): DeepLinkPayload | null => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${PROTOCOL_SCHEME}:`) return null;

    const hostname = parsed.hostname || '';
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const action = pathname ? `${hostname}/${pathname}` : hostname;

    const params: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    // If data param exists, decode base64 JSON and merge into params
    if (params.data) {
      try {
        const json = JSON.parse(Buffer.from(params.data, 'base64').toString('utf-8'));
        if (json && typeof json === 'object') {
          Object.assign(params, json);
        }
      } catch {
        // Ignore decode errors
      }
      delete params.data;
    }

    return { action, params };
  } catch {
    return null;
  }
};

let mainWindowRef: BrowserWindow | null = null;
let detachRendererConsumer: (() => void) | null = null;
let readyProviderRegistered = false;
const rendererRelay = createBufferedEventRelay<DeepLinkPayload>();

const markDeepLinkRendererNotReady = (): void => {
  detachRendererConsumer?.();
  detachRendererConsumer = null;
};

export const setDeepLinkMainWindow = (win: BrowserWindow): void => {
  markDeepLinkRendererNotReady();
  mainWindowRef = win;
  registerRendererReadinessInvalidation(win.webContents, markDeepLinkRendererNotReady);
  win.on('closed', () => {
    if (mainWindowRef !== win) return;
    markDeepLinkRendererNotReady();
    mainWindowRef = null;
  });
};

/** Register the renderer-ready handshake once in the main process. */
export const registerDeepLinkReadyProvider = (): void => {
  if (readyProviderRegistered) return;
  readyProviderRegistered = true;
  ipcBridge.deepLink.ready.provider(() => {
    if (!mainWindowRef || mainWindowRef.isDestroyed() || mainWindowRef.webContents.isDestroyed()) {
      return Promise.resolve();
    }
    if (!detachRendererConsumer) {
      console.info('[DeepLink] renderer ready; flushing any buffered deep link');
      detachRendererConsumer = rendererRelay.attach((payload) => ipcBridge.deepLink.received.emit(payload));
    }
    return Promise.resolve();
  });
};

/**
 * Send the deep-link payload to the renderer via IPC bridge.
 * If the window isn't ready yet, queue it.
 */
export const handleDeepLinkUrl = (url: string): void => {
  const summary = describeDeepLinkForLog(url);
  const parsed = parseDeepLinkUrl(url);
  if (!parsed) {
    console.warn(`[DeepLink] dropped, not a recognizable aionui link: ${summary}`);
    return;
  }
  // "buffered" means the payload waits for the renderer handshake; it is
  // delivered once ipcBridge.deepLink.ready attaches the consumer.
  console.info(`[DeepLink] received ${summary} (renderer ${detachRendererConsumer ? 'ready' : 'not ready, buffered'})`);
  rendererRelay.publish(parsed);
};

const initialDeepLinkUrl = findDeepLinkUrl(process.argv);
if (initialDeepLinkUrl) handleDeepLinkUrl(initialDeepLinkUrl);
