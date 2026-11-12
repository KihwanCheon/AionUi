/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { showBrowserNotification } from '@/renderer/hooks/system/notification/browserNotificationDisplay';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import BrowserNotificationGrant from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserNotificationGrant';

const setNotification = (permission: NotificationPermission | null, secure = true) => {
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });
  if (permission === null) {
    delete (globalThis as unknown as { Notification?: unknown }).Notification;
  } else {
    (globalThis as unknown as { Notification: unknown }).Notification = {
      permission,
      requestPermission: vi.fn(() => Promise.resolve('granted')),
    };
  }
};
const originalWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

afterEach(() => {
  cleanup();
  if (originalWorker) Object.defineProperty(navigator, 'serviceWorker', originalWorker);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('BrowserNotificationGrant', () => {
  it('shows the enable button when permission is default', () => {
    setNotification('default');
    render(<BrowserNotificationGrant />);
    expect(screen.getByText('settings.browserNotification.enable')).toBeInTheDocument();
  });

  it('shows the granted state when already granted', () => {
    setNotification('granted');
    render(<BrowserNotificationGrant />);
    expect(screen.getByText('settings.browserNotification.granted')).toBeInTheDocument();
  });

  it('shows the denied state when permission is denied', () => {
    setNotification('denied');
    render(<BrowserNotificationGrant />);
    expect(screen.getByText('settings.browserNotification.denied')).toBeInTheDocument();
  });

  it('shows the insecure-context hint when not a secure context', () => {
    setNotification('default', false);
    render(<BrowserNotificationGrant />);
    expect(screen.getByText('settings.browserNotification.insecureContext')).toBeInTheDocument();
  });

  it('requests permission when the enable button is clicked', async () => {
    setNotification('default');
    const requestSpy = (globalThis as unknown as { Notification: { requestPermission: ReturnType<typeof vi.fn> } })
      .Notification.requestPermission;
    render(<BrowserNotificationGrant />);
    await userEvent.click(screen.getByText('settings.browserNotification.enable'));
    expect(requestSpy).toHaveBeenCalled();
  });
  it('lets the user test an actual service-worker notification from settings', async () => {
    setNotification('granted');
    const showNotification = vi.fn(async () => {});
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: async () => ({ active: {}, showNotification }),
      },
    });
    render(<BrowserNotificationGrant />);
    await userEvent.click(screen.getByRole('button', { name: 'settings.browserNotification.test' }));
    expect(showNotification).toHaveBeenCalledWith(
      'AionUi',
      expect.objectContaining({ body: 'settings.browserNotification.testBody' })
    );
    expect(screen.getByText('settings.browserNotification.connectedOnly')).toBeInTheDocument();
  });
});

describe('mobile browser notification display', () => {
  it('uses an active service worker even when Notification is not constructible', async () => {
    setNotification('granted');
    const showNotification = vi.fn(async () => {});
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: async () => ({ active: {}, showNotification }),
      },
    });
    await showBrowserNotification({ body: '확인할 내용', conversationId: 'chat-1', kind: 'confirmation' }, () => {});
    expect(showNotification).toHaveBeenCalledWith(
      'AionUi',
      expect.objectContaining({ body: '확인할 내용', data: { conversationId: 'chat-1' } })
    );
  });
  it('reports denied permission instead of claiming that a notification was sent', async () => {
    setNotification('denied');
    await expect(showBrowserNotification({ body: '내용', kind: 'confirmation' }, () => {})).rejects.toThrow(
      'unavailable'
    );
  });
  it('does not hide a service-worker display failure', async () => {
    setNotification('granted');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: async () => ({
          active: {},
          showNotification: async () => {
            throw Error('blocked');
          },
        }),
      },
    });
    await expect(showBrowserNotification({ body: '내용', kind: 'confirmation' }, () => {})).rejects.toThrow('blocked');
  });
});

describe('service worker notification navigation', () => {
  it('opens the exact conversation within the same origin and focuses its window', async () => {
    let click!: (event: unknown) => void;
    const navigate = vi.fn(async () => {});
    const focus = vi.fn(async () => {});
    const openWindow = vi.fn();
    const worker = {
      location: { href: 'https://aion.example/sw.js', origin: 'https://aion.example' },
      addEventListener: (name: string, listener: (event: unknown) => void) => {
        if (name === 'notificationclick') click = listener;
      },
      clients: { matchAll: async () => [{ url: 'https://aion.example/', navigate, focus }], openWindow },
    };
    runInNewContext(readFileSync('public/sw.js', 'utf8'), { self: worker, URL });
    let completion!: Promise<void>;
    click({
      notification: { close: vi.fn(), data: { conversationId: 'chat/with space' } },
      waitUntil: (task: Promise<void>) => {
        completion = task;
      },
    });
    await completion;
    expect(navigate).toHaveBeenCalledWith('https://aion.example/conversation/chat%2Fwith%20space');
    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });
  it('never treats notification data as an external destination', async () => {
    let click!: (event: unknown) => void;
    const openWindow = vi.fn(async () => {});
    const worker = {
      location: { href: 'https://aion.example/sw.js', origin: 'https://aion.example' },
      addEventListener: (name: string, listener: (event: unknown) => void) => {
        if (name === 'notificationclick') click = listener;
      },
      clients: { matchAll: async () => [], openWindow },
    };
    runInNewContext(readFileSync('public/sw.js', 'utf8'), { self: worker, URL });
    let completion!: Promise<void>;
    click({
      notification: { close: vi.fn(), data: { url: 'https://attacker.example/' } },
      waitUntil: (task: Promise<void>) => {
        completion = task;
      },
    });
    await completion;
    expect(openWindow).toHaveBeenCalledWith('https://aion.example/');
  });
});
