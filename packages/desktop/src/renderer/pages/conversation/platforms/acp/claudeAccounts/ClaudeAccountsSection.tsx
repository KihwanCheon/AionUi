/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Checkbox, Input, Message, Modal, Popconfirm, Switch, Typography } from '@arco-design/web-react';
import { Delete, Down, Up } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { ClaudeAccount, ClaudeAccountAuthStatus } from '@/common/types/platform/claudeAccount';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import styles from './ClaudeAccountBadge.module.css';
import { claudeAccountApi } from './claudeAccountApi';

const CLAUDE_ACCOUNTS_SWR_KEY = 'claude-accounts';

type ActionKind = 'create' | 'delete' | 'update';

type AddForm = { label: string; configDir: string; defaultLabel: string; shareSettings: boolean };
const EMPTY_FORM: AddForm = { label: '', configDir: '', defaultLabel: '', shareSettings: true };

const isDefaultClaudeAgent = (agent: ManagedAgent): boolean =>
  agent.backend === 'claude' && agent.agent_source === 'builtin';

const loginCommand = (account: ClaudeAccount): string =>
  account.config_dir ? `$env:CLAUDE_CONFIG_DIR="${account.config_dir}"; claude auth login` : 'claude auth login';

/**
 * Claude account management on the builtin Claude agent page (personal fork).
 * The only addition visible with a single account is the "add account" entry.
 */
const ClaudeAccountsSection: React.FC<{ agent: ManagedAgent; onChanged: () => Promise<unknown> | void }> = ({
  agent,
  onChanged,
}) => {
  const { t } = useTranslation();
  const { data: accounts = [], mutate } = useSWR<ClaudeAccount[]>(
    isDefaultClaudeAgent(agent) ? CLAUDE_ACCOUNTS_SWR_KEY : null,
    () => claudeAccountApi.list()
  );
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, ClaudeAccountAuthStatus | 'checking'>>({});
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});

  const failureMessage = useCallback(
    (error: unknown, kind: ActionKind): string => {
      const status = error instanceof BackendHttpError ? error.status : undefined;
      if (status === 409) {
        return kind === 'delete' ? t('settings.claudeAccounts.deleteInUse') : t('settings.claudeAccounts.duplicateDir');
      }
      if (status === 400) return t('settings.claudeAccounts.invalidInput');
      return t('settings.claudeAccounts.saveFailed');
    },
    [t]
  );

  const run = useCallback(
    async (action: () => Promise<unknown>, kind: ActionKind = 'update'): Promise<boolean> => {
      setBusy(true);
      try {
        await action();
        await mutate();
        await onChanged();
        return true;
      } catch (error) {
        Message.error(failureMessage(error, kind));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [failureMessage, mutate, onChanged]
  );

  if (!isDefaultClaudeAgent(agent)) return null;

  const single = accounts.length <= 1;

  const submitAdd = async (): Promise<void> => {
    const created = await run(
      () =>
        claudeAccountApi.create({
          label: form.label,
          config_dir: form.configDir,
          default_label: single && form.defaultLabel.trim() ? form.defaultLabel : undefined,
          share_default_settings: form.shareSettings,
        }),
      'create'
    );
    if (created) {
      Message.success(t('settings.claudeAccounts.created'));
      setAdding(false);
      setForm(EMPTY_FORM);
    }
  };

  const move = (index: number, offset: number): void => {
    const ids = accounts.map((account) => account.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + offset, 0, moved);
    void run(() => claudeAccountApi.reorder(ids));
  };

  const checkLogin = async (account: ClaudeAccount): Promise<void> => {
    setStatuses((current) => ({ ...current, [account.id]: 'checking' }));
    try {
      const status = await claudeAccountApi.authStatus(account.id);
      setStatuses((current) => ({ ...current, [account.id]: status }));
    } catch {
      setStatuses((current) => ({ ...current, [account.id]: { logged_in: false } }));
    }
  };

  const renderStatus = (account: ClaudeAccount): React.ReactNode => {
    const status = statuses[account.id];
    if (!status || status === 'checking') {
      return (
        <Button size='mini' loading={status === 'checking'} onClick={() => void checkLogin(account)}>
          {t('settings.claudeAccounts.checkLogin')}
        </Button>
      );
    }
    if (status.logged_in) {
      return (
        <span className='text-12px text-success-6'>
          {status.subscription_type
            ? t('settings.claudeAccounts.loggedIn', { plan: status.subscription_type })
            : t('settings.claudeAccounts.loggedInNoPlan')}
        </span>
      );
    }
    return (
      <div className='flex flex-col gap-2px'>
        <span className='text-12px text-warning-6'>{t('settings.claudeAccounts.loggedOut')}</span>
        <span className='text-11px text-t-tertiary'>{t('settings.claudeAccounts.loginHint')}</span>
        <Typography.Text copyable className='text-11px font-mono'>
          {loginCommand(account)}
        </Typography.Text>
      </div>
    );
  };

  return (
    <div className='mt-18px' data-testid='claude-accounts-section'>
      <div className='mb-8px flex items-center justify-between gap-12px'>
        <Typography.Text className='text-13px font-medium text-t-primary'>
          {t('settings.claudeAccounts.title')}
        </Typography.Text>
        <Button size='small' disabled={busy} onClick={() => setAdding(true)} data-testid='btn-add-claude-account'>
          {t('settings.claudeAccounts.add')}
        </Button>
      </div>
      <Typography.Paragraph className='!mb-10px text-12px text-t-tertiary'>
        {t('settings.claudeAccounts.description')}
      </Typography.Paragraph>

      {!single && (
        <div className='flex flex-col gap-8px'>
          {accounts.map((account, index) => (
            <div
              key={account.id}
              className='flex items-start gap-10px rounded-8px border border-border-2 px-12px py-10px'
              data-testid={`claude-account-row-${account.number}`}
            >
              <span className={`${styles.tagNumber} mt-3px`}>{account.number}</span>
              <div className='min-w-0 flex-1 flex flex-col gap-4px'>
                <Typography.Text
                  className='text-13px text-t-primary'
                  editable={{
                    onChange: (label: string) => setLabelDrafts((current) => ({ ...current, [account.id]: label })),
                    onEnd: (label: string) => {
                      setLabelDrafts((current) => {
                        const { [account.id]: _done, ...rest } = current;
                        return rest;
                      });
                      if (label.trim() && label.trim() !== account.label) {
                        void run(() => claudeAccountApi.update(account.id, { label }));
                      }
                    },
                  }}
                >
                  {labelDrafts[account.id] ?? account.label}
                </Typography.Text>
                <span className='truncate text-12px text-t-tertiary'>
                  {account.config_dir ?? t('settings.claudeAccounts.defaultDir')}
                </span>
                {!account.is_default && (
                  <span className='flex items-center gap-6px text-12px text-t-secondary'>
                    <Switch
                      size='small'
                      checked={account.share_default_settings}
                      disabled={busy}
                      onChange={(checked) =>
                        void run(() => claudeAccountApi.update(account.id, { share_default_settings: checked }))
                      }
                    />
                    {t('settings.claudeAccounts.shareSettings')}
                  </span>
                )}
                {renderStatus(account)}
              </div>
              <div className='flex items-center gap-4px'>
                <Button
                  size='mini'
                  icon={<Up size='12' />}
                  disabled={busy || index === 0}
                  aria-label={t('settings.claudeAccounts.moveUp')}
                  onClick={() => move(index, -1)}
                />
                <Button
                  size='mini'
                  icon={<Down size='12' />}
                  disabled={busy || index === accounts.length - 1}
                  aria-label={t('settings.claudeAccounts.moveDown')}
                  onClick={() => move(index, 1)}
                />
                {!account.is_default && (
                  <Popconfirm
                    title={t('settings.claudeAccounts.deleteConfirm')}
                    onOk={() => void run(() => claudeAccountApi.remove(account.id), 'delete')}
                  >
                    <Button
                      size='mini'
                      status='danger'
                      icon={<Delete size='12' />}
                      disabled={busy}
                      aria-label={t('settings.claudeAccounts.delete')}
                    />
                  </Popconfirm>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        title={t('settings.claudeAccounts.add')}
        visible={adding}
        confirmLoading={busy}
        okButtonProps={{ disabled: !form.label.trim() || !form.configDir.trim() }}
        onOk={() => void submitAdd()}
        onCancel={() => setAdding(false)}
      >
        <div className='flex flex-col gap-12px'>
          {single && (
            <label className='flex flex-col gap-4px text-12px text-t-secondary'>
              {t('settings.claudeAccounts.defaultLabelLabel')}
              <Input
                value={form.defaultLabel}
                placeholder={t('settings.claudeAccounts.defaultLabelPlaceholder')}
                onChange={(defaultLabel) => setForm((current) => ({ ...current, defaultLabel }))}
              />
            </label>
          )}
          <label className='flex flex-col gap-4px text-12px text-t-secondary'>
            {t('settings.claudeAccounts.labelLabel')}
            <Input
              value={form.label}
              placeholder={t('settings.claudeAccounts.labelPlaceholder')}
              onChange={(label) => setForm((current) => ({ ...current, label }))}
            />
          </label>
          <label className='flex flex-col gap-4px text-12px text-t-secondary'>
            {t('settings.claudeAccounts.configDirLabel')}
            <Input
              value={form.configDir}
              placeholder={t('settings.claudeAccounts.configDirPlaceholder')}
              onChange={(configDir) => setForm((current) => ({ ...current, configDir }))}
            />
          </label>
          <Checkbox
            checked={form.shareSettings}
            onChange={(shareSettings) => setForm((current) => ({ ...current, shareSettings }))}
          >
            {t('settings.claudeAccounts.shareSettings')}
          </Checkbox>
        </div>
      </Modal>
    </div>
  );
};

export default ClaudeAccountsSection;
