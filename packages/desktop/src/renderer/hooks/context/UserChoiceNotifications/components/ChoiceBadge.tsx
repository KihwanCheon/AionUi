import { Tooltip } from '@arco-design/web-react';
import { Attention } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useUserChoiceNotifications } from '..';

export function ConversationChoiceBadge({ conversationId }: { conversationId: string }) {
  const { notices } = useUserChoiceNotifications();
  const { t } = useTranslation();
  if (!notices.some((notice) => notice.conversationId === conversationId)) return null;
  return (
    <Tooltip content={t('conversation.userChoiceNotifications.title')}>
      <span className='text-warning flex-center shrink-0' data-testid={`conversation-choice-${conversationId}`}>
        <Attention
          theme='filled'
          size={14}
          fill='currentColor'
          aria-label={t('conversation.userChoiceNotifications.title')}
        />
      </span>
    </Tooltip>
  );
}

export function ProjectChoiceBadge({ conversationIds }: { conversationIds: readonly string[] }) {
  const { notices } = useUserChoiceNotifications();
  const { t } = useTranslation();
  if (!notices.some((notice) => conversationIds.includes(notice.conversationId))) return null;
  return (
    <Tooltip content={t('conversation.userChoiceNotifications.title')}>
      <span className='text-warning flex-center shrink-0 me-24px' data-testid='project-choice'>
        <Attention
          theme='filled'
          size={14}
          fill='currentColor'
          aria-label={t('conversation.userChoiceNotifications.title')}
        />
      </span>
    </Tooltip>
  );
}
