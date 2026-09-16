/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Popover } from '@arco-design/web-react';
import { Dashboard } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { subscriptionUsageBridge } from '@/common/platform/subscriptionUsageBridge';
import type { CodexUsageSnapshot } from '@/common/types/platform/codexUsage';
import { isElectronDesktop } from '@/renderer/utils/platform';
import styles from './SubscriptionUsageIndicator.module.css';
import {
  getSubscriptionUsageTone,
  isSubscriptionUsageFresh,
  SUBSCRIPTION_USAGE_STALE_AFTER_MS,
  type SubscriptionUsageTone,
} from './subscriptionUsageTone';

const formatReset = (resetsAt: number | undefined): string | undefined => {
  if (typeof resetsAt !== 'number' || resetsAt <= 0) return undefined;
  const date = new Date(resetsAt * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const toneClasses: Record<SubscriptionUsageTone, { text: string; bg: string }> = {
  normal: { text: 'text-t-secondary', bg: 'bg-primary-6' },
  warning: { text: 'text-warning-6', bg: 'bg-warning-6' },
  limit: { text: 'text-danger-6', bg: 'bg-danger-6' },
};

const toneClass = (tone: SubscriptionUsageTone, kind: 'text' | 'bg'): string => toneClasses[tone][kind];

const CodexUsageIndicator: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const [usage, setUsage] = useState<CodexUsageSnapshot | null>(null);
  const [, refreshFreshness] = React.useReducer((version: number) => version + 1, 0);

  useEffect(() => {
    if (!usage) return;
    const delayMs = usage.updatedAt + SUBSCRIPTION_USAGE_STALE_AFTER_MS - Date.now();
    if (delayMs <= 0) return;
    const timer = window.setTimeout(refreshFreshness, delayMs);
    return () => window.clearTimeout(timer);
  }, [usage]);

  useEffect(() => {
    if (!isElectronDesktop()) return;

    const conversationId = location.pathname.match(/^\/conversation\/([^/]+)/)?.[1];
    const isNewConversation = location.pathname === '/guid';
    if (!conversationId && !isNewConversation) {
      setUsage(null);
      return;
    }

    let cancelled = false;
    let requestInFlight = false;

    const refresh = (): void => {
      if (requestInFlight || document.visibilityState === 'hidden') return;
      requestInFlight = true;
      void subscriptionUsageBridge.getCodex
        .invoke(conversationId ? { conversationId } : {})
        .then((snapshot) => {
          if (!cancelled && snapshot) setUsage(snapshot);
        })
        .catch((): void => {})
        .finally(() => {
          requestInFlight = false;
        });
    };

    const refreshWhenVisible = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };

    const stopUsageUpdates = subscriptionUsageBridge.codexChanged.on((snapshot) => {
      if (!cancelled) setUsage(snapshot);
    });

    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      cancelled = true;
      stopUsageUpdates();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [location.pathname]);

  if (!usage || !isSubscriptionUsageFresh(usage.updatedAt)) return null;

  const tone = getSubscriptionUsageTone(usage.weekly.usedPercent, usage.limitReached ? 100 : undefined);
  const percent = Math.round(usage.weekly.usedPercent);
  const reset = formatReset(usage.weekly.resetsAt);
  const content = (
    <div className='flex w-200px flex-col gap-12px p-4px'>
      <span className='text-12px font-600 text-t-primary'>
        {t('common.claudeUsage.codexTitle', { defaultValue: 'Codex Usage' })}
      </span>
      <div className='flex flex-col gap-4px'>
        <div className='flex items-center justify-between gap-12px'>
          <span className='text-12px font-500 text-t-primary'>
            {t('common.claudeUsage.weekly', { defaultValue: 'Weekly (all models)' })}
          </span>
          <span className={`text-12px font-600 ${toneClass(tone, 'text')}`}>{percent}%</span>
        </div>
        <div
          className='h-6px w-full overflow-hidden rounded-999px bg-fill-2'
          role='progressbar'
          aria-label={t('common.claudeUsage.weekly', { defaultValue: 'Weekly (all models)' })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, percent)}
        >
          <div
            className={`h-full rounded-999px ${toneClass(tone, 'bg')}`}
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
        {reset ? (
          <span className='text-11px text-t-tertiary'>
            {t('common.claudeUsage.resets', { time: reset, defaultValue: 'Resets {{time}}' })}
          </span>
        ) : null}
      </div>
    </div>
  );

  return (
    <Popover trigger='hover' position='br' content={content}>
      <div
        className={`${styles.usage} ${styles[tone]} ${toneClass(tone, 'text')}`}
        aria-label={t('common.claudeUsage.codexTitle', { defaultValue: 'Codex Usage' })}
      >
        <Dashboard theme='outline' size={14} fill='currentColor' />
        <span className='text-12px font-600 leading-none'>{percent}%</span>
      </div>
    </Popover>
  );
};

export default CodexUsageIndicator;
