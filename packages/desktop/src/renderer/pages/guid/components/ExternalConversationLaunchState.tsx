/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Result, Spin } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ExternalConversationLaunchError } from '../hooks/useExternalConversationLaunchSession';

type ExternalConversationLaunchStateProps = {
  error: ExternalConversationLaunchError | null;
  loading: boolean;
  onClose: () => void;
  onRetry: () => void;
};

const ERROR_KEYS: Record<ExternalConversationLaunchError, string> = {
  'already-used': 'guid.externalLaunch.alreadyUsed',
  'load-failed': 'guid.externalLaunch.loadFailed',
  'not-found-or-expired': 'guid.externalLaunch.notFoundOrExpired',
  'unavailable-options': 'guid.externalLaunch.unavailableOptions',
};

const ExternalConversationLaunchState: React.FC<ExternalConversationLaunchStateProps> = ({
  error,
  loading,
  onClose,
  onRetry,
}) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className='flex h-full min-h-240px flex-col items-center justify-center gap-16px text-t-secondary'>
        <Spin size={28} />
        <span>{t('guid.externalLaunch.loading')}</span>
      </div>
    );
  }

  if (!error) return null;

  return (
    <div className='flex h-full min-h-240px items-center justify-center px-24px'>
      <Result
        status='error'
        title={t('guid.externalLaunch.errorTitle')}
        subTitle={t(ERROR_KEYS[error])}
        extra={[
          ...(error === 'load-failed'
            ? [
                <Button key='retry' type='primary' onClick={onRetry}>
                  {t('common.retry')}
                </Button>,
              ]
            : []),
          <Button key='close' onClick={onClose}>
            {t('common.close')}
          </Button>,
        ]}
      />
    </div>
  );
};

export default ExternalConversationLaunchState;
