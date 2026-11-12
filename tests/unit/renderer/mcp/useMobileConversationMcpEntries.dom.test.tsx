/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, renderHook } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reloadMcpServersMock, toggleMcpServerMock, useReloadConversationMcpServersMock } = vi.hoisted(() => ({
  reloadMcpServersMock: vi.fn(),
  toggleMcpServerMock: vi.fn(),
  useReloadConversationMcpServersMock: vi.fn(),
}));

vi.mock('@/renderer/hooks/mcp/useReloadConversationMcpServers', () => ({
  useReloadConversationMcpServers: useReloadConversationMcpServersMock,
}));

vi.mock('@icon-park/react', () => ({
  Shield: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { useMobileConversationMcpEntries } from '@/renderer/pages/conversation/hooks/useMobileConversationMcpEntries';

describe('useMobileConversationMcpEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReloadConversationMcpServersMock.mockReturnValue({
      availableMcpServers: [
        { id: 'mcp-loaded', name: 'Loaded MCP', enabled: true },
        { id: 'mcp-failed', name: 'Failed MCP', enabled: true },
      ],
      isCatalogLoading: false,
      isReloading: false,
      reloadMcpServers: reloadMcpServersMock,
      selectedMcpServerIds: ['mcp-loaded'],
      toggleMcpServer: toggleMcpServerMock,
    });
  });

  it('shows selectable MCP servers and an apply action on mobile', () => {
    const { result } = renderHook(() =>
      useMobileConversationMcpEntries({
        conversationId: 'conv-1',
        currentMcpStatuses: [
          { id: 'mcp-loaded', name: 'Loaded MCP', status: 'loaded' },
          { id: 'mcp-failed', name: 'Failed MCP', status: 'failed', reason: 'connection failed' },
        ],
        enabled: true,
      })
    );

    expect(result.current.map((entry) => entry.key)).toEqual(['mcp']);
    expect(result.current[0]?.submenu?.options).toEqual([
      { key: 'mcp-loaded', label: 'Loaded MCP', description: undefined, active: true },
      {
        key: 'mcp-failed',
        label: 'Failed MCP',
        description: 'conversation.mcp.status.failed · connection failed',
        active: false,
      },
    ]);
    expect(result.current[0]?.submenu).toEqual(
      expect.objectContaining({
        multiSelect: true,
        footer: expect.anything(),
      })
    );
  });

  it('uses the same selection and reload handlers as the desktop MCP panel', () => {
    const { result } = renderHook(() =>
      useMobileConversationMcpEntries({
        conversationId: 'conv-1',
        currentMcpStatuses: [],
        enabled: true,
      })
    );

    act(() => result.current[0]?.submenu?.onSelect('mcp-failed'));
    const { getByTestId } = render(result.current[0]?.submenu?.footer as React.ReactElement);
    fireEvent.click(getByTestId('mobile-action-sheet-mcp-reload'));

    expect(toggleMcpServerMock).toHaveBeenCalledWith('mcp-failed');
    expect(reloadMcpServersMock).toHaveBeenCalledTimes(1);
  });

  it('prevents reload while the MCP catalog is loading', () => {
    useReloadConversationMcpServersMock.mockReturnValue({
      availableMcpServers: [],
      isCatalogLoading: true,
      isReloading: false,
      reloadMcpServers: reloadMcpServersMock,
      selectedMcpServerIds: [],
      toggleMcpServer: toggleMcpServerMock,
    });
    const { result } = renderHook(() =>
      useMobileConversationMcpEntries({
        conversationId: 'conv-1',
        currentMcpStatuses: [],
        enabled: true,
      })
    );

    const { getByTestId } = render(result.current[0]?.submenu?.footer as React.ReactElement);
    const reloadButton = getByTestId('mobile-action-sheet-mcp-reload');
    fireEvent.click(reloadButton);

    expect(reloadButton).toBeDisabled();
    expect(reloadMcpServersMock).not.toHaveBeenCalled();
  });

  it('hides the entries and disables catalog access outside an editable mobile conversation', () => {
    const { result } = renderHook(() =>
      useMobileConversationMcpEntries({
        conversationId: 'conv-1',
        currentMcpStatuses: [],
        enabled: false,
      })
    );

    expect(result.current).toEqual([]);
    expect(useReloadConversationMcpServersMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      currentMcpStatuses: [],
      enabled: false,
    });
  });
});
