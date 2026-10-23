import React, { createContext, useContext, useState, useSyncExternalStore } from 'react';

type NotificationTarget = {
  key: string;
  conversationId: string;
  messageId?: string;
  markerIndex?: number;
};

const createHighlightStore = () => {
  let target: NotificationTarget | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => target,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    highlight: (next: NotificationTarget) => {
      if (target?.key === next.key) return;
      target = next;
      listeners.forEach((listener) => listener());
    },
    clear: (key: string) => {
      if (target?.key !== key) return;
      target = null;
      listeners.forEach((listener) => listener());
    },
  };
};

const HighlightContext = createContext(createHighlightStore());

/** Keep transient notification previews separate from persisted notice state. */
export function NotificationHighlightProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(createHighlightStore);
  return <HighlightContext.Provider value={store}>{children}</HighlightContext.Provider>;
}

/** Previewing an item never navigates, scrolls, acknowledges, or dismisses it. */
export const useNotificationHighlight = () => useContext(HighlightContext);

/** Subscribe to this row only, so unrelated conversations do not rerender on hover. */
export function useConversationNotificationHighlight(conversationId: string): boolean {
  const store = useContext(HighlightContext);
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot()?.conversationId === conversationId,
    () => false
  );
}

/** Resolve the exact question by conversation, message identity, and marker index. */
export function useMessageNotificationHighlight(
  conversationId: string,
  messageId: string,
  streamMessageId?: string
): number | undefined {
  const store = useContext(HighlightContext);
  return useSyncExternalStore(
    store.subscribe,
    () => {
      const target = store.getSnapshot();
      return target?.conversationId === conversationId &&
        (target.messageId === messageId || (streamMessageId && target.messageId === streamMessageId))
        ? target.markerIndex
        : undefined;
    },
    (): undefined => undefined
  );
}
