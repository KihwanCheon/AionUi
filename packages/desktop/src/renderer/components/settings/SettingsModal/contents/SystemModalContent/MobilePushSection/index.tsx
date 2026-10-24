import { Alert, Button, Input, Message, Switch, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mobilePushBridge } from '@/common/platform/mobilePushBridge';
import type { MobilePushPairing, MobilePushResult, MobilePushStatus } from '@/common/types/platform/mobilePush';
import { isElectronDesktop, isWindows } from '@/renderer/utils/platform';
import PreferenceRow from '../PreferenceRow';
import PairingCard from './PairingCard';

export default function MobilePushSection() {
  const { t } = useTranslation();
  const desktop = isElectronDesktop() && isWindows() && mobilePushBridge.available();
  const [status, setStatus] = useState<MobilePushStatus>();
  const [file, setFile] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [pairing, setPairing] = useState<MobilePushPairing>();
  const beforePair = useRef(new Set<string>());

  const load = useCallback(async () => {
    const result = await mobilePushBridge.status.invoke();
    if (result.ok === true) {
      setStatus(result.value);
      setFile((previous) => previous || result.value.credentialPath);
      setName((previous) => previous || result.value.sourceName);
    } else setError(t(`settings.mobilePush.errors.${result.error}`));
  }, [t]);

  useEffect(() => {
    if (!desktop) return;
    void load();
    return mobilePushBridge.changed.on(() => {
      void load();
    });
  }, [desktop, load]);

  useEffect(() => {
    if (!desktop || !status?.configured) return;
    let disposed = false;
    void mobilePushBridge.refresh.invoke().then((result) => {
      if (disposed) return;
      if (result.ok === true) setStatus(result.value);
      else setError(t(`settings.mobilePush.errors.${result.error}`));
    });
    return () => {
      disposed = true;
    };
  }, [desktop, status?.configured, t]);

  useEffect(() => {
    if (!pairing || !desktop) return;
    let disposed = false,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await mobilePushBridge.refresh.invoke();
        if (disposed) return;
        if (result.ok) {
          setStatus(result.value);
          if (result.value.devices.some((device) => !beforePair.current.has(device.id))) setPairing(undefined);
        }
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => {
      void poll();
    }, 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [pairing, desktop]);

  const act = async <T,>(operation: () => Promise<MobilePushResult<T>>, success?: (value: T) => void) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await operation();
      if (result.ok === true) {
        success?.(result.value);
        await load();
      } else setError(t(`settings.mobilePush.errors.${result.error}`));
    } catch {
      setError(t('settings.mobilePush.errors.firebase'));
    } finally {
      setBusy(false);
    }
  };
  const expire = useCallback(() => {
    setPairing(undefined);
    setError(t('settings.mobilePush.expired'));
  }, [t]);
  if (!desktop) return null;
  return (
    <div
      className='px-12px md:px-32px py-16px bg-2 text-t-primary rd-16px space-y-12px'
      data-testid='mobile-push-settings'
    >
      <div className='text-16px font-medium'>{t('settings.mobilePush.title')}</div>
      <p className='text-12px text-t-secondary'>{t('settings.mobilePush.description')}</p>
      {error && <Alert type='error' content={error} />}
      <PreferenceRow label={t('settings.mobilePush.enabled')}>
        <Switch
          aria-label={t('settings.mobilePush.enabled')}
          checked={status?.enabled ?? false}
          disabled={busy || !status?.configured || !status.secureStorageAvailable}
          onChange={(enabled) => {
            if (!enabled) setPairing(undefined);
            void act(() => mobilePushBridge.options.invoke({ enabled }));
          }}
        />
      </PreferenceRow>
      <div className='space-y-8px'>
        <label className='text-13px' htmlFor='mobile-push-credential-path'>
          {t('settings.mobilePush.credentialPath')}
        </label>
        <div className='flex flex-wrap gap-8px'>
          <Input
            id='mobile-push-credential-path'
            value={file}
            onChange={setFile}
            disabled={busy}
            className='!flex-1 min-w-180px'
          />
          <Button
            loading={busy}
            disabled={!file}
            onClick={() => void act(() => mobilePushBridge.configure.invoke({ credentialPath: file }))}
          >
            {t('settings.mobilePush.loadCredentials')}
          </Button>
        </div>
        {status?.projectId && (
          <p className='text-12px text-t-secondary'>
            {t('settings.mobilePush.project', { projectId: status.projectId })}
          </p>
        )}
      </div>
      <div className='space-y-8px'>
        <label className='text-13px' htmlFor='mobile-push-source-name'>
          {t('settings.mobilePush.sourceName')}
        </label>
        <div className='flex gap-8px'>
          <Input id='mobile-push-source-name' value={name} onChange={setName} maxLength={120} disabled={busy} />
          <Button
            disabled={busy || !name.trim() || name.trim() === status?.sourceName}
            onClick={() => void act(() => mobilePushBridge.options.invoke({ sourceName: name.trim() }))}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
      <PreferenceRow label={t('settings.mobilePush.includePreview')} description={t('settings.mobilePush.previewHint')}>
        <Switch
          aria-label={t('settings.mobilePush.includePreview')}
          checked={status?.includePreview ?? false}
          disabled={busy || !status?.configured}
          onChange={(includePreview) => void act(() => mobilePushBridge.options.invoke({ includePreview }))}
        />
      </PreferenceRow>
      <div className='flex items-center justify-between gap-8px'>
        <div className='text-14px font-medium'>{t('settings.mobilePush.devices')}</div>
        <div className='flex gap-8px'>
          <Button
            size='small'
            disabled={busy || !status?.configured}
            onClick={() => void act(() => mobilePushBridge.refresh.invoke(), setStatus)}
          >
            {t('settings.mobilePush.refresh')}
          </Button>
          <Button
            size='small'
            type='primary'
            disabled={busy || !status?.enabled}
            onClick={() =>
              void act(
                () => mobilePushBridge.pair.invoke(),
                (value) => {
                  beforePair.current = new Set(status?.devices.map((device) => device.id));
                  setPairing(value);
                }
              )
            }
          >
            {t('settings.mobilePush.connectPhone')}
          </Button>
        </div>
      </div>
      {pairing && <PairingCard pairing={pairing} onExpire={expire} />}
      {!status?.devices.length && <p className='text-12px text-t-tertiary'>{t('settings.mobilePush.noDevices')}</p>}
      {status?.devices.map((device) => (
        <div
          key={device.id}
          className='flex flex-wrap items-center justify-between gap-8px py-8px border-b border-b-base'
        >
          <div className='min-w-0'>
            <span className='text-13px'>{device.name}</span>
            {!device.enabled && <Tag className='ms-8px'>{t('settings.mobilePush.disabledOnPhone')}</Tag>}
          </div>
          <div className='flex gap-8px'>
            <Button
              size='small'
              disabled={busy || !status.enabled || !device.enabled}
              onClick={() =>
                void act(
                  () =>
                    mobilePushBridge.test.invoke({
                      deviceId: device.id,
                      title: t('settings.mobilePush.testTitle'),
                      body: t('settings.mobilePush.testBody'),
                    }),
                  () => Message.success(t('settings.mobilePush.testRequested'))
                )
              }
            >
              {t('settings.mobilePush.test')}
            </Button>
            <Button
              size='small'
              status='danger'
              disabled={busy}
              onClick={() => void act(() => mobilePushBridge.unlink.invoke({ deviceId: device.id }), setStatus)}
            >
              {t('settings.mobilePush.disconnect')}
            </Button>
          </div>
        </div>
      ))}
      {status?.lastSentAt && (
        <p className='text-12px text-t-tertiary'>
          {t('settings.mobilePush.lastSent', { time: new Date(status.lastSentAt).toLocaleString() })}
        </p>
      )}
      {status?.lastError && !error && (
        <Alert type='warning' content={t(`settings.mobilePush.errors.${status.lastError}`)} />
      )}
    </div>
  );
}
