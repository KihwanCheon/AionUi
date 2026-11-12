/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { tmpdir } from 'node:os';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it, vi } from 'vitest';
import {
  buildWindowsConversationToast,
  traceWindowsNotificationActivation,
} from '@/process/startup/bootstrap/windowsNotification';

function parseToast(options: Parameters<typeof buildWindowsConversationToast>[0]) {
  const toast = buildWindowsConversationToast(options, 'win32');
  if (!toast) throw new Error('Expected a Windows conversation toast.');
  return new DOMParser().parseFromString(toast.toastXml, 'text/xml');
}

describe('Windows conversation notification activation', () => {
  it('embeds the existing conversation navigation protocol for Windows to activate independently', () => {
    const document = parseToast({ title: 'AionUi', body: 'Done', conversation_id: '58ebaac9' });
    const toast = document.documentElement;
    const activation = new URL(toast.getAttribute('launch') ?? '');

    expect(toast.getAttribute('activationType')).toBe('protocol');
    expect([activation.protocol, activation.hostname, activation.searchParams.get('route')]).toEqual([
      'aionui:',
      'navigate',
      '/conversation/58ebaac9',
    ]);
    expect(activation.searchParams.get('source')).toBe('desktop-notification');
  });

  it('preserves Korean titles and message bodies containing XML special characters', () => {
    const title = 'AionUi "알림" <완료> & 확인';
    const body = "'결과' <상세> & 다음 대화를 확인하세요.";
    const document = parseToast({ title, body, conversation_id: 'c1' });

    expect(Array.from(document.getElementsByTagName('text')).map((element) => element.textContent)).toEqual([
      title,
      body,
    ]);
    expect(document.getElementsByTagName('binding').item(0)?.getAttribute('template')).toBe('ToastGeneric');
  });

  it('keeps conversation IDs from injecting a different route or launch parameter', () => {
    const conversationId = 'chat/다음?route=/settings#항목';
    const document = parseToast({ title: 'AionUi', body: 'Done', conversation_id: conversationId });
    const activation = new URL(document.documentElement.getAttribute('launch') ?? '');
    const route = activation.searchParams.get('route') ?? '';

    expect(decodeURIComponent(route.slice('/conversation/'.length))).toBe(conversationId);
    expect(route.split('/')).toHaveLength(3);
    expect([...activation.searchParams.keys()]).toEqual(['route', 'source']);
  });

  it('preserves the existing icon as an escaped file URI', () => {
    const icon = path.join(tmpdir(), 'AionUi icons', 'logo & badge.png');
    const document = parseToast({ title: 'AionUi', body: 'Done', conversation_id: 'c1', icon });
    const image = document.getElementsByTagName('image').item(0);
    const iconUrl = new URL(image?.getAttribute('src') ?? '');

    expect(image?.getAttribute('placement')).toBe('appLogoOverride');
    expect(iconUrl.protocol).toBe('file:');
    expect(decodeURIComponent(iconUrl.pathname)).toContain('/AionUi icons/logo & badge.png');
  });

  it('omits an unavailable icon without introducing an empty image URL', () => {
    const document = parseToast({ title: 'AionUi', body: 'Done', conversation_id: 'c1' });

    expect(document.getElementsByTagName('image')).toHaveLength(0);
  });

  it.each(['darwin', 'linux'] as const)('keeps the existing notification API on %s', (platform) => {
    expect(
      buildWindowsConversationToast({ title: 'AionUi', body: 'Done', conversation_id: 'c1' }, platform)
    ).toBeUndefined();
  });

  it.each([undefined, '', '   '])(
    'keeps the existing click behavior when no conversation ID is available: %s',
    (id) => {
      expect(
        buildWindowsConversationToast({ title: 'AionUi', body: 'Done', conversation_id: id }, 'win32')
      ).toBeUndefined();
    }
  );
});

describe('notification activation diagnostics', () => {
  it.each(['received', 'renderer-ready'] as const)(
    'records the %s phase without including unrelated credentials',
    (phase) => {
      const log = vi.fn();
      traceWindowsNotificationActivation(
        {
          action: 'navigate',
          params: { source: 'desktop-notification', route: '/conversation/58ebaac9', token: 'do-not-log' },
        },
        phase,
        log
      );

      expect(log).toHaveBeenCalledExactlyOnceWith('[WindowsNotificationActivation]', {
        phase,
        conversation_id: '58ebaac9',
      });
    }
  );

  it.each([
    { action: 'add-provider', params: { source: 'desktop-notification', route: '/conversation/c1' } },
    { action: 'navigate', params: { source: 'external', route: '/conversation/c1' } },
    { action: 'navigate', params: { source: 'desktop-notification', route: '/settings/model?api_key=do-not-log' } },
    { action: 'navigate', params: { source: 'desktop-notification', route: '/conversation/c1\nforged-log' } },
  ])('does not trace unrelated or malformed protocol payloads', (payload) => {
    const log = vi.fn();
    traceWindowsNotificationActivation(payload, 'received', log);

    expect(log).not.toHaveBeenCalled();
  });
});
