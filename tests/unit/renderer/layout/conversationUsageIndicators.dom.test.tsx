/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeUsageSnapshot } from '@/common/types/platform/claudeUsage';
import type { CodexUsageSnapshot } from '@/common/types/platform/codexUsage';
import type {
  ClaudeAccountSubscriptionUsage,
  SubscriptionUsageSnapshot,
} from '@/common/types/platform/subscriptionUsage';
import styles from '@/renderer/components/layout/Titlebar/SubscriptionUsageIndicator.module.css';

const fixtures = vi.hoisted(() => ({
  claudeInvoke: vi.fn(),
  claudeListener: undefined as ((usage: ClaudeUsageSnapshot) => void) | undefined,
  codexInvoke: vi.fn(),
  codexListener: undefined as ((usage: CodexUsageSnapshot) => void) | undefined,
  conversationUsageInvoke: vi.fn(),
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
}));

import ConversationUsageIndicator from '@/renderer/components/layout/Titlebar/ConversationUsageIndicator';

const webAccount = (
  id: string,
  number: number,
  label: string,
  session: number,
  weekly: number
): ClaudeAccountSubscriptionUsage => ({
  id,
  number,
  label,
  state: 'ready',
  updatedAt: new Date().toISOString(),
  session: { usedPercent: session, resetsAt: null },
  weekly: { usedPercent: weekly, resetsAt: null },
});

const webSnapshot = (accounts: ClaudeAccountSubscriptionUsage[]): SubscriptionUsageSnapshot => ({
  schemaVersion: 1,
  state: 'partial',
  generatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  retryAfterMs: null,
  claude: accounts.find((account) => account.id === 'default') ?? {
    state: 'unavailable',
    updatedAt: null,
    session: null,
    weekly: null,
  },
  codex: { state: 'unavailable', updatedAt: null, weekly: null, limitReached: false },
  claudeAccounts: accounts,
});

const mobileDetails = () => within(screen.getByRole('button', { name: 'Claude Usage / Codex Usage' }).parentElement!);

describe('ConversationUsageIndicator', () => {
  beforeEach(() => {
    fixtures.claudeInvoke.mockReset().mockResolvedValue(null);
    fixtures.codexInvoke.mockReset().mockResolvedValue(null);
    fixtures.conversationUsageInvoke.mockReset().mockResolvedValue(null);
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

  it('keeps stale Claude usage with a delay label and restores freshness on the next reading', async () => {
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

      expect(screen.getByLabelText('Claude Usage')).toHaveTextContent('common.claudeUsage.refreshDelayed');
      expect(screen.queryByLabelText('Codex Usage')).not.toBeInTheDocument();
      await act(async () => {
        fixtures.claudeListener?.({
          session: { utilization: 32, utilizationUnit: 'percent', rateLimitType: 'five_hour' },
          updatedAt: Date.now(),
        });
      });
      expect(screen.getByLabelText('Claude Usage')).toHaveTextContent('32%');
      expect(screen.getByLabelText('Claude Usage')).not.toHaveTextContent('common.claudeUsage.refreshDelayed');
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

  it('shows the Codex 5-hour window in WebUI only while the snapshot has it', async () => {
    fixtures.electronDesktop = false;
    const now = new Date().toISOString();
    const webUsage: SubscriptionUsageSnapshot = {
      schemaVersion: 1,
      state: 'partial',
      generatedAt: now,
      updatedAt: now,
      retryAfterMs: null,
      claude: { state: 'unavailable', updatedAt: null, session: null, weekly: null },
      codex: {
        state: 'ready',
        updatedAt: now,
        session: { usedPercent: 92, resetsAt: null, windowDurationMins: 300 },
        weekly: { usedPercent: 8, resetsAt: null, windowDurationMins: 10_080 },
        limitReached: false,
      },
    };
    fixtures.webUsageInvoke.mockResolvedValue(webUsage);

    render(<ConversationUsageIndicator />);

    expect(await screen.findByLabelText('Codex Usage')).toHaveTextContent('92% · 8%');
    expect(screen.getByRole('button', { name: 'Claude Usage / Codex Usage' })).toHaveTextContent('92%');
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

  it('lists every registered Claude account in shared order in the mobile detail popover', async () => {
    fixtures.electronDesktop = false;
    fixtures.webUsageInvoke.mockResolvedValue(
      webSnapshot([webAccount('max', 1, 'Personal Max', 12, 87), webAccount('default', 2, 'Company Team', 31, 24)])
    );

    render(<ConversationUsageIndicator />);
    await screen.findByRole('button', { name: 'Claude Usage / Codex Usage' });

    const details = mobileDetails();
    expect(details.getAllByTestId('claude-account-tag').map((tag) => tag.textContent)).toEqual([
      '1Personal Max',
      '2Company Team',
    ]);
    expect(details.getAllByRole('progressbar').map((bar) => bar.getAttribute('aria-valuenow'))).toEqual([
      '12',
      '87',
      '31',
      '24',
    ]);
    expect(screen.getByRole('button', { name: 'Claude Usage / Codex Usage' }).parentElement).toHaveAttribute(
      'data-popover-trigger',
      'click'
    );
  });

  it('uses the highest account usage and its account mark in the web pill and mobile summary', async () => {
    fixtures.electronDesktop = false;
    fixtures.webUsageInvoke.mockResolvedValue(
      webSnapshot([webAccount('default', 1, 'Team', 31, 24), webAccount('max', 2, 'Max', 12, 87)])
    );

    render(<ConversationUsageIndicator />);
    const pill = await screen.findByLabelText('Claude Usage');

    expect(pill).toHaveTextContent('12% · 87%');
    expect(within(pill).getByTestId('claude-account-mark')).toHaveTextContent('2');
    const summary = screen.getByRole('button', { name: 'Claude Usage / Codex Usage' });
    expect(summary).toHaveTextContent('87%');
    expect(summary).toHaveClass(styles.warning);
  });

  it('shows another account when the default account has no usage data', async () => {
    fixtures.electronDesktop = false;
    const unavailable: ClaudeAccountSubscriptionUsage = {
      ...webAccount('default', 1, 'Team', 0, 0),
      state: 'unavailable',
      updatedAt: null,
      session: null,
      weekly: null,
    };
    fixtures.webUsageInvoke.mockResolvedValue(webSnapshot([unavailable, webAccount('max', 2, 'Max', 8, 23)]));

    render(<ConversationUsageIndicator />);

    expect(await screen.findByLabelText('Claude Usage')).toHaveTextContent('8% · 23%');
    expect(mobileDetails().getAllByTestId('claude-account-tag')).toHaveLength(2);
    expect(mobileDetails().getByText('common.claudeUsage.noData')).toBeInTheDocument();
  });

  it('excludes stale account usage from the summary while keeping the account in the details', async () => {
    fixtures.electronDesktop = false;
    const stale = { ...webAccount('max', 2, 'Max', 99, 100), updatedAt: new Date(Date.now() - 300_000).toISOString() };
    fixtures.webUsageInvoke.mockResolvedValue(webSnapshot([webAccount('default', 1, 'Team', 4, 18), stale]));

    render(<ConversationUsageIndicator />);

    expect(await screen.findByLabelText('Claude Usage')).toHaveTextContent('4% · 18%');
    expect(mobileDetails().getByText('common.claudeUsage.refreshDelayed')).toBeInTheDocument();
    expect(
      mobileDetails()
        .getAllByRole('progressbar')
        .map((bar) => bar.getAttribute('aria-valuenow'))
    ).toEqual(['4', '18', '99', '100']);
  });

  it('keeps stale usage in WebUI and mobile when every account is delayed', async () => {
    fixtures.electronDesktop = false;
    fixtures.webUsageInvoke.mockResolvedValue(
      webSnapshot([
        { ...webAccount('default', 1, 'Team', 4, 18), updatedAt: new Date(Date.now() - 300_000).toISOString() },
        { ...webAccount('max', 2, 'Max', 22, 44), updatedAt: new Date(Date.now() - 300_000).toISOString() },
      ])
    );
    render(<ConversationUsageIndicator />);
    expect(await screen.findByLabelText('Claude Usage')).toHaveTextContent(
      '22% · 44%common.claudeUsage.refreshDelayed'
    );
    expect(screen.getByRole('button', { name: 'Claude Usage / Codex Usage' })).toHaveTextContent(
      '44%common.claudeUsage.refreshDelayed'
    );
  });

  it('preserves the last WebUI reading during network errors and clears the delay after recovery', async () => {
    vi.useFakeTimers();
    fixtures.electronDesktop = false;
    fixtures.webUsageInvoke
      .mockResolvedValueOnce(webSnapshot([webAccount('default', 1, 'Team', 4, 18)]))
      .mockRejectedValue(new Error('offline'));
    try {
      render(<ConversationUsageIndicator />);
      await act(async () => vi.advanceTimersByTimeAsync(300_000));
      expect(screen.getByLabelText('Claude Usage')).toHaveTextContent('4% · 18%common.claudeUsage.refreshDelayed');
      fixtures.webUsageInvoke.mockResolvedValue(webSnapshot([webAccount('default', 1, 'Team', 5, 19)]));
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(screen.getByLabelText('Claude Usage')).toHaveTextContent('5% · 19%');
      expect(screen.getByLabelText('Claude Usage')).not.toHaveTextContent('common.claudeUsage.refreshDelayed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns to a single-account display when the next snapshot removes extra accounts', async () => {
    fixtures.electronDesktop = false;
    vi.useFakeTimers();
    try {
      const account = webAccount('default', 1, 'Team', 4, 18);
      fixtures.webUsageInvoke
        .mockResolvedValueOnce(webSnapshot([account, webAccount('max', 2, 'Max', 9, 87)]))
        .mockResolvedValue({ ...webSnapshot([account]), claudeAccounts: undefined });
      render(<ConversationUsageIndicator />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(mobileDetails().getAllByTestId('claude-account-tag')).toHaveLength(2);

      await act(async () => vi.advanceTimersByTimeAsync(10_000));

      expect(screen.queryByTestId('claude-account-mark')).not.toBeInTheDocument();
      expect(mobileDetails().queryByTestId('claude-account-tag')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Claude Usage')).toHaveTextContent('4% · 18%');
    } finally {
      vi.useRealTimers();
    }
  });
});
