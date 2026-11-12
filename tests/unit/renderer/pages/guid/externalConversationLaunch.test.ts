/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  handleExternalConversationDeepLink,
  parseExternalConversationLaunch,
  readExternalConversationLaunch,
} from '@/renderer/services/externalConversationLaunch';
import type { NavigateFunction } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

function createNavigate(): { navigate: NavigateFunction; navigateMock: ReturnType<typeof vi.fn> } {
  const navigateMock = vi.fn();
  return {
    navigate: navigateMock as unknown as NavigateFunction,
    navigateMock,
  };
}

describe('external conversation launch payload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('normalizes valid launch data and filters invalid list entries', () => {
    const result = parseExternalConversationLaunch(
      JSON.stringify({
        agentId: '8e1acf31',
        completionUrl: 'http://127.0.0.1:4176/api/integrations/aionui/launches/token/conversation',
        title: ' 제품 로드맵:\n  제품 설계 ',
        prompt: 'Review this card',
        mcpIds: ['mind-mcp', 42],
        autoSend: true,
      })
    );

    expect(result).toMatchObject({
      agentId: '8e1acf31',
      autoSend: true,
      completionUrl: 'http://127.0.0.1:4176/api/integrations/aionui/launches/token/conversation',
      mcpIds: ['mind-mcp'],
      title: '제품 로드맵: 제품 설계',
    });
  });

  it('rejects malformed or incomplete launch payloads', () => {
    expect(parseExternalConversationLaunch('{invalid')).toBeNull();
    expect(parseExternalConversationLaunch(JSON.stringify({ agentId: 'codex' }))).toBeNull();
  });

  it('keeps the launch valid while discarding an unsafe completion URL', () => {
    const result = parseExternalConversationLaunch(
      JSON.stringify({
        agentId: '8e1acf31',
        completionUrl: 'https://example.com/callback',
        prompt: 'Review this card',
      })
    );

    expect(result?.agentId).toBe('8e1acf31');
    expect(result?.completionUrl).toBeUndefined();
  });

  it('routes a valid deep link through an isolated launch session and reports the created conversation', async () => {
    const { navigate, navigateMock } = createNavigate();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(
      handleExternalConversationDeepLink(
        {
          action: 'conversation/new',
          params: {
            payload: JSON.stringify({
              agentId: 'codex',
              completionUrl: 'http://localhost:4176/api/integrations/aionui/launches/token/conversation',
              prompt: 'Review this card',
              workspace: 'D:/workspace',
            }),
          },
        },
        navigate
      )
    ).toBe(true);

    const [route, options] = navigateMock.mock.calls[0] as [string, { state: Record<string, unknown> }];
    const session = readExternalConversationLaunch(new URL(route, 'http://localhost').search);
    expect(options.state).toMatchObject({
      prefillPrompt: 'Review this card',
      selectedAssistantId: 'bare:codex',
      workspace: 'D:/workspace',
    });
    expect(session?.launch.agentId).toBe('codex');

    await session?.onConversationCreated('conv-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4176/api/integrations/aionui/launches/token/conversation',
      expect.objectContaining({
        body: JSON.stringify({ conversationId: 'conv-1' }),
        method: 'POST',
      })
    );
    expect(readExternalConversationLaunch(new URL(route, 'http://localhost').search)).toBeNull();
  });

  it('ignores unrelated deep-link actions', () => {
    const { navigate, navigateMock } = createNavigate();

    expect(handleExternalConversationDeepLink({ action: 'navigate', params: {} }, navigate)).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('routes a desktop ticket to the server-backed launch flow without an inline prompt', () => {
    const { navigate, navigateMock } = createNavigate();
    const launchId = 'a'.repeat(64);
    handleExternalConversationDeepLink({ action: 'conversation/new', params: { launchId } }, navigate);
    expect(navigateMock).toHaveBeenCalledExactlyOnceWith(`/guid?external-launch=${launchId}`);
    expect(readExternalConversationLaunch(`?external-launch=${launchId}`)).toBeNull();
  });

  it.each(['', 'short', 'A'.repeat(64), '../conversation/other', 'a'.repeat(65)])(
    'rejects malformed tickets without falling back to the inline payload: %s',
    (launchId) => {
      const { navigate, navigateMock } = createNavigate();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      handleExternalConversationDeepLink(
        {
          action: 'conversation/new',
          params: { launchId, payload: JSON.stringify({ agentId: 'codex', prompt: 'ignored' }) },
        },
        navigate
      );
      expect(navigateMock).not.toHaveBeenCalled();
    }
  );
});
