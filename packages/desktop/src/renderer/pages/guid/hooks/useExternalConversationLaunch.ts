/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMcpServer } from '@/common/config/storage';
import {
  takeExternalConversationAutoSend,
  type ExternalConversationLaunchSession,
} from '@/renderer/services/externalConversationLaunch';
import { useEffect, useRef, useState } from 'react';
import type { GuidAssistantSelectionResult } from './useGuidAssistantSelection';
import type { GuidModelSelectionResult } from './useGuidModelSelection';

type AvailableSkill = {
  name: string;
};

type UseExternalConversationLaunchOptions = {
  agentSelection: GuidAssistantSelectionResult;
  allSkills: AvailableSkill[];
  availableMcpServers: IMcpServer[];
  input: string;
  modelSelection: GuidModelSelectionResult;
  onUnavailable?: () => void;
  sendMessage: () => void;
  session: ExternalConversationLaunchSession | null;
  setDisabledBuiltinSkills: React.Dispatch<React.SetStateAction<string[] | undefined>>;
  setEnabledSkills: React.Dispatch<React.SetStateAction<string[] | undefined>>;
  setSelectedMcpServerIds: React.Dispatch<React.SetStateAction<string[] | undefined>>;
};

export function useExternalConversationLaunch({
  agentSelection,
  allSkills,
  availableMcpServers,
  input,
  modelSelection,
  onUnavailable,
  sendMessage,
  session,
  setDisabledBuiltinSkills,
  setEnabledSkills,
  setSelectedMcpServerIds,
}: UseExternalConversationLaunchOptions): void {
  const [readyToken, setReadyToken] = useState<string | null>(null);
  const appliedTokenRef = useRef<string | null>(null);
  const sentTokenRef = useRef<string | null>(null);
  const launch = session?.launch;
  // Setter calls alone do not prove the next render retained these values.
  const runtimeOptionsMatch = Boolean(
    launch &&
    agentSelection.selectedAssistantId === `bare:${launch.agentId}` &&
    (!launch.modelId ||
      (agentSelection.selectedAssistantBackend === 'aionrs'
        ? modelSelection.current_model?.use_model === launch.modelId &&
          (!launch.providerId || modelSelection.current_model.id === launch.providerId)
        : agentSelection.selectedAcpModel === launch.modelId)) &&
    (!launch.mode || agentSelection.selectedMode === launch.mode) &&
    (!launch.thoughtLevel || agentSelection.selectedThoughtLevelValue === launch.thoughtLevel)
  );
  const optionsReady = readyToken === session?.token && (!launch?.autoSend || runtimeOptionsMatch);

  useEffect(() => {
    if (!session || !onUnavailable || optionsReady || sentTokenRef.current === session.token) return;
    const timeout = window.setTimeout(onUnavailable, 15_000);
    return () => window.clearTimeout(timeout);
  }, [onUnavailable, optionsReady, session]);

  useEffect(() => {
    if (!session || !launch || !agentSelection.selectedAssistantId) return;
    if (appliedTokenRef.current === session.token) return;
    if (agentSelection.selectedAssistantId !== `bare:${launch.agentId}`) return;

    const availableAcpModelIds = new Set(
      agentSelection.currentAcpCachedModelInfo?.available_models.map((model) => model.id) ?? []
    );
    if (
      agentSelection.selectedAssistantBackend !== 'aionrs' &&
      launch.modelId &&
      (availableAcpModelIds.size === 0 || !availableAcpModelIds.has(launch.modelId))
    ) {
      return;
    }
    if (launch.mode && !agentSelection.currentAgentModeOptions.some((option) => option.value === launch.mode)) {
      return;
    }
    if (
      launch.thoughtLevel &&
      !agentSelection.currentThoughtLevelOption?.options.some((option) => option.value === launch.thoughtLevel)
    ) {
      return;
    }

    const requestedSkillIds = [...(launch.enabledSkillIds ?? []), ...(launch.disabledBuiltinSkillIds ?? [])];
    if (
      requestedSkillIds.length > 0 &&
      !requestedSkillIds.every((id) => allSkills.some((skill) => skill.name === id))
    ) {
      return;
    }
    if (launch.mcpIds?.length && !launch.mcpIds.every((id) => availableMcpServers.some((server) => server.id === id))) {
      return;
    }

    const applyLaunchOptions = async () => {
      if (agentSelection.selectedAssistantBackend === 'aionrs' && launch.modelId) {
        const matchedProvider = modelSelection.modelList.find(
          (provider) =>
            (!launch.providerId || provider.id === launch.providerId) && provider.models.includes(launch.modelId!)
        );
        if (!matchedProvider) return;
        await modelSelection.setCurrentModel(
          {
            ...matchedProvider,
            use_model: launch.modelId,
          },
          { persistPreference: false }
        );
      } else if (launch.modelId) {
        agentSelection.setSelectedAcpModel(launch.modelId, { persistPreference: false });
      }

      if (launch.mode) {
        agentSelection.setSelectedMode(launch.mode, { persistPreference: false });
      }
      if (launch.thoughtLevel) {
        agentSelection.setSelectedThoughtLevelValue(launch.thoughtLevel, { persistPreference: false });
      }
      if (launch.enabledSkillIds) setEnabledSkills(launch.enabledSkillIds);
      if (launch.disabledBuiltinSkillIds) setDisabledBuiltinSkills(launch.disabledBuiltinSkillIds);
      if (launch.mcpIds) setSelectedMcpServerIds(launch.mcpIds);

      appliedTokenRef.current = session.token;
      setReadyToken(session.token);
    };

    void applyLaunchOptions().catch((error) => {
      console.error('[GuidPage] Failed to apply external conversation options:', error);
      onUnavailable?.();
    });
  }, [
    agentSelection,
    allSkills,
    availableMcpServers,
    launch,
    modelSelection,
    onUnavailable,
    session,
    setDisabledBuiltinSkills,
    setEnabledSkills,
    setSelectedMcpServerIds,
  ]);

  useEffect(() => {
    if (!session || !launch?.autoSend || !optionsReady || !input.trim()) return;
    if (sentTokenRef.current === session.token) return;
    sentTokenRef.current = session.token;
    if (!takeExternalConversationAutoSend(session)) return;
    sendMessage();
  }, [input, launch?.autoSend, optionsReady, sendMessage, session]);
}
