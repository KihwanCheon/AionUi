import { Badge, Button, Drawer, Popover } from '@arco-design/web-react';
import { Remind } from '@icon-park/react';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useUserChoiceNotifications } from '..';
import type { ChoiceNotice } from '../store';
import NotificationList from './NotificationList';
import styles from './notifications.module.css';

export default function UserChoiceNotificationButton() {
  const { notices, dismiss } = useUserChoiceNotifications();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const layout = useLayoutContext();
  const [open, setOpen] = useState(false);
  const count = new Set(notices.map((notice) => notice.conversationId)).size;
  const label = t('conversation.userChoiceNotifications.label', { count });
  const phone = Boolean(layout?.isMobile && window.innerWidth < 768);
  const onOpen = (notice: ChoiceNotice) => {
    setOpen(false);
    // Existing message-anchor navigation also supports same-route clicks.
    void navigate(`/conversation/${notice.conversationId}`, { state: { targetMessageId: notice.messageId } });
  };
  const trigger = (
    <Button
      type='text'
      shape='circle'
      className={`${styles.trigger} ${count ? styles.pending : ''}`}
      aria-label={label}
      title={label}
      onClick={phone ? () => setOpen((value) => !value) : undefined}
    >
      <Badge count={count} maxCount={99}>
        <Remind theme='outline' size={18} fill='currentColor' className={count ? 'text-warning' : 'text-t-secondary'} />
      </Badge>
    </Button>
  );
  const list = <NotificationList notices={notices} onOpen={onOpen} onDismiss={dismiss} />;
  if (phone) {
    return (
      <>
        {trigger}
        <Drawer
          visible={open}
          placement='bottom'
          height='65vh'
          title={t('conversation.userChoiceNotifications.title')}
          footer={null}
          onCancel={() => setOpen(false)}
        >
          {list}
        </Drawer>
      </>
    );
  }
  return (
    <Popover
      trigger='click'
      position='br'
      style={{ maxWidth: window.innerWidth - 24 }}
      popupVisible={open}
      onVisibleChange={setOpen}
      title={t('conversation.userChoiceNotifications.title')}
      content={<div className={styles.panel}>{list}</div>}
    >
      {trigger}
    </Popover>
  );
}
