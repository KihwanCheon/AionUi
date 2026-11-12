/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import type { IMcpServer } from '@/common/config/storage';
import type { ExternalConversationLaunchSession } from '@/renderer/services/externalConversationLaunch';
import { useExternalConversationLaunch } from '@/renderer/pages/guid/hooks/useExternalConversationLaunch';
import type { GuidAssistantSelectionResult } from '@/renderer/pages/guid/hooks/useGuidAssistantSelection';
import type { GuidModelSelectionResult } from '@/renderer/pages/guid/hooks/useGuidModelSelection';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createConversationInvokeMock, updateConversationInvokeMock, swrMutateMock } = vi.hoisted(() => ({
  createConversationInvokeMock: vi.fn(),
  updateConversationInvokeMock: vi.fn(),
  swrMutateMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      create: {
        invoke: (...args: unknown[]) => createConversationInvokeMock(...args),
      },
      update: {
        invoke: (...args: unknown[]) => updateConversationInvokeMock(...args),
      },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: vi.fn(),
  },
}));

vi.mock('swr', () => ({
  mutate: (...args: unknown[]) => swrMutateMock(...args),
}));

vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({
  updateWorkspaceTime: vi.fn(),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

function createAgentSelection(): GuidAssistantSelectionResult {
  return {
    assistants: [],
    currentAcpCachedModelInfo: {
      current_model_id: 'gpt-5.6-sol',
      current_model_label: 'GPT-5.6-Sol',
      available_models: [{ id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' }],
    },
    currentAgentAvailableCommands: [],
    currentAgentModeOptions: [{ label: 'Agent', value: 'agent' }],
    currentThoughtLevelOption: {
      category: 'thought_level',
      currentValue: 'high',
      id: 'reasoning_effort',
      options: [{ label: 'high', value: 'high' }],
    },
    defaultAssistantId: null,
    selectedAcpModel: 'gpt-5.6-sol',
    selectedAssistant: undefined,
    selectedAssistantAvailable: true,
    selectedAssistantBackend: 'codex',
    selectedAssistantId: 'bare:codex',
    selectedMode: 'agent',
    selectedThoughtLevelValue: 'high',
    setSelectedAcpModel: vi.fn(),
    setSelectedAssistantId: vi.fn(),
    setSelectedMode: vi.fn(),
    setSelectedThoughtLevelValue: vi.fn(),
  };
}

function createModelSelection(): GuidModelSelectionResult {
  return {
    current_model: undefined,
    formatGeminiModelLabel: vi.fn(() => ''),
    isGoogleAuth: false,
    modelList: [],
    resetCurrentModel: vi.fn(async () => {}),
    setCurrentModel: vi.fn(async () => {}),
  };
}

function createSession(modelId = 'gpt-5.6-sol'): ExternalConversationLaunchSession {
  return {
    launch: {
      agentId: 'codex',
      autoSend: true,
      mode: 'agent',
      modelId,
      prompt: 'Review this card',
      thoughtLevel: 'high',
    },
    onConversationCreated: vi.fn(async () => {}),
    token: 'launch-1',
  };
}

const createGuidSendDeps = (): GuidSendDeps => ({
  input: 'hello',
  setInput: vi.fn(),
  files: [],
  setFiles: vi.fn(),
  dir: '',
  setDir: vi.fn(),
  setLoading: vi.fn(),
  loading: false,
  selectedAssistantId: 'assistant-1',
  selectedAssistantBackend: 'claude',
  selectedMode: 'bypassPermissions',
  selectedAcpModel: 'claude-opus',
  currentAcpCachedModelInfo: null,
  current_model: undefined,
  guidDisabledBuiltinSkills: undefined,
  guidEnabledSkills: undefined,
  assistantDefaultSkillIds: undefined,
  assistantDefaultDisabledBuiltinSkillIds: undefined,
  availableMcpServers: [{ id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer],
  selectedMcpServerIds: ['mcp-user'],
  assistantDefaultMcpIds: undefined,
  isGoogleAuth: false,
  setMentionOpen: vi.fn(),
  setMentionQuery: vi.fn(),
  setMentionSelectorOpen: vi.fn(),
  setMentionActiveIndex: vi.fn(),
  navigate: vi.fn(() => Promise.resolve()) as never,
  t: vi.fn((key: string, options?: { defaultValue?: string }) => options?.defaultValue || key) as never,
  localeKey: 'zh-CN',
});

describe('useExternalConversationLaunch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies available runtime options before automatically sending', async () => {
    const agentSelection = {
      ...createAgentSelection(),
      selectedAcpModel: null,
      selectedMode: '',
      selectedThoughtLevelValue: '',
    };
    const modelSelection = createModelSelection();
    const sendMessage = vi.fn();

    const { rerender } = renderHook(
      (selection) =>
        useExternalConversationLaunch({
          agentSelection: selection,
          allSkills: [],
          availableMcpServers: [],
          input: 'Review this card',
          modelSelection,
          sendMessage,
          session: createSession(),
          setDisabledBuiltinSkills: vi.fn(),
          setEnabledSkills: vi.fn(),
          setSelectedMcpServerIds: vi.fn(),
        }),
      { initialProps: agentSelection as GuidAssistantSelectionResult }
    );

    await waitFor(() => {
      expect(agentSelection.setSelectedAcpModel).toHaveBeenCalledWith('gpt-5.6-sol', {
        persistPreference: false,
      });
      expect(agentSelection.setSelectedMode).toHaveBeenCalledWith('agent', { persistPreference: false });
      expect(agentSelection.setSelectedThoughtLevelValue).toHaveBeenCalledWith('high', {
        persistPreference: false,
      });
    });
    expect(sendMessage).not.toHaveBeenCalled();
    rerender(createAgentSelection());
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
  });

  it.each([{ selectedAcpModel: 'stale-model' }, { selectedMode: 'stale-mode' }, { selectedThoughtLevelValue: 'max' }])(
    'does not consume a launch ticket while the applied options differ: %j',
    async (staleSelection) => {
      const sendMessage = vi.fn();
      const session = {
        ...createSession(),
        source: 'web' as const,
        token: `stale-options-${Object.keys(staleSelection)[0]}`,
      };
      const options = {
        agentSelection: { ...createAgentSelection(), ...staleSelection },
        modelSelection: createModelSelection(),
        allSkills: [],
        availableMcpServers: [],
        input: 'Review this card',
        sendMessage,
        session,
        setDisabledBuiltinSkills: vi.fn(),
        setEnabledSkills: vi.fn(),
        setSelectedMcpServerIds: vi.fn(),
      };
      const { rerender } = renderHook(
        (selection) => useExternalConversationLaunch({ ...options, agentSelection: selection }),
        { initialProps: options.agentSelection }
      );
      expect(sendMessage).not.toHaveBeenCalled();

      rerender(createAgentSelection());
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      rerender(createAgentSelection());
      expect(sendMessage).toHaveBeenCalledTimes(1);
    }
  );

  it('waits for the requested Aion CLI provider and model before sending', async () => {
    const sendMessage = vi.fn();
    const agentSelection = { ...createAgentSelection(), selectedAssistantBackend: 'aionrs' };
    const provider = { id: 'requested-provider', models: ['gpt-5.6-sol'], use_model: 'gpt-5.6-sol' };
    const modelSelection = {
      ...createModelSelection(),
      modelList: [provider],
      current_model: { ...provider, id: 'other-provider' },
    } as GuidModelSelectionResult;
    const session = createSession();
    session.launch.providerId = provider.id;
    const { rerender } = renderHook(
      (selection) =>
        useExternalConversationLaunch({
          agentSelection,
          modelSelection: selection,
          allSkills: [],
          availableMcpServers: [],
          input: 'Review this card',
          sendMessage,
          session,
          setDisabledBuiltinSkills: vi.fn(),
          setEnabledSkills: vi.fn(),
          setSelectedMcpServerIds: vi.fn(),
        }),
      { initialProps: modelSelection }
    );
    await act(async () => {});
    expect(sendMessage).not.toHaveBeenCalled();

    rerender({ ...modelSelection, current_model: provider } as GuidModelSelectionResult);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
  });

  it('reports options that never match instead of sending with another thought level', async () => {
    vi.useFakeTimers();
    const onUnavailable = vi.fn();
    const sendMessage = vi.fn();
    renderHook(() =>
      useExternalConversationLaunch({
        agentSelection: { ...createAgentSelection(), selectedThoughtLevelValue: 'max' },
        modelSelection: createModelSelection(),
        allSkills: [],
        availableMcpServers: [],
        input: 'Review this card',
        sendMessage,
        onUnavailable,
        session: createSession(),
        setDisabledBuiltinSkills: vi.fn(),
        setEnabledSkills: vi.fn(),
        setSelectedMcpServerIds: vi.fn(),
      })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('waits without sending when a requested model is unavailable', async () => {
    const agentSelection = createAgentSelection();
    const modelSelection = createModelSelection();
    const sendMessage = vi.fn();

    renderHook(() =>
      useExternalConversationLaunch({
        agentSelection,
        allSkills: [],
        availableMcpServers: [],
        input: 'Review this card',
        modelSelection,
        sendMessage,
        session: createSession('missing-model'),
        setDisabledBuiltinSkills: vi.fn(),
        setEnabledSkills: vi.fn(),
        setSelectedMcpServerIds: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(agentSelection.setSelectedAcpModel).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  it('does not auto-send the same ticket again when reopened before creation confirmation', async () => {
    const sendMessage = vi.fn();
    const session = { ...createSession(), source: 'web' as const, token: 'pending-desktop-ticket' };
    const options = {
      agentSelection: createAgentSelection(),
      modelSelection: createModelSelection(),
      allSkills: [],
      availableMcpServers: [],
      input: 'Review this card',
      sendMessage,
      session,
      setDisabledBuiltinSkills: vi.fn(),
      setEnabledSkills: vi.fn(),
      setSelectedMcpServerIds: vi.fn(),
    };
    const first = renderHook(() => useExternalConversationLaunch(options));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    first.unmount();
    renderHook(() => useExternalConversationLaunch(options));
    await act(async () => {});
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('reports requested options that remain unavailable', async () => {
    vi.useFakeTimers();
    const onUnavailable = vi.fn();

    renderHook(() =>
      useExternalConversationLaunch({
        agentSelection: createAgentSelection(),
        allSkills: [],
        availableMcpServers: [],
        input: 'Review this card',
        modelSelection: createModelSelection(),
        onUnavailable,
        sendMessage: vi.fn(),
        session: createSession('missing-model'),
        setDisabledBuiltinSkills: vi.fn(),
        setEnabledSkills: vi.fn(),
        setSelectedMcpServerIds: vi.fn(),
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('useGuidSend external launch integration', () => {
  beforeEach(() => {
    createConversationInvokeMock.mockReset();
    createConversationInvokeMock.mockResolvedValue({ id: 'conv-1' });
    updateConversationInvokeMock.mockReset();
    updateConversationInvokeMock.mockResolvedValue(true);
    swrMutateMock.mockReset();
    swrMutateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the requested thought level to the conversation creation API', async () => {
    const deps = {
      ...createGuidSendDeps(),
      selectedAcpModel: 'opus',
      selectedMode: 'acceptEdits',
      selectedThoughtLevelValue: 'xhigh',
    };
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      await result.current.handleSend();
    });
    expect(createConversationInvokeMock.mock.calls[0][0].assistant.conversation_overrides).toMatchObject({
      model: 'opus',
      permission: 'acceptEdits',
      thought_level: 'xhigh',
    });
  });

  it('uses an external title for an ACP conversation while retaining the prompt as the initial message', async () => {
    const deps = createGuidSendDeps();
    deps.input = '# MindNProgress 작업 요청';
    deps.conversationName = '제품 로드맵: 제품 설계';

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    const initialMessage = JSON.parse(sessionStorage.getItem('acp_initial_message_conv-1') ?? '{}');
    expect(payload.name).toBe('제품 로드맵: 제품 설계');
    expect(updateConversationInvokeMock).toHaveBeenCalledWith({
      id: 'conv-1',
      updates: { name: '제품 로드맵: 제품 설계', name_source: 'user' },
    });
    expect(initialMessage.input).toBe('# MindNProgress 작업 요청');
  });

  it('notifies a conversation-created observer after creating an ACP conversation', async () => {
    const deps = createGuidSendDeps();
    deps.onConversationCreated = vi.fn();

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(deps.onConversationCreated).toHaveBeenCalledWith('conv-1');
  });

  it('uses an external title for an Aion CLI conversation', async () => {
    const deps = createGuidSendDeps();
    deps.conversationName = '제품 로드맵: 제품 설계';
    deps.selectedAssistantId = 'bare:aionrs';
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { provider_id: 'openai', model: 'gpt-5', use_model: 'gpt-5' } as never;

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(createConversationInvokeMock.mock.calls[0][0].name).toBe('제품 로드맵: 제품 설계');
    expect(updateConversationInvokeMock).toHaveBeenCalledWith({
      id: 'conv-1',
      updates: { name: '제품 로드맵: 제품 설계', name_source: 'user' },
    });
  });

  it('continues opening an Aion CLI conversation when the conversation-created observer fails', async () => {
    const deps = createGuidSendDeps();
    deps.onConversationCreated = vi.fn().mockRejectedValue(new Error('offline'));
    deps.selectedAssistantId = 'bare:aionrs';
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { provider_id: 'openai', model: 'gpt-5', use_model: 'gpt-5' } as never;
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(deps.navigate).toHaveBeenCalledWith('/conversation/conv-1');
  });

  it('falls back to the prompt when an external title is blank', async () => {
    const deps = createGuidSendDeps();
    deps.conversationName = '   ';

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(createConversationInvokeMock.mock.calls[0][0].name).toBe('hello');
    expect(updateConversationInvokeMock).not.toHaveBeenCalled();
  });

  it('stops an external launch when its card title cannot be protected', async () => {
    const deps = createGuidSendDeps();
    deps.conversationName = '제품 로드맵: 제품 설계';
    deps.onConversationCreated = vi.fn();
    updateConversationInvokeMock.mockResolvedValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await expect(result.current.handleSend()).rejects.toThrow('conversation.createFailed');
    });

    expect(deps.onConversationCreated).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });
});
