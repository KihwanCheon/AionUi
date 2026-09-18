/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeUsageSnapshot } from '@/common/types/platform/claudeUsage';
import type { CodexUsageSnapshot } from '@/common/types/platform/codexUsage';
import type { SubscriptionUsageSnapshot } from '@/common/types/platform/subscriptionUsage';
import type { PtyMonitorSnapshot } from '@/common/types/platform/subscriptionUsage';
import styles from '@/renderer/components/layout/Titlebar/SubscriptionUsageIndicator.module.css';

const fixtures = vi.hoisted(() => ({
  claudeInvoke: vi.fn(),
  claudeListener: undefined as ((usage: ClaudeUsageSnapshot) => void) | undefined,
  codexInvoke: vi.fn(),
  codexListener: undefined as ((usage: CodexUsageSnapshot) => void) | undefined,
  conversationUsageInvoke: vi.fn(),
  ptyInvoke: vi.fn(),
  ptyListener: undefined as ((snapshot: PtyMonitorSnapshot) => void) | undefined,
  electronDesktop: true,
  webUsageInvoke: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/conversation/first' }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      getUsage: { invoke: fixtures.conversationUsageInvoke },
    },
  },
}));

vi.mock('@/common/platform/subscriptionUsageBridge', () => ({
  subscriptionUsageBridge: {
    getClaude: { invoke: fixtures.claudeInvoke },
    getCodex: { invoke: fixtures.codexInvoke },
    claudeChanged: {
      on: (listener: (usage: ClaudeUsageSnapshot) => void) => {
        fixtures.claudeListener = listener;
        return vi.fn();
      },
    },
    codexChanged: {
      on: (listener: (usage: CodexUsageSnapshot) => void) => {
        fixtures.codexListener = listener;
        return vi.fn();
      },
    },
    getPtyMonitor: { invoke: fixtures.ptyInvoke },
    ptyMonitorChanged: {
      on: (listener: (snapshot: PtyMonitorSnapshot) => void) => {
        fixtures.ptyListener = listener;
        return vi.fn();
      },
    },
  },
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpGet: () => ({ invoke: fixtures.webUsageInvoke }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => fixtures.electronDesktop,
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
  Popover: ({
    children,
    content,
    trigger,
  }: {
    children: React.ReactNode;
    content: React.ReactNode;
    trigger: string;
  }) => (
    <div data-popover-trigger={trigger}>
      {children}
      <div>{content}</div>
    </div>
  ),
}));

vi.mock('@icon-park/react', () => ({
  Dashboard: () => <span />,
  Terminal: () => <span />,
}));

import ConversationUsageIndicator from '@/renderer/components/layout/Titlebar/ConversationUsageIndicator';

describe('ConversationUsageIndicator', () => {
  beforeEach(() => {
    fixtures.claudeInvoke.mockReset().mockResolvedValue(null);
    fixtures.codexInvoke.mockReset().mockResolvedValue(null);
    fixtures.conversationUsageInvoke.mockReset().mockResolvedValue(null);
    fixtures.ptyInvoke.mockReset().mockResolvedValue({
      state: 'unsupported',
      updatedAt: Date.now(),
      limit: null,
      totalCount: null,
      aionUiPid: 1,
      aionUiCount: null,
      trackedActiveCount: 0,
      suspectedUntrackedCount: null,
      owners: [],
      activeLaunches: [],
    } satisfies PtyMonitorSnapshot);
    fixtures.ptyListener = undefined;
    fixtures.electronDesktop = true;
    fixtures.webUsageInvoke.mockReset().mockResolvedValue(null);
    fixtures.claudeListener = undefined;
    fixtures.codexListener = undefined;
  });

  it('uses the account-wide Claude probe without polling a conversation usage snapshot', async () => {
    render(<ConversationUsageIndicator />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(fixtures.claudeInvoke).toHaveBeenCalledWith({ conversationId: 'first' });
    expect(fixtures.conversationUsageInvoke).not.toHaveBeenCalled();
  });

  it('renders Claude and Codex publisher updates immediately with exact percentages', async () => {
    render(<ConversationUsageIndicator />);

    await act(async () => {
      fixtures.claudeListener?.({
        session: { rateLimitType: 'five_hour', utilization: 1, utilizationUnit: 'percent' },
        weekly: { rateLimitType: 'seven_day', utilization: 30, utilizationUnit: 'percent' },
        updatedAt: Date.now(),
      });
      fixtures.codexListener?.({
        weekly: { usedPercent: 1 },
        limitReached: false,
        updatedAt: Date.now(),
      });
    });

    expect(screen.getByLabelText('Claude Usage')).toHaveTextContent('1% · 30%');
    expect(screen.getByLabelText('Codex Usage')).toHaveTextContent('1%');
  });

  it('shows exact over-limit Claude usage while keeping low Codex usage normal', async () => {
    render(<ConversationUsageIndicator />);

    await act(async () => {
      fixtures.claudeListener?.({
        session: { rateLimitType: 'five_hour', utilization: 103, utilizationUnit: 'percent' },
        weekly: { rateLimitType: 'seven_day', utilization: 39, utilizationUnit: 'percent' },
        updatedAt: Date.now(),
      });
      fixtures.codexListener?.({
        weekly: { usedPercent: 15 },
        limitReached: false,
        updatedAt: Date.now(),
      });
    });

    expect(screen.getByLabelText('Claude Usage')).toHaveTextContent('103% · 39%');
    expect(screen.getByLabelText('Claude Usage')).toHaveClass(styles.limit);
    expect(screen.getByLabelText('Codex Usage')).not.toHaveClass(styles.warning, styles.limit);
  });

  it('shows the limit tone when Codex reports the limit reached flag', async () => {
    render(<ConversationUsageIndicator />);

    await act(async () => {
      fixtures.codexListener?.({
        weekly: { usedPercent: 15 },
        limitReached: true,
        updatedAt: Date.now(),
      });
    });

    expect(screen.getByLabelText('Codex Usage')).toHaveClass(styles.limit);
  });

  it('hides Claude and Codex usage when their snapshots become five minutes old', async () => {
    vi.useFakeTimers();
    try {
      const updatedAt = Date.now();
      render(<ConversationUsageIndicator />);

      await act(async () => {
        fixtures.claudeListener?.({
          session: { rateLimitType: 'five_hour', utilization: 31, utilizationUnit: 'percent' },
          updatedAt,
        });
        fixtures.codexListener?.({
          weekly: { usedPercent: 29 },
          limitReached: false,
          updatedAt,
        });
      });
      expect(screen.getByLabelText('Claude Usage')).toBeInTheDocument();
      expect(screen.getByLabelText('Codex Usage')).toBeInTheDocument();

      await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));

      expect(screen.queryByLabelText('Claude Usage')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Codex Usage')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows desktop-style provider pills and a click detail trigger in WebUI', async () => {
    fixtures.electronDesktop = false;
    const now = new Date().toISOString();
    const webUsage: SubscriptionUsageSnapshot = {
      schemaVersion: 1,
      state: 'ready',
      generatedAt: now,
      updatedAt: now,
      retryAfterMs: null,
      claude: {
        state: 'ready',
        updatedAt: now,
        session: { usedPercent: 17, resetsAt: null },
        weekly: { usedPercent: 41, resetsAt: null },
      },
      codex: {
        state: 'ready',
        updatedAt: now,
        weekly: { usedPercent: 73, resetsAt: null, windowDurationMins: 10_080 },
        limitReached: false,
      },
    };
    fixtures.webUsageInvoke.mockResolvedValue(webUsage);

    render(<ConversationUsageIndicator />);

    expect(await screen.findByLabelText('Claude Usage')).toHaveTextContent('17% · 41%');
    expect(screen.getByLabelText('Codex Usage')).toHaveTextContent('73%');
    const mobileTrigger = screen.getByRole('button', { name: 'Claude Usage / Codex Usage' });
    expect(mobileTrigger).toHaveTextContent('73%');
    expect(mobileTrigger.parentElement).toHaveAttribute('data-popover-trigger', 'click');
    expect(fixtures.webUsageInvoke).toHaveBeenCalledTimes(1);
    expect(fixtures.claudeInvoke).not.toHaveBeenCalled();
    expect(fixtures.codexInvoke).not.toHaveBeenCalled();
  });

  it('keeps WebUI usage hidden when the desktop snapshot is unavailable', async () => {
    fixtures.electronDesktop = false;
    fixtures.webUsageInvoke.mockResolvedValue(null);

    render(<ConversationUsageIndicator />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByLabelText('Claude Usage')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Codex Usage')).not.toBeInTheDocument();
  });
});
