/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isElectronDesktop } from '@/renderer/utils/platform';

/**
 * Require a direct pointer/touch gesture before focusing text input on
 * touch-first WebUI clients. This is separate from responsive layout so a
 * large tablet can keep the desktop layout without opening its soft keyboard
 * whenever the active conversation changes.
 */
export const shouldRequireExplicitInputFocus = (isMobileLayout: boolean): boolean => {
  if (isMobileLayout) return true;
  if (typeof window === 'undefined' || isElectronDesktop() || typeof window.matchMedia !== 'function') return false;

  return window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches;
};
