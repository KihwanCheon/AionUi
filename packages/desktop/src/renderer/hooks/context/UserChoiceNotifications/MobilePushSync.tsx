import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mobilePushBridge } from '@/common/platform/mobilePushBridge';
import { isElectronDesktop, isWindows } from '@/renderer/utils/platform';
import { useAttentionNotifications } from './useAttentionNotifications';

/** Mirror the existing notice list; native code owns opt-in, privacy, retries and deduplication. */
export default function MobilePushSync(): null {
  const { notices } = useAttentionNotifications();
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const desktop = isElectronDesktop() && isWindows() && mobilePushBridge.available();
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const result = await mobilePushBridge.status.invoke();
        if (!disposed) setEnabled(result.ok && result.value.enabled);
      } catch {
        if (!disposed) setEnabled(false);
      }
    };
    void refresh();
    const off = mobilePushBridge.changed.on(() => {
      void refresh();
    });
    const timer = window.setInterval(() => {
      void refresh();
    }, 15000);
    return () => {
      disposed = true;
      off();
      window.clearInterval(timer);
    };
  }, [desktop]);
  const current = useMemo(() => [...notices].toSorted((a, b) => b.createdAt - a.createdAt).slice(0, 500), [notices]);
  useEffect(() => {
    if (!desktop || !enabled) return;
    void mobilePushBridge.sync
      .invoke({
        notices: current,
        labels: {
          choiceTitle: t('settings.mobilePush.choiceTitle'),
          choiceBody: t('settings.mobilePush.choiceBody'),
          failureTitle: t('settings.mobilePush.failureTitle'),
          failureBody: t('settings.mobilePush.failureBody'),
        },
      })
      .catch(() => {});
  }, [desktop, enabled, current, t]);
  return null;
}
