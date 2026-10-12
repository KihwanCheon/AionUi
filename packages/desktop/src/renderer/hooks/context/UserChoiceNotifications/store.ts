import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { normalizeTextMessageContent } from '@/common/chat/chatLib';
import { ChoiceSignalParser } from './protocol';

export type ChoiceNotice = {
  key: string;
  conversationId: string;
  messageId: string;
  markerIndex: number;
  preview: string;
  createdAt: number;
};

type SavedChoices = { pending: ChoiceNotice[]; dismissed: string[] };
type Persistence = Pick<Storage, 'getItem' | 'setItem'>;

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

/** Dismissal is a durable tombstone, not a transient read/turn-completion flag. */
export const createChoiceNoticeStore = (initialPersistence?: Persistence, initialStorageKey = '') => {
  let persistence = initialPersistence;
  let storageKey = initialStorageKey;
  let pending: ChoiceNotice[] = [];
  const dismissed = new Set<string>();
  const listeners = new Set<() => void>();
  const parsers = new Map<string, { conversationId: string; parser: ChoiceSignalParser }>();
  let persistenceWarningReported = false;
  const restore = () => {
    try {
      const raw: unknown = JSON.parse(persistence?.getItem(storageKey) || 'null');
      if (raw && typeof raw === 'object') {
        const saved = raw as Partial<SavedChoices>;
        if (Array.isArray(saved.dismissed)) {
          for (const key of saved.dismissed) if (typeof key === 'string') dismissed.add(key);
        }
        if (Array.isArray(saved.pending)) {
          const merged = new Map([...saved.pending.filter(isNotice), ...pending].map((notice) => [notice.key, notice]));
          pending = [...merged.values()].filter((notice) => !dismissed.has(notice.key));
        }
      }
    } catch {
      console.warn('[ChoiceNotifications] Could not restore local notification state');
    }
  };
  restore();

  const publish = () => {
    try {
      persistence?.setItem(storageKey, JSON.stringify({ pending, dismissed: [...dismissed] }));
    } catch {
      if (!persistenceWarningReported) {
        persistenceWarningReported = true;
        console.warn('[ChoiceNotifications] Could not persist local notification state');
      }
    }
    listeners.forEach((listener) => listener());
  };

  const register = (notice: ChoiceNotice): void => {
    if (dismissed.has(notice.key)) return;
    const previous = pending.find((item) => item.key === notice.key);
    if (previous?.preview === notice.preview) return;
    pending = previous
      ? pending.map((item) => (item.key === notice.key ? { ...item, preview: notice.preview } : item))
      : [...pending, notice];
    if (!previous) {
      console.info('[ChoiceNotifications] Registered', {
        conversationId: notice.conversationId,
        messageId: notice.messageId,
        markerIndex: notice.markerIndex,
      });
    }
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
    hydrate: (nextPersistence: Persistence | undefined, nextStorageKey: string) => {
      // Keep live parser fragments and early manual dismissals across identity loading.
      persistence = nextPersistence;
      storageKey = nextStorageKey;
      restore();
      publish();
    },
    dismiss: (key: string) => {
      const notice = pending.find((item) => item.key === key);
      if (!notice) return;
      dismissed.add(key);
      pending = pending.filter((item) => item.key !== key);
      console.info('[ChoiceNotifications] Dismissed', {
        conversationId: notice.conversationId,
        messageId: notice.messageId,
        markerIndex: notice.markerIndex,
      });
      publish();
    },
    consume: (message: IResponseMessage) => {
      if (message.type === 'finish' || message.type === 'error') {
        // Drop scratch buffers, never pending notifications or dismissal tombstones.
        for (const [key, value] of parsers) {
          if (value.conversationId === message.conversation_id) parsers.delete(key);
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
        parsers.set(parserKey, { conversationId: message.conversation_id, parser: new ChoiceSignalParser() });
      }
      const parser = parsers.get(parserKey)!.parser;
      for (const signal of parser.feed(content.content)) {
        register({
          key: choiceNoticeKey(message.conversation_id, message.msg_id, signal.index),
          conversationId: message.conversation_id,
          messageId: message.msg_id,
          markerIndex: signal.index,
          preview: signal.preview,
          createdAt: message.created_at ?? Date.now(),
        });
      }
    },
  };
};

export type ChoiceNoticeStore = ReturnType<typeof createChoiceNoticeStore>;
