/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { pathToFileURL } from 'node:url';
import { AIONUI_PROTOCOL_SCHEME } from './protocol';

type ConversationNotification = {
  title: string;
  body: string;
  conversation_id?: string;
  icon?: string;
};

type NotificationDeepLink = {
  action: string;
  params: Record<string, string>;
};

const NOTIFICATION_SOURCE = 'desktop-notification';
const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

const escapeXml = (value: string): string => value.replace(/[&<>"']/g, (character) => XML_ENTITIES[character]);

/** Build a Windows toast whose conversation link survives the native click callback. */
export function buildWindowsConversationToast(
  options: ConversationNotification,
  platform: NodeJS.Platform = process.platform
): { toastXml: string } | undefined {
  if (platform !== 'win32' || !options.conversation_id?.trim()) return undefined;

  const activationUrl = new URL(`${AIONUI_PROTOCOL_SCHEME}://navigate`);
  activationUrl.searchParams.set('route', `/conversation/${encodeURIComponent(options.conversation_id)}`);
  activationUrl.searchParams.set('source', NOTIFICATION_SOURCE);
  const image = options.icon
    ? `<image placement="appLogoOverride" src="${escapeXml(pathToFileURL(options.icon).href)}"/>`
    : '';

  return {
    toastXml:
      `<toast activationType="protocol" launch="${escapeXml(activationUrl.href)}">` +
      `<visual><binding template="ToastGeneric">${image}` +
      `<text>${escapeXml(options.title)}</text><text>${escapeXml(options.body)}</text>` +
      '</binding></visual></toast>',
  };
}

/** Trace only notification conversation links, without logging arbitrary deep-link credentials. */
export function traceWindowsNotificationActivation(
  payload: NotificationDeepLink,
  phase: 'received' | 'renderer-ready',
  log: (message: string, details: { phase: string; conversation_id: string }) => void = console.info
): void {
  if (payload.action !== 'navigate' || payload.params.source !== NOTIFICATION_SOURCE) return;
  const match = /^\/conversation\/([a-zA-Z0-9_-]+)$/.exec(payload.params.route ?? '');
  if (!match) return;
  log('[WindowsNotificationActivation]', { phase, conversation_id: match[1] });
}
