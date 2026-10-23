/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutContext } from '@/renderer/hooks/context/LayoutContext';

const originalMatchMedia = window.matchMedia;
const desktopElectronApi = window.electronAPI;

const useTouchWebEnvironment = (): void => {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined, writable: true });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
    writable: true,
  });
};

afterEach(() => {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: desktopElectronApi, writable: true });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia, writable: true });
});

const {
  modelSelectionMock,
  agentSelectionMock,
  locationMock,
  guidInputMock,
  capturedGuidActionRowProps,
  capturedAssistantSelectionAreaProps,
  capturedGuidInputCardProps,
  capturedGuidSendDeps,
  resolveGuidAssistantDefaultsMock,
  listAvailableSkillsInvokeMock,
  sendMock,
  navigateMock,
} = vi.hoisted(() => ({
  modelSelectionMock: {
    modelList: [],
    isGoogleAuth: false,
    current_model: undefined,
    setCurrentModel: vi.fn(),
    resetCurrentModel: vi.fn(),
  },
  agentSelectionMock: {
    selectedAssistantId: 'bare-aionrs',
    selectedAssistant: {
      id: 'bare-aionrs',
      source: 'generated',
      name: 'Aion CLI',
      name_i18n: {},
      description_i18n: {},
      enabled: true,
      sort_order: 10,
      preset_agent_type: 'aionrs',
      enabled_skills: [],
      custom_skill_names: [],
      disabled_builtin_skills: [],
      context_i18n: {},
      prompts: [],
      prompts_i18n: {},
      models: [],
      agent_status: 'online',
      team_selectable: true,
      deletable: false,
    },
    assistants: [
      {
        id: 'bare-aionrs',
        source: 'generated',
        name: 'Aion CLI',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 10,
        preset_agent_type: 'aionrs',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        agent_status: 'online',
        team_selectable: true,
        deletable: false,
      },
    ],
    selectedAssistantBackend: 'aionrs',
    selectedAssistantAvailable: true,
    selectedMode: 'default',
    setSelectedMode: vi.fn(),
    selectedAcpModel: null,
    setSelectedAcpModel: vi.fn(),
    currentAcpCachedModelInfo: null,
    defaultAssistantId: 'bare-aionrs',
    setSelectedAssistantId: vi.fn(),
  },
  guidInputMock: {
    input: '',
    setInput: vi.fn(),
    files: [],
    setFiles: vi.fn(),
    dir: '',
    setDir: vi.fn(),
    loading: false,
    setLoading: vi.fn(),
    isInputFocused: false,
    isFileDragging: false,
    dragHandlers: {},
    onPaste: vi.fn(),
    handleTextareaFocus: vi.fn(),
    handleTextareaBlur: vi.fn(),
    handleFilesUploaded: vi.fn(),
    handleRemoveFile: vi.fn(),
  },
  locationMock: {
    state: null as unknown,
    key: 'guid-location',
    pathname: '/guid',
    search: '',
    hash: '',
  },
  capturedGuidActionRowProps: [] as Array<Record<string, unknown>>,
  capturedAssistantSelectionAreaProps: [] as Array<Record<string, unknown>>,
  capturedGuidInputCardProps: [] as Array<Record<string, unknown>>,
  capturedGuidSendDeps: [] as Array<Record<string, unknown>>,
  resolveGuidAssistantDefaultsMock: vi.fn(() => ({
    disabledBuiltinSkillIds: [],
    skillIds: [],
    mcpIds: [],
  })),
  listAvailableSkillsInvokeMock: vi.fn().mockResolvedValue([]),
  sendMock: {
    handleSend: vi.fn(),
    sendMessageHandler: vi.fn(),
    isButtonDisabled: false,
  },
  navigateMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; [key: string]: unknown }) => options?.defaultValue || key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => locationMock,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: listAvailableSkillsInvokeMock },
    },
  },
}));

vi.mock('@/renderer/hooks/mcp/catalog', () => ({
  ensureBackendMcpCatalog: vi.fn().mockResolvedValue({ allServers: [] }),
}));

vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({
    activeBorderColor: '#000',
    inactiveBorderColor: '#ccc',
    activeShadow: 'none',
  }),
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({
  useGuidModelSelection: () => modelSelectionMock,
}));

const useGuidAssistantSelectionMock = vi.fn(() => agentSelectionMock);

vi.mock('@/renderer/pages/guid/hooks/useGuidAssistantSelection', () => ({
  useGuidAssistantSelection: (...args: unknown[]) => useGuidAssistantSelectionMock(...args),
  resolveAssistantSelectionKey: vi.fn(),
  pickDefaultAssistantSelectionKey: vi.fn(),
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidInput', () => ({
  useGuidInput: () => guidInputMock,
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidSend', () => ({
  useGuidSend: (deps: Record<string, unknown>) => {
    capturedGuidSendDeps.push(deps);
    return sendMock;
  },
}));

vi.mock('@/renderer/pages/guid/hooks/useTypewriterPlaceholder', () => ({
  useTypewriterPlaceholder: () => '',
}));

vi.mock('@/renderer/pages/guid/components/AssistantSelectionArea', () => ({
  default: (props: Record<string, unknown>) => {
    capturedAssistantSelectionAreaProps.push(props);
    return <div data-testid='assistant-selection-area' />;
  },
}));

vi.mock('@/renderer/pages/guid/components/GuidActionRow', () => ({
  default: (props: Record<string, unknown>) => {
    capturedGuidActionRowProps.push(props);
    return <div data-testid='guid-action-row' />;
  },
}));

vi.mock('@/renderer/pages/guid/components/GuidInputCard', () => ({
  default: (props: Record<string, unknown>) => {
    capturedGuidInputCardProps.push(props);
    return <div data-testid='guid-input-card'>{props.actionRow as React.ReactNode}</div>;
  },
}));

vi.mock('@/renderer/pages/guid/components/GuidModelSelector', () => ({
  default: () => <div data-testid='guid-model-selector' />,
}));

vi.mock('@/renderer/pages/guid/components/QuickActionButtons', () => ({
  default: () => <div data-testid='guid-quick-actions' />,
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/FeedbackReportModal', () => ({
  default: () => null,
}));

vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({
  default: () => null,
}));

vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', () => ({
  useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
}));

vi.mock('@/renderer/hooks/system/useSpeechInput', () => ({
  appendSpeechTranscript: (prev: string, next: string) => `${prev}${next}`,
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => Boolean(window.electronAPI),
  openExternalUrl: vi.fn(),
  resolveExtensionAssetUrl: vi.fn(),
  resolveBackendAssetUrl: vi.fn((path: string) => path),
}));

vi.mock('@/renderer/pages/guid/utils/assistantDefaults', () => ({
  resolveGuidAssistantDefaults: (...args: unknown[]) => resolveGuidAssistantDefaultsMock(...args),
}));

const swrMock = vi.hoisted(() => ({
  useSWRMock: vi.fn(),
}));

const assistantDetailFixture = {
  prompts: {
    recommended: [],
    recommended_i18n: {
      'en-US': [
        'Create a three-page financial dashboard with profit, revenue mix, and conditional formatting highlights',
      ],
    },
  },
  defaults: {
    model: { mode: 'auto' },
    permission: { mode: 'auto' },
    skills: { mode: 'auto', value: [] },
    mcps: { mode: 'auto', value: [] },
  },
  preferences: {
    last_model_id: null,
    last_permission_value: null,
    last_skill_ids: [],
    last_disabled_builtin_skill_ids: [],
    last_mcp_ids: [],
  },
};

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return {
    ...actual,
    default: swrMock.useSWRMock,
    mutate: vi.fn(),
  };
});

import GuidPage from '@/renderer/pages/guid/GuidPage';

const guidInputCardProps = {
  input: 'Existing Guid draft\nCreate with /cron in AionUi',
  onInputChange: vi.fn(),
  onKeyDown: vi.fn(),
  onPaste: vi.fn(),
  onFocus: vi.fn(),
  onBlur: vi.fn(),
  placeholder: 'Message',
  isInputActive: false,
  isFileDragging: false,
  activeBorderColor: 'var(--color-primary-6)',
  inactiveBorderColor: 'var(--color-border-2)',
  activeShadow: 'none',
  dragHandlers: {},
  files: [],
  onRemoveFile: vi.fn(),
  actionRow: null,
  workspaceDir: '',
  onSelectWorkspace: vi.fn(),
  onClearWorkspace: vi.fn(),
};

describe('GuidPage', () => {
  beforeEach(() => {
    locationMock.state = null;
    locationMock.key = 'guid-location';
    navigateMock.mockReset();
    swrMock.useSWRMock.mockReturnValue({ data: null });
    capturedGuidActionRowProps.length = 0;
    capturedAssistantSelectionAreaProps.length = 0;
    capturedGuidInputCardProps.length = 0;
    capturedGuidSendDeps.length = 0;
    listAvailableSkillsInvokeMock.mockReset();
    listAvailableSkillsInvokeMock.mockResolvedValue([]);
    useGuidAssistantSelectionMock.mockClear();
    resolveGuidAssistantDefaultsMock.mockReturnValue({
      disabledBuiltinSkillIds: [],
      skillIds: [],
      mcpIds: [],
    });
    modelSelectionMock.modelList = [];
    modelSelectionMock.setCurrentModel.mockReset();
    modelSelectionMock.resetCurrentModel.mockReset();
    agentSelectionMock.currentAgentModeOptions = [];
    agentSelectionMock.currentAcpCachedModelInfo = null;
    agentSelectionMock.selectedAssistantBackend = 'aionrs';
    agentSelectionMock.setSelectedAcpModel.mockReset();
    agentSelectionMock.setSelectedMode.mockReset();
    agentSelectionMock.assistants = [
      {
        id: 'bare-aionrs',
        source: 'generated',
        name: 'Aion CLI',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 10,
        preset_agent_type: 'aionrs',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        agent_status: 'online',
        team_selectable: true,
        deletable: false,
      },
    ];
  });

  it('keeps the existing replace contract for ordinary Guid prefills', () => {
    locationMock.state = { prefillPrompt: 'Replace with this prompt' };
    guidInputMock.setInput.mockClear();
    guidInputMock.setFiles.mockClear();
    guidInputMock.setDir.mockClear();

    render(<GuidPage />);

    expect(guidInputMock.setInput).toHaveBeenCalledWith('Replace with this prompt');
    expect(guidInputMock.setFiles).toHaveBeenCalledWith([]);
    expect(guidInputMock.setDir).toHaveBeenCalledWith('');
    expect(capturedGuidInputCardProps.at(-1)?.focusRequestKey).toBeUndefined();
  });

  it('keeps replacing attachments supplied by an ordinary Guid prefill', () => {
    locationMock.state = {
      prefillPrompt: 'Replace prompt and attachments',
      prefillFiles: ['/tmp/one.png', '/tmp/two.png'],
    };
    guidInputMock.setFiles.mockClear();

    render(<GuidPage />);

    // Prefill attachments carry no source tag → seeded as `upload` refs.
    expect(guidInputMock.setFiles).toHaveBeenCalledWith([
      { kind: 'upload', path: '/tmp/one.png' },
      { kind: 'upload', path: '/tmp/two.png' },
    ]);
  });

  it('appends a draft-preserving prefill without clearing attachments or workspace', () => {
    locationMock.state = {
      prefillPrompt: 'Create with /cron in AionUi',
      preservePrefillDraft: true,
      focusPrefill: true,
      returnTo: 'conversation-sidebar',
    };
    guidInputMock.setInput.mockClear();
    guidInputMock.setFiles.mockClear();
    guidInputMock.setDir.mockClear();

    const { rerender, unmount } = render(<GuidPage />);

    const inputUpdater = guidInputMock.setInput.mock.calls[0]?.[0];
    expect(inputUpdater).toBeTypeOf('function');
    expect(inputUpdater('Existing Guid draft')).toBe('Existing Guid draft\nCreate with /cron in AionUi');
    expect(guidInputMock.setFiles).not.toHaveBeenCalled();
    expect(guidInputMock.setDir).not.toHaveBeenCalled();
    expect(capturedGuidInputCardProps.at(-1)?.focusRequestKey).toBe('guid-location');
    expect(navigateMock).toHaveBeenCalledWith('/guid', {
      replace: true,
      state: { returnTo: 'conversation-sidebar' },
    });

    locationMock.state = { returnTo: 'conversation-sidebar' };
    locationMock.key = 'guid-location-replaced';
    rerender(<GuidPage />);
    expect(guidInputMock.setInput).toHaveBeenCalledOnce();
    expect(guidInputMock.setDir).not.toHaveBeenCalled();

    unmount();
    guidInputMock.setInput.mockClear();
    render(<GuidPage />);
    expect(guidInputMock.setInput).toHaveBeenCalledWith('');
    expect(guidInputMock.setInput.mock.calls.some(([value]) => typeof value === 'function')).toBe(false);
  });

  it('removes a consumed preserved prefill even when no other navigation state remains', () => {
    locationMock.state = {
      prefillPrompt: 'Create with /cron in AionUi',
      preservePrefillDraft: true,
      focusPrefill: true,
    };

    render(<GuidPage />);

    expect(navigateMock).toHaveBeenCalledWith('/guid', { replace: true, state: null });
  });

  it('keeps a generic conversation heading and omits assistant-detail chrome on the home page', () => {
    render(<GuidPage />);

    expect(screen.queryByLabelText('common.back')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Assistant Details')).not.toBeInTheDocument();
    expect(screen.getByText('conversation.welcome.title')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-selection-area')).toBeInTheDocument();
    const latestAssistantSelectionAreaProps = capturedAssistantSelectionAreaProps.at(-1);
    const latestGuidActionRowProps = capturedGuidActionRowProps.at(-1);
    const latestGuidInputCardProps = capturedGuidInputCardProps.at(-1);

    expect(capturedAssistantSelectionAreaProps.length).toBeGreaterThan(0);
    expect(latestAssistantSelectionAreaProps).not.toHaveProperty('is_presetAgent');
    expect(latestAssistantSelectionAreaProps).not.toHaveProperty('selectedAgentInfo');
    expect(capturedGuidActionRowProps.length).toBeGreaterThan(0);
    expect(latestGuidActionRowProps).not.toHaveProperty('hidePresetTag');
    expect(latestGuidActionRowProps).not.toHaveProperty('is_presetAgent');
    expect(latestGuidActionRowProps).not.toHaveProperty('selectedAgent');
    expect(latestGuidActionRowProps).not.toHaveProperty('selectedAgentInfo');
    expect(latestGuidActionRowProps).not.toHaveProperty('onClosePresetTag');
    expect(capturedGuidInputCardProps.length).toBeGreaterThan(0);
    expect(latestGuidInputCardProps).not.toHaveProperty('mentionOpen');
    expect(latestGuidInputCardProps).not.toHaveProperty('mentionSelectorBadge');
    expect(latestGuidInputCardProps).not.toHaveProperty('mentionDropdown');
  });

  it('ignores legacy selectedAgentKey navigation state when preselecting an assistant', () => {
    locationMock.state = {
      selectedAgentKey: 'bare:claude',
    };

    render(<GuidPage />);

    expect(useGuidAssistantSelectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        preselectAssistantId: undefined,
      })
    );
  });

  it('renders example prompts with wrapping text for long assistant suggestions', () => {
    agentSelectionMock.assistants = [
      {
        id: 'bare-aionrs',
        source: 'generated',
        name: 'Aion CLI',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 10,
        preset_agent_type: 'aionrs',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {
          'en-US': [
            'Create a three-page financial dashboard with profit, revenue mix, and conditional formatting highlights',
          ],
        },
        models: [],
        agent_status: 'online',
        team_selectable: true,
        deletable: false,
      },
    ];

    swrMock.useSWRMock.mockImplementation((key: string | null) => {
      if (key?.startsWith('guid.assistant.detail.')) {
        return {
          data: assistantDetailFixture,
        };
      }
      return { data: null };
    });

    render(<GuidPage />);

    const promptButton = screen.getByRole('button', {
      name: /Create a three-page financial dashboard with profit/i,
    });

    expect(promptButton.className).toContain('!whitespace-normal');
    expect(promptButton.className).toContain('!break-words');
  });

  it('falls back to default instruction prompts when the selected assistant has no recommendations', () => {
    render(<GuidPage />);

    expect(screen.getByRole('button', { name: 'guid.defaultPrompts.understand' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'guid.defaultPrompts.cleanup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'guid.defaultPrompts.create' })).toBeInTheDocument();
  });

  it('selects session-message by default in both the skill picker and conversation creation options', async () => {
    listAvailableSkillsInvokeMock.mockResolvedValue([
      {
        name: 'session-message',
        description: 'Cross-session messages',
        location: '/builtin/session-message/SKILL.md',
        is_auto_inject: true,
        is_custom: false,
        source: 'builtin',
      },
      {
        name: 'officecli',
        description: 'Office documents',
        location: '/builtin/officecli/SKILL.md',
        is_auto_inject: true,
        is_custom: false,
        source: 'builtin',
      },
      {
        name: 'skill-creator',
        description: 'Create skills',
        location: '/builtin/skill-creator/SKILL.md',
        is_auto_inject: true,
        is_custom: false,
        source: 'builtin',
      },
      {
        name: 'cron',
        description: 'Schedule tasks',
        location: '/builtin/cron/SKILL.md',
        is_auto_inject: true,
        is_custom: false,
        source: 'builtin',
      },
      {
        name: 'aionui-config',
        description: 'Configure AionUi',
        location: '/builtin/aionui-config/SKILL.md',
        is_auto_inject: true,
        is_custom: false,
        source: 'builtin',
      },
      {
        name: 'manual-skill',
        description: 'Opt-in skill',
        location: '/builtin/manual-skill/SKILL.md',
        is_auto_inject: false,
        is_custom: false,
        source: 'builtin',
      },
    ]);

    render(<GuidPage />);

    const expectedDisabledSkills = ['officecli', 'skill-creator', 'cron', 'aionui-config'];
    await waitFor(() => {
      expect(capturedGuidActionRowProps.at(-1)?.disabledBuiltinSkills).toEqual(expectedDisabledSkills);
      expect(capturedGuidSendDeps.at(-1)?.assistantDefaultDisabledBuiltinSkillIds).toEqual(expectedDisabledSkills);
    });

    act(() => {
      const onToggleSkill = capturedGuidActionRowProps.at(-1)?.onToggleSkill as
        | ((skillName: string, isAuto: boolean) => void)
        | undefined;
      onToggleSkill?.('officecli', true);
    });

    await waitFor(() => {
      expect(capturedGuidActionRowProps.at(-1)?.disabledBuiltinSkills).toEqual([
        'skill-creator',
        'cron',
        'aionui-config',
      ]);
    });
  });

  it('honors a manual session-message opt-out before assistant details load', async () => {
    listAvailableSkillsInvokeMock.mockResolvedValue([
      { name: 'session-message', description: 'Messages', source: 'builtin', is_auto_inject: true },
      { name: 'cron', description: 'Schedule tasks', source: 'builtin', is_auto_inject: true },
    ]);
    render(<GuidPage />);
    await waitFor(() => expect(capturedGuidActionRowProps.at(-1)?.disabledBuiltinSkills).toEqual(['cron']));

    act(() => {
      const toggle = capturedGuidActionRowProps.at(-1)?.onToggleSkill as (name: string, isAuto: boolean) => void;
      toggle('session-message', true);
    });

    expect(capturedGuidActionRowProps.at(-1)?.disabledBuiltinSkills).toEqual(['cron', 'session-message']);
    expect(capturedGuidSendDeps.at(-1)?.guidDisabledBuiltinSkills).toEqual(['cron', 'session-message']);
  });

  it('starts each new chat with session-message selected even when assistant preferences previously disabled it', async () => {
    listAvailableSkillsInvokeMock.mockResolvedValue([
      { name: 'session-message', description: 'Messages', source: 'builtin', is_auto_inject: true },
      { name: 'cron', description: 'Schedule tasks', source: 'builtin', is_auto_inject: true },
    ]);
    swrMock.useSWRMock.mockReturnValue({ data: assistantDetailFixture });
    resolveGuidAssistantDefaultsMock.mockReturnValue({
      disabledBuiltinSkillIds: ['session-message'],
      skillIds: [],
      mcpIds: [],
    });
    const { rerender } = render(<GuidPage />);
    await waitFor(() => expect(capturedGuidActionRowProps.at(-1)?.disabledBuiltinSkills).toEqual(['cron']));
    act(() => {
      const toggle = capturedGuidActionRowProps.at(-1)?.onToggleSkill as (name: string, isAuto: boolean) => void;
      toggle('session-message', true);
      toggle('cron', true);
    });
    rerender(<GuidPage />);
    expect(capturedGuidSendDeps.at(-1)?.guidDisabledBuiltinSkills).toEqual(['session-message']);

    locationMock.state = { resetAssistant: true };
    locationMock.key = 'next-new-chat';
    rerender(<GuidPage />);
    expect(capturedGuidActionRowProps.at(-1)?.disabledBuiltinSkills).toEqual([]);
  });

  it('does not seed skill defaults from the assistant list while detail is loading', async () => {
    agentSelectionMock.assistants = [
      {
        id: 'bare-aionrs',
        source: 'generated',
        name: 'Aion CLI',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 10,
        preset_agent_type: 'aionrs',
        enabled_skills: ['stale-list-skill'],
        custom_skill_names: [],
        disabled_builtin_skills: ['stale-disabled-builtin'],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        agent_status: 'online',
        team_selectable: true,
        deletable: false,
      },
    ];
    swrMock.useSWRMock.mockReturnValue({ data: null });

    render(<GuidPage />);

    await vi.waitFor(() => {
      const latestDeps = capturedGuidSendDeps.at(-1);
      expect(latestDeps).toMatchObject({
        guidEnabledSkills: undefined,
        guidDisabledBuiltinSkills: undefined,
      });
    });
  });

  it('applies an aionrs assistant default model after provider models load', async () => {
    swrMock.useSWRMock.mockReturnValue({ data: assistantDetailFixture });
    resolveGuidAssistantDefaultsMock.mockReturnValue({
      modelId: 'gpt-4.1',
      disabledBuiltinSkillIds: [],
      skillIds: [],
      mcpIds: [],
    });

    const { rerender } = render(<GuidPage />);

    expect(modelSelectionMock.setCurrentModel).not.toHaveBeenCalled();

    modelSelectionMock.modelList = [
      {
        id: 'provider-openai',
        name: 'OpenAI',
        models: ['gpt-4.1'],
        use_model: 'gpt-4o',
        enabled: true,
      },
    ];

    rerender(<GuidPage />);

    await vi.waitFor(() => {
      expect(modelSelectionMock.setCurrentModel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'provider-openai',
          use_model: 'gpt-4.1',
        }),
        { persistPreference: false }
      );
    });
  });

  it('does not reapply assistant default model over a guid-page model selection', async () => {
    swrMock.useSWRMock.mockReturnValue({ data: assistantDetailFixture });
    resolveGuidAssistantDefaultsMock.mockReturnValue({
      modelId: 'default',
      disabledBuiltinSkillIds: [],
      skillIds: [],
      mcpIds: [],
    });
    agentSelectionMock.selectedAssistantBackend = 'claude';
    agentSelectionMock.currentAcpCachedModelInfo = {
      current_model_id: 'default',
      current_model_label: 'Default',
      available_models: [
        { id: 'default', label: 'Default' },
        { id: 'global.anthropic.claude-opus-4-8', label: 'Opus 4.8' },
      ],
    };

    const { rerender } = render(<GuidPage />);

    await vi.waitFor(() => {
      expect(agentSelectionMock.setSelectedAcpModel).toHaveBeenCalledWith('default', { persistPreference: false });
    });
    agentSelectionMock.setSelectedAcpModel.mockClear();

    const latestActionRowProps = capturedGuidActionRowProps.at(-1);
    const modelSelectorNode = latestActionRowProps?.modelSelectorNode as React.ReactElement<{
      setSelectedAcpModel: (model: string) => void;
    }>;
    const setSelectedAcpModel = modelSelectorNode.props.setSelectedAcpModel;
    setSelectedAcpModel('global.anthropic.claude-opus-4-8');

    expect(agentSelectionMock.setSelectedAcpModel).toHaveBeenCalledWith('global.anthropic.claude-opus-4-8', {
      persistPreference: false,
    });
    agentSelectionMock.setSelectedAcpModel.mockClear();

    agentSelectionMock.currentAcpCachedModelInfo = {
      current_model_id: 'default',
      current_model_label: 'Default',
      available_models: [
        { id: 'default', label: 'Default' },
        { id: 'global.anthropic.claude-opus-4-8', label: 'Opus 4.8' },
        { id: 'global.anthropic.claude-sonnet-4-8', label: 'Sonnet 4.8' },
      ],
    };
    rerender(<GuidPage />);

    expect(agentSelectionMock.setSelectedAcpModel).not.toHaveBeenCalledWith('default', {
      persistPreference: false,
    });
  });

  it('sends on Enter with empty input (empty-input start), matching the button', () => {
    guidInputMock.input = '';
    sendMock.isButtonDisabled = false;
    sendMock.sendMessageHandler.mockClear();

    render(<GuidPage />);

    const onKeyDown = capturedGuidInputCardProps.at(-1)?.onKeyDown as (event: unknown) => void;
    const preventDefault = vi.fn();
    onKeyDown({ key: 'Enter', shiftKey: false, preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(sendMock.sendMessageHandler).toHaveBeenCalledTimes(1);
  });

  it('does not send on Enter while the send gate is disabled', () => {
    guidInputMock.input = '';
    sendMock.isButtonDisabled = true;
    sendMock.sendMessageHandler.mockClear();

    render(<GuidPage />);

    const onKeyDown = capturedGuidInputCardProps.at(-1)?.onKeyDown as (event: unknown) => void;
    onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: vi.fn() });

    expect(sendMock.sendMessageHandler).not.toHaveBeenCalled();

    // Restore shared mock state for later tests.
    sendMock.isButtonDisabled = false;
  });

  it.each(['', 'first line'])('leaves Enter as a touch newline without starting a conversation (%s)', (input) => {
    useTouchWebEnvironment();
    guidInputMock.input = input;
    sendMock.isButtonDisabled = false;
    sendMock.sendMessageHandler.mockClear();
    render(<GuidPage />);
    const props = capturedGuidInputCardProps.at(-1);
    const onKeyDown = props?.onKeyDown as (event: unknown) => void;
    const preventDefault = vi.fn();

    onKeyDown({ key: 'Enter', shiftKey: false, preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(sendMock.sendMessageHandler).not.toHaveBeenCalled();
    expect(props?.enterKeyHint).toBe('enter');
  });

  it('still starts a touch conversation from the send button', () => {
    useTouchWebEnvironment();
    sendMock.isButtonDisabled = false;
    sendMock.sendMessageHandler.mockClear();
    render(<GuidPage />);

    const onSend = capturedGuidActionRowProps.at(-1)?.onSend as () => void;
    onSend();

    expect(sendMock.sendMessageHandler).toHaveBeenCalledTimes(1);
  });
});

describe('GuidInputCard prefill focus', () => {
  it('accepts a multiline touch draft and preserves the newline keyboard hint', async () => {
    const { default: GuidInputCard } = await vi.importActual<
      typeof import('@/renderer/pages/guid/components/GuidInputCard')
    >('@/renderer/pages/guid/components/GuidInputCard');
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    const Harness = () => {
      const [value, setValue] = React.useState('first line');
      return (
        <GuidInputCard
          {...guidInputCardProps}
          input={value}
          onInputChange={setValue}
          onKeyDown={onKeyDown}
          enterKeyHint='enter'
        />
      );
    };
    render(<Harness />);
    const textarea = screen.getByTestId('guid-input');

    await user.click(textarea);
    await user.keyboard('{End}{Enter}second line');

    expect(textarea).toHaveValue('first line\nsecond line');
    expect(textarea).toHaveAttribute('enterkeyhint', 'enter');
  });

  it('does not forward Enter to the send handler during Korean composition', async () => {
    const { default: GuidInputCard } = await vi.importActual<
      typeof import('@/renderer/pages/guid/components/GuidInputCard')
    >('@/renderer/pages/guid/components/GuidInputCard');
    const onKeyDown = vi.fn();
    render(<GuidInputCard {...guidInputCardProps} onKeyDown={onKeyDown} enterKeyHint='enter' />);
    const textarea = screen.getByTestId('guid-input');

    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', isComposing: true });
    fireEvent.compositionEnd(textarea, { data: '글' });

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('focuses a draft-preserving prefill on desktop', async () => {
    const { default: GuidInputCard } = await vi.importActual<
      typeof import('@/renderer/pages/guid/components/GuidInputCard')
    >('@/renderer/pages/guid/components/GuidInputCard');

    const originalDraft = 'Existing Guid draft';
    const { rerender } = render(
      <LayoutContext.Provider value={{ isMobile: false, siderCollapsed: false, setSiderCollapsed: vi.fn() }}>
        <GuidInputCard {...guidInputCardProps} input={originalDraft} focusRequestKey='desktop-prefill' />
      </LayoutContext.Provider>
    );

    const textarea = screen.getByTestId('guid-input');
    await waitFor(() => expect(textarea).toHaveFocus());
    expect((textarea as HTMLTextAreaElement).selectionStart).toBe(originalDraft.length);

    const outsideTarget = document.createElement('button');
    document.body.append(outsideTarget);
    outsideTarget.focus();
    rerender(
      <LayoutContext.Provider value={{ isMobile: false, siderCollapsed: false, setSiderCollapsed: vi.fn() }}>
        <GuidInputCard {...guidInputCardProps} focusRequestKey='desktop-prefill' />
      </LayoutContext.Provider>
    );
    await waitFor(() => expect(textarea).toHaveFocus());
    expect((textarea as HTMLTextAreaElement).selectionStart).toBe(guidInputCardProps.input.length);

    outsideTarget.focus();
    rerender(
      <LayoutContext.Provider value={{ isMobile: false, siderCollapsed: false, setSiderCollapsed: vi.fn() }}>
        <GuidInputCard {...guidInputCardProps} focusRequestKey='desktop-prefill' />
      </LayoutContext.Provider>
    );
    expect(outsideTarget).toHaveFocus();

    rerender(
      <LayoutContext.Provider value={{ isMobile: false, siderCollapsed: false, setSiderCollapsed: vi.fn() }}>
        <GuidInputCard {...guidInputCardProps} input={`${guidInputCardProps.input}!`} />
      </LayoutContext.Provider>
    );
    expect(outsideTarget).toHaveFocus();
    outsideTarget.remove();
  });

  it('does not force focus for a mobile prefill', async () => {
    const { default: GuidInputCard } = await vi.importActual<
      typeof import('@/renderer/pages/guid/components/GuidInputCard')
    >('@/renderer/pages/guid/components/GuidInputCard');

    render(
      <LayoutContext.Provider value={{ isMobile: true, siderCollapsed: false, setSiderCollapsed: vi.fn() }}>
        <GuidInputCard {...guidInputCardProps} focusRequestKey='mobile-prefill' />
      </LayoutContext.Provider>
    );

    expect(screen.getByTestId('guid-input')).not.toHaveFocus();
  });

  it('does not focus without an explicit request key', async () => {
    const { default: GuidInputCard } = await vi.importActual<
      typeof import('@/renderer/pages/guid/components/GuidInputCard')
    >('@/renderer/pages/guid/components/GuidInputCard');
    const outsideTarget = document.createElement('button');
    document.body.append(outsideTarget);
    outsideTarget.focus();

    render(
      <LayoutContext.Provider value={{ isMobile: false, siderCollapsed: false, setSiderCollapsed: vi.fn() }}>
        <GuidInputCard {...guidInputCardProps} />
      </LayoutContext.Provider>
    );

    expect(outsideTarget).toHaveFocus();
    outsideTarget.remove();
  });
});
