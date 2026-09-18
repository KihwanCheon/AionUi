/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyMonitorSnapshot } from '@/common/types/platform/subscriptionUsage';

const fixtures = vi.hoisted(() => ({
  invoke: vi.fn(),
  listener: undefined as ((snapshot: PtyMonitorSnapshot) => void) | undefined,
}));

vi.mock('@/common/platform/subscriptionUsageBridge', () => ({
  subscriptionUsageBridge: {
    getPtyMonitor: { invoke: fixtures.invoke },
    ptyMonitorChanged: {
      on: (listener: (snapshot: PtyMonitorSnapshot) => void) => {
        fixtures.listener = listener;
        return vi.fn();
      },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Popover: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
    <div>
      {children}
      <div>{content}</div>
    </div>
  ),
}));

vi.mock('@icon-park/react', () => ({
  Terminal: () => <span />,
}));

import PtyMonitorIndicator from '@/renderer/components/layout/Titlebar/ConversationUsageIndicator/PtyMonitorIndicator';

const readySnapshot: PtyMonitorSnapshot = {
  state: 'ready',
  updatedAt: 1_000,
  limit: 511,
  totalCount: 20,
  aionUiPid: 100,
  aionUiCount: 12,
  trackedActiveCount: 1,
  suspectedUntrackedCount: 11,
  owners: [
    { pid: 100, processName: 'Electron', count: 12 },
    { pid: 200, processName: 'Terminal', count: 8 },
  ],
  activeLaunches: [
    {
      id: 'launch-1',
      purpose: 'claude-usage-probe',
      conversationId: 'conv-1',
      conversationName: 'PTY investigation',
      childPid: 300,
      startedAt: 900,
    },
  ],
};

describe('PtyMonitorIndicator', () => {
  beforeEach(() => {
    fixtures.invoke.mockReset().mockResolvedValue(readySnapshot);
    fixtures.listener = undefined;
  });

  it('shows system, AionUi, untracked, owner, and active launch details', async () => {
    render(<PtyMonitorIndicator />);

    expect(await screen.findByRole('button', { name: 'PTY Monitor' })).toHaveTextContent('20/511');
    expect(screen.getByText('AionUi').parentElement).toHaveTextContent('12');
    expect(screen.getByText('Untracked suspected').parentElement).toHaveTextContent('11');
    expect(screen.getByText('Electron · PID 100')).toBeInTheDocument();
    expect(screen.getByText('PTY investigation · PID 300')).toBeInTheDocument();
  });

  it('updates from periodic main-process snapshots', async () => {
    render(<PtyMonitorIndicator />);
    await screen.findByRole('button', { name: 'PTY Monitor' });

    await act(async () => {
      fixtures.listener?.({ ...readySnapshot, totalCount: 21, aionUiCount: 13, suspectedUntrackedCount: 12 });
    });

    expect(screen.getByRole('button', { name: 'PTY Monitor' })).toHaveTextContent('21/511');
  });

  it('shows an unavailable state without claiming a garbage count', async () => {
    fixtures.invoke.mockResolvedValue({
      ...readySnapshot,
      state: 'unavailable',
      limit: null,
      totalCount: null,
      aionUiCount: null,
      trackedActiveCount: 0,
      suspectedUntrackedCount: null,
      owners: [],
      activeLaunches: [],
    } satisfies PtyMonitorSnapshot);

    render(<PtyMonitorIndicator />);

    expect(await screen.findByText('Monitoring unavailable')).toBeInTheDocument();
    expect(screen.queryByText('11')).not.toBeInTheDocument();
  });
});
