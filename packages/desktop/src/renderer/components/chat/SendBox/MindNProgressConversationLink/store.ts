import type {
  MindNProgressConversationApi,
  MindNProgressConversationLinkResponse,
  MindNProgressLinkState,
  MindNProgressTarget,
} from './api';

const EMPTY: MindNProgressLinkState = { status: 'loading' };
const CACHE_MS = 60_000;
const RECHECK_MS = 1_500;
const cardKey = (target: MindNProgressTarget) => JSON.stringify([target.mapId, target.cardId]);
type Entry = {
  state: MindNProgressLinkState;
  listeners: Set<() => void>;
  updated: number;
  version: number;
  busy: boolean;
  retry: boolean;
};
const publish = (value: Entry, state: MindNProgressLinkState) => {
  value.state = state;
  value.listeners.forEach((listener) => listener());
};

/** Share lookups across titles and controls; bound list discovery and reject stale role assignments. */
export function createLinkStore(api: MindNProgressConversationApi) {
  const entries = new Map<string, Entry>();
  const cards = new Map<string, { primary: string | null; version: number }>();
  const queue: string[] = [];
  let running = 0;
  let sequence = 0;
  let subscribers = 0;
  let stopListening: (() => void) | undefined;
  const entry = (id: string) => {
    let value = entries.get(id);
    if (!value) {
      value = { state: EMPTY, listeners: new Set(), updated: 0, version: 0, busy: false, retry: false };
      entries.set(id, value);
    }
    return value;
  };
  const accept = (id: string, response: MindNProgressConversationLinkResponse, version: number) => {
    const value = entry(id);
    if (version < value.version) return;
    if (response.conversationId !== id) throw new Error('MindNProgress conversation identity mismatch');
    const target = response.exists ? response.target : null;
    if (
      target &&
      target.primaryConversationId !== undefined &&
      (target.conversationRole === 'primary' || target.conversationRole === 'auxiliary')
    ) {
      const key = cardKey(target);
      const previous = cards.get(key);
      if (previous && version < previous.version && previous.primary !== target.primaryConversationId) {
        value.retry = true;
        return;
      }
      if (!previous || version >= previous.version) {
        cards.set(key, { primary: target.primaryConversationId, version });
      }
      // Recheck known peers instead of letting two cached conversations remain primary.
      for (const [peerId, peer] of entries) {
        if (peerId === id || peer.state.status !== 'linked') continue;
        const peerTarget = peer.state.link.target;
        if (
          !peerTarget ||
          cardKey(peerTarget) !== key ||
          peerTarget.primaryConversationId === undefined ||
          peerTarget.primaryConversationId === target.primaryConversationId
        )
          continue;
        peer.version = version;
        peer.updated = 0;
        publish(peer, {
          status: 'linked',
          link: {
            ...peer.state.link,
            target: {
              ...peerTarget,
              conversationRole: undefined,
              primaryConversationId: undefined,
            },
          },
        });
        if (peer.busy) peer.retry = true;
        else if (peer.listeners.size) request(peerId, true);
      }
    }
    value.version = version;
    value.updated = Date.now();
    publish(value, response.exists ? { status: 'linked', link: response } : { status: 'unlinked' });
  };
  const pump = () => {
    while (running < 4 && queue.length) {
      const id = queue.shift()!;
      const value = entry(id);
      if (!value.listeners.size) {
        value.busy = false;
        continue;
      }
      const version = ++sequence;
      running++;
      void Promise.resolve()
        .then(() => api.lookup(id))
        .then((response) => accept(id, response, version))
        .catch((error: unknown) => {
          if (version < value.version) return;
          value.updated = Date.now();
          publish(value, { status: 'error', error });
        })
        .finally(() => {
          running--;
          value.busy = false;
          if (value.retry) {
            value.retry = false;
            value.updated = 0;
            if (value.listeners.size) request(id, true);
          }
          pump();
        });
    }
  };
  const request = (id: string, force = false) => {
    if (!id) return;
    const value = entry(id);
    if (value.busy) {
      if (force) {
        const index = queue.indexOf(id);
        if (index > 0) {
          queue.splice(index, 1);
          queue.unshift(id);
        }
      }
      return;
    }
    if (value.updated && Date.now() - value.updated < (force ? RECHECK_MS : CACHE_MS)) return;
    value.busy = true;
    if (force) queue.unshift(id);
    else queue.push(id);
    pump();
  };
  const listen = () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (force: boolean) => {
      if (document.visibilityState === 'hidden') return;
      for (const [id, value] of entries) if (value.listeners.size) request(id, force);
    };
    const resume = () => {
      if (document.visibilityState === 'hidden') return;
      clearTimeout(timer);
      timer = setTimeout(() => refresh(true), 120);
    };
    const interval = setInterval(() => refresh(false), CACHE_MS);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  };
  return {
    snapshot: (id: string) => (id ? entry(id).state : EMPTY),
    request,
    acceptSelection: (id: string, target: MindNProgressTarget) => {
      const value = entry(id);
      if (value.state.status !== 'linked') {
        request(id, true);
        return;
      }
      accept(id, { ...value.state.link, target }, ++sequence);
    },
    subscribe: (id: string, listener: () => void) => {
      if (!id) return () => {};
      const value = entry(id);
      value.listeners.add(listener);
      if (++subscribers === 1) stopListening = listen();
      return () => {
        value.listeners.delete(listener);
        if (--subscribers === 0) {
          stopListening?.();
          stopListening = undefined;
        }
        // Bound session-local history; roles are never written to persistent storage.
        if (entries.size > 500) {
          for (const [key, cached] of entries) {
            if (!cached.listeners.size && !cached.busy) entries.delete(key);
            if (entries.size <= 500) break;
          }
          const retainedCards = new Set(
            [...entries.values()].flatMap((cached) =>
              cached.state.status === 'linked' && cached.state.link.target ? [cardKey(cached.state.link.target)] : []
            )
          );
          for (const key of cards.keys()) if (!retainedCards.has(key)) cards.delete(key);
        }
      };
    },
  };
}

const stores = new WeakMap<MindNProgressConversationApi, ReturnType<typeof createLinkStore>>();
export const getLinkStore = (api: MindNProgressConversationApi) => {
  let store = stores.get(api);
  if (!store) {
    store = createLinkStore(api);
    stores.set(api, store);
  }
  return store;
};
