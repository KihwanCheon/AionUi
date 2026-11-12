import { Button } from '@arco-design/web-react';
import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MobilePushPairing } from '@/common/types/platform/mobilePush';
import { copyText } from '@/renderer/utils/ui/clipboard';

export default function PairingCard({ pairing, onExpire }: { pairing: MobilePushPairing; onExpire: () => void }) {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1000)));
  useEffect(() => {
    const update = () => {
      const remaining = Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1000));
      setSeconds(remaining);
      if (!remaining) onExpire();
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [pairing.expiresAt, onExpire]);
  return (
    <div className='flex flex-wrap items-center gap-16px p-16px bg-1 rd-8px' data-testid='mobile-push-pairing'>
      {/* Fixed QR asset colors preserve scanning contrast in both app themes. */}
      <QRCodeSVG value={pairing.code} size={168} marginSize={4} aria-label={t('settings.mobilePush.connectPhone')} />
      <div className='flex-1 min-w-160px space-y-8px'>
        <p className='text-13px text-t-secondary'>{t('settings.mobilePush.pairHelp')}</p>
        <p className='text-12px text-t-tertiary'>{t('settings.mobilePush.expiresIn', { seconds })}</p>
        <Button size='small' onClick={() => void copyText(pairing.code)}>
          {t('settings.mobilePush.copyCode')}
        </Button>
      </div>
    </div>
  );
}
