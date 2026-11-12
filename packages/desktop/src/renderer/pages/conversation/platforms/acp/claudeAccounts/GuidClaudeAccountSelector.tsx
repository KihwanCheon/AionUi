/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Menu } from '@arco-design/web-react';
import { Down, User } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeAccountSummary } from '@/common/types/platform/claudeAccount';
import type { MobileActionSheetEntry } from '@/renderer/components/chat/MobileActionSheet/types';
import { iconColors } from '@/renderer/styles/colors';
import styles from './ClaudeAccountBadge.module.css';
import { ClaudeAccountBadge } from './ClaudeAccountBadge';
import { useClaudeAccounts } from './useClaudeAccounts';

type SelectorProps = {
  accounts: ClaudeAccountSummary[];
  value: string;
  onChange: (accountId: string) => void;
};

/** Account picker for the new-conversation screen; only mounted with 2+ accounts. */
export const GuidClaudeAccountSelector: React.FC<SelectorProps> = ({ accounts, value, onChange }) => {
  const { t } = useTranslation();
  if (accounts.length < 2) return null;
  const selected = accounts.find((account) => account.id === value) ?? accounts[0];

  return (
    <Dropdown
      trigger='click'
      droplist={
        <Menu selectedKeys={[selected.id]} onClickMenuItem={(key) => onChange(key)}>
          {accounts.map((account) => (
            <Menu.Item key={account.id} data-testid={`guid-claude-account-option-${account.number}`}>
              <span className='flex items-center gap-6px'>
                <span className={styles.tagNumber}>{account.number}</span>
                {account.label}
              </span>
            </Menu.Item>
          ))}
        </Menu>
      }
    >
      <Button
        className='sendbox-model-btn guid-config-btn'
        shape='round'
        size='small'
        aria-label={t('guid.claudeAccount.label')}
        data-testid='guid-claude-account-selector'
      >
        <span className='flex items-center gap-6px min-w-0'>
          <span className={styles.tagNumber}>{selected.number}</span>
          <span className='guid-model-label'>{selected.label}</span>
          <Down theme='outline' size='12' fill={iconColors.secondary} className='shrink-0' />
        </span>
      </Button>
    </Dropdown>
  );
};

export type GuidClaudeAccountSelection = {
  /** Account for the new conversation; `null` keeps the single-account create payload. */
  accountId: string | null;
  selectorNode: React.ReactNode;
  mobileEntry: MobileActionSheetEntry | null;
};

/**
 * Selection state for the new-conversation screen. With a single account, or
 * for non-Claude assistants, it yields no selector and no account id.
 */
export const useGuidClaudeAccountSelection = ({
  backend,
  requestedAccountId,
}: {
  backend: string | undefined;
  requestedAccountId?: string;
}): GuidClaudeAccountSelection => {
  const { t } = useTranslation();
  const accounts = useClaudeAccounts();
  const [chosenAccountId, setChosenAccountId] = useState<string | null>(null);

  if (!accounts || backend !== 'claude') {
    return { accountId: null, selectorNode: null, mobileEntry: null };
  }
  const selected = accounts.find((account) => account.id === (chosenAccountId ?? requestedAccountId)) ?? accounts[0];
  const accountId = selected.id;
  return {
    accountId,
    selectorNode: <GuidClaudeAccountSelector accounts={accounts} value={accountId} onChange={setChosenAccountId} />,
    mobileEntry: {
      key: 'claude-account',
      icon: <User theme='outline' size='16' />,
      label: t('guid.claudeAccount.label'),
      meta: <ClaudeAccountBadge account={selected} variant='tag' />,
      submenu: {
        title: t('guid.claudeAccount.label'),
        options: accounts.map((account) => ({
          key: account.id,
          label: <ClaudeAccountBadge account={account} variant='tag' />,
          active: account.id === accountId,
        })),
        onSelect: setChosenAccountId,
      },
    },
  };
};
