/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

let mockAgents: ManagedAgent[] = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/renderer/hooks/agent/useManagedAgents', () => ({ useManagedAgentRuntimeCatalog: () => mockAgents }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: true }) }));
vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({ default: () => null }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => false }));
vi.mock('@/renderer/services/FileService', () => ({
  getCleanFileNames: (files: string[]) => files,
  FileService: { processDroppedFiles: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    dialog: { showOpen: { invoke: vi.fn().mockResolvedValue([]) } },
    conversation: { get: { invoke: vi.fn(async () => maxConversation) } },
  },
}));
vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({ usePresetAssistantInfo: () => ({ info: null }) }));
vi.mock('@/renderer/components/agent/AgentBadge', () => ({ AgentLogoIcon: () => <span /> }));

import type { TChatConversation } from '@/common/config/storage';
import { ConversationClaudeAccountBadge } from '@/renderer/pages/conversation/platforms/acp/claudeAccounts/ClaudeAccountBadge';
import { useGuidClaudeAccountSelection } from '@/renderer/pages/conversation/platforms/acp/claudeAccounts/GuidClaudeAccountSelector';
import GuidActionRow from '@/renderer/pages/guid/components/GuidActionRow';
import MobileConversationBrand from '@/renderer/components/layout/Titlebar/MobileConversationBrand';

const claudeRow = (claudeAccounts?: { id: string; number: number; label: string }[]): ManagedAgent =>
  ({ id: 'claude-row', backend: 'claude', claude_accounts: claudeAccounts }) as unknown as ManagedAgent;

const twoAccounts = [
  { id: 'default', number: 1, label: 'Team' },
  { id: 'max', number: 2, label: 'Max' },
];

const maxConversation = {
  id: 'c1',
  type: 'acp',
  extra: { backend: 'claude', claude_account_id: 'max' },
} as unknown as TChatConversation;

const MobileAccountStart = ({
  onStart,
  backend = 'claude',
}: {
  onStart: (accountId: string | null) => void;
  backend?: string;
}) => {
  const selection = useGuidClaudeAccountSelection({ backend });
  return (
    <GuidActionRow
      files={[]}
      onFilesUploaded={vi.fn()}
      onFilesPicked={vi.fn()}
      modelSelectorNode={selection.selectorNode}
      mobileAccountEntry={selection.mobileEntry}
      isGeminiMode={false}
      modelList={[]}
      setCurrentModel={vi.fn()}
      currentAcpCachedModelInfo={null}
      selectedAcpModel={null}
      setSelectedAcpModel={vi.fn()}
      selectedMode=''
      onModeSelect={vi.fn()}
      allSkills={[]}
      disabledBuiltinSkills={[]}
      enabledSkills={[]}
      onToggleSkill={vi.fn()}
      mcpServers={[]}
      selectedMcpServerIds={[]}
      onToggleMcpServer={vi.fn()}
      loading={false}
      isButtonDisabled={false}
      onSend={() => onStart(selection.accountId)}
    />
  );
};

afterEach(() => {
  mockAgents = [];
});

describe('ConversationClaudeAccountBadge', () => {
  it.each([undefined, [], twoAccounts.slice(0, 1)])('renders no badge with fewer than two accounts: %j', (accounts) => {
    mockAgents = [claudeRow(accounts)];
    const { container } = render(<ConversationClaudeAccountBadge conversation={maxConversation} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the shared number of the conversation account with two accounts', () => {
    mockAgents = [claudeRow(twoAccounts)];
    render(<ConversationClaudeAccountBadge conversation={maxConversation} />);
    expect(screen.getByTestId('claude-account-badge')).toHaveTextContent('2');
  });

  it('shows number and label in the header tag variant', () => {
    mockAgents = [claudeRow(twoAccounts)];
    render(<ConversationClaudeAccountBadge conversation={maxConversation} variant='tag' />);
    expect(screen.getByTestId('claude-account-tag')).toHaveTextContent('2Max');
  });

  it('keeps account details available on hover outside the mobile titlebar', async () => {
    mockAgents = [claudeRow(twoAccounts)];
    render(<ConversationClaudeAccountBadge conversation={maxConversation} />);
    fireEvent.mouseEnter(screen.getByTestId('claude-account-badge'));
    expect(await screen.findByText('conversation.claudeAccount.badgeTooltip')).toBeVisible();
  });

  it('keeps the mobile titlebar number visible without opening account details on touch or hover', async () => {
    mockAgents = [claudeRow(twoAccounts)];
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MobileConversationBrand conversation_id='c1' fallbackTitle='모바일 대화' />
      </SWRConfig>
    );
    const badge = await screen.findByTestId('claude-account-badge');
    fireEvent.touchStart(badge);
    fireEvent.touchEnd(badge);
    fireEvent.click(badge);
    fireEvent.mouseEnter(badge);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(badge).toHaveTextContent('2');
    expect(screen.getByText('모바일 대화')).toBeVisible();
    expect(screen.queryByText('conversation.claudeAccount.badgeTooltip')).not.toBeInTheDocument();
  });
});

describe('useGuidClaudeAccountSelection', () => {
  it('yields no selector and no account id with a single account', () => {
    mockAgents = [claudeRow()];
    const { result } = renderHook(() => useGuidClaudeAccountSelection({ backend: 'claude' }));
    expect(result.current).toEqual({ accountId: null, selectorNode: null, mobileEntry: null });
  });

  it('stays inert for non-Claude assistants even with two accounts', () => {
    mockAgents = [claudeRow(twoAccounts)];
    const { result } = renderHook(() => useGuidClaudeAccountSelection({ backend: 'codex' }));
    expect(result.current.accountId).toBeNull();
  });

  it('defaults to account 1 and prefers an account requested by an external launch', () => {
    mockAgents = [claudeRow(twoAccounts)];
    const plain = renderHook(() => useGuidClaudeAccountSelection({ backend: 'claude' }));
    expect(plain.result.current.accountId).toBe('default');
    expect(plain.result.current.selectorNode).not.toBeNull();

    const launched = renderHook(() => useGuidClaudeAccountSelection({ backend: 'claude', requestedAccountId: 'max' }));
    expect(launched.result.current.accountId).toBe('max');
  });

  it('switches the account when the user picks another one', () => {
    mockAgents = [claudeRow(twoAccounts)];
    const { result } = renderHook(() => useGuidClaudeAccountSelection({ backend: 'claude' }));
    const selector = result.current.selectorNode as React.ReactElement<{ onChange: (id: string) => void }>;
    act(() => selector.props.onChange('max'));
    expect(result.current.accountId).toBe('max');
  });

  it('uses an existing account when the previously selected account is removed', () => {
    mockAgents = [claudeRow(twoAccounts)];
    const { result, rerender } = renderHook(() => useGuidClaudeAccountSelection({ backend: 'claude' }));
    act(() => result.current.mobileEntry?.submenu?.onSelect('max'));
    mockAgents = [claudeRow([twoAccounts[0], { id: 'new-account', number: 2, label: 'New' }])];
    rerender();
    expect(result.current.accountId).toBe('default');
  });
});

describe('mobile Claude account selection', () => {
  it('starts with the account selected in the mobile menu', () => {
    mockAgents = [claudeRow(twoAccounts)];
    const onStart = vi.fn();
    render(<MobileAccountStart onStart={onStart} />);
    fireEvent.click(screen.getByTestId('file-upload-btn'));
    fireEvent.click(screen.getByTestId('mobile-action-sheet-claude-account'));
    expect(screen.getByTestId('mobile-action-sheet-option-default')).toHaveTextContent('1Team');
    expect(screen.getByTestId('mobile-action-sheet-option-max')).toHaveTextContent('2Max');
    fireEvent.click(screen.getByTestId('mobile-action-sheet-option-max'));
    fireEvent.click(screen.getByTestId('guid-send-btn'));
    expect(onStart).toHaveBeenCalledWith('max');
  });

  it.each([undefined, [], twoAccounts.slice(0, 1)])(
    'omits the mobile picker and account override with fewer than two accounts: %j',
    (accounts) => {
      mockAgents = [claudeRow(accounts)];
      const onStart = vi.fn();
      render(<MobileAccountStart onStart={onStart} />);
      fireEvent.click(screen.getByTestId('file-upload-btn'));
      expect(screen.queryByTestId('mobile-action-sheet-claude-account')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('guid-send-btn'));
      expect(onStart).toHaveBeenCalledWith(null);
    }
  );

  it('omits the mobile picker for non-Claude assistants', () => {
    mockAgents = [claudeRow(twoAccounts)];
    const onStart = vi.fn();
    render(<MobileAccountStart onStart={onStart} backend='codex' />);
    fireEvent.click(screen.getByTestId('file-upload-btn'));
    expect(screen.queryByTestId('mobile-action-sheet-claude-account')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('guid-send-btn'));
    expect(onStart).toHaveBeenCalledWith(null);
  });

  it('removes the open account picker when only one account remains', async () => {
    mockAgents = [claudeRow(twoAccounts)];
    const onStart = vi.fn();
    const { rerender } = render(<MobileAccountStart onStart={onStart} />);
    fireEvent.click(screen.getByTestId('file-upload-btn'));
    fireEvent.click(screen.getByTestId('mobile-action-sheet-claude-account'));
    await waitFor(() =>
      expect(screen.getByTestId('mobile-action-sheet-option-max').closest('[aria-hidden]')).toHaveAttribute(
        'aria-hidden',
        'false'
      )
    );
    mockAgents = [claudeRow(twoAccounts.slice(0, 1))];
    rerender(<MobileAccountStart onStart={onStart} />);
    expect(screen.queryByTestId('mobile-action-sheet-option-max')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('mobile-action-sheet-attach-host-files').closest('[aria-hidden]')).toHaveAttribute(
        'aria-hidden',
        'false'
      )
    );
    fireEvent.click(screen.getByTestId('guid-send-btn'));
    expect(onStart).toHaveBeenCalledWith(null);
  });
});
