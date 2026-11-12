/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BackendHttpError } from '@/common/adapter/httpBridge';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ensureBackendMcpCatalogMock,
  reloadMcpServersInvokeMock,
  ensureRuntimeInvokeMock,
  refreshConversationCacheMock,
  messageMock,
} = vi.hoisted(() => ({
  ensureBackendMcpCatalogMock: vi.fn(),
  reloadMcpServersInvokeMock: vi.fn(),
  ensureRuntimeInvokeMock: vi.fn(),
  refreshConversationCacheMock: vi.fn(),
  messageMock: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      reloadMcpServers: { invoke: reloadMcpServersInvokeMock },
      ensureRuntime: { invoke: ensureRuntimeInvokeMock },
    },
  },
}));

vi.mock('@/renderer/hooks/mcp/catalog', () => ({
  ensureBackendMcpCatalog: ensureBackendMcpCatalogMock,
  toSessionMcpServer: (server: { id: string; name: string; transport: unknown }) => ({
    id: server.id,
    name: server.name,
    transport: server.transport,
  }),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  refreshConversationCache: refreshConversationCacheMock,
}));

vi.mock('@arco-design/web-react', () => ({
  Message: messageMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { useReloadConversationMcpServers } from '@/renderer/hooks/mcp/useReloadConversationMcpServers';

describe('useReloadConversationMcpServers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reloadMcpServersInvokeMock.mockResolvedValue({});
    ensureRuntimeInvokeMock.mockResolvedValue({});
    refreshConversationCacheMock.mockResolvedValue(undefined);
    ensureBackendMcpCatalogMock.mockResolvedValue({
      userServers: [
        {
          id: 'user-enabled',
          name: 'unityMCP',
          enabled: true,
          transport: { type: 'http', url: 'http://localhost:8080/mcp' },
        },
      ],
      builtinServers: [
        {
          id: 'builtin-enabled',
          name: 'image-gen',
          enabled: true,
          transport: { type: 'stdio', command: 'image-server', args: [] },
        },
        {
          id: 'builtin-disabled',
          name: 'disabled',
          enabled: false,
          transport: { type: 'stdio', command: 'disabled-server', args: [] },
        },
      ],
      allServers: [
        {
          id: 'user-enabled',
          name: 'unityMCP',
          enabled: true,
          transport: { type: 'http', url: 'http://localhost:8080/mcp' },
        },
        {
          id: 'builtin-enabled',
          name: 'image-gen',
          enabled: true,
          builtin: true,
          transport: { type: 'stdio', command: 'image-server', args: [] },
        },
        {
          id: 'builtin-disabled',
          name: 'disabled',
          enabled: false,
          builtin: true,
          transport: { type: 'stdio', command: 'disabled-server', args: [] },
        },
      ],
    });
  });

  it('applies the selected AionUi MCP servers and rebuilds the existing runtime', async () => {
    const { result } = renderHook(() =>
      useReloadConversationMcpServers({
        conversationId: 'conv-1',
        currentMcpStatuses: [{ id: 'builtin-enabled', name: 'image-gen', status: 'loaded' }],
      })
    );

    await waitFor(() => expect(result.current.selectedMcpServerIds).toEqual(['builtin-enabled']));
    act(() => {
      result.current.toggleMcpServer('user-enabled');
    });

    await act(async () => {
      await result.current.reloadMcpServers();
    });

    expect(reloadMcpServersInvokeMock).toHaveBeenCalledWith({
      conversation_id: 'conv-1',
      sync_aionui_catalog: true,
      mcp_server_ids: ['user-enabled'],
      session_mcp_servers: [
        {
          id: 'builtin-enabled',
          name: 'image-gen',
          transport: { type: 'stdio', command: 'image-server', args: [] },
        },
      ],
    });
    expect(ensureRuntimeInvokeMock).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    expect(refreshConversationCacheMock).toHaveBeenCalledWith('conv-1');
    expect(messageMock.success).toHaveBeenCalledWith('conversation.mcp.reloadSuccess');
  });

  it('can clear every MCP from an existing conversation', async () => {
    const { result } = renderHook(() =>
      useReloadConversationMcpServers({
        conversationId: 'conv-1',
        currentMcpStatuses: [{ id: 'user-enabled', name: 'unityMCP', status: 'loaded' }],
      })
    );

    await waitFor(() => expect(result.current.selectedMcpServerIds).toEqual(['user-enabled']));
    act(() => {
      result.current.toggleMcpServer('user-enabled');
    });
    await act(async () => {
      await result.current.reloadMcpServers();
    });

    expect(reloadMcpServersInvokeMock).toHaveBeenCalledWith({
      conversation_id: 'conv-1',
      sync_aionui_catalog: true,
      mcp_server_ids: [],
      session_mcp_servers: [],
    });
  });

  it('does not load or apply MCP servers when selection is disabled', async () => {
    const { result } = renderHook(() =>
      useReloadConversationMcpServers({
        conversationId: 'conv-1',
        enabled: false,
      })
    );

    await waitFor(() => expect(result.current.isCatalogLoading).toBe(false));
    await act(async () => {
      await result.current.reloadMcpServers();
    });

    expect(ensureBackendMcpCatalogMock).not.toHaveBeenCalled();
    expect(reloadMcpServersInvokeMock).not.toHaveBeenCalled();
  });

  it('reports a reload failure without rebuilding the runtime', async () => {
    reloadMcpServersInvokeMock.mockRejectedValue(new Error('reload failed'));
    const { result } = renderHook(() =>
      useReloadConversationMcpServers({
        conversationId: 'conv-1',
      })
    );

    await act(async () => {
      await result.current.reloadMcpServers();
    });

    expect(ensureRuntimeInvokeMock).not.toHaveBeenCalled();
    expect(messageMock.error).toHaveBeenCalledWith('conversation.mcp.reloadFailed');
  });

  it('reports that AionCore must be rebuilt when the reload route is missing', async () => {
    reloadMcpServersInvokeMock.mockRejectedValue(
      new BackendHttpError({
        method: 'PUT',
        path: '/api/conversations/conv-1/mcp-servers',
        status: 404,
        body: { code: 'NOT_FOUND', error: 'Route not found.' },
      })
    );
    const { result } = renderHook(() =>
      useReloadConversationMcpServers({
        conversationId: 'conv-1',
      })
    );

    await act(async () => {
      await result.current.reloadMcpServers();
    });

    expect(ensureRuntimeInvokeMock).not.toHaveBeenCalled();
    expect(messageMock.error).toHaveBeenCalledWith('conversation.mcp.reloadBackendOutdated');
  });
});
