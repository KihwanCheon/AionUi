import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { IConversationMcpStatus, IMcpServer } from '@/common/config/storage';
import { refreshConversationCache } from '@/renderer/pages/conversation/utils/conversationCache';
import { Message } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ensureBackendMcpCatalog, toSessionMcpServer } from './catalog';

type UseReloadConversationMcpServersOptions = {
  conversationId: string;
  currentMcpStatuses?: IConversationMcpStatus[];
  enabled?: boolean;
};

const normalizeName = (name: string) => name.trim().toLowerCase();

export const useReloadConversationMcpServers = ({
  conversationId,
  currentMcpStatuses = [],
  enabled = true,
}: UseReloadConversationMcpServersOptions) => {
  const { t } = useTranslation();
  const [isReloading, setIsReloading] = useState(false);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [availableMcpServers, setAvailableMcpServers] = useState<IMcpServer[]>([]);
  const [selectedMcpServerIds, setSelectedMcpServerIds] = useState<string[]>([]);
  const currentSelectionKey = currentMcpStatuses
    .flatMap((status) => [`id:${status.id}`, `name:${normalizeName(status.name)}`])
    .toSorted()
    .join('\u0000');
  const currentMcpIdentityKeys = useMemo(
    () => new Set(currentSelectionKey ? currentSelectionKey.split('\u0000') : []),
    [currentSelectionKey]
  );

  useEffect(() => {
    if (!enabled) {
      setAvailableMcpServers([]);
      setIsCatalogLoading(false);
      return;
    }

    let cancelled = false;
    setIsCatalogLoading(true);
    void ensureBackendMcpCatalog()
      .then(({ allServers }) => {
        if (!cancelled) {
          setAvailableMcpServers(allServers.filter((server) => server.enabled));
        }
      })
      .catch((error) => {
        console.error('[MCP] Failed to load selectable MCP servers:', error);
        if (!cancelled) {
          setAvailableMcpServers([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCatalogLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, enabled]);

  useEffect(() => {
    setSelectedMcpServerIds(
      availableMcpServers
        .filter(
          (server) =>
            currentMcpIdentityKeys.has(`id:${server.id}`) ||
            currentMcpIdentityKeys.has(`name:${normalizeName(server.name)}`)
        )
        .map((server) => server.id)
    );
  }, [availableMcpServers, currentMcpIdentityKeys]);

  const toggleMcpServer = useCallback((serverId: string) => {
    setSelectedMcpServerIds((current) =>
      current.includes(serverId) ? current.filter((id) => id !== serverId) : [...current, serverId]
    );
  }, []);

  const reloadMcpServers = useCallback(async (): Promise<void> => {
    if (!enabled || isReloading) return;

    setIsReloading(true);
    try {
      const { allServers } = await ensureBackendMcpCatalog();
      const selectedIds = new Set(selectedMcpServerIds);
      const selectedServers = allServers.filter((server) => server.enabled && selectedIds.has(server.id));
      const userMcpServerIds = selectedServers.filter((server) => server.builtin !== true).map((server) => server.id);
      const sessionMcpServers = selectedServers.filter((server) => server.builtin === true).map(toSessionMcpServer);

      await ipcBridge.conversation.reloadMcpServers.invoke({
        conversation_id: conversationId,
        sync_aionui_catalog: true,
        mcp_server_ids: userMcpServerIds,
        session_mcp_servers: sessionMcpServers,
      });
      await ipcBridge.conversation.ensureRuntime.invoke({ conversation_id: conversationId });
      await refreshConversationCache(conversationId);
      Message.success(t('conversation.mcp.reloadSuccess'));
    } catch (error) {
      console.error('[MCP] Failed to reload conversation MCP servers:', error);
      const errorKey =
        isBackendHttpError(error) && error.status === 404
          ? 'conversation.mcp.reloadBackendOutdated'
          : isBackendHttpError(error) && error.status === 409
            ? 'conversation.mcp.reloadBusy'
            : 'conversation.mcp.reloadFailed';
      Message.error(t(errorKey));
    } finally {
      setIsReloading(false);
    }
  }, [conversationId, enabled, isReloading, selectedMcpServerIds, t]);

  return {
    availableMcpServers,
    isCatalogLoading,
    isReloading,
    reloadMcpServers,
    selectedMcpServerIds,
    toggleMcpServer,
  };
};
