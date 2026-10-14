import { ipcBridge } from '@/common';
import { LayoutContext, type LayoutContextValue } from '../LayoutContext';
import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { createChoiceNoticeStore, type ChoiceNotice, type ChoiceNoticeStore } from './store';

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
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const scheduleUpsert = (notice: ChoiceNotice, attempt = 0) => {
      const existing = timers.get(notice.key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(
        () => {
          timers.delete(notice.key);
          void ipcBridge.conversation.registerChoiceNotice.invoke(notice).then(
            (items) => {
              if (!disposed) store.settleUpsert(notice.key, items);
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
      const pendingUpsert = timers.get(notice.key);
      if (pendingUpsert) {
        clearTimeout(pendingUpsert);
        timers.delete(notice.key);
      }
      const timerKey = `dismiss:${notice.key}`;
      const timer = setTimeout(
        () => {
          timers.delete(timerKey);
          void ipcBridge.conversation.dismissChoiceNotice.invoke(notice).then(
            (items) => {
              if (!disposed) store.replaceAll(items);
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
        },
        attempt ? 1000 * 2 ** attempt : 0
      );
      timers.set(timerKey, timer);
    };
    store.setSyncHandlers({ upsert: scheduleUpsert, dismiss: scheduleDismiss });
    const unsubscribeStream = ipcBridge.conversation?.responseStream?.on(store.consume);
    const unsubscribeUserCreated = ipcBridge.conversation?.userCreated?.on((message) => {
      if (!message.hidden && message.source === 'user') store.resolveConversation(message.conversation_id);
    });
    const unsubscribeChoiceNotices = ipcBridge.conversation?.choiceNoticesChanged?.on((event) => {
      store.replaceAll(event.items);
    });
    if (!suppliedStore) {
      void ipcBridge.conversation.listChoiceNotices.invoke().then(
        (items) => {
          if (!disposed) store.mergeAll(items);
        },
        () => console.warn('[ChoiceNotifications] Could not load synchronized notifications')
      );
    }
    return () => {
      disposed = true;
      store.setSyncHandlers(undefined);
      timers.forEach((timer) => clearTimeout(timer));
      unsubscribeStream?.();
      unsubscribeUserCreated?.();
      unsubscribeChoiceNotices?.();
    };
  }, [store, suppliedStore]);
  return <ChoiceContext.Provider value={store}>{children}</ChoiceContext.Provider>;
}

/** Read pending entries without modifying their manually controlled lifecycle. */
export function useUserChoiceNotifications() {
  const store = useContext(ChoiceContext);
  const notices = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { notices, dismiss: store.dismiss };
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
