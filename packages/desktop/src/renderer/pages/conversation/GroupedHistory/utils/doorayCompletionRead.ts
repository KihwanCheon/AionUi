/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

type ConversationMetadata = { id: string; extra?: unknown };

/** Match MnP-created proposal chats, never a title, workspace, or approval purpose. */
export const isDoorayProposalConversation = (conversation: ConversationMetadata): boolean => {
  const extra = conversation.extra;
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return false;
  const { mnpDoorayResponseId: responseId, mnpDoorayOperationId: operationId } = extra as Record<string, unknown>;
  return (
    typeof responseId === 'string' &&
    responseId.trim().length > 0 &&
    typeof operationId === 'string' &&
    operationId.startsWith(`${responseId}-`) &&
    operationId.length > responseId.length + 1
  );
};

/**
 * Fork-local completion policy. Metadata can arrive after a terminal event;
 * defer that event briefly, fail open on lookup failure, and never alter manual
 * unread, running, or confirmation state. No prompt content is read or logged.
 */
export const createDoorayCompletionReadPolicy = ({
  loadConversation,
  markUnread,
  clearUnread,
}: {
  loadConversation: (id: string) => Promise<ConversationMetadata | null | undefined>;
  markUnread: (id: string) => void;
  clearUnread: (id: string) => void;
}) => {
  const autoReadById = new Map<string, boolean>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const cancelPending = (id: string) => {
    const timer = pending.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    pending.delete(id);
  };

  const reconcile = (conversations: ConversationMetadata[]) => {
    for (const conversation of conversations) {
      const autoRead = isDoorayProposalConversation(conversation);
      autoReadById.set(conversation.id, autoRead);
      const wasPending = pending.has(conversation.id);
      cancelPending(conversation.id);
      if (autoRead) clearUnread(conversation.id);
      else if (wasPending) markUnread(conversation.id);
    }
  };

  const markCompletion = (id: string) => {
    const autoRead = autoReadById.get(id);
    if (autoRead === true) {
      clearUnread(id);
      return;
    }
    if (autoRead === false) {
      markUnread(id);
      return;
    }
    if (pending.has(id)) return;

    // Do not lose ordinary completions if metadata is unavailable or hangs.
    const failOpen = () => {
      if (pending.get(id) !== timer) return;
      cancelPending(id);
      markUnread(id);
    };
    const timer = setTimeout(failOpen, 5000);
    pending.set(id, timer);
    void Promise.resolve()
      .then(() => loadConversation(id))
      .then((conversation) => {
        if (pending.get(id) !== timer) return;
        if (conversation?.id !== id) {
          failOpen();
          return;
        }
        reconcile([conversation]);
      })
      .catch(failOpen);
  };

  return {
    reconcile,
    markCompletion,
    clearCompletion: (id: string) => {
      cancelPending(id);
      clearUnread(id);
    },
    forget: (id: string) => {
      cancelPending(id);
      autoReadById.delete(id);
    },
  };
};
