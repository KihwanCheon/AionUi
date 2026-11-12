import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { DatabaseMaintenanceAction, DatabaseMaintenanceStatus } from '@/common/types/platform/databaseMaintenance';

/** Native status polling survives backend restarts and settings-page navigation. */
export function useDatabaseMaintenance(enabled: boolean) {
  const [status, setStatus] = useState<DatabaseMaintenanceStatus | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(false);
  const requesting = useRef(false);
  const starting = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const refresh = async () => {
      if (!enabled || requesting.current || starting.current) return;
      requesting.current = true;
      const currentRevision = revision.current;
      try {
        const next = await ipcBridge.application.databaseMaintenanceStatus.invoke();
        if (mounted.current && currentRevision === revision.current) {
          setStatus(next);
          setRequestError(null);
        }
      } catch {
        if (mounted.current && currentRevision === revision.current) setRequestError('backend_unavailable');
      } finally {
        requesting.current = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [enabled]);

  const start = useCallback(
    async (action: DatabaseMaintenanceAction) => {
      if (!enabled || starting.current) return;
      starting.current = true;
      revision.current += 1;
      setPending(true);
      setRequestError(null);
      try {
        const next = await ipcBridge.application.databaseMaintenanceStart.invoke({ action });
        if (mounted.current) setStatus(next);
      } catch {
        if (mounted.current) setRequestError('operation_failed');
      } finally {
        starting.current = false;
        if (mounted.current) setPending(false);
      }
    },
    [enabled]
  );

  return { status, pending, error: requestError ?? status?.error, start };
}

export function formatDatabaseBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log2(Math.max(1, bytes)) / 10)));
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(bytes / 1024 ** index)} ${units[index]}`;
}
