/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

let mockAgents: ManagedAgent[] = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: '/guid' }) }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => false }));
vi.mock('@/renderer/hooks/agent/useManagedAgents', () => ({ useManagedAgentRuntimeCatalog: () => mockAgents }));

import ClaudeUsagePill, { pickClaudeUsageAccountIndex } from '@/renderer/components/layout/Titlebar/ClaudeUsagePill';
import { pushClaudeUsageSnapshot, type ClaudeRateLimitState } from '@/renderer/hooks/useClaudeRateLimit';

const claudeRow = (claudeAccounts?: { id: string; number: number; label: string }[]): ManagedAgent =>
  ({ id: 'claude-row', backend: 'claude', claude_accounts: claudeAccounts }) as unknown as ManagedAgent;

const pushUsage = (accountId: string, session: number, weekly: number): void =>
  pushClaudeUsageSnapshot({
    session: { rateLimitType: 'five_hour', utilization: session, utilizationUnit: 'percent' },
    weekly: { rateLimitType: 'seven_day', utilization: weekly, utilizationUnit: 'percent' },
    updatedAt: Date.now(),
    ...(accountId === 'default' ? {} : { accountId }),
  });

const state = (
  session: number | undefined,
  weekly: number | undefined,
  updatedAt = Date.now()
): ClaudeRateLimitState => ({
  session:
    session === undefined
      ? undefined
      : { rateLimitType: 'five_hour', utilization: session, utilizationUnit: 'percent' },
  weekly:
    weekly === undefined ? undefined : { rateLimitType: 'seven_day', utilization: weekly, utilizationUnit: 'percent' },
  updatedAt,
});

afterEach(() => {
  mockAgents = [];
});

describe('pickClaudeUsageAccountIndex', () => {
  it('picks the account with the highest usage across both windows', () => {
    expect(pickClaudeUsageAccountIndex([state(30, 88), state(70, 20)])).toBe(0);
    expect(pickClaudeUsageAccountIndex([state(30, 10), state(70, 20)])).toBe(1);
  });

  it('keeps the account order on ties and skips stale or empty accounts', () => {
    expect(pickClaudeUsageAccountIndex([state(50, 10), state(50, 10)])).toBe(0);
    expect(pickClaudeUsageAccountIndex([state(10, 10), state(99, 99, 1)])).toBe(0);
    expect(pickClaudeUsageAccountIndex([{ updatedAt: 0 }, state(5, 5)])).toBe(1);
  });

  it('counts a limit status without a percentage as full usage', () => {
    const rejected: ClaudeRateLimitState = {
      session: { rateLimitType: 'five_hour', status: 'rejected' },
      updatedAt: Date.now(),
    };
    expect(pickClaudeUsageAccountIndex([state(90, 90), rejected])).toBe(1);
  });
});

describe('ClaudeUsagePill with Claude accounts', () => {
  it('shows the default account without an account mark while one account exists', () => {
    mockAgents = [claudeRow()];
    pushUsage('default', 30, 10);
    pushUsage('max', 70, 20);
    render(<ClaudeUsagePill />);
    expect(screen.getByText('30% · 10%')).toBeInTheDocument();
    expect(screen.queryByTestId('claude-account-mark')).toBeNull();
  });

  it('shows the most used account and lists every account on hover', async () => {
    mockAgents = [
      claudeRow([
        { id: 'default', number: 1, label: 'Team' },
        { id: 'max', number: 2, label: 'Max' },
      ]),
    ];
    pushUsage('default', 30, 10);
    pushUsage('max', 70, 20);
    render(<ClaudeUsagePill />);
    expect(screen.getByText('70% · 20%')).toBeInTheDocument();
    expect(screen.getByTestId('claude-account-mark')).toHaveTextContent('2');

    fireEvent.mouseEnter(screen.getByLabelText('common.claudeUsage.title'));
    const tags = await screen.findAllByTestId('claude-account-tag');
    expect(tags.map((tag) => tag.textContent)).toEqual(['1Team', '2Max']);
    expect(screen.getAllByText('30%')).toHaveLength(1);
    expect(screen.getAllByText('70%')).toHaveLength(1);
  });

  it('marks an account without usage data in the list', async () => {
    mockAgents = [
      claudeRow([
        { id: 'default', number: 1, label: 'Team' },
        { id: 'pro', number: 2, label: 'Pro' },
      ]),
    ];
    pushUsage('default', 40, 15);
    render(<ClaudeUsagePill />);
    expect(screen.getByText('40% · 15%')).toBeInTheDocument();
    expect(screen.getByTestId('claude-account-mark')).toHaveTextContent('1');

    fireEvent.mouseEnter(screen.getByLabelText('common.claudeUsage.title'));
    expect(await screen.findByText('common.claudeUsage.noData')).toBeInTheDocument();
  });
});
