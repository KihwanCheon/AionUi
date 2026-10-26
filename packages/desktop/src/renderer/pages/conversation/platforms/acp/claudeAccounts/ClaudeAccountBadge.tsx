/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tooltip } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TChatConversation } from '@/common/config/storage';
import type { ClaudeAccountSummary } from '@/common/types/platform/claudeAccount';
import styles from './ClaudeAccountBadge.module.css';
import { resolveConversationClaudeAccount, useClaudeAccounts } from './useClaudeAccounts';

type BadgeProps = {
  account: ClaudeAccountSummary;
  /** `number`: small circle over an agent icon. `tag`: number plus label. `mark`: inline number only. */
  variant?: 'number' | 'tag' | 'mark';
};

/** Circled account number shared with MindNProgress and the account selectors. */
export const ClaudeAccountBadge: React.FC<BadgeProps> = ({ account, variant = 'number' }) => {
  const { t } = useTranslation();
  const label = t('conversation.claudeAccount.badgeTooltip', { number: account.number, label: account.label });

  if (variant === 'mark') {
    return (
      <span className={styles.tagNumber} aria-label={label} data-testid='claude-account-mark'>
        {account.number}
      </span>
    );
  }

  if (variant === 'tag') {
    return (
      <span className={styles.tag} aria-label={label} data-testid='claude-account-tag'>
        <span className={styles.tagNumber}>{account.number}</span>
        {account.label}
      </span>
    );
  }

  return (
    <Tooltip content={label} position='right' mini>
      <span className={styles.number} aria-label={label} data-testid='claude-account-badge'>
        {account.number}
      </span>
    </Tooltip>
  );
};

/** Badge for a conversation; renders nothing with a single Claude account. */
export const ConversationClaudeAccountBadge: React.FC<{
  conversation: TChatConversation;
  variant?: BadgeProps['variant'];
}> = ({ conversation, variant }) => {
  const accounts = useClaudeAccounts();
  const account = resolveConversationClaudeAccount(accounts, conversation);
  return account ? <ClaudeAccountBadge account={account} variant={variant} /> : null;
};
