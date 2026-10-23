/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { useCallback, useMemo, useState } from 'react';
import type { ConversationHistoryView } from '../utils/bookmarkHelpers';
import {
  filterConversationsByActivityPeriod,
  isConversationActivityPeriod,
  type ConversationActivityPeriod,
} from '../utils/activityPeriod';

const ACTIVITY_PERIOD_STORAGE_KEY = 'conversation-activity-period';
const ACTIVITY_FILTER_ENABLED_STORAGE_KEY = 'conversation-activity-filter-enabled';
const DEFAULT_ACTIVITY_PERIOD: ConversationActivityPeriod = 'today';

type ActivityFilterState = {
  enabled: boolean;
  period: ConversationActivityPeriod;
  referenceTime: number;
};

const readStoredEnabled = (view: ConversationHistoryView): boolean => {
  try {
    const stored =
      localStorage.getItem(`${ACTIVITY_FILTER_ENABLED_STORAGE_KEY}:${view}`) ??
      localStorage.getItem(ACTIVITY_FILTER_ENABLED_STORAGE_KEY);
    return stored === 'true';
  } catch {
    return false;
  }
};

const readStoredPeriod = (view: ConversationHistoryView): ConversationActivityPeriod => {
  try {
    const stored =
      localStorage.getItem(`${ACTIVITY_PERIOD_STORAGE_KEY}:${view}`) ??
      localStorage.getItem(ACTIVITY_PERIOD_STORAGE_KEY);
    return isConversationActivityPeriod(stored) ? stored : DEFAULT_ACTIVITY_PERIOD;
  } catch {
    return DEFAULT_ACTIVITY_PERIOD;
  }
};

const readStoredFilter = (view: ConversationHistoryView): ActivityFilterState => ({
  enabled: readStoredEnabled(view),
  period: readStoredPeriod(view),
  referenceTime: Date.now(),
});

export const useConversationActivityFilter = (conversations: TChatConversation[], view: ConversationHistoryView) => {
  // Seed each view from its own settings, falling back to the legacy shared
  // values only when absent. Future changes never overwrite the shared keys.
  const [filters, setFilters] = useState<Record<ConversationHistoryView, ActivityFilterState>>(() => ({
    all: readStoredFilter('all'),
    bookmarks: readStoredFilter('bookmarks'),
  }));
  const { enabled, period, referenceTime } = filters[view];

  const updateFilter = useCallback(
    (changes: Partial<ActivityFilterState>) => {
      setFilters((previous) => ({ ...previous, [view]: { ...previous[view], ...changes } }));
    },
    [view]
  );

  const setEnabled = useCallback(
    (nextEnabled: boolean) => {
      updateFilter({ enabled: nextEnabled, ...(nextEnabled ? { referenceTime: Date.now() } : {}) });
      try {
        localStorage.setItem(`${ACTIVITY_FILTER_ENABLED_STORAGE_KEY}:${view}`, String(nextEnabled));
      } catch {
        // Ignore storage failures; the current selection still remains active.
      }
    },
    [updateFilter, view]
  );

  const setPeriod = useCallback(
    (nextPeriod: ConversationActivityPeriod) => {
      updateFilter({ period: nextPeriod, referenceTime: Date.now() });
      try {
        localStorage.setItem(`${ACTIVITY_PERIOD_STORAGE_KEY}:${view}`, nextPeriod);
      } catch {
        // Ignore storage failures; the current selection still remains active.
      }
    },
    [updateFilter, view]
  );

  const refresh = useCallback(() => updateFilter({ referenceTime: Date.now() }), [updateFilter]);

  const filteredConversations = useMemo(
    () => (enabled ? filterConversationsByActivityPeriod(conversations, period, referenceTime) : conversations),
    [conversations, enabled, period, referenceTime]
  );

  return {
    enabled,
    setEnabled,
    period,
    setPeriod,
    refresh,
    filteredConversations,
  };
};
