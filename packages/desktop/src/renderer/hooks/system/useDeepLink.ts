/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { handleExternalConversationDeepLink } from '@/renderer/services/externalConversationLaunch';

/**
 * Deep link event payload from main process
 */
export type DeepLinkPayload = {
  action: string;
  params: Record<string, string>;
};

export type DeepLinkAddProviderDetail = {
  base_url?: string;
  api_key?: string;
  name?: string;
  platform?: string;
};

export type MindNProgressRunnerPairingDetail = {
  apiUrl: string;
  pairingCode: string;
  machineId: string;
};

/** Pending deep link data for the add-provider action. Read-once: consumed by ModelModalContent on mount. */
let pendingDeepLinkData: DeepLinkAddProviderDetail | null = null;
let pendingMindNProgressRunnerPairing: MindNProgressRunnerPairingDetail | null = null;
const mindNProgressRunnerPairingListeners = new Set<(pairing: MindNProgressRunnerPairingDetail) => void>();

/**
 * Consume (read and clear) pending deep link data.
 * Returns the data if present, or null. Subsequent calls return null until new data arrives.
 */
export const consumePendingDeepLink = (): DeepLinkAddProviderDetail | null => {
  const data = pendingDeepLinkData;
  pendingDeepLinkData = null;
  return data;
};

/** Read and clear the one-time Runner pairing payload before it can be reused. */
export const consumeMindNProgressRunnerPairing = (): MindNProgressRunnerPairingDetail | null => {
  const pairing = pendingMindNProgressRunnerPairing;
  pendingMindNProgressRunnerPairing = null;
  return pairing;
};

/** Deliver pairing links to an already-mounted settings page without putting secrets in the route. */
export const subscribeMindNProgressRunnerPairing = (
  listener: (pairing: MindNProgressRunnerPairingDetail) => void
): (() => void) => {
  mindNProgressRunnerPairingListeners.add(listener);
  return () => mindNProgressRunnerPairingListeners.delete(listener);
};

const publishMindNProgressRunnerPairing = (pairing: MindNProgressRunnerPairingDetail): void => {
  if (mindNProgressRunnerPairingListeners.size === 0) {
    pendingMindNProgressRunnerPairing = pairing;
    return;
  }
  pendingMindNProgressRunnerPairing = null;
  for (const listener of mindNProgressRunnerPairingListeners) listener(pairing);
};

/**
 * Allowed route patterns for the navigate deep link action.
 * Only routes matching these patterns are permitted.
 */
const ALLOWED_NAVIGATE_PATTERNS = [/^\/team\/[^/]+$/, /^\/conversation\/[^/]+$/];

/**
 * Hook to listen for aionui:// deep link events from main process.
 * Routes 'add-provider' action to the model settings page.
 * Routes 'navigate' action to the specified route (whitelist-validated).
 * The pre-fill data is stored in a module-level variable and consumed
 * by ModelModalContent on mount via consumePendingDeepLink().
 */
export const useDeepLink = () => {
  const navigate = useNavigate();

  const handler = useCallback(
    (payload: DeepLinkPayload) => {
      if (handleExternalConversationDeepLink(payload, navigate)) return;

      // Support both formats: "add-provider" and "provider/add" (one-api style)
      if (payload.action === 'add-provider' || payload.action === 'provider/add') {
        pendingDeepLinkData = {
          base_url: payload.params.base_url,
          api_key: payload.params.api_key || payload.params.key,
          name: payload.params.name,
          platform: payload.params.platform,
        };

        // Navigate to model settings page; ModelModalContent will pick up the pending data
        void navigate('/settings/model');
        return;
      }

      if (payload.action === 'mindnprogress/runner-pair') {
        const apiUrl = payload.params.api_url;
        const pairingCode = payload.params.pairing_code;
        const machineId = payload.params.machine_id;
        if (!apiUrl || !pairingCode || !machineId) {
          console.warn('[DeepLink] MindNProgress Runner pairing link is incomplete');
          return;
        }
        publishMindNProgressRunnerPairing({ apiUrl, pairingCode, machineId });
        void navigate('/settings/mindnprogress');
        return;
      }

      if (payload.action === 'navigate') {
        const route = payload.params.route;
        if (!route) {
          console.warn('[DeepLink] navigate action missing route param');
          return;
        }

        const isAllowed = ALLOWED_NAVIGATE_PATTERNS.some((pattern) => pattern.test(route));
        if (!isAllowed) {
          console.warn(`[DeepLink] navigate blocked: route "${route}" not in whitelist`);
          return;
        }

        void navigate(route);
      }
    },
    [navigate]
  );

  useEffect(() => {
    const unsubscribe = ipcBridge.deepLink.received.on(handler);
    void ipcBridge.deepLink.ready.invoke().catch(() => {
      // Browser-only WebUI sessions may not have an Electron deep-link provider.
    });
    return unsubscribe;
  }, [handler]);
};
