/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationMcpStatus, IConversationMcpStatusKind } from '@/common/config/storage';
import FileAttachButton from '@/renderer/components/media/FileAttachButton';
import { useReloadConversationMcpServers } from '@/renderer/hooks/mcp/useReloadConversationMcpServers';
import { Button, Checkbox, Spin } from '@arco-design/web-react';
import { Refresh, Right, Shield } from '@icon-park/react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type ConversationFileAttachButtonProps = Omit<
  React.ComponentProps<typeof FileAttachButton>,
  'mcpPanelContent' | 'mcpServerCount'
> & {
  conversationId: string;
  enableMcpSelection?: boolean;
};

const MCP_STATUS_CLASS_NAME: Record<IConversationMcpStatusKind, string> = {
  loaded: 'text-[var(--color-success-6)]',
  failed: 'text-[var(--color-danger-6)]',
  unsupported: 'text-[var(--color-warning-6)]',
};

const findStatus = (
  statuses: IConversationMcpStatus[],
  server: { id: string; name: string }
): IConversationMcpStatus | undefined =>
  statuses.find(
    (status) => status.id === server.id || status.name.trim().toLowerCase() === server.name.trim().toLowerCase()
  );

const ConversationFileAttachButton: React.FC<ConversationFileAttachButtonProps> = ({
  conversationId,
  enableMcpSelection = true,
  loadedMcpStatuses = [],
  ...fileAttachProps
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    availableMcpServers,
    isCatalogLoading,
    isReloading,
    reloadMcpServers,
    selectedMcpServerIds,
    toggleMcpServer,
  } = useReloadConversationMcpServers({
    conversationId,
    currentMcpStatuses: loadedMcpStatuses,
    enabled: enableMcpSelection,
  });

  const handleOpenMcpSettings = useCallback(() => {
    void navigate('/settings/tools');
  }, [navigate]);

  if (!enableMcpSelection) {
    return <FileAttachButton {...fileAttachProps} loadedMcpStatuses={loadedMcpStatuses} />;
  }

  const mcpPanelContent = (
    <div
      className='min-w-220px max-w-320px py-6px'
      style={{
        width: 'min(320px, calc(100vw - 96px))',
        backgroundColor: 'var(--color-bg-2)',
        border: '1px solid var(--color-border-1)',
        borderRadius: 12,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {isCatalogLoading ? (
        <div className='flex justify-center px-12px py-16px'>
          <Spin size={18} />
        </div>
      ) : (
        availableMcpServers.map((server) => {
          const status = findStatus(loadedMcpStatuses, server);
          return (
            <div
              key={server.id}
              className='mx-6px flex items-center gap-10px rounded-8px px-12px py-9px text-14px text-t-primary hover:bg-fill-2'
              title={status?.reason}
            >
              <span className='inline-flex w-18px flex-shrink-0 items-center justify-center text-t-secondary'>
                <Shield theme='outline' size={15} strokeWidth={2.5} />
              </span>
              <Checkbox
                className='min-w-0 flex-1'
                checked={selectedMcpServerIds.includes(server.id)}
                disabled={isReloading}
                onClick={(event) => event.stopPropagation()}
                onChange={() => toggleMcpServer(server.id)}
              >
                {server.name}
              </Checkbox>
              {status && status.status !== 'loaded' ? (
                <span className={`text-12px leading-none ${MCP_STATUS_CLASS_NAME[status.status]}`}>
                  {t(`conversation.mcp.status.${status.status}` as const)}
                </span>
              ) : null}
            </div>
          );
        })
      )}
      <div className='mx-12px my-4px h-1px bg-border-1' />
      <div className='px-12px py-8px'>
        <div className='whitespace-normal break-words text-12px leading-16px text-t-secondary'>
          {t('conversation.mcp.reloadHint')}
        </div>
        <Button
          type='secondary'
          size='mini'
          className='mt-8px'
          icon={<Refresh theme='outline' size={12} />}
          loading={isReloading}
          disabled={isReloading}
          onClick={() => void reloadMcpServers()}
        >
          {t('conversation.mcp.reload')}
        </Button>
        <Button
          type='text'
          size='mini'
          className='mt-6px h-auto! px-0! text-12px! inline-flex! items-center! gap-4px!'
          onClick={handleOpenMcpSettings}
        >
          <span className='leading-none'>{t('conversation.mcp.openSettings')}</span>
          <span className='inline-flex h-12px w-12px flex-shrink-0 items-center justify-center'>
            <Right theme='outline' size={12} strokeWidth={3} className='block' />
          </span>
        </Button>
      </div>
    </div>
  );

  return (
    <FileAttachButton
      {...fileAttachProps}
      loadedMcpStatuses={loadedMcpStatuses}
      mcpPanelContent={mcpPanelContent}
      mcpServerCount={selectedMcpServerIds.length}
    />
  );
};

export default ConversationFileAttachButton;
