/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Popover } from '@arco-design/web-react';
import { Terminal } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { subscriptionUsageBridge } from '@/common/platform/subscriptionUsageBridge';
import type { PtyMonitorSnapshot } from '@/common/types/platform/subscriptionUsage';
import styles from '../SubscriptionUsageIndicator.module.css';

const toneClass = (snapshot: PtyMonitorSnapshot | null): string => {
  if (!snapshot || snapshot.state !== 'ready') return styles.normal;
  const ratio = snapshot.limit && snapshot.totalCount !== null ? snapshot.totalCount / snapshot.limit : 0;
  if (ratio >= 0.85) return styles.limit;
  if (ratio >= 0.7 || (snapshot.suspectedUntrackedCount ?? 0) > 0) return styles.warning;
  return styles.normal;
};

const Metric: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
  <div className='flex items-center justify-between gap-16px text-12px'>
    <span className='text-t-secondary'>{label}</span>
    <span className='font-600 text-t-primary'>{value}</span>
  </div>
);

const PtyMonitorIndicator: React.FC = () => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<PtyMonitorSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    void subscriptionUsageBridge.getPtyMonitor
      .invoke()
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch(() => {
        if (active) setSnapshot(null);
      });
    const stop = subscriptionUsageBridge.ptyMonitorChanged.on(setSnapshot);
    return () => {
      active = false;
      stop();
    };
  }, []);

  if (!snapshot || snapshot.state === 'unsupported') return null;

  const title = t('common.ptyMonitor.title', { defaultValue: 'PTY Monitor' });
  const stateMessage = t('common.ptyMonitor.unavailable', { defaultValue: 'Monitoring unavailable' });
  const summary =
    snapshot?.state === 'ready' && snapshot.totalCount !== null
      ? `${snapshot.totalCount}/${snapshot.limit ?? '?'}`
      : '—';

  const content =
    snapshot?.state === 'ready' ? (
      <div className='flex w-300px flex-col gap-12px p-4px'>
        <div className='flex items-center justify-between gap-12px'>
          <span className='text-12px font-600 text-t-primary'>{title}</span>
          <span className='text-11px text-t-tertiary'>PID {snapshot.aionUiPid}</span>
        </div>
        <div className='flex flex-col gap-6px rounded-8px bg-fill-1 p-8px'>
          <Metric
            label={t('common.ptyMonitor.systemTotal', { defaultValue: 'System total' })}
            value={`${snapshot.totalCount ?? 0} / ${snapshot.limit ?? '?'}`}
          />
          <Metric label='AionUi' value={snapshot.aionUiCount ?? 0} />
          <Metric
            label={t('common.ptyMonitor.tracked', { defaultValue: 'Tracked active' })}
            value={snapshot.trackedActiveCount}
          />
          <Metric
            label={t('common.ptyMonitor.untracked', { defaultValue: 'Untracked suspected' })}
            value={snapshot.suspectedUntrackedCount ?? 0}
          />
        </div>
        <div className='flex flex-col gap-4px'>
          <span className='text-11px font-600 text-t-secondary'>
            {t('common.ptyMonitor.owners', { defaultValue: 'PTY owners' })}
          </span>
          {snapshot.owners.length > 0 ? (
            snapshot.owners.map((owner) => (
              <div key={owner.pid} className='flex items-center justify-between gap-12px text-11px'>
                <span className='min-w-0 truncate text-t-primary'>
                  {owner.processName} · PID {owner.pid}
                </span>
                <span className='font-600 text-t-secondary'>{owner.count}</span>
              </div>
            ))
          ) : (
            <span className='text-11px text-t-tertiary'>{t('common.ptyMonitor.none', { defaultValue: 'None' })}</span>
          )}
        </div>
        <div className='flex flex-col gap-4px'>
          <span className='text-11px font-600 text-t-secondary'>
            {t('common.ptyMonitor.activeLaunches', { defaultValue: 'Tracked launches' })}
          </span>
          {snapshot.activeLaunches.length > 0 ? (
            snapshot.activeLaunches.map((launch) => (
              <div key={launch.id} className='text-11px text-t-primary'>
                {launch.conversationName || launch.conversationId || launch.purpose} · PID {launch.childPid}
              </div>
            ))
          ) : (
            <span className='text-11px text-t-tertiary'>{t('common.ptyMonitor.none', { defaultValue: 'None' })}</span>
          )}
        </div>
        <span className='text-10px text-t-tertiary'>
          {t('common.ptyMonitor.readOnly', { defaultValue: 'Read-only monitoring; no processes are terminated.' })}
        </span>
      </div>
    ) : (
      <div className='w-240px p-4px text-12px text-t-secondary'>{stateMessage}</div>
    );

  return (
    <Popover trigger='click' position='br' content={content}>
      <Button type='text' className={`${styles.usage} ${styles.clickable} ${toneClass(snapshot)}`} aria-label={title}>
        <Terminal theme='outline' size={14} fill='currentColor' />
        <span className='text-12px font-600 leading-none'>{summary}</span>
      </Button>
    </Popover>
  );
};

export default PtyMonitorIndicator;
