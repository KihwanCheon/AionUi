import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import React from 'react';
import MindNProgressConversationLink, {
  getMindNProgressSelectionError,
  mindNProgressConversationApi,
  type MindNProgressConversationApi,
  type MindNProgressConversationLinkResponse,
  type MindNProgressConversationSelectionResponse,
  useMindNProgressConversationLink,
} from '@/renderer/components/chat/SendBox/MindNProgressConversationLink';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
