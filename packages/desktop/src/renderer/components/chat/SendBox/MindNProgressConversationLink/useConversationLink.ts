import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  mindNProgressConversationApi,
  type MindNProgressConversationApi,
  type MindNProgressConversationSelectionResponse,
} from './api';
import { getLinkStore } from './store';

/** Active conversations recheck on selection; visible list entries share the cached result. */
export function useMindNProgressConversationLink(
  conversationId: string,
  api: MindNProgressConversationApi = mindNProgressConversationApi,
  { enabled = true, active = true }: { enabled?: boolean; active?: boolean } = {}
) {
  const store = getLinkStore(api);
  const subscribe = useCallback(
    (listener: () => void) => (enabled ? store.subscribe(conversationId, listener) : () => {}),
    [store, conversationId, enabled]
  );
  const state = useSyncExternalStore(
    subscribe,
    () => store.snapshot(conversationId),
    () => store.snapshot('')
  );
  const [selecting, setSelecting] = useState(false);
  const currentConversationIdRef = useRef(conversationId);
  const selectionRef = useRef<{
    conversationId: string;
    promise: Promise<MindNProgressConversationSelectionResponse>;
  } | null>(null);
  currentConversationIdRef.current = conversationId;
  useEffect(() => {
    setSelecting(false);
    if (enabled) store.request(conversationId, active);
  }, [store, conversationId, enabled, active]);
  const select = useCallback(async (): Promise<MindNProgressConversationSelectionResponse | undefined> => {
    if (selectionRef.current?.conversationId === conversationId) return undefined;
    const promise = api.select(conversationId);
    selectionRef.current = { conversationId, promise };
    setSelecting(true);
    try {
      const response = await promise;
      if (response.conversationId === conversationId) store.acceptSelection(conversationId, response.target);
      return currentConversationIdRef.current === conversationId ? response : undefined;
    } finally {
      if (selectionRef.current?.promise === promise) {
        selectionRef.current = null;
        setSelecting(false);
      }
    }
  }, [api, store, conversationId]);
  return { state, selecting, select };
}
