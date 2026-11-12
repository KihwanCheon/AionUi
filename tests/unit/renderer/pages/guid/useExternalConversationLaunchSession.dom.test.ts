/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, waitFor } from '@testing-library/react';
import React, { StrictMode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useExternalConversationLaunchSession } from '@/renderer/pages/guid/hooks/useExternalConversationLaunchSession';
import { handleExternalConversationDeepLink } from '@/renderer/services/externalConversationLaunch';
import type { NavigateFunction } from 'react-router-dom';

const { httpRequestMock } = vi.hoisted(() => ({
  httpRequestMock: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: (...args: unknown[]) => httpRequestMock(...args),
  isBackendHttpError: (error: unknown) =>
    Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'BackendHttpError'),
}));

const strictModeWrapper: React.FC<React.PropsWithChildren> = ({ children }) =>
  React.createElement(
    MemoryRouter,
    { initialEntries: ['/guid?external-launch=web-launch-strict'] },
    React.createElement(StrictMode, null, children)
  );

function routerWrapper(entry: string): React.FC<React.PropsWithChildren> {
  return ({ children }) => React.createElement(MemoryRouter, { initialEntries: [entry] }, children);
}

describe('useExternalConversationLaunchSession', () => {
  afterEach(() => {
    httpRequestMock.mockReset();
  });

  it('claims a WebUI launch once under StrictMode and completes it through AionCore', async () => {
    httpRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path.endsWith('/claim')) {
        return {
          launch: {
            agentId: 'codex',
            prompt: 'Review this card',
            thoughtLevel: 'high',
            autoSend: true,
          },
          expiresAt: '2026-08-04T12:05:00.000Z',
        };
      }
      return { callbackStatus: 'delivered' };
    });
    const onCallbackPending = vi.fn();

    const { result } = renderHook(
      () => ({
        launchState: useExternalConversationLaunchSession(onCallbackPending),
        location: useLocation(),
      }),
      { wrapper: strictModeWrapper }
    );

    await waitFor(() => expect(result.current.launchState.session?.source).toBe('web'));
    await waitFor(() =>
      expect(result.current.location.state).toMatchObject({
        prefillPrompt: 'Review this card',
        selectedAssistantId: 'bare:codex',
      })
    );
    expect(httpRequestMock.mock.calls.filter((call) => call[1].endsWith('/claim'))).toHaveLength(1);

    await result.current.launchState.session?.onConversationCreated('conv-1');

    expect(httpRequestMock).toHaveBeenCalledWith('POST', '/api/external-conversation-launches/complete', {
      conversationId: 'conv-1',
      launchId: 'web-launch-strict',
    });
    expect(onCallbackPending).not.toHaveBeenCalled();
  });

  it('maps an expired launch to a stable user-facing state', async () => {
    httpRequestMock.mockRejectedValue({
      name: 'BackendHttpError',
      status: 404,
      code: 'EXTERNAL_LAUNCH_NOT_FOUND_OR_EXPIRED',
    });

    const onCallbackPending = vi.fn();
    const { result } = renderHook(() => useExternalConversationLaunchSession(onCallbackPending), {
      wrapper: routerWrapper('/guid?external-launch=web-launch-expired'),
    });

    await waitFor(() => expect(result.current.error).toBe('not-found-or-expired'));
    expect(result.current.loading).toBe(false);
    expect(result.current.session).toBeNull();
  });

  it('claims the full multibyte prompt from a short desktop link without losing execution options', async () => {
    const launchId = 'b'.repeat(64);
    const prompt = '승인 범위와 제외 사항 및 사용자 추가 요청입니다.\n'.repeat(1000);
    const launch = {
      agentId: 'codex',
      prompt,
      modelId: 'selected-model',
      thoughtLevel: 'xhigh',
      mode: 'full-access',
      workspace: 'C:/selected/project',
      mcpIds: ['mnp', 'unity', 'dooray', 'pptx'],
      autoSend: true,
    };
    httpRequestMock.mockResolvedValueOnce({ launch, expiresAt: '2099-01-01T00:00:00.000Z' });
    const navigate = vi.fn();
    const onCallbackPending = vi.fn();
    handleExternalConversationDeepLink(
      { action: 'conversation/new', params: { launchId } },
      navigate as NavigateFunction
    );
    const { result } = renderHook(() => useExternalConversationLaunchSession(onCallbackPending), {
      wrapper: routerWrapper(navigate.mock.calls[0][0] as string),
    });
    await waitFor(() => expect(result.current.session?.launch).toMatchObject(launch));
    expect(navigate.mock.calls[0][0].length).toBeLessThan(128);
    expect(httpRequestMock).toHaveBeenCalledExactlyOnceWith(
      'POST',
      '/api/external-conversation-launches/claim',
      { launchId },
      { silentStatuses: [404, 409] }
    );
  });

  it('reports a pending server-side completion callback without failing conversation creation', async () => {
    httpRequestMock
      .mockResolvedValueOnce({
        launch: { agentId: 'claude', prompt: 'Start work', autoSend: true },
        expiresAt: '2026-08-04T12:05:00.000Z',
      })
      .mockResolvedValueOnce({ callbackStatus: 'pending' });
    const onCallbackPending = vi.fn();

    const { result } = renderHook(() => useExternalConversationLaunchSession(onCallbackPending), {
      wrapper: routerWrapper('/guid?external-launch=web-launch-pending'),
    });
    await waitFor(() => expect(result.current.session).not.toBeNull());

    await result.current.session?.onConversationCreated('conv-2');

    expect(onCallbackPending).toHaveBeenCalledTimes(1);
  });

  it('does not replay cached launch data after creation when completion delivery is pending', async () => {
    const launchId = 'callback-pending-no-replay';
    const onCallbackPending = vi.fn();
    httpRequestMock
      .mockResolvedValueOnce({
        launch: { agentId: 'codex', prompt: 'Start work', autoSend: true },
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
      .mockResolvedValueOnce({ callbackStatus: 'pending' })
      .mockRejectedValueOnce({ name: 'BackendHttpError', status: 409, code: 'EXTERNAL_LAUNCH_ALREADY_CLAIMED' });
    const first = renderHook(() => useExternalConversationLaunchSession(onCallbackPending), {
      wrapper: routerWrapper(`/guid?external-launch=${launchId}`),
    });
    await waitFor(() => expect(first.result.current.session).not.toBeNull());
    await first.result.current.session?.onConversationCreated('already-created');
    first.unmount();
    const next = renderHook(() => useExternalConversationLaunchSession(onCallbackPending), {
      wrapper: routerWrapper(`/guid?external-launch=${launchId}`),
    });
    await waitFor(() => expect(next.result.current.error).toBe('already-used'));
    expect(next.result.current.session).toBeNull();
  });
});
