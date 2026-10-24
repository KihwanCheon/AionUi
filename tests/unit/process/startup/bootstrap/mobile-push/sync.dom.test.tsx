import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobilePushNotice } from '@/common/types/platform/mobilePush';

const state = vi.hoisted(() => ({
  desktop: true,
  enabled: false,
  notices: [] as MobilePushNotice[],
  changed: undefined as (() => void) | undefined,
  status: vi.fn(),
  sync: vi.fn(),
  t: (key: string) => key,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: state.t }) }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => state.desktop, isWindows: () => true }));
vi.mock('@/renderer/hooks/context/UserChoiceNotifications/useAttentionNotifications', () => ({
  useAttentionNotifications: () => ({ notices: state.notices }),
}));
vi.mock('@/common/platform/mobilePushBridge', () => ({
  mobilePushBridge: {
    available: () => true,
    status: { invoke: state.status },
    sync: { invoke: state.sync },
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
import MobilePushSync from '@/renderer/hooks/context/UserChoiceNotifications/MobilePushSync';

beforeEach(() => {
  vi.clearAllMocks();
  state.desktop = true;
  state.enabled = false;
  state.notices = [
    { key: 'request', kind: 'choice', conversationId: 'chat', messageId: 'message', markerIndex: 2, createdAt: 100 },
  ];
  state.status.mockImplementation(async () => ({ ok: true, value: { enabled: state.enabled } }));
  state.sync.mockResolvedValue({ ok: true });
});
describe('mobile push notice synchronization', () => {
  it('does not send snapshots until opted in, then follows additions and dismissals', async () => {
    const view = render(<MobilePushSync />);
    await waitFor(() => expect(state.status).toHaveBeenCalled());
    expect(state.sync).not.toHaveBeenCalled();
    state.enabled = true;
    await act(async () => {
      state.changed?.();
    });
    await waitFor(() => expect(state.sync).toHaveBeenCalledWith(expect.objectContaining({ notices: state.notices })));
    state.notices = [];
    view.rerender(<MobilePushSync />);
    await waitFor(() => expect(state.sync).toHaveBeenLastCalledWith(expect.objectContaining({ notices: [] })));
    state.enabled = false;
    await act(async () => {
      state.changed?.();
    });
    state.sync.mockClear();
    state.notices = [{ key: 'later', kind: 'failure', conversationId: 'chat', createdAt: 200 }];
    view.rerender(<MobilePushSync />);
    expect(state.sync).not.toHaveBeenCalled();
  });
  it('does not access desktop push endpoints in WebUI', () => {
    state.desktop = false;
    render(<MobilePushSync />);
    expect(state.status).not.toHaveBeenCalled();
    expect(state.sync).not.toHaveBeenCalled();
  });
  it('stays disabled when identity or the endpoint is unavailable', async () => {
    state.status.mockResolvedValue({ ok: false, error: 'identity' });
    render(<MobilePushSync />);
    await waitFor(() => expect(state.status).toHaveBeenCalled());
    expect(state.sync).not.toHaveBeenCalled();
  });
});
