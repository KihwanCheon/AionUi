/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebContents } from 'electron';

/**
 * Invalidate renderer readiness only when its top-level document or process is
 * replaced. Loading a subframe must not disconnect a live deep-link consumer.
 */
export function registerRendererReadinessInvalidation(webContents: WebContents, invalidate: () => void): void {
  webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      invalidate();
    }
  });
  webContents.on('render-process-gone', invalidate);
}
