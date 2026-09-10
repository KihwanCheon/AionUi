/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

type TargetSelectionHandle = {
  attachedWebContentsId: () => number | null;
  attach: (webContentsId: number) => { ok: true } | { ok: false; reason: string };
  detach: () => void;
};

export type TargetSelectionResult = { ok: true } | { ok: false; reason: string };

/**
 * Keep the single-target bridge aligned with the visible in-app browser tab.
 *
 * Deactivation is conditional on ownership. React effects for the old and new
 * tabs may reach the main process in either order; an old tab must never detach
 * a newer tab that has already become active.
 */
export const updateCdpTargetSelection = (
  handle: TargetSelectionHandle,
  webContentsId: number,
  active: boolean
): TargetSelectionResult => {
  if (active) return handle.attach(webContentsId);
  if (handle.attachedWebContentsId() === webContentsId) handle.detach();
  return { ok: true };
};
