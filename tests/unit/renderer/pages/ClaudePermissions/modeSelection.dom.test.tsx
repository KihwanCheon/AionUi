import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClaudeModeSelection } from '@/renderer/pages/conversation/platforms/acp/claudePermissions/useClaudeModeSelection';
import {
  claudeConversationIds,
  forgetClaudeConversation,
  getClaudeMode,
} from '@/renderer/pages/conversation/platforms/acp/claudePermissions/state';

afterEach(() => {
  cleanup();
  claudeConversationIds().forEach(forgetClaudeConversation);
});
const defaults = () => ({
  conversationId: 'claude-1',
  backend: 'claude',
  observedMode: 'default',
  setting: false,
  syncMode: vi.fn().mockResolvedValue(undefined),
  onSyncError: vi.fn(),
});

describe('Claude input permission selection', () => {
  it('retains the choice after a failed CLI switch and a stale runtime refresh', async () => {
    const props = defaults();
    props.syncMode.mockRejectedValue(new Error('confirmation_timeout'));
    const { result, rerender } = renderHook((value) => useClaudeModeSelection(value), { initialProps: props });
    act(() => result.current?.onSelect('bypassPermissions'));
    await waitFor(() => expect(props.onSyncError).toHaveBeenCalled());
    rerender({ ...props });
    expect(result.current?.value).toBe('bypassPermissions');
    expect(getClaudeMode('claude-1')).toBe('bypassPermissions');
  });

  it('lets the user turn automatic Allow off while the CLI update is busy', async () => {
    const props = defaults();
    const { result, rerender } = renderHook((value) => useClaudeModeSelection(value), { initialProps: props });
    act(() => result.current?.onSelect('bypassPermissions'));
    rerender({ ...props, setting: true });
    act(() => result.current?.onSelect('default'));
    expect(getClaudeMode('claude-1')).toBe('default');
    rerender({ ...props, setting: false });
    await waitFor(() => expect(props.syncMode).toHaveBeenLastCalledWith('default'));
  });

  it('preserves the selection across page unmounts and isolates another conversation', () => {
    const props = defaults();
    const first = renderHook(() => useClaudeModeSelection(props));
    act(() => first.result.current?.onSelect('bypassPermissions'));
    first.unmount();
    const second = renderHook(() => useClaudeModeSelection({ ...props, conversationId: 'claude-2' }));
    const reopened = renderHook(() => useClaudeModeSelection(props));
    expect(second.result.current?.value).toBe('default');
    expect(reopened.result.current?.value).toBe('bypassPermissions');
  });

  it('does not register or override Codex input selection', () => {
    const props = { ...defaults(), backend: 'codex' };
    const { result } = renderHook(() => useClaudeModeSelection(props));
    expect(result.current).toBeUndefined();
    expect(getClaudeMode(props.conversationId)).toBeUndefined();
    expect(props.syncMode).not.toHaveBeenCalled();
  });
});
