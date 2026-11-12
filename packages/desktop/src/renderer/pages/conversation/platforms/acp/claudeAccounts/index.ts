/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Claude multi-account support (personal fork). Every export renders or
 * returns nothing extra while only one Claude account exists.
 */
export { claudeAccountApi } from './claudeAccountApi';
export { default as ClaudeAccountsSection } from './ClaudeAccountsSection';
export { ClaudeAccountBadge, ConversationClaudeAccountBadge } from './ClaudeAccountBadge';
export { GuidClaudeAccountSelector, useGuidClaudeAccountSelection } from './GuidClaudeAccountSelector';
export {
  claudeAccountExtra,
  conversationClaudeAccountId,
  resolveConversationClaudeAccount,
  selectClaudeAccounts,
  useClaudeAccounts,
} from './useClaudeAccounts';
