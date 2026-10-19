import { useCallback, useEffect, useRef } from 'react';
import { getClaudeSelectedMode, observeClaudeMode, selectClaudeMode, useClaudeMode } from './state';

/** Keep the send-box choice authoritative while serializing best-effort CLI updates. */
export function useClaudeModeSelection({
  conversationId,
  backend,
  observedMode,
  setting,
  syncMode,
  onSyncError,
}: {
  conversationId: string;
  backend: string;
  observedMode: string;
  setting: boolean;
  syncMode: (mode: string) => Promise<unknown>;
  onSyncError: (error: unknown) => void;
}) {
  useClaudeMode(conversationId);
  const latest = useRef({ syncMode, onSyncError });
  latest.current = { syncMode, onSyncError };
  const attempted = useRef<{ id: string; mode: string } | null>(null);
  const enabled = backend === 'claude';

  useEffect(() => {
    if (enabled) observeClaudeMode(conversationId, observedMode);
  }, [conversationId, enabled, observedMode]);

  const onSelect = useCallback((mode: string) => selectClaudeMode(conversationId, mode), [conversationId]);
  const selected = enabled ? getClaudeSelectedMode(conversationId) : undefined;
  useEffect(() => {
    if (!selected || setting || (attempted.current?.id === conversationId && attempted.current.mode === selected))
      return;
    attempted.current = { id: conversationId, mode: selected };
    void latest.current.syncMode(selected).catch((error: unknown) => latest.current.onSyncError(error));
  }, [conversationId, selected, setting]);

  return enabled ? { value: getClaudeSelectedMode(conversationId) ?? observedMode, onSelect } : undefined;
}
