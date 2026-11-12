import type { TChatConversation } from '@/common/config/storage';
import AionModal from '@/renderer/components/base/AionModal';
import { Alert, Button, Checkbox, Empty, Spin, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useUnlinkedConversations } from './useUnlinkedConversations';

type Props = {
  groupName: string;
  conversations: TChatConversation[];
  isConversationGenerating: (id: string) => boolean;
  onClose: () => void;
};

const MnpUnlinkedConversationsModal: React.FC<Props> = ({
  groupName,
  conversations,
  isConversationGenerating,
  onClose,
}) => {
  const { t } = useTranslation();
  const state = useUnlinkedConversations(conversations);
  const disabled = state.loading || state.archiving;
  const allSelected = state.unlinked.length > 0 && state.selectedIds.length === state.unlinked.length;

  return (
    <AionModal
      visible
      alignCenter
      variant='standard'
      size='large'
      className='!h-auto'
      header={{ title: t('conversation.mnpUnlinked.title'), subtitle: groupName, showClose: !state.archiving }}
      onCancel={() => {
        if (!state.archiving) onClose();
      }}
      escToExit={!state.archiving}
      maskClosable={!state.archiving}
      getPopupContainer={() => document.body}
      footer={
        <div className='flex flex-wrap items-center justify-end gap-8px'>
          <Button disabled={disabled} onClick={state.refresh}>
            {t('common.refresh')}
          </Button>
          <Button disabled={state.archiving} onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            type='primary'
            disabled={disabled || state.selectedIds.length === 0}
            loading={state.archiving}
            onClick={() => void state.archive(state.selectedIds)}
          >
            {t('conversation.mnpUnlinked.archiveSelected', { count: state.selectedIds.length })}
          </Button>
        </div>
      }
    >
      <div className='flex flex-col gap-16px'>
        <div className='text-13px text-t-secondary'>{t('conversation.mnpUnlinked.description')}</div>
        {state.loading && (
          <div role='status' className='flex items-center gap-8px'>
            <Spin size={16} />
            {t('conversation.mnpUnlinked.checking', { checked: state.checkedCount, total: conversations.length })}
          </div>
        )}
        {state.failedCount > 0 && (
          <Alert
            type='warning'
            content={
              <div className='flex flex-wrap items-center gap-8px'>
                <span>{t('conversation.mnpUnlinked.lookupFailed', { count: state.failedCount })}</span>
                <Button size='mini' disabled={disabled} onClick={state.refresh}>
                  {t('common.retry')}
                </Button>
              </div>
            }
          />
        )}
        {state.unlinked.length > 0 ? (
          <>
            <Checkbox
              disabled={disabled}
              checked={allSelected}
              indeterminate={state.selectedIds.length > 0 && !allSelected}
              onChange={state.selectAll}
            >
              {t('conversation.mnpUnlinked.selectAll', { count: state.unlinked.length })}
            </Checkbox>
            <ul className='list-none m-0 p-0 flex flex-col gap-8px'>
              {state.unlinked.map((conversation) => {
                const name = conversation.name || t('conversation.historySearch.untitled');
                return (
                  <li
                    key={conversation.id}
                    className='flex items-center gap-12px border-b border-solid border-b-base pb-12px'
                  >
                    <Checkbox
                      aria-label={t('conversation.mnpUnlinked.selectConversation', { name })}
                      disabled={disabled}
                      checked={state.selectedIds.includes(conversation.id)}
                      onChange={(checked) => state.select(conversation.id, checked)}
                    />
                    <div className='min-w-0 flex-1'>
                      <div className='text-t-primary break-words'>{name}</div>
                      <div className='text-12px text-t-tertiary'>{conversation.id}</div>
                      {isConversationGenerating(conversation.id) && (
                        <Tag size='small'>{t('conversation.mnpUnlinked.running')}</Tag>
                      )}
                      {state.statuses[conversation.id] === 'archiveFailed' && (
                        <div role='alert' className='text-12px text-danger'>
                          {t('conversation.history.archiveFailed')}
                        </div>
                      )}
                    </div>
                    <Button disabled={disabled} size='small' onClick={() => void state.archive([conversation.id])}>
                      {t('conversation.history.archive')}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          !state.loading && (
            <Empty
              description={t(
                state.failedCount > 0 ? 'conversation.mnpUnlinked.noConfirmed' : 'conversation.mnpUnlinked.empty'
              )}
            />
          )
        )}
      </div>
    </AionModal>
  );
};

export default MnpUnlinkedConversationsModal;
