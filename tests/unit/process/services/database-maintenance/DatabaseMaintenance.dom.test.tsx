import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DatabaseMaintenance from '@renderer/pages/settings/IntegrationsSettings/DatabaseMaintenance';
import type { DatabaseMaintenanceStatus } from '@/common/types/platform/databaseMaintenance';

const bridge = vi.hoisted(() => ({ status: vi.fn(), start: vi.fn(), desktop: true }));
vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      databaseMaintenanceStatus: { invoke: bridge.status },
      databaseMaintenanceStart: { invoke: bridge.start },
    },
  },
}));
vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => bridge.desktop }));
vi.mock('@renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const initial: DatabaseMaintenanceStatus = {
  phase: 'idle',
  busy: false,
  startedAt: null,
  inspectedAt: null,
  usage: null,
  result: null,
  error: null,
  restartRequired: false,
};
const inspected: DatabaseMaintenanceStatus = {
  ...initial,
  phase: 'done',
  inspectedAt: 1,
  usage: {
    database_bytes: 100,
    wal_bytes: 0,
    free_bytes: 40,
    available_bytes: 300,
    required_free_bytes: 200,
    conversation_count: 1,
    messages: [{ message_type: 'tool_call', count: 2, content_bytes: 20 }],
  },
};

describe('database settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    bridge.desktop = true;
    bridge.status.mockResolvedValue(initial);
    bridge.start.mockResolvedValue(inspected);
  });

  it('opens without inspecting or modifying the database', async () => {
    render(<DatabaseMaintenance />);
    await waitFor(() => expect(bridge.status).toHaveBeenCalledOnce());
    expect(bridge.start).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'settings.databaseMaintenance.compact' })).toBeDisabled();
  });

  it('shows usage and enables cleanup only after the inspect action', async () => {
    render(<DatabaseMaintenance />);
    const button = screen.getByRole('button', { name: 'settings.databaseMaintenance.inspect' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByText('tool_call');
    expect(bridge.start).toHaveBeenCalledWith({ action: 'inspect' });
    expect(screen.getByRole('button', { name: 'settings.databaseMaintenance.compact' })).toBeEnabled();
  });

  it('requires confirmation before cleanup and keeps history-preservation copy visible', async () => {
    bridge.status.mockResolvedValue(inspected);
    render(<DatabaseMaintenance />);
    const cleanup = screen.getByRole('button', { name: 'settings.databaseMaintenance.compact' });
    await waitFor(() => expect(cleanup).toBeEnabled());
    fireEvent.click(cleanup);
    await screen.findByText('settings.databaseMaintenance.confirmBody');
    expect(bridge.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('keeps cleanup disabled when temporary disk space is insufficient', async () => {
    bridge.status.mockResolvedValue({ ...inspected, usage: { ...inspected.usage, available_bytes: 1 } });
    render(<DatabaseMaintenance />);
    await screen.findByText('settings.databaseMaintenance.errors.space');
    expect(screen.getByRole('button', { name: 'settings.databaseMaintenance.compact' })).toBeDisabled();
  });

  it('starts cleanup only after the user confirms', async () => {
    bridge.status.mockResolvedValue(inspected);
    render(<DatabaseMaintenance />);
    const cleanup = screen.getByRole('button', { name: 'settings.databaseMaintenance.compact' });
    await waitFor(() => expect(cleanup).toBeEnabled());
    fireEvent.click(cleanup);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.databaseMaintenance.compact' }));
    await waitFor(() => expect(bridge.start).toHaveBeenCalledWith({ action: 'compact' }));
  });

  it('shows a job already running when the page is reopened', async () => {
    bridge.status.mockResolvedValue({ ...inspected, phase: 'compacting', busy: true, startedAt: Date.now() });
    render(<DatabaseMaintenance />);
    await screen.findByText('settings.databaseMaintenance.phases.compacting');
    expect(screen.getByRole('button', { name: 'settings.databaseMaintenance.inspect' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'settings.databaseMaintenance.compact' })).toBeDisabled();
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('offers restart recovery and disables new work after restart failure', async () => {
    bridge.status.mockResolvedValue({ ...inspected, phase: 'error', error: 'restart_failed', restartRequired: true });
    render(<DatabaseMaintenance />);
    const recovery = await screen.findByRole('button', { name: 'settings.databaseMaintenance.restart' });
    expect(screen.getByRole('button', { name: 'settings.databaseMaintenance.inspect' })).toBeDisabled();
    await act(async () => fireEvent.click(recovery));
    expect(bridge.start).toHaveBeenCalledWith({ action: 'restart' });
  });

  it('does not request native maintenance in the web client', async () => {
    bridge.desktop = false;
    render(<DatabaseMaintenance />);
    expect(screen.getByText('settings.databaseMaintenance.desktopOnly')).toBeInTheDocument();
    expect(bridge.status).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'settings.databaseMaintenance.inspect' })).not.toBeInTheDocument();
  });
});
