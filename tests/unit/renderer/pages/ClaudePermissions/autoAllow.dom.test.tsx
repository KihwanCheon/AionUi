import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfirmation, IMessageAcpPermission } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { useClaudeAutoAllow } from '@/renderer/pages/conversation/platforms/acp/claudePermissions';
import {
  claudeConversationIds,
  forgetClaudeConversation,
  observeClaudeMode,
  selectClaudeMode,
  submitClaudePermission,
} from '@/renderer/pages/conversation/platforms/acp/claudePermissions/state';
import MessageAcpPermission from '@/renderer/pages/conversation/Messages/acp/MessageAcpPermission';

const { list, confirm, get, manualConfirm, streams, changes } = vi.hoisted(() => ({
  list: vi.fn(),
  confirm: vi.fn(),
  get: vi.fn(),
  manualConfirm: vi.fn(),
  streams: new Set<(event: { conversation_id: string; type: string }) => void>(),
  changes: new Set<(event: { conversation_id: string; action: string }) => void>(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: { invoke: get },
      confirmation: { list: { invoke: list }, confirm: { invoke: confirm } },
      responseStream: {
        on: (fn: Parameters<typeof streams.add>[0]) => {
          streams.add(fn);
          return () => streams.delete(fn);
        },
      },
      listChanged: {
        on: (fn: Parameters<typeof changes.add>[0]) => {
          changes.add(fn);
          return () => changes.delete(fn);
        },
      },
    },
  },
}));
vi.mock('@/common/adapter/ipcBridge', () => ({ conversation: { confirmMessage: { invoke: manualConfirm } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const chat = (id = 'claude-1', backend = 'claude', mode = 'bypassPermissions'): TChatConversation => ({
  id,
  type: 'acp',
  name: id,
  created_at: 1,
  modified_at: 1,
  extra: { backend, session_mode: mode },
});
const permission = (id = 'request-1'): IConfirmation<unknown> => ({
  id,
  call_id: id,
  title: 'Bash',
  description: 'Run command',
  options: [
    { label: 'Reject', value: 'reject' },
    { label: 'Always', value: 'allow_always' },
    { label: '허용', value: 'allow' },
  ],
});
const emit = (id = 'claude-1') =>
  act(() => {
    streams.forEach((fn) => fn({ conversation_id: id, type: 'acp_permission' }));
  });
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe.each(['bypassPermissions', 'acceptEdits'])('Claude background automatic Allow (%s)', (mode) => {
  const autoChat = (id = 'claude-1', backend = 'claude') => chat(id, backend, mode);
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue([permission()]);
    confirm.mockResolvedValue(undefined);
    manualConfirm.mockResolvedValue(undefined);
    get.mockResolvedValue(autoChat());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    claudeConversationIds().forEach(forgetClaudeConversation);
    vi.restoreAllMocks();
  });

  it('approves a background pending request without mounting a chat or card', async () => {
    renderHook(() => useClaudeAutoAllow([autoChat()]));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'claude-1',
        call_id: 'request-1',
        data: { value: 'allow' },
        always_allow: false,
      })
    );
  });

  it('starts on input selection even when the CLI and sidebar still report default', async () => {
    const chats = [chat('claude-1', 'claude', 'default')];
    renderHook(() => useClaudeAutoAllow(chats));
    expect(confirm).not.toHaveBeenCalled();
    act(() => selectClaudeMode('claude-1', mode));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  });

  it('does not replace the input mode with an outdated sidebar snapshot', async () => {
    observeClaudeMode('claude-1', 'default');
    renderHook(() => useClaudeAutoAllow([autoChat()]));
    await settle();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('handles a new background permission after the initial pending list was empty', async () => {
    list.mockResolvedValueOnce([]);
    renderHook(() => useClaudeAutoAllow([autoChat()]));
    await settle();
    emit();
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  });

  it('looks up a conversation absent from the sidebar and checks its backend', async () => {
    renderHook(() => useClaudeAutoAllow([]));
    emit();
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith({ id: 'claude-1' });
  });

  it('never approves Codex, including an unseen conversation reporting an automatic mode', async () => {
    get.mockResolvedValue(autoChat('codex-1', 'codex'));
    renderHook(() => useClaudeAutoAllow([autoChat('codex-1', 'codex')]));
    emit('codex-1');
    await settle();
    expect(list).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not interpret questions or missing allow choices as tool approval', async () => {
    list.mockResolvedValue([
      { ...permission('ask-1'), questions: [] },
      { ...permission('ask-2'), title: 'AskUserQuestion' },
      { ...permission('unknown'), options: [{ label: 'Allow', value: 'unknown' }] },
      { ...permission('always-only'), options: [{ label: 'Always', value: 'allow_always' }] },
    ]);
    renderHook(() => useClaudeAutoAllow([autoChat()]));
    await settle();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('rechecks selection after an outstanding pending-list request returns', async () => {
    const pending = Promise.withResolvers<IConfirmation<unknown>[]>();
    list.mockReturnValue(pending.promise);
    renderHook(() => useClaudeAutoAllow([autoChat()]));
    act(() => selectClaudeMode('claude-1', 'default'));
    await act(async () => pending.resolve([permission()]));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('stops unsent requests when selection changes during an approval', async () => {
    const reply = Promise.withResolvers<void>();
    confirm.mockReturnValueOnce(reply.promise);
    list.mockResolvedValue([permission(), permission('request-2')]);
    renderHook(() => useClaudeAutoAllow([autoChat()]));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    act(() => selectClaudeMode('claude-1', 'plan'));
    await act(async () => reply.resolve());
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('coalesces duplicate events and a simultaneous manual answer', async () => {
    const reply = Promise.withResolvers<void>();
    confirm.mockReturnValue(reply.promise);
    renderHook(() => useClaudeAutoAllow([autoChat()]));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    emit();
    const click = vi.fn();
    const manual = submitClaudePermission('claude-1', 'request-1', click);
    await act(async () => {
      reply.resolve();
      await manual;
    });
    expect(click).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('shows auto failure on a later opened card and allows a manual retry', async () => {
    confirm.mockRejectedValue(new Error('offline'));
    renderHook(() => useClaudeAutoAllow([autoChat()]));
    await settle();
    emit();
    await settle();
    const message: IMessageAcpPermission = {
      id: 'message-1',
      conversation_id: 'claude-1',
      type: 'acp_permission',
      position: 'left',
      content: {
        session_id: 'session-1',
        tool_call: { tool_call_id: 'request-1', title: 'Bash' },
        options: [{ option_id: 'allow', name: 'Allow', kind: 'allow_once' }],
      },
    };
    render(<MessageAcpPermission message={message} />);
    expect(screen.getByTestId('message-acp-permission-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('message-acp-permission-option-allow'));
    await screen.findByTestId('message-acp-permission-status');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(manualConfirm).toHaveBeenCalledTimes(1);
  });

  it('can recover a lookup failure on focus without reopening the conversation', async () => {
    list.mockRejectedValueOnce(new Error('offline'));
    renderHook(() => useClaudeAutoAllow([autoChat()]));
    await settle();
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  });

  it('ignores late lookup results after app unmount or conversation deletion', async () => {
    const pending = Promise.withResolvers<IConfirmation<unknown>[]>();
    list.mockReturnValue(pending.promise);
    const { unmount } = renderHook(() => useClaudeAutoAllow([autoChat()]));
    act(() => changes.forEach((fn) => fn({ conversation_id: 'claude-1', action: 'deleted' })));
    unmount();
    await act(async () => pending.resolve([permission()]));
    expect(confirm).not.toHaveBeenCalled();
    expect(streams.size).toBe(0);
  });
});
