/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type AgentBrowserTargetUpdate = {
  webContentsId: number;
  active: boolean;
};

/**
 * Undefined active state deliberately excludes generic WebviewHost consumers
 * such as URL previews, Office previews, and extension settings from CDP.
 */
export const buildAgentBrowserTargetUpdate = (
  active: boolean | undefined,
  webContentsId: unknown
): AgentBrowserTargetUpdate | null => {
  if (active === undefined || typeof webContentsId !== 'number') return null;
  return { webContentsId, active };
};
