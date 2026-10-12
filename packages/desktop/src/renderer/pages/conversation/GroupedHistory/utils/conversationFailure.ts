/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getTerminalErrorMessage } from '@/common/chat/chatLib';

export type ConversationFailure = { turnId: string; completedAt: number; message?: string };
const READ_FAILURES_KEY = 'conversation-read-failure-turns';

/** Extract the provider's reason without stringifying internal payloads. */
export const getConversationErrorMessage = getTerminalErrorMessage;

/** Track unread failures independently of successful completions, using persisted turn receipts. */
export const createConversationFailureTracker = (isVisible: (id: string) => boolean, onChange: () => void) => {
  let failures = new Map<string, ConversationFailure>();
  let receipts = new Map<string, string>();
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(READ_FAILURES_KEY) ?? '[]');
    if (Array.isArray(stored)) {
      receipts = new Map(
        stored.filter(
          (entry): entry is [string, string] =>
            Array.isArray(entry) && entry.length === 2 && entry.every((value) => typeof value === 'string')
        )
      );
    }
  } catch {
    // Storage may be unavailable or contain an older malformed value.
  }
  const persistReceipts = () => {
    try {
      localStorage.setItem(READ_FAILURES_KEY, JSON.stringify([...receipts]));
    } catch {
      // The current window can still acknowledge failures without storage.
    }
  };
  const remove = (id: string) => {
    if (!failures.has(id)) return;
    failures = new Map(failures);
    failures.delete(id);
    onChange();
  };
  const read = (id: string) => {
    const failure = failures.get(id);
    if (failure) {
      receipts.set(id, failure.turnId);
      persistReceipts();
      remove(id);
    }
  };
  const mark = (id: string, failure: ConversationFailure) => {
    const current = failures.get(id);
    if (current && current.completedAt > failure.completedAt) return;
    if (receipts.get(id) === failure.turnId) return;
    failures = new Map(failures).set(id, failure);
    if (isVisible(id)) read(id);
    else onChange();
  };
  return {
    getSnapshot: () => failures,
    mark,
    read,
    forget: (id: string) => {
      receipts.delete(id);
      persistReceipts();
      remove(id);
    },
    reconcile: (conversations: TChatConversation[]) => {
      for (const conversation of conversations) {
        const result = (conversation.extra as { last_turn_result?: unknown } | undefined)?.last_turn_result;
        if (!result || typeof result !== 'object') continue;
        const { turn_id, status, completed_at, error } = result as Record<string, unknown>;
        if (typeof turn_id !== 'string' || !turn_id || typeof completed_at !== 'number') continue;
        if (status === 'error') {
          mark(conversation.id, {
            turnId: turn_id,
            completedAt: completed_at,
            message: getConversationErrorMessage(error),
          });
        } else if (status === 'finish' && completed_at >= (failures.get(conversation.id)?.completedAt ?? 0)) {
          remove(conversation.id);
        }
      }
    },
  };
};
