/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

let mockAgents: ManagedAgent[] = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/renderer/hooks/agent/useManagedAgents', () => ({ useManagedAgentRuntimeCatalog: () => mockAgents }));

import type { TChatConversation } from '@/common/config/storage';
import { ConversationClaudeAccountBadge } from '@/renderer/pages/conversation/platforms/acp/claudeAccounts/ClaudeAccountBadge';
import { useGuidClaudeAccountSelection } from '@/renderer/pages/conversation/platforms/acp/claudeAccounts/GuidClaudeAccountSelector';

const claudeRow = (claudeAccounts?: { id: string; number: number; label: string }[]): ManagedAgent =>
  ({ id: 'claude-row', backend: 'claude', claude_accounts: claudeAccounts }) as unknown as ManagedAgent;

const twoAccounts = [
  { id: 'default', number: 1, label: 'Team' },
  { id: 'max', number: 2, label: 'Max' },
];

const maxConversation = {
  id: 'c1',
  type: 'acp',
  extra: { backend: 'claude', claude_account_id: 'max' },
} as unknown as TChatConversation;

afterEach(() => {
  mockAgents = [];
});

describe('ConversationClaudeAccountBadge', () => {
  it('renders nothing while only one Claude account exists', () => {
    mockAgents = [claudeRow()];
    const { container } = render(<ConversationClaudeAccountBadge conversation={maxConversation} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the shared number of the conversation account with two accounts', () => {
    mockAgents = [claudeRow(twoAccounts)];
    render(<ConversationClaudeAccountBadge conversation={maxConversation} />);
    expect(screen.getByTestId('claude-account-badge')).toHaveTextContent('2');
  });

  it('shows number and label in the header tag variant', () => {
    mockAgents = [claudeRow(twoAccounts)];
    render(<ConversationClaudeAccountBadge conversation={maxConversation} variant='tag' />);
    expect(screen.getByTestId('claude-account-tag')).toHaveTextContent('2Max');
  });
});

describe('useGuidClaudeAccountSelection', () => {
  it('yields no selector and no account id with a single account', () => {
    mockAgents = [claudeRow()];
    const { result } = renderHook(() => useGuidClaudeAccountSelection({ backend: 'claude' }));
    expect(result.current).toEqual({ accountId: null, selectorNode: null });
  });

  it('stays inert for non-Claude assistants even with two accounts', () => {
    mockAgents = [claudeRow(twoAccounts)];
    const { result } = renderHook(() => useGuidClaudeAccountSelection({ backend: 'codex' }));
    expect(result.current.accountId).toBeNull();
  });

  it('defaults to account 1 and prefers an account requested by an external launch', () => {
    mockAgents = [claudeRow(twoAccounts)];
    const plain = renderHook(() => useGuidClaudeAccountSelection({ backend: 'claude' }));
    expect(plain.result.current.accountId).toBe('default');
    expect(plain.result.current.selectorNode).not.toBeNull();

    const launched = renderHook(() => useGuidClaudeAccountSelection({ backend: 'claude', requestedAccountId: 'max' }));
    expect(launched.result.current.accountId).toBe('max');
  });

  it('switches the account when the user picks another one', () => {
    mockAgents = [claudeRow(twoAccounts)];
    const { result } = renderHook(() => useGuidClaudeAccountSelection({ backend: 'claude' }));
    const selector = result.current.selectorNode as React.ReactElement<{ onChange: (id: string) => void }>;
    act(() => selector.props.onChange('max'));
    expect(result.current.accountId).toBe('max');
  });
});
