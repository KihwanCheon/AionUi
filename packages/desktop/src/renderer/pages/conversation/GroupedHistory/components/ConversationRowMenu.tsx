/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyText } from '@/renderer/utils/ui/clipboard';
import { Dropdown, Menu, Message } from '@arco-design/web-react';
import { Copy, CopyOne, DeleteOne, EditOne, Export, FolderClose, Inbox, MoreOne, Star, Timer } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { ConversationRowProps } from '../types';
import styles from './ConversationRowMenu.module.css';

type ConversationRowMenuProps = Pick<
  ConversationRowProps,
  | 'conversation'
  | 'menuVisible'
  | 'onOpenMenu'
  | 'onMenuVisibleChange'
  | 'onEditStart'
  | 'onCreateCronTask'
  | 'onExport'
  | 'onCopy'
  | 'onCopyAll'
  | 'onArchive'
  | 'onPermanentDelete'
  | 'onTogglePin'
  | 'onToggleManualUnread'
  | 'isManualUnread'
> & {
  isMobile: boolean;
  isPinned: boolean;
};

const ConversationRowMenu: React.FC<ConversationRowMenuProps> = ({
  conversation,
  isMobile,
  isPinned,
  menuVisible,
  onOpenMenu,
  onMenuVisibleChange,
  onEditStart,
  onCreateCronTask,
  onExport,
  onCopy,
  onCopyAll,
  onArchive,
  onPermanentDelete,
  onTogglePin,
  onToggleManualUnread,
  isManualUnread,
}) => {
  const { t } = useTranslation();
  const actionConversationRef = React.useRef(conversation);

  React.useLayoutEffect(() => {
    if (!menuVisible) {
      actionConversationRef.current = conversation;
    }
  }, [conversation, menuVisible]);

  const handleCopyConversationId = async (id: string): Promise<void> => {
    try {
      await copyText(id);
      Message.success(t('messages.copySuccess'));
    } catch {
      Message.error(t('messages.copyFailed'));
    }
  };

  const handleMenuItemClick = (key: string): void => {
    const actionConversation = actionConversationRef.current;
    const conversationActions: Partial<Record<string, () => void>> = {
      copy: onCopy ? () => onCopy(actionConversation) : undefined,
      copyAll: onCopyAll ? () => onCopyAll(actionConversation) : undefined,
      copyId: () => void handleCopyConversationId(actionConversation.id),
      pin: () => onTogglePin(actionConversation),
      toggleManualUnread: () => onToggleManualUnread(actionConversation),
      rename: () => onEditStart(actionConversation),
      createCronTask: () => onCreateCronTask(actionConversation),
      export: onExport ? () => onExport(actionConversation) : undefined,
      archive: () => onArchive(actionConversation),
      permanentDelete: onPermanentDelete ? () => onPermanentDelete(actionConversation) : undefined,
    };
    conversationActions[key]?.();
  };

  return (
    <Dropdown
      droplist={
        <Menu className={styles.rowMenu} onClickMenuItem={handleMenuItemClick}>
          {onCopy && (
            <Menu.Item key='copy'>
              <div className='flex items-center gap-8px'>
                <Copy theme='outline' size='14' />
                <span>{t('messages.copy')}</span>
              </div>
            </Menu.Item>
          )}
          {onCopyAll && (
            <Menu.Item key='copyAll'>
              <div className='flex items-center gap-8px'>
                <CopyOne theme='outline' size='14' />
                <span>{t('conversation.history.copyAll')}</span>
              </div>
            </Menu.Item>
          )}
          <Menu.Item key='copyId'>
            <div className='flex items-center gap-8px'>
              <Copy theme='outline' size='14' />
              <span>{t('conversation.history.copyConversationId')}</span>
            </div>
          </Menu.Item>
          <Menu.Item key='pin'>
            <div className='flex items-center gap-8px'>
              <Star theme={isPinned ? 'filled' : 'outline'} size='14' fill='currentColor' />
              <span>{isPinned ? t('conversation.history.removeBookmark') : t('conversation.history.addBookmark')}</span>
            </div>
          </Menu.Item>
          <Menu.Item key='toggleManualUnread'>
            <div className='flex items-center gap-8px'>
              <Inbox theme='outline' size='14' />
              <span>
                {isManualUnread ? t('conversation.history.markAsRead') : t('conversation.history.markAsUnread')}
              </span>
            </div>
          </Menu.Item>
          <Menu.Item key='rename'>
            <div className='flex items-center gap-8px'>
              <EditOne theme='outline' size='14' />
              <span>{t('conversation.history.rename')}</span>
            </div>
          </Menu.Item>
          <Menu.Item key='createCronTask'>
            <div className='flex items-center gap-8px'>
              <Timer theme='outline' size='14' />
              <span>{t('conversation.history.createCronTask')}</span>
            </div>
          </Menu.Item>
          {onExport && (
            <Menu.Item key='export'>
              <div className='flex items-center gap-8px'>
                <Export theme='outline' size='14' />
                <span>{t('conversation.history.export')}</span>
              </div>
            </Menu.Item>
          )}
          <Menu.Item key='archive'>
            <div className='flex items-center gap-8px'>
              <FolderClose theme='outline' size='14' />
              <span>{t('conversation.history.archive')}</span>
            </div>
          </Menu.Item>
          {onPermanentDelete && (
            <Menu.Item key='permanentDelete'>
              <div className='flex items-center gap-8px text-danger-6'>
                <DeleteOne theme='outline' size='14' />
                <span>{t('conversation.history.permanentDelete')}</span>
              </div>
            </Menu.Item>
          )}
        </Menu>
      }
      trigger='click'
      position='br'
      popupVisible={menuVisible}
      onVisibleChange={(visible) => onMenuVisibleChange(actionConversationRef.current.id, visible)}
      getPopupContainer={() => document.body}
      unmountOnExit
    >
      <span
        data-testid={`conversation-row-menu-${conversation.id}`}
        className={classNames(
          'flex-center cursor-pointer transition-colors text-t-secondary hover:text-t-primary size-20px rd-4px sider-action-btn',
          {
            flex: isMobile || menuVisible,
            'hidden group-hover:flex': !isMobile && !menuVisible,
          }
        )}
        onClick={(event) => {
          event.stopPropagation();
          onOpenMenu(conversation);
        }}
      >
        <MoreOne theme='outline' size='14' fill='currentColor' className='block leading-none' />
      </span>
    </Dropdown>
  );
};

export default ConversationRowMenu;
