/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getActivityTime } from '@/renderer/utils/chat/timeline';

export const CONVERSATION_ACTIVITY_PERIODS = [
  'today',
  'last1Day',
  'last2Days',
  'last3Days',
  'last7Days',
  'last30Days',
] as const;

export type ConversationActivityPeriod = (typeof CONVERSATION_ACTIVITY_PERIODS)[number];

type RollingConversationActivityPeriod = Exclude<ConversationActivityPeriod, 'today'>;

const DAY_MS = 24 * 60 * 60 * 1000;
const ROLLING_ACTIVITY_PERIOD_DAYS: Record<RollingConversationActivityPeriod, number> = {
  last1Day: 1,
  last2Days: 2,
  last3Days: 3,
  last7Days: 7,
  last30Days: 30,
};

export const isConversationActivityPeriod = (value: unknown): value is ConversationActivityPeriod =>
  typeof value === 'string' && CONVERSATION_ACTIVITY_PERIODS.includes(value as ConversationActivityPeriod);

export const getActivityPeriodStart = (period: ConversationActivityPeriod, now: number): number => {
  if (period !== 'today') return now - ROLLING_ACTIVITY_PERIOD_DAYS[period] * DAY_MS;

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
};

export const filterConversationsByActivityPeriod = (
  conversations: TChatConversation[],
  period: ConversationActivityPeriod,
  referenceTime: number
): TChatConversation[] => {
  const start = getActivityPeriodStart(period, referenceTime);
  return conversations.filter((conversation) => {
    const activityTime = getActivityTime(conversation);
    // Keep updates after the fixed reference time visible. Only an explicit
    // refresh advances the lower bound and removes conversations from the list.
    return activityTime >= start;
  });
};
