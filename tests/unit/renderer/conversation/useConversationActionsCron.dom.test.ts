/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { BackendHttpError, HttpRequestTimeoutError } from '@/common/adapter/httpBridge';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  copyTextMock,
  emitterEmitMock,
  getMessagesMock,
  messageErrorMock,
  messageSuccessMock,
  modalConfirmMock,
  navigateMock,
  removeConversationMock,
  requestPrefillMock,
  routeState,
  updateConversationMock,
} = vi.hoisted(() => ({
  copyTextMock: vi.fn(),
  emitterEmitMock: vi.fn(),
  getMessagesMock: vi.fn(),
  messageErrorMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  modalConfirmMock: vi.fn(),
  navigateMock: vi.fn(),
  removeConversationMock: vi.fn(),
  requestPrefillMock: vi.fn(),
  routeState: { id: 'current-conversation' as string | undefined },
  updateConversationMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'cron.status.defaultPrompt' ? 'Create with /cron in AionUi' : key),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ id: routeState.id }),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      remove: { invoke: removeConversationMock },
      update: { invoke: updateConversationMock },
    },
    database: {
      getConversationMessages: { invoke: getMessagesMock },
    },
  },
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: copyTextMock,
}));

vi.mock('@/renderer/utils/chat/getLastAssistantText', () => ({
  getLastAssistantText: () => 'final assistant response',
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    error: messageErrorMock,
    success: messageSuccessMock,
    warning: vi.fn(),
  },
  Modal: {
    confirm: modalConfirmMock,
  },
}));

vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({
  requestConversationSendBoxPrefill: requestPrefillMock,
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  refreshConversationCache: vi.fn(),
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: emitterEmitMock },
}));

vi.mock('@/renderer/utils/ui/focus', () => ({
  blockMobileInputFocus: vi.fn(),
  blurActiveElement: vi.fn(),
}));

import { useConversationActions } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions';

const makeConversation = (id: string, type: TChatConversation['type']): TChatConversation =>
  ({
    id,
    type,
    name: id,
    created_at: 1,
    modified_at: 1,
    extra: type === 'acp' ? { backend: 'claude' } : {},
    model: {},
  }) as TChatConversation;

const renderActions = (onSessionClick?: () => void) =>
  renderHook(
    ({ visibleConversationOrderKey }: { visibleConversationOrderKey: string }) =>
      useConversationActions({
        batchMode: false,
        onSessionClick,
        selectedConversationIds: new Set(),
        setSelectedConversationIds: vi.fn(),
        toggleSelectedConversation: vi.fn(),
        markAsRead: vi.fn(),
        visibleConversationOrderKey,
      }),
    { initialProps: { visibleConversationOrderKey: '["first","second"]' } }
  );

describe('conversation menu target stability', () => {
  it('closes the open menu when automatic sorting changes the visible order', () => {
    const { result, rerender } = renderActions();
    act(() => result.current.handleOpenMenu(makeConversation('first', 'acp')));

    rerender({ visibleConversationOrderKey: '["second","first"]' });

    expect(result.current.dropdownVisibleId).toBeNull();
  });

  it('ignores a delayed close event from a different conversation menu', () => {
    const { result } = renderActions();
    act(() => result.current.handleOpenMenu(makeConversation('first', 'acp')));

    act(() => result.current.handleMenuVisibleChange('second', false));

    expect(result.current.dropdownVisibleId).toBe('first');
  });
});

describe('create scheduled task conversation action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeState.id = 'current-conversation';
    getMessagesMock.mockResolvedValue({ items: [] });
  });

  it('prefills the current editable conversation without navigating', () => {
    const { result } = renderActions();

    act(() => result.current.handleCreateCronTask(makeConversation('current-conversation', 'acp')));

    expect(requestPrefillMock).toHaveBeenCalledWith('current-conversation', 'Create with /cron in AionUi');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('queues the target-scoped prefill before navigating to a background conversation', () => {
    const onSessionClick = vi.fn();
    const { result } = renderActions(onSessionClick);

    act(() => result.current.handleCreateCronTask(makeConversation('background-conversation', 'aionrs')));

    expect(requestPrefillMock).toHaveBeenCalledWith('background-conversation', 'Create with /cron in AionUi');
    expect(navigateMock).toHaveBeenCalledWith('/conversation/background-conversation');
    expect(requestPrefillMock.mock.invocationCallOrder[0]).toBeLessThan(navigateMock.mock.invocationCallOrder[0]);
    expect(onSessionClick).toHaveBeenCalledOnce();
  });

  it.each(['openclaw-gateway', 'nanobot', 'remote', 'gemini', 'codex'])(
    'routes the read-only %s conversation to a draft-preserving Guid prefill',
    (type) => {
      const { result } = renderActions();

      act(() => result.current.handleCreateCronTask(makeConversation(`readonly-${type}`, type)));

      expect(requestPrefillMock).not.toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith('/guid', {
        state: {
          prefillPrompt: 'Create with /cron in AionUi',
          preservePrefillDraft: true,
          focusPrefill: true,
        },
      });
    }
  );
});

describe('conversation copy actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMessagesMock.mockResolvedValue({ items: [] });
    updateConversationMock.mockResolvedValue(true);
  });

  it('copies the last assistant response from the selected conversation', async () => {
    const conversation = makeConversation('copy-target', 'acp');
    const { result } = renderActions();

    await act(async () => {
      await result.current.handleCopyLastOutput(conversation);
    });

    expect(getMessagesMock).toHaveBeenCalledWith({
      conversation_id: 'copy-target',
      limit: 1000,
      content_mode: 'full',
    });
    expect(copyTextMock).toHaveBeenCalledWith('final assistant response');
  });
  it.each([
    { currentPinned: false, expectedPinned: true },
    { currentPinned: true, expectedPinned: false },
  ])(
    'updates the canonical bookmark field from $currentPinned to $expectedPinned',
    async ({ currentPinned, expectedPinned }) => {
      const conversation = {
        ...makeConversation('bookmark-target', 'acp'),
        pinned: currentPinned,
        extra: { backend: 'claude', pinned: currentPinned },
      } as TChatConversation;
      const { result } = renderActions();

      await act(async () => {
        await result.current.handleTogglePin(conversation);
      });

      expect(updateConversationMock).toHaveBeenCalledWith({
        id: 'bookmark-target',
        updates: {
          pinned: expectedPinned,
          extra: { pinned: false },
        },
        merge_extra: true,
      });
    }
  );

  it('keeps the current bookmark state and reports an error when the update is rejected', async () => {
    updateConversationMock.mockResolvedValue(false);
    const conversation = makeConversation('bookmark-failure', 'acp');
    const { result } = renderActions();

    await act(async () => {
      await result.current.handleTogglePin(conversation);
    });

    expect(messageErrorMock).toHaveBeenCalledWith('conversation.history.bookmarkUpdateFailed');
  });
});

describe('permanent conversation deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeState.id = 'current-conversation';
    removeConversationMock.mockResolvedValue(true);
  });

  it('asks for irreversible confirmation before deleting', () => {
    const conversation = makeConversation('current-conversation', 'acp');
    const { result } = renderActions();

    act(() => result.current.handlePermanentDelete(conversation));

    expect(removeConversationMock).not.toHaveBeenCalled();
    expect(modalConfirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'conversation.history.permanentDelete',
        content: 'settings.archived.deleteConfirmContent',
        okButtonProps: { status: 'danger' },
      })
    );
  });

  it('deletes the conversation and leaves its active route after confirmation', async () => {
    const conversation = makeConversation('current-conversation', 'acp');
    const { result } = renderActions();
    act(() => result.current.handlePermanentDelete(conversation));
    const { onOk } = modalConfirmMock.mock.calls[0][0] as { onOk: () => Promise<void> };

    await act(onOk);

    expect(removeConversationMock).toHaveBeenCalledWith({ id: 'current-conversation' });
    expect(navigateMock).toHaveBeenCalledWith('/');
    expect(messageSuccessMock).toHaveBeenCalledWith('conversation.history.deleteSuccess');
  });

  it('reports failure without leaving the active route when deletion is rejected', async () => {
    removeConversationMock.mockResolvedValue(false);
    const conversation = makeConversation('current-conversation', 'acp');
    const { result } = renderActions();
    act(() => result.current.handlePermanentDelete(conversation));
    const { onOk } = modalConfirmMock.mock.calls[0][0] as { onOk: () => Promise<void> };

    await act(onOk);

    expect(messageErrorMock).toHaveBeenCalledWith('conversation.history.deleteFailed');
    expect(navigateMock).not.toHaveBeenCalled();
    expect(emitterEmitMock).not.toHaveBeenCalled();
  });

  it.each([
    new HttpRequestTimeoutError(),
    new BackendHttpError({ method: 'DELETE', path: '/c', status: 408, body: { code: 'TIMEOUT' } }),
  ])('settles the dialog and refreshes the list after a timeout (%s)', async (error) => {
    removeConversationMock.mockRejectedValueOnce(error);
    const { result } = renderActions();
    act(() => result.current.handlePermanentDelete(makeConversation('current-conversation', 'acp')));
    const { onOk } = modalConfirmMock.mock.calls[0][0] as { onOk: () => Promise<void> };
    await act(onOk);
    expect(messageErrorMock).toHaveBeenCalledWith('conversation.history.deleteTimedOut');
    expect(navigateMock).not.toHaveBeenCalled();
    expect(emitterEmitMock).toHaveBeenCalledWith('chat.history.refresh');
  });
});
