/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({
  ipcBridge: {
    application: { systemInfo: { invoke: vi.fn().mockResolvedValue({ workDir: '/' }) } },
    fs: { getFilesByDir: { invoke: vi.fn().mockResolvedValue([]) } },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

import { ipcBridge } from '@/common';
import { WebFsPicker } from '@/renderer/components/workspace/webFsPicker';

afterEach(() => cleanup());

describe('WebFsPicker responsive dialog', () => {
  it('keeps the picker inside a narrow WebUI viewport', async () => {
    render(<WebFsPicker options={{ properties: ['openDirectory'] }} onDone={vi.fn()} />);

    const dialog = await screen.findByRole('dialog');
    const modal = dialog.closest<HTMLElement>('.arco-modal');

    expect(modal?.style.width).toBe('calc(100vw - 32px)');
    expect(modal?.style.maxWidth).toBe('640px');
  });
});

describe('WebFsPicker symlink/junction badge', () => {
  it('renders a badge for a browsable symlink/junction directory, not for a real directory', async () => {
    vi.mocked(ipcBridge.fs.getFilesByDir.invoke).mockResolvedValueOnce([
      { name: 'real_dir', full_path: '/real_dir', is_dir: true, is_symlink: false },
      { name: 'link_dir', full_path: '/link_dir', is_dir: true, is_symlink: true },
    ]);

    render(<WebFsPicker options={{ properties: ['openDirectory'] }} onDone={vi.fn()} />);

    await screen.findByText('link_dir');
    const badges = screen.getAllByTestId('web-fs-picker-symlink-badge');
    expect(badges).toHaveLength(1);
    expect(screen.getByText('real_dir').parentElement?.querySelector('[data-testid]')).toBeNull();
  });
});
