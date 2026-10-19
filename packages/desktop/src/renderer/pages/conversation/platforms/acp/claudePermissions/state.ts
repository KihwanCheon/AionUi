import { useCallback, useSyncExternalStore } from 'react';

export type PermissionResponseState = 'sending' | 'sent' | 'failed';
type Response = { state: PermissionResponseState; promise: Promise<void> };
type ConversationState = {
  observed?: string;
  selected?: string;
  responses: Map<string, Response>;
  autoAttempted: Set<string>;
};

// Renderer-local, conversation-scoped intent survives switching chat tabs. It must
// never be overwritten by a late CLI snapshot after the user has made a choice.
const conversations = new Map<string, ConversationState>();
const listeners = new Set<() => void>();
const modeListeners = new Set<(id: string) => void>();
export const subscribeClaudeModes = (listener: (id: string) => void) => {
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
  };
};
export const claudeConversationIds = (): string[] => [...conversations.keys()];
export const forgetClaudeConversation = (id: string): void => {
  conversations.delete(id);
  notify();
};
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const entry = (id: string): ConversationState => {
  let state = conversations.get(id);
  if (!state) {
    state = { responses: new Map(), autoAttempted: new Set() };
    conversations.set(id, state);
  }
  return state;
};

export const getClaudeSelectedMode = (id: string): string | undefined => conversations.get(id)?.selected;
export const getClaudeMode = (id: string): string | undefined => {
  const state = conversations.get(id);
  return state?.selected ?? state?.observed;
};

/** Input modes that opt Claude tool permission requests into one-shot automatic Allow. */
export const isClaudeAutoAllowMode = (mode: string | undefined): boolean =>
  mode === 'bypassPermissions' || mode === 'acceptEdits';

export function observeClaudeMode(id: string, mode: string): void {
  const state = entry(id);
  if (state.observed === mode) return;
  state.observed = mode;
  notify();
  modeListeners.forEach((listener) => listener(id));
}

export function selectClaudeMode(id: string, mode: string): void {
  const state = entry(id);
  if (state.selected === mode) return;
  state.selected = mode;
  notify();
  modeListeners.forEach((listener) => listener(id));
}

export function useClaudeMode(id: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => getClaudeMode(id), [id])
  );
}

export function useClaudePermissionResponse(id: string, callId: string): PermissionResponseState | undefined {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => conversations.get(id)?.responses.get(callId)?.state, [id, callId])
  );
}

/** Share one submission across live/recovered cards and the automatic responder. */
export function submitClaudePermission(
  id: string,
  callId: string,
  submit: () => Promise<void>,
  automatic = false
): Promise<void> {
  const state = conversations.get(id);
  // Other backends retain their existing submission behavior.
  if (!state) return automatic ? Promise.resolve() : submit();
  const previous = state.responses.get(callId);
  if (previous?.state === 'sending' || previous?.state === 'sent') return previous.promise;
  if (automatic) {
    if (!isClaudeAutoAllowMode(getClaudeMode(id)) || state.autoAttempted.has(callId)) return Promise.resolve();
    state.autoAttempted.add(callId);
  }
  const response: Response = { state: 'sending', promise: Promise.resolve() };
  state.responses.set(callId, response);
  response.promise = (async () => {
    try {
      await submit();
      response.state = 'sent';
    } catch (error) {
      response.state = 'failed';
      state.autoAttempted.add(callId);
      throw error;
    } finally {
      notify();
    }
  })();
  notify();
  return response.promise;
}
