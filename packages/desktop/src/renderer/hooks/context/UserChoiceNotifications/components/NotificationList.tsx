import { ipcBridge } from '@/common';
import { Button } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSnapshotConversationName } from '@renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';
import type { AttentionNotice } from '../useAttentionNotifications';
import styles from './notifications.module.css';

export default function NotificationList({
  notices,
  onOpen,
  onDismiss,
}: {
  notices: readonly AttentionNotice[];
  onOpen: (notice: AttentionNotice) => void;
  onDismiss: (notice: AttentionNotice) => void;
}) {
  const { t } = useTranslation();
  const [names, setNames] = useState<Record<string, string>>({});
  const idsKey = JSON.stringify([...new Set(notices.map((notice) => notice.conversationId))]);
  useEffect(() => {
    let disposed = false;
    const ids = JSON.parse(idsKey) as string[];
    for (const id of ids) {
      if (getSnapshotConversationName(id)) continue;
      void ipcBridge.conversation.get
        .invoke({ id })
        .then((conversation) => {
          if (!disposed && conversation?.name) setNames((current) => ({ ...current, [id]: conversation.name! }));
        })
        .catch(() => {
          // Deleted conversations still leave their notification dismissible.
        });
    }
    return () => {
      disposed = true;
    };
  }, [idsKey]);
  if (!notices.length) return <p className={styles.empty}>{t('conversation.userChoiceNotifications.empty')}</p>;
  return (
    <div className={styles.list}>
      {notices
        .toSorted((a, b) => b.createdAt - a.createdAt)
        .map((notice) => (
          <div className={styles.item} key={notice.key}>
            <Button type='text' className={styles.open} onClick={() => onOpen(notice)}>
              <span className={notice.kind === 'failure' ? 'text-danger text-12px' : 'text-warning text-12px'}>
                {t(
                  notice.kind === 'failure'
                    ? 'conversation.userChoiceNotifications.unreadFailure'
                    : 'conversation.userChoiceNotifications.choiceRequired'
                )}
              </span>
              <span className={styles.name}>
                {getSnapshotConversationName(notice.conversationId) ||
                  names[notice.conversationId] ||
                  t('conversation.welcome.newConversation')}
              </span>
              <span className={styles.preview}>
                {notice.preview ||
                  t(
                    notice.kind === 'failure'
                      ? 'conversation.history.responseFailed'
                      : 'conversation.userChoiceNotifications.questionPending'
                  )}
              </span>
            </Button>
            <Button type='text' size='small' onClick={() => onDismiss(notice)}>
              {t('conversation.userChoiceNotifications.dismiss')}
            </Button>
          </div>
        ))}
    </div>
  );
}
