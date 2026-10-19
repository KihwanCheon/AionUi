type ConfirmationState = {
  revision: number;
  resolved: Set<string>;
  fetching: boolean;
  dirty: boolean;
};

/** Reconcile pending badges without letting old snapshots or resolved frames revive them. */
export function createWaitingConfirmationSync({
  load,
  replace,
}: {
  load: (conversationId: string) => Promise<string[]>;
  replace: (conversationId: string, ids: string[]) => void;
}) {
  const states = new Map<string, ConfirmationState>();
  const entry = (id: string) => {
    let state = states.get(id);
    if (!state) {
      state = { revision: 0, resolved: new Set(), fetching: false, dirty: false };
      states.set(id, state);
    }
    return state;
  };

  const refresh = async (id: string) => {
    const state = entry(id);
    state.dirty = true;
    if (state.fetching) return;
    state.fetching = true;
    try {
      while (state.dirty && states.get(id) === state) {
        state.dirty = false;
        const revision = state.revision;
        // Coalesce arrivals and discard snapshots that predate a newer event.
        // eslint-disable-next-line no-await-in-loop
        const ids = await load(id);
        if (states.get(id) !== state) return;
        if (revision === state.revision) {
          replace(
            id,
            ids.filter((pendingId) => !state.resolved.has(pendingId))
          );
        }
      }
    } catch {
      // Preserve the last known pending state; a later event/focus retries.
    } finally {
      state.fetching = false;
    }
  };

  return {
    refresh,
    mark(id: string, confirmationId: string): boolean {
      const state = entry(id);
      if (state.resolved.has(confirmationId)) return false;
      state.revision += 1;
      void refresh(id);
      return true;
    },
    resolve(id: string, confirmationId: string): void {
      const state = entry(id);
      state.resolved.add(confirmationId);
      state.revision += 1;
      void refresh(id);
    },
    forget(id: string): void {
      states.delete(id);
    },
  };
}
