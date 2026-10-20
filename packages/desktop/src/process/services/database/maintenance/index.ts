import { getDataPath } from '@process/utils/utils';
import { MaintenanceController } from './MaintenanceController';
import { runDatabaseCommand } from './databaseCommand';

type Host = {
  binary: () => string;
  port: () => number;
  running: () => boolean;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
};

/** Wires the maintenance job to the app-owned backend and data directory. */
export function createDatabaseMaintenance(host: Host): MaintenanceController {
  const post = async (endpoint: string, body?: string): Promise<unknown> => {
    const response = await fetch(`http://127.0.0.1:${host.port()}/api/system/database-maintenance/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(
        response.status === 409
          ? 'database_in_use'
          : response.status === 404
            ? 'backend_update_required'
            : 'backend_unavailable'
      );
    }
    const result = (await response.json()) as { data?: unknown };
    return result.data;
  };
  return new MaintenanceController({
    inspect: () => runDatabaseCommand(host.binary(), getDataPath(), false),
    compact: () => runDatabaseCommand(host.binary(), getDataPath(), true),
    prepare: async () => {
      if (!host.running()) throw new Error('backend_unavailable');
      const token = await post('prepare');
      if (typeof token !== 'string' || !token) throw new Error('invalid_response');
      return token;
    },
    release: async (token) => {
      await post('release', token);
    },
    stop: host.stop,
    restart: host.restart,
    log: (phase, error) => console.info('[DatabaseMaintenance]', { phase, error }),
  });
}
