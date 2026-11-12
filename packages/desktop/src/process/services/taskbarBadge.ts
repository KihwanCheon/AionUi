/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { app, nativeImage } from 'electron';

let mainWindowRef: BrowserWindow | null = null;
let flashTimer: ReturnType<typeof setInterval> | null = null;
let flashPhase = false;
let lastBadgeCount = 0;

export const stopTaskbarFlashing = (): void => {
  if (flashTimer) {
    clearInterval(flashTimer);
    flashTimer = null;
  }
  flashPhase = false;
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.flashFrame(false);
  }
};

const startTaskbarFlashing = (): void => {
  if (flashTimer) return;

  flashTimer = setInterval(() => {
    const win = mainWindowRef;
    if (!win || win.isDestroyed() || win.isFocused() || lastBadgeCount <= 0) {
      stopTaskbarFlashing();
      return;
    }
    flashPhase = !flashPhase;
    win.flashFrame(flashPhase);
  }, 700);
};

export const setTaskbarBadgeWindow = (win: BrowserWindow): void => {
  mainWindowRef = win;
  win.on('focus', stopTaskbarFlashing);
};

/**
 * Mirror unread completion state to the platform taskbar and request attention
 * until the user focuses the main window.
 */
export const applyTaskbarBadge = (count: number, iconDataUrl?: string): void => {
  lastBadgeCount = count;
  app.badgeCount = count;

  const win = mainWindowRef;
  if (!win || win.isDestroyed()) return;

  if (process.platform === 'win32') {
    let overlay: Electron.NativeImage | null = null;
    if (count > 0 && iconDataUrl) {
      const image = nativeImage.createFromDataURL(iconDataUrl);
      overlay = image.isEmpty() ? null : image;
    }
    win.setOverlayIcon(overlay, count > 0 ? `${count} completed` : '');
  }

  if (count > 0 && !win.isFocused()) {
    startTaskbarFlashing();
  } else {
    stopTaskbarFlashing();
  }
};
