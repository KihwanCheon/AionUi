/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Popover } from '@arco-design/web-react';
import { Dashboard } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpGet } from '@/common/adapter/httpBridge';
import type { SubscriptionUsageSnapshot, SubscriptionUsageWindow } from '@/common/types/platform/subscriptionUsage';
import { isElectronDesktop } from '@/renderer/utils/platform';
import ClaudeUsagePill from '../ClaudeUsagePill';
import CodexUsageIndicator from '../CodexUsageIndicator';
import styles from '../SubscriptionUsageIndicator.module.css';
import {
  getSubscriptionUsageTone,
  SUBSCRIPTION_USAGE_STALE_AFTER_MS,
  type SubscriptionUsageTone,
} from '../subscriptionUsageTone';

const WEB_USAGE_READY_POLL_MS = 10_000;
const webUsageProvider = httpGet<SubscriptionUsageSnapshot | null>('/api/system/subscription-usage');

const toneClasses: Record<SubscriptionUsageTone, { text: string; bg: string }> = {
  normal: { text: 'text-t-secondary', bg: 'bg-primary-6' },
  warning: { text: 'text-warning-6', bg: 'bg-warning-6' },
  limit: { text: 'text-danger-6', bg: 'bg-danger-6' },
};

const isFresh = (updatedAt: string | null): boolean => {
  if (!updatedAt) return false;
  const timestamp = Date.parse(updatedAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp <= SUBSCRIPTION_USAGE_STALE_AFTER_MS;
};

const formatReset = (resetsAt: string | null, includeDate: boolean): string | undefined => {
  if (!resetsAt) return undefined;
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString(undefined, {
    ...(includeDate ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  });
};

type UsageWindowProps = {
  label: string;
  usage: SubscriptionUsageWindow;
  includeDate: boolean;
  tone: SubscriptionUsageTone;
  resetLabel: (time: string) => string;
};

const UsageWindow: React.FC<UsageWindowProps> = ({ label, usage, includeDate, tone, resetLabel }) => {
  const percent = Math.round(usage.usedPercent);
  const reset = formatReset(usage.resetsAt, includeDate);
  return (
    <div className='flex flex-col gap-4px'>
      <div className='flex items-center justify-between gap-12px'>
        <span className='text-12px font-500 text-t-primary'>{label}</span>
        <span className={`text-12px font-600 ${toneClasses[tone].text}`}>{percent}%</span>
      </div>
      <div
        className='h-6px w-full overflow-hidden rounded-999px bg-fill-2'
        role='progressbar'
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, percent)}
      >
        <div
          className={`h-full rounded-999px ${toneClasses[tone].bg}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      {reset ? <span className='text-11px text-t-tertiary'>{resetLabel(reset)}</span> : null}
    </div>
  );
};

const WebConversationUsageIndicator: React.FC = () => {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<SubscriptionUsageSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const refresh = async (): Promise<void> => {
      let nextDelay = WEB_USAGE_READY_POLL_MS;
      try {
        const snapshot = await webUsageProvider.invoke();
        if (!active) return;
        setUsage(snapshot);
        if (snapshot?.state === 'loading' || snapshot?.state === 'partial') {
          nextDelay = Math.max(1_000, Math.min(WEB_USAGE_READY_POLL_MS, snapshot.retryAfterMs ?? 2_000));
        }
      } catch {
        if (!active) return;
        setUsage(null);
      }
      if (active) {
        timer = window.setTimeout((): void => {
          void refresh();
        }, nextDelay);
      }
    };

    void refresh();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const claudeVisible = Boolean(
    usage?.claude.state === 'ready' && isFresh(usage.claude.updatedAt) && (usage.claude.session || usage.claude.weekly)
  );
  const codexVisible = Boolean(usage?.codex.state === 'ready' && isFresh(usage.codex.updatedAt) && usage.codex.weekly);
  if (!usage || (!claudeVisible && !codexVisible)) return null;

  const claudeTitle = t('common.claudeUsage.title', { defaultValue: 'Claude Usage' });
  const codexTitle = t('common.claudeUsage.codexTitle', { defaultValue: 'Codex Usage' });
  const sessionLabel = t('common.claudeUsage.session', { defaultValue: '5-hour limit' });
  const weeklyLabel = t('common.claudeUsage.weekly', { defaultValue: 'Weekly (all models)' });
  const resetLabel = (time: string): string =>
    t('common.claudeUsage.resets', { time, defaultValue: 'Resets {{time}}' });
  const claudePercentages = [usage.claude.session?.usedPercent, usage.claude.weekly?.usedPercent].filter(
    (percent): percent is number => typeof percent === 'number'
  );
  const codexPercent = usage.codex.weekly?.usedPercent;
  const claudeTone = getSubscriptionUsageTone(...claudePercentages);
  const codexTone = getSubscriptionUsageTone(codexPercent, usage.codex.limitReached ? 100 : undefined);
  const highestPercent = Math.max(
    ...(claudeVisible ? claudePercentages : []),
    ...(codexVisible && typeof codexPercent === 'number' ? [codexPercent] : []),
    codexVisible && usage.codex.limitReached ? 100 : 0
  );
  const summaryTone = getSubscriptionUsageTone(highestPercent);

  const claudeDetails = claudeVisible ? (
    <div className='flex w-200px flex-col gap-12px p-4px'>
      <span className='text-12px font-600 text-t-primary'>{claudeTitle}</span>
      {usage.claude.session ? (
        <UsageWindow
          label={sessionLabel}
          usage={usage.claude.session}
          includeDate={false}
          tone={getSubscriptionUsageTone(usage.claude.session.usedPercent)}
          resetLabel={resetLabel}
        />
      ) : null}
      {usage.claude.weekly ? (
        <UsageWindow
          label={weeklyLabel}
          usage={usage.claude.weekly}
          includeDate
          tone={getSubscriptionUsageTone(usage.claude.weekly.usedPercent)}
          resetLabel={resetLabel}
        />
      ) : null}
    </div>
  ) : null;

  const codexDetails =
    codexVisible && usage.codex.weekly ? (
      <div className='flex w-200px flex-col gap-12px p-4px'>
        <span className='text-12px font-600 text-t-primary'>{codexTitle}</span>
        <UsageWindow
          label={weeklyLabel}
          usage={usage.codex.weekly}
          includeDate
          tone={codexTone}
          resetLabel={resetLabel}
        />
      </div>
    ) : null;

  return (
    <div className={styles.webUsage} aria-label={`${claudeTitle} / ${codexTitle}`}>
      <div className={styles.webPills}>
        {claudeVisible ? (
          <Popover trigger='click' position='br' content={claudeDetails}>
            <Button
              type='text'
              className={`${styles.usage} ${styles.clickable} ${styles[claudeTone]} ${toneClasses[claudeTone].text}`}
              aria-label={claudeTitle}
            >
              <Dashboard theme='outline' size={14} fill='currentColor' />
              <span className='text-12px font-600 leading-none'>
                {claudePercentages.map((percent) => `${Math.round(percent)}%`).join(' · ')}
              </span>
            </Button>
          </Popover>
        ) : null}
        {codexVisible && typeof codexPercent === 'number' ? (
          <Popover trigger='click' position='br' content={codexDetails}>
            <Button
              type='text'
              className={`${styles.usage} ${styles.clickable} ${styles[codexTone]} ${toneClasses[codexTone].text}`}
              aria-label={codexTitle}
            >
              <Dashboard theme='outline' size={14} fill='currentColor' />
              <span className='text-12px font-600 leading-none'>{Math.round(codexPercent)}%</span>
            </Button>
          </Popover>
        ) : null}
      </div>
      <div className={styles.mobileUsage}>
        <Popover
          trigger='click'
          position='br'
          content={
            <div className={styles.mobileDetails}>
              {claudeDetails}
              {codexDetails}
            </div>
          }
        >
          <Button
            type='text'
            className={`${styles.usage} ${styles.clickable} ${styles.mobileTrigger} ${styles[summaryTone]} ${toneClasses[summaryTone].text}`}
            aria-label={`${claudeTitle} / ${codexTitle}`}
          >
            <Dashboard theme='outline' size={14} fill='currentColor' />
            <span className='text-12px font-600 leading-none'>{Math.round(highestPercent)}%</span>
          </Button>
        </Popover>
      </div>
    </div>
  );
};

const ConversationUsageIndicator: React.FC = () => {
  if (!isElectronDesktop()) return <WebConversationUsageIndicator />;
  return (
    <>
      <ClaudeUsagePill />
      <CodexUsageIndicator />
    </>
  );
};

export default ConversationUsageIndicator;
