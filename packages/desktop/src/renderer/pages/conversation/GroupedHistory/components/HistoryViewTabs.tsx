/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { ListView, Star } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { ConversationHistoryView } from '../utils/bookmarkHelpers';

type HistoryViewTabsProps = {
  activeView: ConversationHistoryView;
  bookmarkCount: number;
  onChange: (view: ConversationHistoryView) => void;
};

const HistoryViewTabs: React.FC<HistoryViewTabsProps> = ({ activeView, bookmarkCount, onChange }) => {
  const { t } = useTranslation();

  const renderTab = (view: ConversationHistoryView, icon: React.ReactNode, label: string) => (
    <Button
      type={activeView === view ? 'secondary' : 'text'}
      size='small'
      role='tab'
      aria-selected={activeView === view}
      data-testid={`conversation-history-tab-${view}`}
      className='!flex-1 !rd-8px'
      onClick={() => onChange(view)}
    >
      <span className='flex-center gap-5px'>
        {icon}
        <span>{label}</span>
      </span>
    </Button>
  );

  return (
    <div className='px-8px py-6px' role='tablist' aria-label={t('conversation.history.viewTabsLabel')}>
      <div className='flex w-full gap-2px'>
        {renderTab('all', <ListView theme='outline' size='14' />, t('conversation.history.allTab'))}
        {renderTab(
          'bookmarks',
          <Star theme={activeView === 'bookmarks' ? 'filled' : 'outline'} size='14' fill='currentColor' />,
          t('conversation.history.bookmarksTabCount', { count: bookmarkCount })
        )}
      </div>
    </div>
  );
};

export default HistoryViewTabs;
