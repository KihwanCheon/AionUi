import type { IChoiceNotice, IResponseMessage } from '@/common/adapter/ipcBridge';
import type { IMessageText } from '@/common/chat/chatLib';
import { normalizeTextMessageContent } from '@/common/chat/chatLib';
import { ChoiceSignalParser, USER_CHOICE_MARKER } from './protocol';

export type ChoiceNotice = IChoiceNotice;

type SyncHandlers = {
  upsert: (notice: ChoiceNotice) => void;
  dismiss: (notice: ChoiceNotice) => void;
};

export const choiceNoticeKey = (conversationId: string, messageId: string, index: number): string =>
  JSON.stringify([conversationId, messageId, index]);

const isNotice = (value: unknown): value is ChoiceNotice => {
  if (!value || typeof value !== 'object') return false;
  const notice = value as Record<string, unknown>;
  return (
    typeof notice.conversationId === 'string' &&
    typeof notice.messageId === 'string' &&
    typeof notice.markerIndex === 'number' &&
    Number.isInteger(notice.markerIndex) &&
    notice.markerIndex >= 0 &&
    typeof notice.preview === 'string' &&
    typeof notice.createdAt === 'number' &&
    Number.isFinite(notice.createdAt) &&
    notice.key === choiceNoticeKey(notice.conversationId, notice.messageId, notice.markerIndex)
  );
};

const normalizedPreview = (preview: string): string => preview.trim().replace(/\s+/g, ' ');

/** Local mirror of the server-owned choice-notification snapshot. */
export const createChoiceNoticeStore = () => {
  let pending: ChoiceNotice[] = [];
  const suppressed = new Map<string, ChoiceNotice>();
  const staged = new Map<string, ChoiceNotice>();
  const recovered = new Set<string>();
  const seenOnServer = new Set<string>();
  const listeners = new Set<() => void>();
  const parsers = new Map<
    string,
    {
      conversationId: string;
      messageId: string;
      createdAt: number;
      parser: ChoiceSignalParser;
    }
  >();
  let syncHandlers: SyncHandlers | undefined;

  const publish = () => {
    listeners.forEach((listener) => listener());
  };

  const register = (notice: ChoiceNotice): void => {
    if (suppressed.has(notice.key)) return;
    const previous = pending.find((item) => item.key === notice.key);
    if (!previous && seenOnServer.has(notice.key)) {
      // A removed server notice may have been dismissed on another device.
      if (syncHandlers && !recovered.has(notice.key)) {
        recovered.add(notice.key);
        syncHandlers.upsert({ ...notice, preview: normalizedPreview(notice.preview) });
      }
      return;
    }
    let changed = previous?.preview !== notice.preview;
    if (changed) {
      pending = previous
        ? pending.map((item) => (item.key === notice.key ? { ...item, preview: notice.preview } : item))
        : [...pending, notice];
    }
    const preview = normalizedPreview(notice.preview);
    if (preview) {
      const duplicates = pending.filter(
        (item) =>
          item.key !== notice.key &&
          item.conversationId === notice.conversationId &&
          item.messageId !== notice.messageId &&
          normalizedPreview(item.preview) === preview
      );
      if (duplicates.length) {
        const duplicateKeys = new Set(duplicates.map((item) => item.key));
        duplicates.forEach((item) => {
          staged.delete(item.key);
          suppressed.set(item.key, item);
        });
        pending = pending.filter((item) => !duplicateKeys.has(item.key));
        changed = true;
      }
    }
    if (!changed) return;
    if (!previous) {
      console.info('[ChoiceNotifications] Registered', {
        conversationId: notice.conversationId,
        messageId: notice.messageId,
        markerIndex: notice.markerIndex,
      });
    }
    publish();
    if (syncHandlers) {
      const normalizedNotice = { ...notice, preview };
      staged.set(notice.key, normalizedNotice);
      syncHandlers.upsert(normalizedNotice);
    }
  };

  const replaceFromServer = (notices: ChoiceNotice[]) => {
    const remote = new Map(notices.filter(isNotice).map((notice) => [notice.key, notice]));
    for (const key of remote.keys()) seenOnServer.add(key);
    for (const key of staged.keys()) {
      if (remote.has(key)) staged.delete(key);
    }
    pending = [...remote.values(), ...staged.values()].filter((notice) => !suppressed.has(notice.key));
    publish();
  };

  return {
    getSnapshot: () => pending,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setSyncHandlers: (handlers: SyncHandlers | undefined) => {
      syncHandlers = handlers;
    },
    replaceAll: (notices: ChoiceNotice[]) => {
      replaceFromServer(notices);
    },
    settleUpsert: (key: string, notices: ChoiceNotice[]) => {
      const notice = staged.get(key);
      if (notice && !notices.some((item) => item.key === key)) suppressed.set(key, notice);
      staged.delete(key);
      replaceFromServer(notices);
    },
    recoverCompleted: (message: IMessageText, text: string) => {
      if (
        message.position !== 'left' ||
        message.hidden ||
        message.content.teammateMessage ||
        message.content.user_choice
      )
        return;
      if (!text.includes(USER_CHOICE_MARKER)) return;
      const messageId = message.msg_id || message.id;
      const parser = new ChoiceSignalParser();
      parser.feed(text);
      for (const signal of parser.finish()) {
        const key = choiceNoticeKey(message.conversation_id, messageId, signal.index);
        if (!syncHandlers || recovered.has(key) || suppressed.has(key) || pending.some((item) => item.key === key))
          continue;
        recovered.add(key);
        // History discovery must consult durable tombstones before displaying a notice.
        syncHandlers.upsert({
          key,
          conversationId: message.conversation_id,
          messageId,
          markerIndex: signal.index,
          preview: normalizedPreview(signal.preview),
          createdAt: message.created_at ?? 0,
        });
      }
    },
    mergeAll: (notices: ChoiceNotice[]) => {
      for (const notice of notices.filter(isNotice)) seenOnServer.add(notice.key);
      const merged = new Map([...notices.filter(isNotice), ...pending].map((notice) => [notice.key, notice]));
      pending = [...merged.values()].filter((notice) => !suppressed.has(notice.key));
      publish();
    },
    dismiss: (key: string) => {
      const notice = pending.find((item) => item.key === key);
      if (!notice) return;
      staged.delete(key);
      suppressed.set(key, notice);
      pending = pending.filter((item) => item.key !== key);
      console.info('[ChoiceNotifications] Dismissed', {
        conversationId: notice.conversationId,
        messageId: notice.messageId,
        markerIndex: notice.markerIndex,
      });
      publish();
      syncHandlers?.dismiss(notice);
    },
    rollbackDismiss: (key: string) => {
      const notice = suppressed.get(key);
      if (!notice) return;
      suppressed.delete(key);
      if (!pending.some((item) => item.key === key)) pending = [...pending, notice];
      publish();
    },
    consume: (message: IResponseMessage) => {
      if (message.type === 'finish' || message.type === 'error') {
        // Complete every text segment in the turn before releasing scratch state.
        for (const [key, value] of parsers) {
          if (value.conversationId !== message.conversation_id) continue;
          for (const signal of value.parser.finish()) {
            register({
              key: choiceNoticeKey(value.conversationId, value.messageId, signal.index),
              conversationId: value.conversationId,
              messageId: value.messageId,
              markerIndex: signal.index,
              preview: signal.preview,
              createdAt: value.createdAt,
            });
          }
          parsers.delete(key);
        }
        return;
      }
      if (
        !['content', 'text'].includes(message.type) ||
        !message.conversation_id ||
        !message.msg_id ||
        message.hidden ||
        (message.position && message.position !== 'left')
      ) {
        return;
      }
      const content = normalizeTextMessageContent(message.data, { replace: message.replace });
      if (content.teammateMessage) return;
      const parserKey = choiceNoticeKey(message.conversation_id, message.msg_id, 0);
      if (content.replace || !parsers.has(parserKey)) {
        // Bound scratch state even if a connection loses all terminal frames.
        if (parsers.size >= 128) {
          const oldest = parsers.keys().next().value;
          if (oldest) parsers.delete(oldest);
        }
        parsers.set(parserKey, {
          conversationId: message.conversation_id,
          messageId: message.msg_id,
          createdAt: message.created_at ?? Date.now(),
          parser: new ChoiceSignalParser(),
        });
      }
      const parser = parsers.get(parserKey)!.parser;
      const signals = parser.feed(content.content);
      const completed = message.status === 'finish' || message.status === 'error';
      for (const signal of completed ? parser.finish() : signals) {
        register({
          key: choiceNoticeKey(message.conversation_id, message.msg_id, signal.index),
          conversationId: message.conversation_id,
          messageId: message.msg_id,
          markerIndex: signal.index,
          preview: signal.preview,
          createdAt: message.created_at ?? Date.now(),
        });
      }
      if (completed) parsers.delete(parserKey);
    },
  };
};

export type ChoiceNoticeStore = ReturnType<typeof createChoiceNoticeStore>;
