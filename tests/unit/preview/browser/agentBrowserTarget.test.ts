/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildAgentBrowserTargetUpdate } from '@/renderer/components/media/agentBrowserTarget';

describe('buildAgentBrowserTargetUpdate', () => {
  it('excludes generic WebviewHost consumers from agent browser control', () => {
    expect(buildAgentBrowserTargetUpdate(undefined, 41)).toBeNull();
  });

  it('reports the active browser target', () => {
    expect(buildAgentBrowserTargetUpdate(true, 41)).toEqual({ webContentsId: 41, active: true });
  });

  it('reports deactivation so the current target can be released', () => {
    expect(buildAgentBrowserTargetUpdate(false, 41)).toEqual({ webContentsId: 41, active: false });
  });

  it('waits until Electron exposes a numeric webContents id', () => {
    expect(buildAgentBrowserTargetUpdate(true, undefined)).toBeNull();
  });
});
