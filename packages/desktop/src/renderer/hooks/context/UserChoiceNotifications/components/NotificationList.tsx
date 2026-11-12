import { ipcBridge } from '@/common';
import { Button } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSnapshotConversationName } from '@renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';
import { formatDateTime } from '@renderer/services/i18n/format';
import type { AttentionNotice } from '../useAttentionNotifications';
import { useNotificationHighlight } from '../NotificationHighlight';
import styles from './notifications.module.css';

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Time only for today's notices, month/day as well for older ones; `null` when unknown. */
function noticeTime(createdAt: number, language: string): { label: string; full: string } | null {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
  const options: Intl.DateTimeFormatOptions = isSameDay(new Date(createdAt), new Date())
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return { label: formatDateTime(createdAt, language, options), full: formatDateTime(createdAt, language) };
}

export default function NotificationList({
  notices,
  onOpen,
  onDismiss,
  active,
}: {
  notices: readonly AttentionNotice[];
  onOpen: (notice: AttentionNotice) => void;
  onDismiss: (notice: AttentionNotice) => void;
  active: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [names, setNames] = useState<Record<string, string>>({});
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const { highlight, clear } = useNotificationHighlight();
  const highlighted = active ? notices.find((notice) => notice.key === (hoveredKey ?? focusedKey)) : undefined;
  useEffect(() => {
    if (!highlighted) return;
    highlight(highlighted);
    return () => clear(highlighted.key);
  }, [highlighted, highlight, clear]);
  useEffect(() => {
    if (!active) {
      setHoveredKey(null);
      setFocusedKey(null);
    }
  }, [active]);
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
        .map((notice) => {
          const time = noticeTime(notice.createdAt, i18n.language);
          return (
            <div
              className={styles.item}
              key={notice.key}
              data-notification-highlight={highlighted?.key === notice.key || undefined}
              onMouseEnter={() => setHoveredKey(notice.key)}
              onMouseLeave={() => setHoveredKey(null)}
              onFocusCapture={() => setFocusedKey(notice.key)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocusedKey(null);
              }}
            >
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
                        : 'messages.userQuestion.fallback'
                    )}
                </span>
                {time ? (
                  <time className={styles.time} dateTime={new Date(notice.createdAt).toISOString()} title={time.full}>
                    {time.label}
                  </time>
                ) : (
                  // Keeps the last line free for the dismiss button when the time is unknown.
                  <span className={styles.time} aria-hidden='true' />
                )}
              </Button>
              <Button type='text' size='small' className={styles.dismiss} onClick={() => onDismiss(notice)}>
                {t('conversation.userChoiceNotifications.dismiss')}
              </Button>
            </div>
          );
        })}
    </div>
  );
}
