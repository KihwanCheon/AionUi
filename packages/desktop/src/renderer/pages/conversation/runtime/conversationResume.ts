/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { MessageCursorPage } from '@/common/adapter/ipcBridge';
import type { TMessage } from '@/common/chat/chatLib';
import {
  DEFAULT_MESSAGE_PAGE_LIMIT,
  loadConversationMessagePage,
  loadLatestConversationMessages,
} from '@/renderer/utils/chat/messagePagination';

/** Recover the saved tail, including any gap larger than one history page. */
export async function loadResumedConversationMessages(
  conversationId: string,
  previousTail: TMessage | null | undefined,
  isCurrent: () => boolean
): Promise<MessageCursorPage<TMessage>> {
  const latest = await loadLatestConversationMessages(conversationId, {
    limit: DEFAULT_MESSAGE_PAGE_LIMIT,
    contentMode: 'compact',
  });
  const pages = [latest.items];
  let oldest = latest;
  const visited = new Set<string>();
  const reachesPreviousTail = (messages: TMessage[]) =>
    previousTail === undefined ||
    (!!previousTail &&
      messages.some(
        (message) =>
          message.id === previousTail.id ||
          (message.type === previousTail.type && !!message.msg_id && message.msg_id === previousTail.msg_id) ||
          // A deleted tail must not force a scan through the entire conversation.
          (message.created_at !== undefined &&
            previousTail.created_at !== undefined &&
            message.created_at < previousTail.created_at)
      ));

  while (isCurrent() && !reachesPreviousTail(oldest.items) && oldest.has_more_before && oldest.oldest_cursor) {
    const before = oldest.oldest_cursor;
    if (visited.has(before)) throw new Error('Conversation history cursor did not advance');
    visited.add(before);
    oldest = await loadConversationMessagePage(conversationId, { limit: DEFAULT_MESSAGE_PAGE_LIMIT, before });
    pages.unshift(oldest.items);
  }

  return {
    ...latest,
    items: pages.flat(),
    oldest_cursor: oldest.oldest_cursor,
    has_more_before: oldest.has_more_before,
  };
}

/** Coalesce browser resume signals; keep at most one recovery request in flight. */
export function subscribeConversationResume(refresh: () => Promise<unknown>): () => void {
  let disposed = false;
  let running = false;
  let queued = false;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wasHidden = document.visibilityState === 'hidden';

  const schedule = (delay = 150) => {
    if (disposed || document.visibilityState === 'hidden') return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), delay);
  };
  const run = async () => {
    timer = undefined;
    if (disposed || document.visibilityState === 'hidden') return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    let failed = false;
    try {
      await refresh();
      retries = 0;
    } catch (error) {
      failed = true;
      console.warn('[conversation-resume] Failed to refresh conversation:', error);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        schedule();
      } else if (failed && retries < 2) {
        schedule([1000, 5000][retries++]);
      }
    }
  };
  const resume = () => {
    retries = 0;
    schedule();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) resume();
  };
  const resumeFromBackground = () => {
    if (!wasHidden || document.visibilityState === 'hidden') return;
    wasHidden = false;
    resume();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      wasHidden = true;
    } else {
      resumeFromBackground();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  // Desktop window focus alone is not a suspension. Keep focus only as a
  // fallback for browsers that deliver it before the visible-state event.
  window.addEventListener('focus', resumeFromBackground);
  window.addEventListener('online', resume);
  window.addEventListener('pageshow', onPageShow);
  const unsubscribe = ipcBridge.realtime?.reconnected?.on(resume);
  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', resumeFromBackground);
    window.removeEventListener('online', resume);
    window.removeEventListener('pageshow', onPageShow);
    unsubscribe?.();
  };
}
