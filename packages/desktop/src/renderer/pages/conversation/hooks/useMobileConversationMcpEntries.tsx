/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationMcpStatus } from '@/common/config/storage';
import type { MobileActionSheetEntry, MobileActionSheetOption } from '@/renderer/components/chat/MobileActionSheet';
import { useReloadConversationMcpServers } from '@/renderer/hooks/mcp/useReloadConversationMcpServers';
import { Button } from '@arco-design/web-react';
import { Shield } from '@icon-park/react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

type UseMobileConversationMcpEntriesOptions = {
  conversationId: string;
  currentMcpStatuses: IConversationMcpStatus[];
  enabled: boolean;
};

const normalizeName = (name: string) => name.trim().toLowerCase();

const findStatus = (
  statuses: IConversationMcpStatus[],
  server: { id: string; name: string }
): IConversationMcpStatus | undefined =>
  statuses.find((status) => status.id === server.id || normalizeName(status.name) === normalizeName(server.name));

export const useMobileConversationMcpEntries = ({
  conversationId,
  currentMcpStatuses,
  enabled,
}: UseMobileConversationMcpEntriesOptions): MobileActionSheetEntry[] => {
  const { t } = useTranslation();
  const {
    availableMcpServers,
    isCatalogLoading,
    isReloading,
    reloadMcpServers,
    selectedMcpServerIds,
    toggleMcpServer,
  } = useReloadConversationMcpServers({
    conversationId,
    currentMcpStatuses,
    enabled,
  });

  return useMemo(() => {
    if (!enabled) return [];

    const options: MobileActionSheetOption[] = availableMcpServers.map((server) => {
      const status = findStatus(currentMcpStatuses, server);
      return {
        key: server.id,
        label: server.name,
        description:
          status && status.status !== 'loaded'
            ? status.reason
              ? `${t(`conversation.mcp.status.${status.status}` as const)} · ${status.reason}`
              : t(`conversation.mcp.status.${status.status}` as const)
            : undefined,
        active: selectedMcpServerIds.includes(server.id),
      };
    });

    return [
      {
        key: 'mcp',
        icon: <Shield theme='outline' size='16' />,
        label: t('conversation.mcp.selected'),
        meta: selectedMcpServerIds.length,
        variant: 'muted',
        submenu: {
          title: t('conversation.mcp.selected'),
          options,
          onSelect: toggleMcpServer,
          emptyText: isCatalogLoading ? t('common.loading') : undefined,
          multiSelect: true,
          footer: (
            <div className='border-t border-border-1 px-16px py-10px'>
              <div className='mb-8px text-12px leading-16px text-t-secondary'>{t('conversation.mcp.reloadHint')}</div>
              <Button
                type='secondary'
                long
                loading={isReloading}
                disabled={isCatalogLoading || isReloading}
                onClick={() => void reloadMcpServers()}
                data-testid='mobile-action-sheet-mcp-reload'
              >
                {t('conversation.mcp.reload')}
              </Button>
            </div>
          ),
        },
      },
    ];
  }, [
    availableMcpServers,
    currentMcpStatuses,
    enabled,
    isCatalogLoading,
    isReloading,
    reloadMcpServers,
    selectedMcpServerIds,
    t,
    toggleMcpServer,
  ]);
};
