/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showBrowserNotification } from '@/renderer/hooks/system/notification/browserNotificationDisplay';

/**
 * WebUI-only control to request browser notification permission. In Electron
 * this is never rendered (native notifications are used instead). Renders a
 * grant button, the granted/denied state, or a hint when the page is not a
 * secure context (HTTPS / localhost), where the Notification API is unavailable.
 */
const BrowserNotificationGrant: React.FC = () => {
  const { t } = useTranslation();
  const supported = typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;
  const [permission, setPermission] = useState<NotificationPermission>(supported ? Notification.permission : 'denied');
  const [testing, setTesting] = useState(false);

  const handleRequest = useCallback(() => {
    if (!supported) return;
    void Notification.requestPermission()
      .then((result) => setPermission(result))
      .catch(() => Message.error(t('settings.browserNotification.testFailed')));
  }, [supported, t]);

  if (!supported) {
    return <div className='ps-12px text-12px text-3'>{t('settings.browserNotification.insecureContext')}</div>;
  }
  if (permission === 'granted') {
    return (
      <div className='ps-12px space-y-8px text-12px text-3'>
        <div>{t('settings.browserNotification.granted')}</div>
        <div>{t('settings.browserNotification.connectedOnly')}</div>
        <Button
          size='small'
          loading={testing}
          onClick={() => {
            setTesting(true);
            void showBrowserNotification(
              { body: t('settings.browserNotification.testBody'), kind: 'turnCompleted' },
              () => {}
            )
              .catch(() => Message.error(t('settings.browserNotification.testFailed')))
              .finally(() => setTesting(false));
          }}
        >
          {t('settings.browserNotification.test')}
        </Button>
      </div>
    );
  }
  if (permission === 'denied') {
    return <div className='ps-12px text-12px text-3'>{t('settings.browserNotification.denied')}</div>;
  }
  return (
    <div className='ps-12px'>
      <Button type='outline' size='small' onClick={handleRequest}>
        {t('settings.browserNotification.enable')}
      </Button>
    </div>
  );
};

export default BrowserNotificationGrant;
