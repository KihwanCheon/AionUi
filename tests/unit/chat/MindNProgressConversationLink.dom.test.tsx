import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { ipcBridge } from '@/common';
import { refreshConversationCache } from '@/renderer/pages/conversation/utils/conversationCache';
import { emitter } from '@/renderer/utils/emitter';
import { Message } from '@arco-design/web-react';
import React from 'react';
import MindNProgressTitle from '@/renderer/pages/conversation/GroupedHistory/components/MindNProgressTitle';
import { createLinkStore, getLinkStore } from '@/renderer/components/chat/SendBox/MindNProgressConversationLink/store';
import ChatTitleEditor from '@/renderer/pages/conversation/components/ChatTitleEditor';
import MindNProgressConversationLink, {
  getMindNProgressSelectionError,
  mindNProgressConversationApi,
  type MindNProgressConversationApi,
  type MindNProgressConversationLinkResponse,
  type MindNProgressConversationSelectionResponse,
  useMindNProgressConversationLink,
} from '@/renderer/components/chat/SendBox/MindNProgressConversationLink';
import MindNProgressConversationTitleSync, {
  buildMindNProgressConversationTitle,
  renameMindNProgressConversation,
  useMindNProgressConversationTitleSync,
} from '@/renderer/pages/conversation/components/ChatLayout/MindNProgressConversationTitleSync';

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      update: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  refreshConversationCache: vi.fn(),
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
}));

vi.mock('@/renderer/pages/conversation/components/ConversationTitleMinimap', () => ({ default: () => null }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'messages.mindnprogress.roleCoordinator': '그룹 총괄',
          'messages.mindnprogress.roleRoot': '상위',
          'messages.mindnprogress.roleAuxiliary': '보조',
          'messages.mindnprogress.rolePrimaryTooltip': '이 카드의 담당 대화',
          'messages.mindnprogress.roleAuxiliaryTooltip': '이 카드의 보조 대화',
          'messages.mindnprogress.roleNoPrimaryTooltip': '이 카드의 보조 대화 · 현재 담당 대화 없음',
          'messages.mindnprogress.roleUnknownTooltip': '담당·보조 정보 미확인',
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function linkResponse(
  conversationId: string,
  exists = true,
  documentTitle = 'Document',
  cardTitle = 'Card'
): MindNProgressConversationLinkResponse {
  return {
    conversationId,
    exists,
    target: exists
      ? {
          mapId: 'map-1',
          documentTitle,
          cardId: 'card-1',
          cardTitle,
          archived: false,
        }
      : null,
    selectionAvailable: false,
    matchingViewCount: 0,
    localSelectionAvailable: false,
    localViewCount: 0,
    message: exists ? 'linked' : 'not linked',
  };
}

function selectionResponse(conversationId: string): MindNProgressConversationSelectionResponse {
  return {
    selected: true,
    conversationId,
    target: linkResponse(conversationId).target!,
    deliveredClientCount: 1,
    requestedAt: '2026-09-15T00:00:00.000Z',
    message: 'selected',
  };
}

describe('MindNProgressConversationLink', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows only for a linked conversation even when no matching MnP view is connected', async () => {
    const linkedApi: MindNProgressConversationApi = {
      lookup: vi.fn().mockResolvedValue(linkResponse('linked')),
      select: vi.fn(),
    };
    const { unmount } = render(<MindNProgressConversationLink api={linkedApi} conversationId='linked' />);
    expect(await screen.findByTestId('mindnprogress-conversation-link')).toBeInTheDocument();
    unmount();

    const unlinkedApi: MindNProgressConversationApi = {
      lookup: vi.fn().mockResolvedValue(linkResponse('unlinked', false)),
      select: vi.fn(),
    };
    render(<MindNProgressConversationLink api={unlinkedApi} conversationId='unlinked' />);
    await waitFor(() => expect(unlinkedApi.lookup).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('mindnprogress-conversation-link')).not.toBeInTheDocument();
  });

  it('shows document and card titles in the requested tooltip format', async () => {
    const api: MindNProgressConversationApi = {
      lookup: vi.fn().mockResolvedValue(linkResponse('conversation-1', true, 'Document title', 'Card title')),
      select: vi.fn(),
    };
    const user = userEvent.setup();
    render(<MindNProgressConversationLink api={api} conversationId='conversation-1' />);

    await user.hover(await screen.findByTestId('mindnprogress-conversation-link'));
    expect(await screen.findByText('Document title: Card title')).toBeInTheDocument();
  });

  it('preserves a MindNProgress workflow prefix while updating the linked title', () => {
    const target = linkResponse('conversation-1', true, 'New document', 'New card').target!;

    expect(buildMindNProgressConversationTitle(target, '[그룹 총괄] Old document: Old card')).toBe(
      '[그룹 총괄] New document: New card'
    );
  });

  it('uses the latest group title for an automatically created coordinator document', () => {
    const target = linkResponse(
      'conversation-1',
      true,
      'JP 프로토콜·연동 · 통합 관리',
      'JP 프로토콜·클라이언트 연동 · 통합 관리'
    ).target!;
    target.group = {
      id: 'group-jp-protocol',
      title: 'JP-프로토콜·연동',
      role: 'coordinator',
    };

    expect(
      buildMindNProgressConversationTitle(
        target,
        '[그룹 총괄] JP 프로토콜·연동 · 통합 관리: JP 프로토콜·클라이언트 연동 · 통합 관리'
      )
    ).toBe('[그룹 총괄] JP-프로토콜·연동 · 통합 관리: JP 프로토콜·클라이언트 연동 · 통합 관리');
  });

  it('adds the document root prefix from MnP to an existing conversation', () => {
    const target = { ...linkResponse('conversation-1').target!, titlePrefix: '[상위] ' };
    expect(buildMindNProgressConversationTitle(target, 'Document: Card')).toBe('[상위] Document: Card');
    expect(buildMindNProgressConversationTitle(target, '[상위] Old: Card')).toBe('[상위] Document: Card');
  });

  it('updates role prefixes when a card changes between root, coordinator and child', () => {
    const target = linkResponse('conversation-1').target!;
    expect(buildMindNProgressConversationTitle({ ...target, titlePrefix: '' }, '[상위] Document: Card')).toBe(
      'Document: Card'
    );
    expect(buildMindNProgressConversationTitle({ ...target, titlePrefix: '[그룹 총괄] ' }, '[상위] Old: Card')).toBe(
      '[그룹 총괄] Document: Card'
    );
    expect(buildMindNProgressConversationTitle({ ...target, titlePrefix: '[상위] ' }, '[그룹 총괄] Old: Card')).toBe(
      '[상위] Document: Card'
    );
  });

  it('preserves special workflow prefixes and supports an older MnP server', () => {
    const target = linkResponse('conversation-1').target!;
    for (const prefix of ['[지식정리]', '[문서 정리]', '[배치 제안]', '[Dooray 승인]']) {
      expect(buildMindNProgressConversationTitle({ ...target, titlePrefix: '[상위] ' }, `${prefix} Old: Card`)).toBe(
        `${prefix} Document: Card`
      );
    }
    expect(buildMindNProgressConversationTitle(target, '[상위] Old: Card')).toBe('[상위] Document: Card');
  });

  it('updates the Aion title and refreshes both conversation caches', async () => {
    vi.mocked(ipcBridge.conversation.update.invoke).mockResolvedValue(true);
    vi.mocked(refreshConversationCache).mockResolvedValue(undefined);

    await expect(renameMindNProgressConversation('conversation-1', 'Document: Card')).resolves.toBe(true);
    expect(ipcBridge.conversation.update.invoke).toHaveBeenCalledWith({
      id: 'conversation-1',
      updates: { name: 'Document: Card' },
    });
    expect(refreshConversationCache).toHaveBeenCalledWith('conversation-1');
    expect(emitter.emit).toHaveBeenCalledWith('chat.history.refresh');
  });

  it('saves the document root prefix when the user synchronizes an existing title', async () => {
    const successMessage = vi.spyOn(Message, 'success').mockImplementation(() => undefined);
    const response = linkResponse('root-conversation');
    response.target!.titlePrefix = '[상위] ';
    const api: MindNProgressConversationApi = {
      lookup: vi.fn().mockResolvedValue(response),
      select: vi.fn(),
    };
    const renameConversation = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(
      <MindNProgressConversationTitleSync
        api={api}
        conversationId='root-conversation'
        currentTitle='Document: Card'
        renameConversation={renameConversation}
      />
    );
    await user.click(await screen.findByTestId('mindnprogress-title-sync'));
    await waitFor(() => expect(renameConversation).toHaveBeenCalledWith('root-conversation', '[상위] Document: Card'));
    expect(successMessage).toHaveBeenCalledWith('messages.mindnprogress.titleSyncSuccess');
    successMessage.mockRestore();
  });

  it('does not refresh conversation caches when the Aion rename is rejected', async () => {
    vi.mocked(ipcBridge.conversation.update.invoke).mockResolvedValue(false);

    await expect(renameMindNProgressConversation('conversation-1', 'Document: Card')).resolves.toBe(false);
    expect(refreshConversationCache).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('shows title sync only when the linked MindNProgress title differs', async () => {
    const api: MindNProgressConversationApi = {
      lookup: vi.fn().mockResolvedValue(linkResponse('conversation-1', true, 'Document title', 'Card title')),
      select: vi.fn(),
    };
    const renameConversation = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <MindNProgressConversationTitleSync
        api={api}
        conversationId='conversation-1'
        currentTitle='Old title'
        renameConversation={renameConversation}
      />
    );

    expect(await screen.findByTestId('mindnprogress-title-sync')).toBeInTheDocument();

    rerender(
      <MindNProgressConversationTitleSync
        api={api}
        conversationId='conversation-1'
        currentTitle='Document title: Card title'
        renameConversation={renameConversation}
      />
    );
    await waitFor(() => expect(screen.queryByTestId('mindnprogress-title-sync')).not.toBeInTheDocument());
  });

  it('syncs to the normalized MnP title and allows a retry after failure', async () => {
    const api: MindNProgressConversationApi = {
      lookup: vi.fn().mockResolvedValue(linkResponse('conversation-1', true, ' Document\n title ', ' Card   title ')),
      select: vi.fn(),
    };
    const renameConversation = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const errorMessage = vi.spyOn(Message, 'error').mockImplementation(() => undefined);
    const successMessage = vi.spyOn(Message, 'success').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(
      <MindNProgressConversationTitleSync
        api={api}
        conversationId='conversation-1'
        currentTitle='Old title'
        renameConversation={renameConversation}
      />
    );

    const button = await screen.findByTestId('mindnprogress-title-sync');
    await user.click(button);
    expect(renameConversation).toHaveBeenLastCalledWith('conversation-1', 'Document title: Card title');
    expect(errorMessage).toHaveBeenCalledWith('messages.mindnprogress.titleSyncFailed');

    await waitFor(() => expect(screen.getByTestId('mindnprogress-title-sync')).toBeEnabled());
    await user.click(screen.getByTestId('mindnprogress-title-sync'));
    expect(renameConversation).toHaveBeenCalledTimes(2);
    expect(successMessage).toHaveBeenCalledWith('messages.mindnprogress.titleSyncSuccess');

    errorMessage.mockRestore();
    successMessage.mockRestore();
  });

  it('ignores a stale lookup response after the active conversation changes', async () => {
    const first = deferred<MindNProgressConversationLinkResponse>();
    const second = deferred<MindNProgressConversationLinkResponse>();
    const api: MindNProgressConversationApi = {
      lookup: vi.fn((id: string) => (id === 'first' ? first.promise : second.promise)),
      select: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ conversationId }) => useMindNProgressConversationLink(conversationId, api),
      { initialProps: { conversationId: 'first' } }
    );

    rerender({ conversationId: 'second' });
    await act(async () => second.resolve(linkResponse('second', true, 'Second document', 'Second card')));
    await waitFor(() => expect(result.current.state.status).toBe('linked'));
    await act(async () => first.resolve(linkResponse('first', true, 'First document', 'First card')));

    expect(result.current.state.status).toBe('linked');
    if (result.current.state.status === 'linked') {
      expect(result.current.state.link.conversationId).toBe('second');
    }
  });

  it('sends one selection request with the current conversation id while a click is in flight', async () => {
    const pendingSelection = deferred<MindNProgressConversationSelectionResponse>();
    const api: MindNProgressConversationApi = {
      lookup: vi.fn().mockResolvedValue(linkResponse('current')),
      select: vi.fn(() => pendingSelection.promise),
    };
    const { result } = renderHook(() => useMindNProgressConversationLink('current', api));
    await waitFor(() => expect(result.current.state.status).toBe('linked'));

    let firstRequest!: Promise<MindNProgressConversationSelectionResponse | undefined>;
    let duplicateRequest!: Promise<MindNProgressConversationSelectionResponse | undefined>;
    act(() => {
      firstRequest = result.current.select();
      duplicateRequest = result.current.select();
    });

    expect(api.select).toHaveBeenCalledTimes(1);
    expect(api.select).toHaveBeenCalledWith('current');
    await expect(duplicateRequest).resolves.toBeUndefined();
    pendingSelection.resolve(selectionResponse('current'));
    await expect(firstRequest).resolves.toMatchObject({ conversationId: 'current' });
  });

  it('keeps lookup failures distinct from a confirmed unlinked response', async () => {
    const api: MindNProgressConversationApi = {
      lookup: vi.fn().mockRejectedValue(new Error('temporary failure')),
      select: vi.fn(),
    };
    const { result } = renderHook(() => useMindNProgressConversationLink('conversation-1', api));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
  });

  it('does not put the MnP integration token in browser request headers, state, or URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: linkResponse('conversation/id') }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await mindNProgressConversationApi.lookup('conversation/id');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/integrations/mindnprogress/conversations/conversation%2Fid');
    expect(JSON.stringify(init)).not.toMatch(/authorization|integration-token/i);
    expect(JSON.stringify(response)).not.toMatch(/authorization|integration-token/i);
  });

  it.each([
    [403, 'MNP_LOCAL_SELECTION_REQUIRED'],
    [400, 'MNP_SELECTION_ACCOUNT_REQUIRED'],
    [400, 'MNP_SELECTION_DEVICE_ADDRESS_INVALID'],
    [400, 'MNP_SELECTION_DEVICE_REQUIRED'],
    [403, 'MNP_SELECTION_ACCOUNT_UNAVAILABLE'],
    [403, 'MNP_SELECTION_ACCOUNT_MISMATCH'],
    [404, 'MNP_AI_CONVERSATION_NOT_FOUND'],
    [409, 'MNP_LOCAL_VIEW_NOT_CONNECTED'],
    [409, 'MNP_MATCHING_VIEW_NOT_CONNECTED'],
  ])('shows the backend message for %s selection errors', (status, code) => {
    const error = new BackendHttpError({
      method: 'POST',
      path: '/api/integrations/mindnprogress/conversations/id/select',
      status,
      body: { success: false, code, error: `message-${status}` },
    });
    expect(getMindNProgressSelectionError(error, 'fallback')).toBe(`message-${status}`);
  });
});

function roleResponse(
  id: string,
  primary: string | null,
  cardRole: 'document-root' | 'group-coordinator' | 'card' = 'document-root'
) {
  const response = linkResponse(id);
  Object.assign(response.target!, {
    cardRole,
    conversationRole: primary === id ? 'primary' : 'auxiliary',
    primaryConversationId: primary,
  });
  return response;
}

function TitleSyncHarness({
  conversationId,
  title = 'Old title',
  enabled = true,
}: {
  conversationId: string;
  title?: string;
  enabled?: boolean;
}) {
  const sync = useMindNProgressConversationTitleSync({
    conversationId,
    currentTitle: title,
    disabled: false,
    enabled,
  });
  return (
    <ChatTitleEditor
      conversation_id={conversationId}
      title={title}
      editingTitle={false}
      titleDraft={title}
      setTitleDraft={() => {}}
      setEditingTitle={() => {}}
      renameLoading={false}
      canRenameTitle
      submitTitleRename={async () => {}}
      titleAreaMaxWidth={400}
      leadingAction={sync.leadingAction}
      titleClassName={sync.titleClassName}
    />
  );
}

describe('MindNProgress title warning with shared cached links', () => {
  const titleElement = () => screen.getByTestId('chat-title-editor-trigger').querySelector('.text-16px');
  const warmCache = async (id: string) => {
    const store = getLinkStore(mindNProgressConversationApi);
    const unsubscribe = store.subscribe(id, () => {});
    try {
      await act(async () => store.request(id));
      await waitFor(() => expect(store.snapshot(id).status).toBe('linked'));
    } finally {
      unsubscribe();
    }
  };

  beforeEach(() => {
    vi.spyOn(mindNProgressConversationApi, 'lookup').mockImplementation(async (id) => {
      const response = roleResponse(id, id.endsWith('auxiliary') ? 'owner' : id, 'card');
      response.target!.cardId = id;
      return response;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['primary', 'auxiliary'])('highlights a cached mismatched %s title on mount', async (role) => {
    const id = `cached-title-${role}`;
    await warmCache(id);
    render(<TitleSyncHarness conversationId={id} />);

    expect(await screen.findByTestId('mindnprogress-title-sync')).toBeInTheDocument();
    expect(titleElement()).toHaveClass('!text-warning-6');
  });

  it('keeps the warning when switching between two mismatched conversations', async () => {
    const { rerender } = render(<TitleSyncHarness conversationId='title-switch-first' />);
    await screen.findByTestId('mindnprogress-title-sync');
    expect(titleElement()).toHaveClass('!text-warning-6');

    await warmCache('title-switch-second');
    rerender(<TitleSyncHarness conversationId='title-switch-second' />);
    expect(screen.getByTestId('mindnprogress-title-sync')).toBeInTheDocument();
    expect(titleElement()).toHaveClass('!text-warning-6');
  });

  it('clears the warning on a matching cached title and restores it on return', async () => {
    await warmCache('title-return-mismatch');
    await warmCache('title-return-match');
    const { rerender } = render(<TitleSyncHarness conversationId='title-return-mismatch' />);

    rerender(<TitleSyncHarness conversationId='title-return-match' title='Document: Card' />);
    expect(titleElement()).not.toHaveClass('!text-warning-6');
    expect(screen.queryByTestId('mindnprogress-title-sync')).not.toBeInTheDocument();

    rerender(<TitleSyncHarness conversationId='title-return-mismatch' />);
    expect(titleElement()).toHaveClass('!text-warning-6');
    expect(screen.getByTestId('mindnprogress-title-sync')).toBeInTheDocument();
  });

  it('updates the warning and action together when the saved conversation title changes', async () => {
    await warmCache('title-saved-change');
    const { rerender } = render(<TitleSyncHarness conversationId='title-saved-change' />);

    rerender(<TitleSyncHarness conversationId='title-saved-change' title='Document: Card' />);
    expect(titleElement()).not.toHaveClass('!text-warning-6');
    expect(screen.queryByTestId('mindnprogress-title-sync')).not.toBeInTheDocument();

    rerender(<TitleSyncHarness conversationId='title-saved-change' title='Another title' />);
    expect(titleElement()).toHaveClass('!text-warning-6');
    expect(screen.getByTestId('mindnprogress-title-sync')).toBeInTheDocument();
  });

  it('derives the warning from refreshed MnP titles without remounting', async () => {
    const id = 'title-remote-change';
    await warmCache(id);
    render(<TitleSyncHarness conversationId={id} title='Document: Card' />);
    expect(titleElement()).not.toHaveClass('!text-warning-6');

    act(() =>
      getLinkStore(mindNProgressConversationApi).acceptSelection(id, {
        ...linkResponse(id).target!,
        cardId: id,
        cardTitle: 'Updated card',
      })
    );
    expect(titleElement()).toHaveClass('!text-warning-6');
    expect(screen.getByTestId('mindnprogress-title-sync')).toBeInTheDocument();
  });

  it('hides both indicators while synchronization is disabled and restores them when enabled', async () => {
    await warmCache('title-enable-change');
    const { rerender } = render(<TitleSyncHarness conversationId='title-enable-change' enabled={false} />);
    expect(titleElement()).not.toHaveClass('!text-warning-6');
    expect(screen.queryByTestId('mindnprogress-title-sync')).not.toBeInTheDocument();

    rerender(<TitleSyncHarness conversationId='title-enable-change' />);
    expect(titleElement()).toHaveClass('!text-warning-6');
    expect(screen.getByTestId('mindnprogress-title-sync')).toBeInTheDocument();
  });

  it('does not keep the previous conversation warning while an unlinked lookup is pending', async () => {
    const pending = deferred<MindNProgressConversationLinkResponse>();
    const { rerender } = render(<TitleSyncHarness conversationId='title-before-unlinked' />);
    await screen.findByTestId('mindnprogress-title-sync');
    expect(titleElement()).toHaveClass('!text-warning-6');

    vi.mocked(mindNProgressConversationApi.lookup).mockReturnValueOnce(pending.promise);
    rerender(<TitleSyncHarness conversationId='title-unlinked' />);
    expect(titleElement()).not.toHaveClass('!text-warning-6');
    expect(screen.queryByTestId('mindnprogress-title-sync')).not.toBeInTheDocument();

    await act(async () => pending.resolve(linkResponse('title-unlinked', false)));
    expect(titleElement()).not.toHaveClass('!text-warning-6');
    expect(screen.queryByTestId('mindnprogress-title-sync')).not.toBeInTheDocument();
  });
});

describe('MindNProgress live conversation roles', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ['document-root', 'primary', '[상위] 제목'],
    ['document-root', 'other', '[상위·보조] 제목'],
    ['group-coordinator', 'primary', '[그룹 총괄] 제목'],
    ['group-coordinator', 'other', '[그룹 총괄·보조] 제목'],
    ['card', 'primary', '제목'],
    ['card', 'other', '[보조] 제목'],
  ] as const)('renders %s with the current primary %s', async (cardRole, primary, title) => {
    const api = { lookup: vi.fn().mockResolvedValue(roleResponse('primary', primary, cardRole)), select: vi.fn() };
    const { container } = render(
      <MindNProgressTitle conversationId='primary' active api={api}>
        [상위] 제목
      </MindNProgressTitle>
    );
    await waitFor(() => expect(container.textContent).toBe(title));
    expect(container.querySelector('[data-mnp-conversation-role]')).toHaveAttribute(
      'data-mnp-conversation-role',
      primary === 'primary' ? 'primary' : 'auxiliary'
    );
  });

  it('keeps a workflow title and adds an auxiliary label without renaming it', async () => {
    const api = { lookup: vi.fn().mockResolvedValue(roleResponse('a', 'b')), select: vi.fn() };
    const { container } = render(
      <MindNProgressTitle conversationId='a' active api={api}>
        [지식정리] 사용자 제목
      </MindNProgressTitle>
    );
    await waitFor(() => expect(container.textContent).toBe('[보조] [지식정리] 사용자 제목'));
  });

  it('does not assume an older server assigned a primary conversation', async () => {
    const api = { lookup: vi.fn().mockResolvedValue(linkResponse('a')), select: vi.fn() };
    render(
      <MindNProgressTitle conversationId='a' active api={api}>
        [상위] 제목
      </MindNProgressTitle>
    );
    await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1));
    expect(screen.getByTitle('담당·보조 정보 미확인')).toHaveTextContent('[상위] 제목');
  });

  it('shows an unassigned primary distinctly from an unknown role', async () => {
    const api = { lookup: vi.fn().mockResolvedValue(roleResponse('a', null)), select: vi.fn() };
    render(
      <MindNProgressTitle conversationId='a' active api={api}>
        제목
      </MindNProgressTitle>
    );
    expect(await screen.findByTitle('이 카드의 보조 대화 · 현재 담당 대화 없음')).toHaveTextContent('[상위·보조] 제목');
  });

  it('does not fetch off-screen rows and deduplicates visible duplicates', async () => {
    const observers: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      }
    );
    const api = { lookup: vi.fn().mockResolvedValue(roleResponse('a', 'b')), select: vi.fn() };
    const { rerender } = render(
      <>
        <MindNProgressTitle conversationId='a' api={api}>
          목록
        </MindNProgressTitle>
        <MindNProgressTitle conversationId='a' api={api}>
          검색
        </MindNProgressTitle>
      </>
    );
    expect(api.lookup).not.toHaveBeenCalled();
    act(() =>
      observers.forEach((callback) =>
        callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      )
    );
    expect(await screen.findAllByTitle('이 카드의 보조 대화')).toHaveLength(2);
    await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1));
    rerender(
      <>
        <MindNProgressTitle conversationId='a' api={api}>
          변경된 제목
        </MindNProgressTitle>
        <MindNProgressTitle conversationId='a' api={api}>
          검색
        </MindNProgressTitle>
      </>
    );
    expect(api.lookup).toHaveBeenCalledTimes(1);
  });

  it('never saves the dynamic auxiliary role during title synchronization', () => {
    expect(buildMindNProgressConversationTitle(roleResponse('a', 'b').target!, '제목')).toBe('[상위] Document: Card');
  });
});

describe('MindNProgress shared lookup lifecycle', () => {
  const disposals: (() => void)[] = [];
  const flush = async () => {
    for (let index = 0; index < 12; index++) await Promise.resolve();
  };
  const watch = (store: ReturnType<typeof createLinkStore>, id: string) =>
    disposals.push(store.subscribe(id, () => {}));
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
  });
  afterEach(() => {
    disposals.splice(0).forEach((dispose) => dispose());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('limits concurrent discovery and reuses fresh cached results', async () => {
    const waiting = deferred<MindNProgressConversationLinkResponse>();
    const api = { lookup: vi.fn(() => waiting.promise), select: vi.fn() };
    const store = createLinkStore(api);
    for (let index = 0; index < 10; index++) {
      const id = String(index);
      watch(store, id);
      store.request(id);
    }
    await flush();
    expect(api.lookup).toHaveBeenCalledTimes(4);
    store.request('0', true);
    expect(api.lookup).toHaveBeenCalledTimes(4);
    // No unresolved real IO; the isolated deferred promises are discarded with this store.
  });

  it('rechecks roles on foreground resume and deduplicates simultaneous lifecycle events', async () => {
    let primary = 'a';
    const api = { lookup: vi.fn((id: string) => Promise.resolve(roleResponse(id, primary))), select: vi.fn() };
    const store = createLinkStore(api);
    watch(store, 'a');
    store.request('a');
    await flush();
    primary = 'b';
    await vi.advanceTimersByTimeAsync(2000);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120);
    await flush();
    expect(store.snapshot('a')).toMatchObject({
      status: 'linked',
      link: { target: { conversationRole: 'auxiliary', primaryConversationId: 'b' } },
    });
    expect(api.lookup).toHaveBeenCalledTimes(2);
  });

  it('invalidates the former primary and ignores its older in-flight response', async () => {
    let primary = 'a';
    const oldReading = deferred<MindNProgressConversationLinkResponse>();
    const api = { lookup: vi.fn((id: string) => Promise.resolve(roleResponse(id, primary))), select: vi.fn() };
    const store = createLinkStore(api);
    watch(store, 'a');
    watch(store, 'b');
    store.request('a');
    store.request('b');
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    api.lookup.mockImplementationOnce(() => oldReading.promise);
    store.request('a', true);
    await flush();
    primary = 'b';
    store.request('b', true);
    await flush();
    expect(store.snapshot('a')).toMatchObject({ status: 'linked', link: { target: { conversationRole: undefined } } });
    oldReading.resolve(roleResponse('a', 'a'));
    await flush();
    expect(store.snapshot('a')).toMatchObject({
      status: 'linked',
      link: { target: { conversationRole: 'auxiliary', primaryConversationId: 'b' } },
    });
    expect(store.snapshot('b')).toMatchObject({ status: 'linked', link: { target: { conversationRole: 'primary' } } });
  });

  it('keeps a newer selection response when an older lookup completes later', async () => {
    const api = { lookup: vi.fn().mockResolvedValue(roleResponse('a', 'a')), select: vi.fn() };
    const store = createLinkStore(api);
    watch(store, 'a');
    store.request('a');
    await flush();
    const oldReading = deferred<MindNProgressConversationLinkResponse>();
    api.lookup.mockReturnValueOnce(oldReading.promise);
    await vi.advanceTimersByTimeAsync(2000);
    store.request('a', true);
    await flush();
    store.acceptSelection('a', roleResponse('a', null).target!);
    oldReading.resolve(roleResponse('a', 'a'));
    await flush();
    expect(store.snapshot('a')).toMatchObject({
      status: 'linked',
      link: { target: { conversationRole: 'auxiliary', primaryConversationId: null } },
    });
  });

  it('clears a role after lookup failure and recovers on the next foreground event', async () => {
    const api = { lookup: vi.fn().mockResolvedValue(roleResponse('a', 'a')), select: vi.fn() };
    const store = createLinkStore(api);
    watch(store, 'a');
    store.request('a');
    await flush();
    api.lookup.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(2000);
    store.request('a', true);
    await flush();
    expect(store.snapshot('a').status).toBe('error');
    await vi.advanceTimersByTimeAsync(2000);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(120);
    await flush();
    expect(store.snapshot('a').status).toBe('linked');
  });

  it('rejects mismatched conversation identities instead of showing another role', async () => {
    const api = { lookup: vi.fn().mockResolvedValue(roleResponse('different', 'different')), select: vi.fn() };
    const store = createLinkStore(api);
    watch(store, 'a');
    store.request('a');
    await flush();
    expect(store.snapshot('a')).toMatchObject({
      status: 'error',
      error: new Error('MindNProgress conversation identity mismatch'),
    });
  });

  it('refreshes visible roles periodically but pauses background polling', async () => {
    const api = { lookup: vi.fn().mockResolvedValue(roleResponse('a', 'a')), select: vi.fn() };
    const store = createLinkStore(api);
    watch(store, 'a');
    store.request('a');
    await flush();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.lookup).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.lookup).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });

  it('rechecks when selecting a conversation again without waiting for the list cache to expire', async () => {
    const api = { lookup: vi.fn().mockResolvedValue(roleResponse('a', 'a')), select: vi.fn() };
    const store = createLinkStore(api);
    watch(store, 'a');
    store.request('a');
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    store.request('a');
    await flush();
    expect(api.lookup).toHaveBeenCalledTimes(1);
    api.lookup.mockResolvedValue(roleResponse('a', 'b'));
    store.request('a', true);
    await flush();
    expect(store.snapshot('a')).toMatchObject({
      status: 'linked',
      link: { target: { conversationRole: 'auxiliary' } },
    });
  });
});
