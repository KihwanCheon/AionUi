/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { updateCdpTargetSelection } from '@process/resources/builtinMcp/cdpTargetSelection';

const createHandle = (attachedId: number | null) => ({
  attachedWebContentsId: vi.fn(() => attachedId),
  attach: vi.fn(() => ({ ok: true as const })),
  detach: vi.fn(),
});

describe('updateCdpTargetSelection', () => {
  it('attaches the browser tab that becomes active', () => {
    const handle = createHandle(null);

    expect(updateCdpTargetSelection(handle, 12, true)).toEqual({ ok: true });
    expect(handle.attach).toHaveBeenCalledWith(12);
    expect(handle.detach).not.toHaveBeenCalled();
  });

  it('detaches a browser tab when it stops being the selected target', () => {
    const handle = createHandle(12);

    expect(updateCdpTargetSelection(handle, 12, false)).toEqual({ ok: true });
    expect(handle.detach).toHaveBeenCalledOnce();
  });

  it('does not let a stale deactivation detach the newly active tab', () => {
    const handle = createHandle(27);

    expect(updateCdpTargetSelection(handle, 12, false)).toEqual({ ok: true });
    expect(handle.detach).not.toHaveBeenCalled();
  });
});
