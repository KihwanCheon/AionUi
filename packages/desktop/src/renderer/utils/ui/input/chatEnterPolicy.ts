/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isElectronDesktop } from '@/renderer/utils/platform';

type ChatEnterMode = 'send' | 'newline';
type EnterKeyEvent = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>;

/** Keep desktop submission while allowing touch-first WebUI clients to write multiple lines. */
export const getChatEnterMode = (): ChatEnterMode => {
  if (typeof window === 'undefined' || isElectronDesktop() || typeof window.matchMedia !== 'function') {
    return 'send';
  }

  // Viewport width alone would change desktop shortcuts and miss large tablets.
  return window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches
    ? 'newline'
    : 'send';
};

/** Leave Enter's native newline intact without taking over modifier shortcuts. */
export const isChatNewlineKey = (event: EnterKeyEvent, mode: ChatEnterMode): boolean =>
  mode === 'newline' && event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey;
