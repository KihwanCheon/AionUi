/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import type { TChatConversation } from '@/common/config/storage';
import { DEFAULT_CLAUDE_ACCOUNT_ID, type ClaudeAccountSummary } from '@/common/types/platform/claudeAccount';
import { useManagedAgentRuntimeCatalog } from '@/renderer/hooks/agent/useManagedAgents';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import { resolveConversationBackend } from '../../../utils/conversationAssistantIdentity';

/**
 * Claude accounts in the shared order, or `null` with a single account.
 * AionCore only attaches the list when two or more accounts exist, so every
 * caller can treat `null` as "render exactly what was rendered before".
 */
export const selectClaudeAccounts = (agents: ManagedAgent[] | undefined): ClaudeAccountSummary[] | null => {
  if (!Array.isArray(agents)) return null;
  const row = agents.find(
    (agent) => agent.backend === 'claude' && Array.isArray(agent.claude_accounts) && agent.claude_accounts.length >= 2
  );
  return row?.claude_accounts ?? null;
};

export const useClaudeAccounts = (): ClaudeAccountSummary[] | null => {
  const agents = useManagedAgentRuntimeCatalog();
  return useMemo(() => selectClaudeAccounts(agents), [agents]);
};

/** Account id stored on a conversation; legacy Claude conversations use the default account. */
export const conversationClaudeAccountId = (conversation: Pick<TChatConversation, 'extra'>): string => {
  const extra = conversation.extra as { claude_account_id?: unknown } | undefined;
  const id = typeof extra?.claude_account_id === 'string' ? extra.claude_account_id.trim() : '';
  return id || DEFAULT_CLAUDE_ACCOUNT_ID;
};

/** The account of a Claude conversation, or `null` for single-account setups and non-Claude conversations. */
export const resolveConversationClaudeAccount = (
  accounts: ClaudeAccountSummary[] | null,
  conversation: TChatConversation
): ClaudeAccountSummary | null => {
  if (!accounts || resolveConversationBackend(conversation) !== 'claude') return null;
  const id = conversationClaudeAccountId(conversation);
  return accounts.find((account) => account.id === id) ?? null;
};

/** `extra` entry for a new conversation; the default account stores nothing, exactly as before. */
export const claudeAccountExtra = (accountId: string | null | undefined): { claude_account_id?: string } =>
  accountId && accountId !== DEFAULT_CLAUDE_ACCOUNT_ID ? { claude_account_id: accountId } : {};
