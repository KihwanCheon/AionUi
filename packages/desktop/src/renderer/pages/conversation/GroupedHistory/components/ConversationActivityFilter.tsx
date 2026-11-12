/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Checkbox, Tooltip } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import AionSelect from '@/renderer/components/base/AionSelect';
import { isConversationActivityPeriod, type ConversationActivityPeriod } from '../utils/activityPeriod';

type ConversationActivityFilterProps = {
  enabled: boolean;
  period: ConversationActivityPeriod;
  onEnabledChange: (enabled: boolean) => void;
  onPeriodChange: (period: ConversationActivityPeriod) => void;
  onRefresh: () => void;
};

const ConversationActivityFilter: React.FC<ConversationActivityFilterProps> = ({
  enabled,
  period,
  onEnabledChange,
  onPeriodChange,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const options: Array<{ value: ConversationActivityPeriod; label: string }> = [
    { value: 'today', label: t('conversation.history.today') },
    { value: 'last1Day', label: t('conversation.history.last1Day') },
    { value: 'last2Days', label: t('conversation.history.last2Days') },
    { value: 'last3Days', label: t('conversation.history.last3Days') },
    { value: 'last7Days', label: t('conversation.history.last7Days') },
    { value: 'last30Days', label: t('conversation.history.last30Days') },
  ];

  return (
    <div className='flex items-center gap-6px px-12px pb-6px'>
      <Checkbox className='shrink-0 text-12px' checked={enabled} onChange={onEnabledChange}>
        {t('conversation.history.updatedFilter')}
      </Checkbox>
      <AionSelect
        className='min-w-0 flex-1'
        size='mini'
        value={period}
        disabled={!enabled}
        aria-label={t('conversation.history.updatedPeriod')}
        onChange={(value) => {
          if (isConversationActivityPeriod(value)) onPeriodChange(value);
        }}
      >
        {options.map((option) => (
          <AionSelect.Option key={option.value} value={option.value}>
            {option.label}
          </AionSelect.Option>
        ))}
      </AionSelect>
      <Tooltip content={t('common.refresh')} position='top'>
        <Button
          type='text'
          size='mini'
          className='!h-24px !w-24px !min-w-24px !p-0'
          icon={<Refresh theme='outline' size='14' />}
          aria-label={t('common.refresh')}
          disabled={!enabled}
          onClick={onRefresh}
        />
      </Tooltip>
    </div>
  );
};

export default ConversationActivityFilter;
