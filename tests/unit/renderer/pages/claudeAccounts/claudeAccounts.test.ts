/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/hooks/agent/useManagedAgents', () => ({ useManagedAgentRuntimeCatalog: () => [] }));

import type { TChatConversation } from '@/common/config/storage';
import {
  claudeAccountExtra,
  resolveConversationClaudeAccount,
  selectClaudeAccounts,
} from '@/renderer/pages/conversation/platforms/acp/claudeAccounts/useClaudeAccounts';
import { parseExternalConversationLaunch } from '@/renderer/services/externalConversationLaunch';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

const accounts = [
  { id: 'default', number: 1, label: 'Team' },
  { id: 'max', number: 2, label: 'Max' },
];

const agentRow = (backend: string, claudeAccounts?: typeof accounts): ManagedAgent =>
  ({ id: `${backend}-row`, backend, claude_accounts: claudeAccounts }) as unknown as ManagedAgent;

const conversation = (extra: Record<string, unknown>, type = 'acp'): TChatConversation =>
  ({ id: 'c1', type, extra }) as unknown as TChatConversation;

describe('selectClaudeAccounts', () => {
  it('returns null for a single-account catalog so every surface renders as before', () => {
    expect(selectClaudeAccounts([agentRow('claude')])).toBeNull();
    expect(selectClaudeAccounts([agentRow('claude', accounts.slice(0, 1))])).toBeNull();
  });

  it('returns the shared order carried by the Claude row only', () => {
    expect(selectClaudeAccounts([agentRow('codex', accounts), agentRow('claude', accounts)])).toEqual(accounts);
  });

  it('treats a missing or malformed catalog as single-account', () => {
    expect(selectClaudeAccounts(undefined)).toBeNull();
    expect(selectClaudeAccounts({} as unknown as ManagedAgent[])).toBeNull();
  });
});

describe('resolveConversationClaudeAccount', () => {
  it('maps a legacy Claude conversation without an account id to the default account', () => {
    expect(resolveConversationClaudeAccount(accounts, conversation({ backend: 'claude' }))?.number).toBe(1);
  });

  it('maps a bound conversation to its own account number', () => {
    const bound = conversation({ backend: 'claude', claude_account_id: 'max' });
    expect(resolveConversationClaudeAccount(accounts, bound)?.number).toBe(2);
  });

  it('shows nothing for non-Claude conversations, unknown accounts, or single-account setups', () => {
    expect(resolveConversationClaudeAccount(accounts, conversation({ backend: 'codex' }))).toBeNull();
    expect(
      resolveConversationClaudeAccount(accounts, conversation({ backend: 'claude', claude_account_id: 'gone' }))
    ).toBeNull();
    expect(resolveConversationClaudeAccount(null, conversation({ backend: 'claude' }))).toBeNull();
  });
});

describe('claudeAccountExtra', () => {
  it('stores nothing for the default account so the create payload stays unchanged', () => {
    expect(claudeAccountExtra('default')).toEqual({});
    expect(claudeAccountExtra(null)).toEqual({});
    expect(claudeAccountExtra(undefined)).toEqual({});
  });

  it('stores a non-default account id', () => {
    expect(claudeAccountExtra('max')).toEqual({ claude_account_id: 'max' });
  });
});

describe('external launch claudeAccountId', () => {
  it('keeps a requested account and drops blank or non-string values', () => {
    const base = { agentId: 'claude-agent', prompt: 'hi' };
    expect(
      parseExternalConversationLaunch(JSON.stringify({ ...base, claudeAccountId: ' max ' }))?.claudeAccountId
    ).toBe('max');
    expect(parseExternalConversationLaunch(JSON.stringify({ ...base, claudeAccountId: ' ' }))?.claudeAccountId).toBe(
      undefined
    );
    expect(parseExternalConversationLaunch(JSON.stringify({ ...base, claudeAccountId: 7 }))?.claudeAccountId).toBe(
      undefined
    );
  });
});
