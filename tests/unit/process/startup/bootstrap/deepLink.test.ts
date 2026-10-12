/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { buildWindowsConversationToast } from '@/process/startup/bootstrap/windowsNotification';

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  readyProvider: null as null | (() => Promise<void>),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    deepLink: {
      ready: {
        provider: (handler: () => Promise<void>) => {
          mocks.readyProvider = handler;
        },
      },
      received: { emit: mocks.emit },
    },
  },
}));

function createWindow() {
  const webContentsListeners = new Map<string, (...args: unknown[]) => void>();
  const windowListeners = new Map<string, () => void>();
  const window = {
    isDestroyed: () => false,
    on: (event: string, handler: () => void) => windowListeners.set(event, handler),
    webContents: {
      isDestroyed: () => false,
      on: (event: string, handler: (...args: unknown[]) => void) => webContentsListeners.set(event, handler),
    },
  } as unknown as BrowserWindow;
  return { window, webContentsListeners };
}

describe('deep-link renderer readiness', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.emit.mockReset();
    mocks.readyProvider = null;
  });

  it('keeps valid links in FIFO order until the renderer subscribes', async () => {
    const deepLink = await import('@/process/utils/deepLink');
    const { window } = createWindow();
    deepLink.registerDeepLinkReadyProvider();
    deepLink.setDeepLinkMainWindow(window);

    deepLink.handleDeepLinkUrl('aionui://navigate?route=%2Fconversation%2Ffirst');
    deepLink.handleDeepLinkUrl('aionui://navigate?route=%2Fconversation%2Fsecond');
    expect(mocks.emit).not.toHaveBeenCalled();

    await mocks.readyProvider?.();

    expect(mocks.emit.mock.calls.map(([payload]) => payload.params.route)).toEqual([
      '/conversation/first',
      '/conversation/second',
    ]);
  });

  it('buffers links again while a renderer reload is in progress', async () => {
    const deepLink = await import('@/process/utils/deepLink');
    const { window, webContentsListeners } = createWindow();
    deepLink.registerDeepLinkReadyProvider();
    deepLink.setDeepLinkMainWindow(window);
    await mocks.readyProvider?.();

    webContentsListeners.get('did-start-navigation')?.({ isMainFrame: true, isSameDocument: false });
    deepLink.handleDeepLinkUrl('aionui://navigate?route=%2Fconversation%2Freloaded');
    expect(mocks.emit).not.toHaveBeenCalled();

    await mocks.readyProvider?.();

    expect(mocks.emit).toHaveBeenCalledWith({
      action: 'navigate',
      params: { route: '/conversation/reloaded' },
    });
  });

  it('keeps links flowing while a subframe loads', async () => {
    const deepLink = await import('@/process/utils/deepLink');
    const { window, webContentsListeners } = createWindow();
    deepLink.registerDeepLinkReadyProvider();
    deepLink.setDeepLinkMainWindow(window);
    await mocks.readyProvider?.();

    webContentsListeners.get('did-start-navigation')?.({ isMainFrame: false, isSameDocument: false });
    deepLink.handleDeepLinkUrl('aionui://navigate?route=%2Fconversation%2Fafter-subframe-load');

    expect(mocks.emit).toHaveBeenCalledWith({
      action: 'navigate',
      params: { route: '/conversation/after-subframe-load' },
    });
  });

  it('keeps links flowing during same-document navigation', async () => {
    const deepLink = await import('@/process/utils/deepLink');
    const { window, webContentsListeners } = createWindow();
    deepLink.registerDeepLinkReadyProvider();
    deepLink.setDeepLinkMainWindow(window);
    await mocks.readyProvider?.();

    webContentsListeners.get('did-start-navigation')?.({ isMainFrame: true, isSameDocument: true });
    deepLink.handleDeepLinkUrl('aionui://navigate?route=%2Fconversation%2Fafter-hash-change');

    expect(mocks.emit).toHaveBeenCalledWith({
      action: 'navigate',
      params: { route: '/conversation/after-hash-change' },
    });
  });

  it('buffers links after the renderer exits until its replacement subscribes', async () => {
    const deepLink = await import('@/process/utils/deepLink');
    const { window, webContentsListeners } = createWindow();
    deepLink.registerDeepLinkReadyProvider();
    deepLink.setDeepLinkMainWindow(window);
    await mocks.readyProvider?.();

    webContentsListeners.get('render-process-gone')?.();
    deepLink.handleDeepLinkUrl('aionui://navigate?route=%2Fconversation%2Fafter-crash');
    expect(mocks.emit).not.toHaveBeenCalled();

    await mocks.readyProvider?.();

    expect(mocks.emit).toHaveBeenCalledWith({
      action: 'navigate',
      params: { route: '/conversation/after-crash' },
    });
  });

  it('does not queue malformed external input', async () => {
    const deepLink = await import('@/process/utils/deepLink');
    const { window } = createWindow();
    deepLink.registerDeepLinkReadyProvider();
    deepLink.setDeepLinkMainWindow(window);
    await mocks.readyProvider?.();

    deepLink.handleDeepLinkUrl('https://example.com/conversation/1');

    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('passes a short conversation ticket from the OS protocol to the renderer unchanged', async () => {
    const deepLink = await import('@/process/utils/deepLink');
    const { window } = createWindow();
    deepLink.registerDeepLinkReadyProvider();
    deepLink.setDeepLinkMainWindow(window);
    const launchId = 'a'.repeat(64);
    deepLink.handleDeepLinkUrl(`aionui://conversation/new?launchId=${launchId}`);
    await mocks.readyProvider?.();
    expect(mocks.emit).toHaveBeenCalledExactlyOnceWith({ action: 'conversation/new', params: { launchId } });
  });

  it('delivers the Windows toast conversation link exactly once after the renderer is ready', async () => {
    const deepLink = await import('@/process/utils/deepLink');
    const { window } = createWindow();
    const toast = buildWindowsConversationToast(
      { title: 'AionUi', body: 'done', conversation_id: '58ebaac9' },
      'win32'
    );
    const document = new DOMParser().parseFromString(toast?.toastXml ?? '', 'text/xml');
    const activationUrl = document.documentElement.getAttribute('launch') ?? '';
    deepLink.registerDeepLinkReadyProvider();
    deepLink.setDeepLinkMainWindow(window);
    deepLink.handleDeepLinkUrl(activationUrl);

    expect(mocks.emit).not.toHaveBeenCalled();
    await mocks.readyProvider?.();
    await mocks.readyProvider?.();

    expect(mocks.emit).toHaveBeenCalledExactlyOnceWith({
      action: 'navigate',
      params: { route: '/conversation/58ebaac9', source: 'desktop-notification' },
    });
  });
});
