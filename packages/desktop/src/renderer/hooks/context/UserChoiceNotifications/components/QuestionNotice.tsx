import { Button } from '@arco-design/web-react';
import { CloseRemind } from '@icon-park/react';
import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuestionNotice } from '..';
import { choiceNoticeKey } from '../store';
import styles from '../proseQuestions.module.css';

type MessageIdentity = { conversationId: string; messageId: string; streamMessageId?: string; createdAt?: number };
const MessageIdentityContext = createContext<MessageIdentity | undefined>(undefined);

/** Carries identity through Markdown's shadow-root portal without reparsing it on state changes. */
export function QuestionNoticeProvider({ children, ...identity }: React.PropsWithChildren<MessageIdentity>) {
  const { conversationId, messageId, streamMessageId, createdAt } = identity;
  const value = useMemo(
    () => ({ conversationId, messageId, streamMessageId, createdAt }),
    [conversationId, messageId, streamMessageId, createdAt]
  );
  return <MessageIdentityContext.Provider value={value}>{children}</MessageIdentityContext.Provider>;
}

/** Show notification state independently from the question's answer state. */
export function QuestionNoticeHeader({
  label,
  markerIndex,
  recoveryPreview,
  identity: suppliedIdentity,
}: {
  label: React.ReactNode;
  markerIndex: number;
  recoveryPreview?: string;
  identity?: MessageIdentity;
}) {
  const inheritedIdentity = useContext(MessageIdentityContext);
  const identity = suppliedIdentity ?? inheritedIdentity;
  const { t } = useTranslation();
  const { status, dismiss, recoverNotice } = useQuestionNotice(
    identity?.conversationId ?? '',
    identity?.messageId ?? '',
    markerIndex,
    identity?.streamMessageId
  );
  useEffect(() => {
    if (!identity || recoveryPreview === undefined || status !== 'checking') return;
    const messageId = identity.streamMessageId || identity.messageId;
    let disposed = false;
    // The provider installs server synchronization after child effects run.
    queueMicrotask(() => {
      if (!disposed)
        recoverNotice({
          key: choiceNoticeKey(identity.conversationId, messageId, markerIndex),
          conversationId: identity.conversationId,
          messageId,
          markerIndex,
          preview: recoveryPreview,
          createdAt: identity.createdAt ?? 0,
        });
    });
    return () => {
      disposed = true;
    };
  }, [identity, markerIndex, recoveryPreview, recoverNotice, status]);

  return (
    <div className={styles.noticeHeader} data-choice-notice-state={identity ? status : undefined}>
      <span className={styles.noticeTitle}>{label}</span>
      {identity && (
        <>
          <span className={styles.noticeStatus}>
            {status === 'dismissed' && <CloseRemind size={14} aria-hidden='true' />}
            {status === 'active'
              ? t('conversation.userChoiceNotifications.statusActive')
              : status === 'dismissed'
                ? t('conversation.userChoiceNotifications.statusDismissed')
                : t('conversation.userChoiceNotifications.statusChecking')}
          </span>
          {status === 'active' && (
            <Button
              type='text'
              size='mini'
              className={styles.dismiss}
              onClick={(event) => {
                event.stopPropagation();
                dismiss();
              }}
            >
              {t('conversation.userChoiceNotifications.dismiss')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/** Only generated question labels become controls; ordinary Markdown stays a paragraph. */
export function QuestionNoticeParagraph({ node: _node, children, ...props }: Record<string, unknown>) {
  const index = props['data-choice-label-index'];
  if (index !== undefined && /^\d+$/.test(String(index))) {
    return <QuestionNoticeHeader markerIndex={Number(index)} label={children as React.ReactNode} />;
  }
  return <p {...(props as React.HTMLAttributes<HTMLParagraphElement>)}>{children as React.ReactNode}</p>;
}
