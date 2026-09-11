/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IMindNProgressRunnerStatus } from '@/common/adapter/ipcBridge';
import {
  consumeMindNProgressRunnerPairing,
  subscribeMindNProgressRunnerPairing,
  type MindNProgressRunnerPairingDetail,
} from '@/renderer/hooks/system/useDeepLink';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Alert, Button, Input, Message, Modal, Spin, Tag, Typography } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import SettingsPageHeader from '../components/SettingsPageHeader';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import { parseRunnerPairingLink } from './runnerPairingLink';

const EMPTY_STATUS: IMindNProgressRunnerStatus = {
  configured: false,
  secureStorageAvailable: true,
  state: 'not-configured',
  apiUrl: null,
  machineId: null,
  label: null,
  lastConnectedAt: null,
  lastError: null,
};

const MANUAL_PAIR_ERROR_KEYS = {
  'invalid-scheme': 'settings.mindnprogressRunner.manualPairError.scheme',
  incomplete: 'settings.mindnprogressRunner.manualPairError.incomplete',
} as const;

const MindNProgressRunnerSettingsContent: React.FC = () => {
  const { t } = useTranslation();
  const [modal, modalContextHolder] = Modal.useModal();
  const [status, setStatus] = useState<IMindNProgressRunnerStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [manualLink, setManualLink] = useState('');

  const loadStatus = useCallback(async () => {
    const result = await ipcBridge.application.getMindNProgressRunnerStatus.invoke();
    if (result.success && result.data) setStatus(result.data);
  }, []);

  useEffect(() => {
    const unsubscribe = ipcBridge.application.mindNProgressRunnerStatusChanged.on(setStatus);
    void loadStatus()
      .catch(() => Message.error(t('settings.mindnprogressRunner.statusLoadFailed')))
      .finally(() => setLoading(false));
    return unsubscribe;
  }, [loadStatus, t]);

  const confirmPairing = useCallback(
    (pairing: MindNProgressRunnerPairingDetail): void => {
      let server = pairing.apiUrl;
      try {
        server = new URL(pairing.apiUrl).origin;
      } catch {
        // The main process performs authoritative validation after confirmation.
      }
      modal.confirm({
        title: t('settings.mindnprogressRunner.pairConfirmTitle'),
        content: t('settings.mindnprogressRunner.pairConfirmContent', { server, machineId: pairing.machineId }),
        onOk: async () => {
          setWorking(true);
          try {
            const result = await ipcBridge.application.pairMindNProgressRunner.invoke({
              apiUrl: pairing.apiUrl,
              pairingCode: pairing.pairingCode,
              expectedMachineId: pairing.machineId,
            });
            if (!result.success || !result.data)
              throw new Error(result.msg || t('settings.mindnprogressRunner.pairFailed'));
            setStatus(result.data);
            Message.success(t('settings.mindnprogressRunner.pairSuccess'));
          } catch (error) {
            Message.error(error instanceof Error ? error.message : t('settings.mindnprogressRunner.pairFailed'));
          } finally {
            setWorking(false);
          }
        },
      });
    },
    [modal, t]
  );

  /**
   * Pairing normally arrives as an aionui:// deep link. On builds whose bundle
   * does not own that scheme (a dev run, or another install claiming it) the
   * link never reaches this app, so the same link is accepted as pasted text.
   */
  const submitManualLink = useCallback(() => {
    const result = parseRunnerPairingLink(manualLink);
    if (result.status !== 'ok') {
      Message.error(t(MANUAL_PAIR_ERROR_KEYS[result.status]));
      return;
    }
    setManualLink('');
    confirmPairing(result.detail);
  }, [confirmPairing, manualLink, t]);

  useEffect(() => {
    const unsubscribe = subscribeMindNProgressRunnerPairing(confirmPairing);
    const pendingPairing = consumeMindNProgressRunnerPairing();
    if (pendingPairing) confirmPairing(pendingPairing);
    return unsubscribe;
  }, [confirmPairing]);

  const restart = useCallback(async () => {
    setWorking(true);
    try {
      const result = await ipcBridge.application.restartMindNProgressRunner.invoke();
      if (!result.success || !result.data)
        throw new Error(result.msg || t('settings.mindnprogressRunner.restartFailed'));
      setStatus(result.data);
    } catch (error) {
      Message.error(error instanceof Error ? error.message : t('settings.mindnprogressRunner.restartFailed'));
    } finally {
      setWorking(false);
    }
  }, [t]);

  const confirmDisconnect = useCallback(() => {
    modal.confirm({
      title: t('settings.mindnprogressRunner.disconnectConfirmTitle'),
      content: t('settings.mindnprogressRunner.disconnectConfirmContent'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        setWorking(true);
        try {
          const result = await ipcBridge.application.disconnectMindNProgressRunner.invoke();
          if (!result.success || !result.data) {
            throw new Error(result.msg || t('settings.mindnprogressRunner.disconnectFailed'));
          }
          setStatus(result.data);
          Message.success(t('settings.mindnprogressRunner.disconnectSuccess'));
        } catch (error) {
          Message.error(error instanceof Error ? error.message : t('settings.mindnprogressRunner.disconnectFailed'));
        } finally {
          setWorking(false);
        }
      },
    });
  }, [modal, t]);

  const stateLabel = t(`settings.mindnprogressRunner.states.${status.state}`);
  const stateColor = status.state === 'connected' ? 'green' : status.state === 'error' ? 'red' : 'arcoblue';

  return (
    <SettingsPageWrapper>
      {modalContextHolder}
      <SettingsPageHeader
        title={t('settings.mindnprogressRunner.title')}
        description={t('settings.mindnprogressRunner.description')}
      />

      <div className='mt-20px space-y-16px'>
        {!status.secureStorageAvailable ? (
          <Alert type='error' content={t('settings.mindnprogressRunner.secureStorageUnavailable')} />
        ) : null}

        {!status.configured ? <Alert type='info' content={t('settings.mindnprogressRunner.connectGuide')} /> : null}

        {status.lastError ? <Alert type='error' content={status.lastError} /> : null}

        <div className='rounded-16px bg-2 px-20px py-18px'>
          {loading || working ? (
            <div className='flex min-h-120px items-center justify-center'>
              <Spin />
            </div>
          ) : (
            <div className='space-y-16px'>
              <div className='flex items-center justify-between gap-12px'>
                <Typography.Title heading={6} className='!m-0'>
                  {t('settings.mindnprogressRunner.connectionStatus')}
                </Typography.Title>
                <Tag color={stateColor}>{stateLabel}</Tag>
              </div>

              {status.configured ? (
                <div className='grid grid-cols-[140px_1fr] gap-x-16px gap-y-10px text-13px'>
                  <span className='text-t-tertiary'>{t('settings.mindnprogressRunner.machine')}</span>
                  <span className='text-t-primary'>
                    {status.label} ({status.machineId})
                  </span>
                  <span className='text-t-tertiary'>{t('settings.mindnprogressRunner.server')}</span>
                  <span className='break-all text-t-primary'>{status.apiUrl}</span>
                  <span className='text-t-tertiary'>{t('settings.mindnprogressRunner.lastConnected')}</span>
                  <span className='text-t-primary'>
                    {status.lastConnectedAt
                      ? new Date(status.lastConnectedAt).toLocaleString()
                      : t('settings.mindnprogressRunner.neverConnected')}
                  </span>
                </div>
              ) : (
                <div className='space-y-12px'>
                  <Typography.Text type='secondary'>{t('settings.mindnprogressRunner.notConfigured')}</Typography.Text>
                  <div className='space-y-8px'>
                    <Typography.Text className='text-13px text-t-primary'>
                      {t('settings.mindnprogressRunner.manualPairLabel')}
                    </Typography.Text>
                    <Typography.Text type='secondary' className='block text-12px'>
                      {t('settings.mindnprogressRunner.manualPairHint')}
                    </Typography.Text>
                    <Input.TextArea
                      value={manualLink}
                      onChange={setManualLink}
                      placeholder={t('settings.mindnprogressRunner.manualPairPlaceholder')}
                      autoSize={{ minRows: 2, maxRows: 4 }}
                      disabled={!status.secureStorageAvailable}
                    />
                    <div className='flex justify-end'>
                      <Button
                        type='primary'
                        disabled={!manualLink.trim() || !status.secureStorageAvailable}
                        onClick={submitManualLink}
                      >
                        {t('settings.mindnprogressRunner.manualPairSubmit')}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {status.configured ? (
                <div className='flex flex-wrap justify-end gap-8px'>
                  <Button onClick={() => void restart()}>{t('settings.mindnprogressRunner.retry')}</Button>
                  <Button status='danger' onClick={confirmDisconnect}>
                    {t('settings.mindnprogressRunner.disconnect')}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <Alert type='warning' content={t('settings.mindnprogressRunner.lifecycleNote')} />
      </div>
    </SettingsPageWrapper>
  );
};

const MindNProgressRunnerSettings: React.FC = () => {
  return isElectronDesktop() ? <MindNProgressRunnerSettingsContent /> : <Navigate to='/settings/webui' replace />;
};

export default MindNProgressRunnerSettings;
