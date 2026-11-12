import { ipcBridge } from '@/common';
import { LayoutContext, type LayoutContextValue } from '../LayoutContext';
import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { choiceNoticeKey, createChoiceNoticeStore, type ChoiceNotice, type ChoiceNoticeStore } from './store';
import { NotificationHighlightProvider } from './NotificationHighlight';
import type { IMessageText } from '@/common/chat/chatLib';
import MobilePushSync from './MobilePushSync';

const emptyStore = createChoiceNoticeStore();
const ChoiceContext = createContext<ChoiceNoticeStore>(emptyStore);

/** One global subscription, independent of the active conversation or history filter. */
export function UserChoiceNotificationsProvider({
  children,
  store: suppliedStore,
}: {
  children: React.ReactNode;
  store?: ChoiceNoticeStore;
}) {
  const [store] = useState(() => suppliedStore ?? createChoiceNoticeStore());
  useEffect(() => {
    let disposed = false;
    let snapshotVersion = 0;
    let latestSnapshot: ChoiceNotice[] = [];
    let refreshing = false;
    let refreshQueued = false;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const latestUpserts = new Map<string, ChoiceNotice>();
    const recordSnapshot = (items: ChoiceNotice[]) => {
      snapshotVersion += 1;
      latestSnapshot = items;
    };
    const scheduleUpsert = (notice: ChoiceNotice, attempt = 0) => {
      if (attempt && latestUpserts.get(notice.key) !== notice) return;
      latestUpserts.set(notice.key, notice);
      const existing = timers.get(notice.key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(
        () => {
          timers.delete(notice.key);
          const version = snapshotVersion;
          void ipcBridge.conversation.registerChoiceNotice.invoke(notice).then(
            (items) => {
              if (disposed) return;
              const authoritative = version === snapshotVersion;
              if (authoritative) recordSnapshot(items);
              store.settleUpsert(notice.key, authoritative ? items : latestSnapshot, {
                preview: notice.preview,
                authoritative,
              });
              if (latestUpserts.get(notice.key) === notice) latestUpserts.delete(notice.key);
              if (!authoritative) refresh();
            },
            () => {
              if (disposed) return;
              if (attempt < 2) {
                scheduleUpsert(notice, attempt + 1);
              } else {
                console.warn('[ChoiceNotifications] Could not synchronize a notification', {
                  conversationId: notice.conversationId,
                  messageId: notice.messageId,
                  markerIndex: notice.markerIndex,
                });
              }
            }
          );
        },
        attempt ? 1000 * 2 ** attempt : 250
      );
      timers.set(notice.key, timer);
    };
    const scheduleDismiss = (notice: ChoiceNotice, attempt = 0) => {
      latestUpserts.delete(notice.key);
      const pendingUpsert = timers.get(notice.key);
      if (pendingUpsert) {
        clearTimeout(pendingUpsert);
        timers.delete(notice.key);
      }
      const timerKey = `dismiss:${notice.key}`;
      const send = () => {
        timers.delete(timerKey);
        const version = snapshotVersion;
        void ipcBridge.conversation.dismissChoiceNotice.invoke(notice).then(
          (items) => {
            if (disposed) return;
            if (version === snapshotVersion) {
              recordSnapshot(items);
              store.replaceAll(items);
            } else refresh();
          },
          () => {
            if (disposed) return;
            if (attempt < 2) {
              scheduleDismiss(notice, attempt + 1);
            } else {
              store.rollbackDismiss(notice.key);
              console.warn('[ChoiceNotifications] Could not synchronize a dismissal');
            }
          }
        );
      };
      // Start the user action before a mobile page can be suspended or unmounted.
      if (attempt) timers.set(timerKey, setTimeout(send, 1000 * 2 ** attempt));
      else send();
    };
    store.setSyncHandlers({ upsert: scheduleUpsert, dismiss: scheduleDismiss });
    const unsubscribeStream = ipcBridge.conversation?.responseStream?.on(store.consume);
    const unsubscribeChoiceNotices = ipcBridge.conversation?.choiceNoticesChanged?.on((event) => {
      recordSnapshot(event.items);
      store.replaceAll(event.items);
    });
    const refresh = (initial = false) => {
      if (disposed) return;
      if (refreshing) {
        refreshQueued = true;
        return;
      }
      refreshing = true;
      const version = snapshotVersion;
      void ipcBridge.conversation.listChoiceNotices
        .invoke()
        .then(
          (items) => {
            if (disposed || version !== snapshotVersion) return;
            recordSnapshot(items);
            if (initial) store.mergeAll(items);
            else store.replaceAll(items);
          },
          () => console.warn('[ChoiceNotifications] Could not load synchronized notifications')
        )
        .finally(() => {
          refreshing = false;
          if (refreshQueued) {
            refreshQueued = false;
            refresh();
          }
        });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const unsubscribeReconnect = ipcBridge.realtime?.reconnected?.on(() => refresh());
    document.addEventListener('visibilitychange', onVisible);
    if (!suppliedStore) {
      refresh(true);
    }
    return () => {
      disposed = true;
      store.setSyncHandlers(undefined);
      timers.forEach((timer) => clearTimeout(timer));
      unsubscribeStream?.();
      unsubscribeChoiceNotices?.();
      unsubscribeReconnect?.();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store, suppliedStore]);
  return (
    <NotificationHighlightProvider>
      <ChoiceContext.Provider value={store}>
        {children}
        <MobilePushSync />
      </ChoiceContext.Provider>
    </NotificationHighlightProvider>
  );
}

/** Read pending entries without modifying their manually controlled lifecycle. */
export function useUserChoiceNotifications() {
  const store = useContext(ChoiceContext);
  const notices = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { notices, dismiss: store.dismiss };
}

/** Subscribe only to this question's status, not to unrelated notification previews. */
export function useQuestionNotice(conversationId: string, messageId: string, index: number, streamMessageId?: string) {
  const store = useContext(ChoiceContext);
  const keys = [choiceNoticeKey(conversationId, messageId, index)];
  if (streamMessageId) keys.push(choiceNoticeKey(conversationId, streamMessageId, index));
  const status = useSyncExternalStore(
    store.subscribe,
    () => store.getStatus(keys),
    () => 'checking' as const
  );
  const dismiss = () => {
    const notice = store.getSnapshot().find((item) => keys.includes(item.key));
    if (notice) store.dismiss(notice.key);
  };
  return { status, dismiss, recoverNotice: store.recoverNotice };
}

/** Recover completed history without optimistically reviving dismissed notices. */
export function useCompletedChoiceMessage(message: IMessageText, text: string, complete: boolean) {
  const store = useContext(ChoiceContext);
  useEffect(() => {
    let disposed = false;
    // Parent effects install synchronization handlers after child effects run.
    queueMicrotask(() => {
      if (complete && !disposed) store.recoverCompleted(message, text);
    });
    return () => {
      disposed = true;
    };
  }, [store, message, text, complete]);
}

/** Compose at the existing layout boundary without reindenting upstream's layout tree. */
export function ChoiceNotificationLayoutProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: LayoutContextValue;
}) {
  return (
    <UserChoiceNotificationsProvider>
      <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
    </UserChoiceNotificationsProvider>
  );
}

export { default as UserChoiceNotificationButton } from './components/NotificationButton';
export { ConversationChoiceBadge, ProjectChoiceBadge } from './components/ChoiceBadge';
export {
  useConversationHighlight,
  useConversationNotificationHighlight,
  useMessageNotificationHighlight,
  useNotificationHighlight,
  useSourceConversationPreview,
} from './NotificationHighlight';
export { default as notificationHighlightStyles } from './highlight.module.css';
