import { ipcBridge } from '@/common';
import { resolveCurrentUserId } from '@renderer/hooks/system/currentUserId';
import { LayoutContext, type LayoutContextValue } from '../LayoutContext';
import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { createChoiceNoticeStore, type ChoiceNoticeStore } from './store';

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
    const unsubscribe = ipcBridge.conversation?.responseStream?.on(store.consume);
    if (!suppliedStore) {
      void resolveCurrentUserId().then((userId) => {
        if (disposed || !userId) return;
        let persistence: Storage | undefined;
        try {
          persistence = window.localStorage;
        } catch {
          console.warn('[ChoiceNotifications] Local storage is unavailable');
        }
        store.hydrate(persistence, `aionui.user-choice-notifications.v1:${userId}`);
      });
    }
    return () => {
      disposed = true;
      unsubscribe?.();
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
