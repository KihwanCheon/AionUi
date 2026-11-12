/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { Button, Tooltip } from '@arco-design/web-react';
import { Star } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

type ConversationBookmarkButtonProps = {
  conversation: TChatConversation;
  isPinned: boolean;
  isMobile: boolean;
  onTogglePin: (conversation: TChatConversation) => void;
  /** Keep the star about 2px before status without changing the button's flow slot. */
  statusLayout?: 'gutter' | 'compact';
};

const ConversationBookmarkButton: React.FC<ConversationBookmarkButtonProps> = ({
  conversation,
  isPinned,
  isMobile,
  onTogglePin,
  statusLayout,
}) => {
  const { t } = useTranslation();
  const label = isPinned ? t('conversation.history.removeBookmark') : t('conversation.history.addBookmark');

  return (
    <Tooltip content={label} position='top'>
      <Button
        type='text'
        size='mini'
        aria-label={label}
        data-testid={`conversation-bookmark-${conversation.id}`}
        className={classNames(
          '!h-20px !w-20px !p-0 !inline-flex !items-center !justify-center !leading-none text-t-secondary hover:text-warning-6',
          statusLayout === 'gutter'
            ? '-translate-x-15px rtl:translate-x-15px'
            : statusLayout === 'compact'
              ? '-translate-x-1px rtl:translate-x-1px'
              : undefined,
          {
            'text-warning-6': isPinned,
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100': !isMobile && !isPinned,
          }
        )}
        onClick={(event) => {
          event.stopPropagation();
          onTogglePin(conversation);
        }}
      >
        <Star theme={isPinned ? 'filled' : 'outline'} size='14' fill='currentColor' className='leading-none' />
      </Button>
    </Tooltip>
  );
};

export default ConversationBookmarkButton;
