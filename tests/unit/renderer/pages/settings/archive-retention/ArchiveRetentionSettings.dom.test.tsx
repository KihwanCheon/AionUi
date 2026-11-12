import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import type { ArchiveRetentionResponse } from '@/common/types/sidebar';
import ArchiveRetentionSettings from '@/renderer/pages/settings/ArchivedSettings/ArchiveRetentionSettings';

const { get, save } = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    sidebar: {
      getArchiveRetention: { invoke: get },
      saveArchiveRetention: { invoke: save },
    },
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ko-KR' },
  }),
}));

const key = (name: string) => `settings.archived.retention.${name}`;
const response = (): ArchiveRetentionResponse => ({
  settings: { enabled: false, retention_days: 30, run_at: '04:30', timezone: 'Asia/Seoul' },
  next_run_at: null,
  last_run_at: null,
  last_deleted: 0,
  last_failed: 0,
});
const open = async () => {
  fireEvent.click(screen.getByRole('button', { name: key('title') }));
  return screen.findByRole('switch');
};

describe('archive retention settings', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((media: string) => ({
        matches: false,
        media,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );
    get.mockReset().mockResolvedValue(response());
    save.mockReset().mockResolvedValue(response());
    vi.spyOn(Message, 'error').mockImplementation(() => 'error');
    vi.spyOn(Message, 'success').mockImplementation(() => 'success');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not enable deletion or write anything when merely opened and cancelled', async () => {
    render(<ArchiveRetentionSettings />);
    expect(get).not.toHaveBeenCalled();
    const toggle = await open();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(save).not.toHaveBeenCalled();
  });

  it('saves enabled state and days with the backend timezone preserved', async () => {
    render(<ArchiveRetentionSettings />);
    fireEvent.click(await open());
    const days = screen.getByRole('spinbutton');
    fireEvent.change(days, { target: { value: '7' } });
    fireEvent.blur(days);
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        enabled: true,
        retention_days: 7,
        run_at: '04:30',
        timezone: 'Asia/Seoul',
      })
    );
  });

  it('enables schedule fields only while automatic deletion is enabled', async () => {
    render(<ArchiveRetentionSettings />);
    const toggle = await open();
    const days = screen.getByRole('spinbutton') as HTMLInputElement;
    const time = screen.getByDisplayValue('04:30') as HTMLInputElement;
    expect([days.disabled, time.disabled]).toEqual([true, true]);
    fireEvent.click(toggle);
    expect([days.disabled, time.disabled]).toEqual([false, false]);
    fireEvent.click(toggle);
    expect([days.disabled, time.disabled]).toEqual([true, true]);
  });

  it('preserves schedule values and allows saving when automatic deletion is switched off', async () => {
    get.mockResolvedValue({
      ...response(),
      settings: { ...response().settings, enabled: true, retention_days: 14, run_at: '05:45' },
    });
    render(<ArchiveRetentionSettings />);
    const toggle = await open();
    const days = screen.getByRole('spinbutton');
    fireEvent.change(days, { target: { value: '7' } });
    fireEvent.blur(days);
    fireEvent.click(toggle);
    expect((days as HTMLInputElement).value).toBe('7');
    expect((screen.getByDisplayValue('05:45') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        enabled: false,
        retention_days: 7,
        run_at: '05:45',
        timezone: 'Asia/Seoul',
      })
    );
  });

  it('retains edited values after a failed save and allows retry', async () => {
    save.mockRejectedValueOnce(new Error('network unavailable'));
    render(<ArchiveRetentionSettings />);
    fireEvent.click(await open());
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith(key('saveFailed')));
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(Message.success).toHaveBeenCalledWith(key('saved')));
  });

  it('blocks saving after a load failure and can reload the server settings', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    render(<ArchiveRetentionSettings />);
    fireEvent.click(screen.getByRole('button', { name: key('title') }));
    await screen.findByText(key('loadFailed'));
    expect((screen.getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await screen.findByRole('switch');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('reloads settings on reopening so changes from another device are shown', async () => {
    render(<ArchiveRetentionSettings />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(screen.queryByRole('switch')).toBeNull());
    get.mockResolvedValue({ ...response(), settings: { ...response().settings, enabled: true, retention_days: 14 } });
    const toggle = await open();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('14');
  });
});
