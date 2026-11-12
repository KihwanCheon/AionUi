import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { mindNProgressConversationApi } from '@/renderer/components/chat/SendBox/MindNProgressConversationLink';
import { emitter } from '@/renderer/utils/emitter';
import { useCallback, useEffect, useRef, useState } from 'react';
import { forEachConversation, readLinkStatus, type LinkStatus } from './operations';

type Status = LinkStatus | 'checking' | 'error' | 'archived' | 'archiveFailed';
type ConversationApi = {
  lookup: typeof mindNProgressConversationApi.lookup;
  archive: (id: string) => Promise<void>;
};

const defaultApi: ConversationApi = {
  lookup: (id) => mindNProgressConversationApi.lookup(id),
  archive: (item_id) => ipcBridge.sidebar.archive.invoke({ item_type: 'conversation', item_id }),
};

/** Track lookup failures separately and recheck links immediately before each archive. */
export function useUnlinkedConversations(conversations: TChatConversation[], api = defaultApi) {
  const idsKey = JSON.stringify([...new Set(conversations.map(({ id }) => id))]);
  const idsRef = useRef<string[]>([]);
  idsRef.current = JSON.parse(idsKey) as string[];
  const mounted = useRef(false);
  const busy = useRef(false);
  const archivedIds = useRef(new Set<string>());
  const archivingIds = useRef(new Set<string>());
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState(new Set<string>());
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;
  const scannedRevision = useRef(revision);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const refreshRequested = scannedRevision.current !== revision;
    scannedRevision.current = revision;
    for (const id of archivedIds.current) {
      if (!idsRef.current.includes(id)) archivedIds.current.delete(id);
    }
    const ids = idsRef.current.filter((id) => !archivedIds.current.has(id));
    const toCheck = ids.filter(
      (id) =>
        !archivingIds.current.has(id) &&
        (refreshRequested || !statusesRef.current[id] || statusesRef.current[id] === 'checking')
    );
    const pendingIds = new Set(toCheck);
    setStatuses((previous) =>
      Object.fromEntries(ids.map((id) => [id, pendingIds.has(id) ? 'checking' : previous[id]]))
    );
    setSelection((previous) => new Set([...previous].filter((id) => ids.includes(id) && !pendingIds.has(id))));
    setLoading(true);
    void forEachConversation(
      toCheck,
      async (id) => {
        if (archivingIds.current.has(id)) return;
        let status: Status;
        try {
          status = readLinkStatus(id, await api.lookup(id));
        } catch {
          status = 'error';
        }
        if (active && !archivedIds.current.has(id) && !archivingIds.current.has(id)) {
          setStatuses((previous) => ({ ...previous, [id]: status }));
        }
      },
      () => active
    ).then(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [api, idsKey, revision]);

  const unlinked = conversations.filter(({ id }) => statuses[id] === 'unlinked' || statuses[id] === 'archiveFailed');
  const selectedIds = unlinked.filter(({ id }) => selection.has(id)).map(({ id }) => id);
  const failedCount = conversations.filter(({ id }) => statuses[id] === 'error').length;
  const checkedCount = conversations.filter(({ id }) => statuses[id] && statuses[id] !== 'checking').length;

  const archive = useCallback(
    async (requestedIds: string[]): Promise<void> => {
      if (busy.current || loading) return;
      const ids = [...new Set(requestedIds)].filter(
        (id) =>
          idsRef.current.includes(id) &&
          !archivedIds.current.has(id) &&
          (statuses[id] === 'unlinked' || statuses[id] === 'archiveFailed')
      );
      if (ids.length === 0) return;
      busy.current = true;
      archivingIds.current = new Set(ids);
      setArchiving(true);
      let changed = false;
      try {
        await forEachConversation(
          ids,
          async (id) => {
            let status: Status;
            try {
              status = readLinkStatus(id, await api.lookup(id));
            } catch {
              status = 'error';
            }
            if (status === 'unlinked' && mounted.current && idsRef.current.includes(id)) {
              try {
                await api.archive(id);
                archivedIds.current.add(id);
                changed = true;
                status = 'archived';
              } catch {
                status = 'archiveFailed';
              }
            }
            if (mounted.current) {
              setStatuses((previous) => ({ ...previous, [id]: status }));
              if (status !== 'archiveFailed') {
                setSelection((previous) => {
                  const next = new Set(previous);
                  next.delete(id);
                  return next;
                });
              }
            }
          },
          () => mounted.current
        );
      } finally {
        busy.current = false;
        archivingIds.current.clear();
        if (mounted.current) setArchiving(false);
        if (changed) emitter.emit('chat.history.refresh');
      }
    },
    [api, loading, statuses]
  );

  return {
    unlinked,
    statuses,
    loading,
    archiving,
    failedCount,
    checkedCount,
    selectedIds,
    archive,
    refresh: () => {
      if (!busy.current) setRevision((previous) => previous + 1);
    },
    select: (id: string, checked: boolean) => {
      setSelection((previous) => {
        const next = new Set(previous);
        if (checked) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    selectAll: (checked: boolean) => setSelection(new Set(checked ? unlinked.map(({ id }) => id) : [])),
  };
}
