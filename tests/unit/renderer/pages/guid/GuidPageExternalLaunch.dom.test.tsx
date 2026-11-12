/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assistant, AssistantDetail } from '@/common/types/agent/assistantTypes';
import type { GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';
import type { AgentRuntimeCatalog } from '@/renderer/utils/model/agentRuntimeCatalog';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  listAssistants: vi.fn(),
  getAssistant: vi.fn(),
  configGet: vi.fn(),
  configSet: vi.fn(),
  sent: [] as Array<{ selectedAssistantId: string | null; input: string; dir: string }>,
  sentOptions: [] as GuidSendDeps[],
  latestSend: null as GuidSendDeps | null,
  runtimeCatalog: [] as Array<AgentRuntimeCatalog & { id: string }>,
  runtimeListeners: new Set<() => void>(),
  translate: (key: string) => key,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.translate, i18n: { language: 'en-US' } }),
}));
vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: mocks.request,
  isBackendHttpError: () => false,
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: { list: { invoke: mocks.listAssistants }, get: { invoke: mocks.getAssistant } },
    fs: { listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) } },
  },
}));
vi.mock('@/common/config/configService', () => ({
  configService: { get: mocks.configGet, set: mocks.configSet },
}));
vi.mock('@/renderer/hooks/agent/useManagedAgents', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useManagedAgentRuntimeCatalog: () =>
      useSyncExternalStore(
        (listener) => {
          mocks.runtimeListeners.add(listener);
          return () => {
            mocks.runtimeListeners.delete(listener);
          };
        },
        () => mocks.runtimeCatalog
      ),
  };
});
vi.mock('@/renderer/hooks/mcp/catalog', () => ({
  ensureBackendMcpCatalog: vi.fn().mockResolvedValue({ allServers: [] }),
}));
vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({ activeBorderColor: '', inactiveBorderColor: '', activeShadow: '' }),
}));
vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => {
  const selection = {
    modelList: [],
    isGoogleAuth: false,
    current_model: undefined,
    setCurrentModel: vi.fn(),
    resetCurrentModel: vi.fn(),
  };
  return { useGuidModelSelection: () => selection };
});
vi.mock('@/renderer/pages/guid/hooks/useGuidSend', () => {
  const send = {
    handleSend: vi.fn(),
    isButtonDisabled: false,
    sendMessageHandler: () => {
      const latest = mocks.latestSend!;
      mocks.sent.push({ selectedAssistantId: latest.selectedAssistantId, input: latest.input, dir: latest.dir });
      mocks.sentOptions.push(latest);
    },
  };
  return {
    useGuidSend: (deps: GuidSendDeps) => {
      mocks.latestSend = deps;
      return send;
    },
  };
});
vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }),
}));
vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({ onPaste: vi.fn(), onFocus: vi.fn() }),
}));
vi.mock('@/renderer/services/FileService', () => ({ allSupportedExts: [] }));
vi.mock('@/renderer/hooks/file/useOpenFileSelector', () => ({
  useOpenFileSelector: () => ({ onSlashBuiltinCommand: vi.fn() }),
}));
vi.mock('@/renderer/pages/guid/hooks/useTypewriterPlaceholder', () => ({ useTypewriterPlaceholder: () => '' }));
vi.mock('@/renderer/pages/guid/components/AssistantSelectionArea', () => ({
  default: ({ selectedAssistantId }: { selectedAssistantId: string | null }) => (
    <div data-testid='selected-assistant'>{selectedAssistantId}</div>
  ),
}));
vi.mock('@/renderer/pages/guid/components/GuidInputCard', () => ({
  default: ({ input, workspaceDir }: { input: string; workspaceDir: string }) => (
    <div data-testid='guid-draft' data-workspace={workspaceDir}>
      {input}
    </div>
  ),
}));
vi.mock('@/renderer/pages/guid/components/GuidActionRow', () => ({ default: () => null }));
vi.mock('@/renderer/pages/guid/components/GuidModelSelector', () => ({ default: () => null }));
vi.mock('@/renderer/pages/guid/components/QuickActionButtons', () => ({ default: () => null }));
vi.mock('@/renderer/components/settings/SettingsModal/contents/FeedbackReportModal', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({ default: () => null }));
vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', () => ({
  useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
}));
vi.mock('@/renderer/hooks/system/useSpeechInput', () => ({
  appendSpeechTranscript: (previous: string, next: string) => `${previous}${next}`,
}));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => Boolean(window.electronAPI),
  openExternalUrl: vi.fn(),
  resolveExtensionAssetUrl: vi.fn(),
  resolveBackendAssetUrl: (path: string) => path,
}));

import GuidPage from '@/renderer/pages/guid/GuidPage';

function assistant(id: string, runtime: string): Assistant {
  return {
    id: `bare:${id}`,
    source: 'generated',
    name: id,
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: 0,
    agent_id: id,
    agent: { type: runtime === 'aionrs' ? runtime : 'acp', source: 'builtin', acp_backend: runtime },
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
  };
}

const defaultAssistant = assistant('default-agent', 'aionrs');
const requestedAssistant = assistant('requested-agent', 'codex');
const claudeAssistant = assistant('requested-agent', 'claude');
const claudeRuntimeCatalog = {
  id: claudeAssistant.agent_id,
  available_models: { current_model_id: 'sonnet', available_models: [{ id: 'opus' }, { id: 'sonnet' }] },
  available_modes: {
    current_mode_id: 'default',
    available_modes: [
      { id: 'default', name: 'Default' },
      { id: 'acceptEdits', name: 'Accept Edits' },
    ],
  },
  config_options: [
    {
      id: 'reasoning_effort',
      category: 'thought_level',
      type: 'select',
      current_value: 'max',
      options: [
        { value: 'xhigh', label: 'xhigh' },
        { value: 'max', label: 'max' },
      ],
    },
  ],
};

function claudeDetail(): AssistantDetail {
  return {
    id: claudeAssistant.id,
    source: 'generated',
    agent_status: 'online',
    team_selectable: true,
    deletable: false,
    profile: { name: 'Claude Code', name_i18n: {}, description_i18n: {} },
    state: { enabled: true, sort_order: 0 },
    engine: { agent_id: claudeAssistant.agent_id },
    rules: { content: '', storage_mode: 'none' },
    prompts: { recommended: [], recommended_i18n: {} },
    defaults: {
      model: { mode: 'auto' },
      permission: { mode: 'auto' },
      thought_level: { mode: 'auto' },
      skills: { mode: 'auto', value: [] },
      mcps: { mode: 'auto', value: [] },
    },
    capabilities: { default_skill_ids: [], custom_skill_names: [], default_disabled_builtin_skill_ids: [] },
    preferences: {
      last_model_id: 'sonnet',
      last_permission_value: 'default',
      last_thought_level_value: 'max',
      last_skill_ids: ['default-skill'],
      last_disabled_builtin_skill_ids: ['default-builtin'],
      last_mcp_ids: ['default-mcp'],
    },
  };
}

function publishRuntimeCatalog() {
  mocks.runtimeCatalog = [claudeRuntimeCatalog];
  mocks.runtimeListeners.forEach((listener) => listener());
}
const launchPrompt = '선택한 AI로 이 카드의 작업을 진행합니다.';
const launchWorkspace = 'C:/isolated/project';
const launchResponse = {
  launch: {
    agentId: 'requested-agent',
    prompt: launchPrompt,
    workspace: launchWorkspace,
    autoSend: true,
  },
  expiresAt: '2099-01-01T00:00:00.000Z',
};
let launchSequence = 0;
let releaseCatalog: (value: Assistant[]) => void;

function NavigationState() {
  return <output data-testid='navigation-state'>{JSON.stringify(useLocation().state)}</output>;
}

function renderGuid(externalLaunch = true, state?: { resetAssistant?: boolean; selectedAssistantId?: string }) {
  const entry = externalLaunch ? `/guid?external-launch=guid-page-race-${++launchSequence}` : '/guid';
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
      <MemoryRouter initialEntries={[{ pathname: '/guid', search: entry.slice('/guid'.length), state }]}>
        <GuidPage />
        <NavigationState />
      </MemoryRouter>
    </SWRConfig>
  );
}

describe('GuidPage external launch assistant selection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.sent.length = 0;
    mocks.sentOptions.length = 0;
    mocks.latestSend = null;
    mocks.runtimeCatalog = [];
    mocks.request.mockReset();
    mocks.configGet.mockReturnValue(undefined);
    mocks.configSet.mockResolvedValue(undefined);
    mocks.getAssistant.mockResolvedValue(null);
    const catalog = new Promise<Assistant[]>((resolve) => {
      releaseCatalog = resolve;
    });
    mocks.listAssistants.mockReturnValue(catalog);
    mocks.request.mockResolvedValue(launchResponse);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('preserves external runtime options when the catalog arrives after conflicting assistant defaults', async () => {
    mocks.getAssistant.mockResolvedValue(claudeDetail());
    mocks.request.mockResolvedValue({
      ...launchResponse,
      launch: {
        ...launchResponse.launch,
        modelId: 'opus',
        mode: 'acceptEdits',
        thoughtLevel: 'xhigh',
        enabledSkillIds: [],
        disabledBuiltinSkillIds: [],
        mcpIds: [],
      },
    });
    renderGuid();
    await act(async () => releaseCatalog([defaultAssistant, claudeAssistant]));
    expect(mocks.sent).toEqual([]);

    await act(async () => publishRuntimeCatalog());

    expect(mocks.sentOptions).toHaveLength(1);
    expect(mocks.sentOptions[0]).toMatchObject({
      selectedAssistantId: claudeAssistant.id,
      selectedAcpModel: 'opus',
      selectedMode: 'acceptEdits',
      selectedThoughtLevelValue: 'xhigh',
      guidEnabledSkills: [],
      guidDisabledBuiltinSkills: [],
      selectedMcpServerIds: [],
    });
  });

  it('uses assistant defaults only for options omitted by an external launch', async () => {
    mocks.getAssistant.mockResolvedValue(claudeDetail());
    mocks.request.mockResolvedValue({
      ...launchResponse,
      launch: {
        ...launchResponse.launch,
        mode: 'acceptEdits',
      },
    });
    renderGuid();
    await act(async () => releaseCatalog([defaultAssistant, claudeAssistant]));
    await act(async () => publishRuntimeCatalog());

    expect(mocks.sentOptions).toHaveLength(1);
    expect(mocks.sentOptions[0]).toMatchObject({
      selectedAcpModel: 'sonnet',
      selectedMode: 'acceptEdits',
      selectedThoughtLevelValue: 'max',
    });
  });

  it('does not replace external options when assistant details arrive after the launch options', async () => {
    let releaseDetail!: (value: AssistantDetail) => void;
    mocks.getAssistant.mockReturnValue(
      new Promise<AssistantDetail>((resolve) => {
        releaseDetail = resolve;
      })
    );
    mocks.runtimeCatalog = [claudeRuntimeCatalog];
    mocks.request.mockResolvedValue({
      ...launchResponse,
      launch: {
        ...launchResponse.launch,
        autoSend: false,
        modelId: 'opus',
        mode: 'acceptEdits',
        thoughtLevel: 'xhigh',
        enabledSkillIds: [],
        disabledBuiltinSkillIds: [],
        mcpIds: [],
      },
    });
    renderGuid();
    await act(async () => releaseCatalog([defaultAssistant, claudeAssistant]));
    await act(async () => releaseDetail(claudeDetail()));

    expect(mocks.latestSend).toMatchObject({
      selectedAcpModel: 'opus',
      selectedMode: 'acceptEdits',
      selectedThoughtLevelValue: 'xhigh',
      guidEnabledSkills: [],
      guidDisabledBuiltinSkills: [],
      selectedMcpServerIds: [],
    });
    expect(mocks.sent).toEqual([]);
  });

  it('starts with the requested assistant when the launch is claimed before the assistant catalog loads', async () => {
    renderGuid();
    await act(async () => {});
    expect(mocks.sent).toEqual([]);

    await act(async () => releaseCatalog([defaultAssistant, requestedAssistant]));

    expect(mocks.sent).toEqual([
      { selectedAssistantId: requestedAssistant.id, input: launchPrompt, dir: launchWorkspace },
    ]);
    expect(screen.queryByText('guid.externalLaunch.errorTitle')).not.toBeInTheDocument();
  });

  it('starts once when the requested assistant is already selected before the launch is claimed', async () => {
    let releaseClaim: (value: typeof launchResponse) => void;
    mocks.request.mockReturnValue(
      new Promise<typeof launchResponse>((resolve) => {
        releaseClaim = resolve;
      })
    );
    mocks.listAssistants.mockResolvedValue([defaultAssistant, requestedAssistant]);
    mocks.configGet.mockImplementation((key: string) =>
      key === 'guid.lastAssistantId' ? requestedAssistant.id : undefined
    );
    renderGuid();
    await act(async () => {});
    expect(mocks.latestSend?.selectedAssistantId).toBe(requestedAssistant.id);
    expect(mocks.sent).toEqual([]);
    await act(async () => releaseClaim(launchResponse));

    expect(mocks.sent).toEqual([
      { selectedAssistantId: requestedAssistant.id, input: launchPrompt, dir: launchWorkspace },
    ]);
  });

  it('shows an unavailable error without sending through another assistant when the requested assistant is missing', async () => {
    renderGuid();
    await act(async () => {});
    await act(async () => releaseCatalog([defaultAssistant]));
    await act(async () => vi.advanceTimersByTimeAsync(15_001));

    expect(screen.getByText('guid.externalLaunch.unavailableOptions')).toBeInTheDocument();
    expect(mocks.sent).toEqual([]);
  });

  it('keeps the ordinary new-chat default when there is no external request', async () => {
    renderGuid(false);
    await act(async () => releaseCatalog([defaultAssistant, requestedAssistant]));

    expect(screen.getByTestId('selected-assistant')).toHaveTextContent(defaultAssistant.id);
    expect(mocks.sent).toEqual([]);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('restores the saved assistant for an ordinary reset after the catalog loads', async () => {
    mocks.configGet.mockImplementation((key: string) =>
      key === 'guid.lastAssistantId' ? requestedAssistant.id : undefined
    );
    renderGuid(false, { resetAssistant: true });
    await act(async () => {});
    expect(screen.getByTestId('navigation-state')).toHaveTextContent('"resetAssistant":true');
    await act(async () => releaseCatalog([defaultAssistant, requestedAssistant]));

    expect(screen.getByTestId('selected-assistant')).toHaveTextContent(requestedAssistant.id);
    expect(mocks.sent).toEqual([]);
  });

  it('consumes a normalized preselection only after the requested assistant is selected', async () => {
    renderGuid(false, { selectedAssistantId: `custom:${requestedAssistant.id}` });
    await act(async () => {});
    await act(async () => releaseCatalog([defaultAssistant, requestedAssistant]));

    expect(screen.getByTestId('selected-assistant')).toHaveTextContent(requestedAssistant.id);
    expect(screen.getByTestId('navigation-state')).toHaveTextContent('null');
    expect(mocks.sent).toEqual([]);
  });

  it('clears a preselection that already matches the selected default assistant', async () => {
    mocks.listAssistants.mockResolvedValue([defaultAssistant, requestedAssistant]);
    renderGuid(false, { selectedAssistantId: defaultAssistant.id });
    await act(async () => {});

    expect(screen.getByTestId('selected-assistant')).toHaveTextContent(defaultAssistant.id);
    expect(screen.getByTestId('navigation-state')).toHaveTextContent('null');
    expect(mocks.sent).toEqual([]);
  });
});
