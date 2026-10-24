import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobilePushStatus } from '@/common/types/platform/mobilePush';
import { Message } from '@arco-design/web-react';

const state = vi.hoisted(() => ({
  desktop: true,
  changed: undefined as (() => void) | undefined,
  status: vi.fn(),
  configure: vi.fn(),
  options: vi.fn(),
  pair: vi.fn(),
  refresh: vi.fn(),
  unlink: vi.fn(),
  test: vi.fn(),
  t: (key: string) => key,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: state.t }) }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => state.desktop, isWindows: () => true }));
vi.mock('@/common/platform/mobilePushBridge', () => ({
  mobilePushBridge: {
    available: () => true,
    status: { invoke: state.status },
    configure: { invoke: state.configure },
    options: { invoke: state.options },
    pair: { invoke: state.pair },
    refresh: { invoke: state.refresh },
    unlink: { invoke: state.unlink },
    test: { invoke: state.test },
    changed: {
      on: (listener: () => void) => {
        state.changed = listener;
        return () => {
          state.changed = undefined;
        };
      },
    },
  },
}));
import MobilePushSection from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/MobilePushSection';

let current: MobilePushStatus;
const key = (name: string) => `settings.mobilePush.${name}`;
beforeEach(() => {
  vi.clearAllMocks();
  state.desktop = true;
  vi.spyOn(Message, 'success').mockImplementation(() => ({ close: () => {} }));
  current = {
    supported: true,
    secureStorageAvailable: true,
    enabled: false,
    includePreview: false,
    configured: false,
    credentialPath: 'C:/private/firebase-service-account.json',
    sourceName: 'PC',
    devices: [],
  };
  state.status.mockImplementation(async () => ({ ok: true, value: { ...current } }));
  state.configure.mockImplementation(async () => ({
    ok: true,
    value: (current = { ...current, configured: true, projectId: 'private-project' }),
  }));
  state.options.mockImplementation(async (options) => ({ ok: true, value: (current = { ...current, ...options }) }));
  state.pair.mockResolvedValue({ ok: true, value: { code: '{"v":1}', expiresAt: Date.now() + 600000 } });
  state.refresh.mockImplementation(async () => ({ ok: true, value: { ...current } }));
  state.test.mockResolvedValue({ ok: true, value: undefined });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('desktop mobile push settings', () => {
  it('stays off until credentials are imported and the user explicitly enables it', async () => {
    render(<MobilePushSection />);
    const toggle = screen.getByRole('switch', { name: key('enabled') });
    await waitFor(() => expect(screen.getByLabelText(key('credentialPath'))).toHaveValue(current.credentialPath));
    expect(toggle).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: key('loadCredentials') }));
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(state.options).toHaveBeenCalledWith({ enabled: true });
  });
  it('does not expose key settings through the web interface', () => {
    state.desktop = false;
    render(<MobilePushSection />);
    expect(screen.queryByTestId('mobile-push-settings')).not.toBeInTheDocument();
    expect(state.status).not.toHaveBeenCalled();
  });
  it('shows a safe error when credential import is rejected', async () => {
    state.configure.mockResolvedValue({ ok: false, error: 'credentials' });
    render(<MobilePushSection />);
    await waitFor(() => expect(screen.getByRole('button', { name: key('loadCredentials') })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: key('loadCredentials') }));
    expect(await screen.findByText(key('errors.credentials'))).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: key('enabled') })).toBeDisabled();
  });
  it('clears the pairing code once the phone is registered and enables a test for that device', async () => {
    current = { ...current, configured: true, enabled: true };
    render(<MobilePushSection />);
    const connect = screen.getByRole('button', { name: key('connectPhone') });
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    expect(await screen.findByText(key('pairHelp'))).toBeInTheDocument();
    current = { ...current, devices: [{ id: 'phone', name: 'My phone', enabled: true }] };
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3100));
    });
    await waitFor(() => expect(screen.queryByText(key('pairHelp'))).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: key('test') }));
    await waitFor(() =>
      expect(state.test).toHaveBeenCalledWith({ deviceId: 'phone', title: key('testTitle'), body: key('testBody') })
    );
  });
  it('disables test delivery when the phone opts out', async () => {
    current = {
      ...current,
      configured: true,
      enabled: true,
      devices: [{ id: 'phone', name: 'Phone', enabled: false }],
    };
    render(<MobilePushSection />);
    expect(await screen.findByText(key('disabledOnPhone'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: key('test') })).toBeDisabled();
  });
});
