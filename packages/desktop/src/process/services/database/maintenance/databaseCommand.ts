import { spawn } from 'child_process';
import type { DatabaseCompactionResult, DatabaseUsage } from '@/common/types/platform/databaseMaintenance';

type ResultEnvelope = { success?: boolean; data?: unknown; code?: string };

/** Runs only the fixed maintenance command against the app-owned data directory. */
export function runDatabaseCommand(binary: string, dataDir: string, compact: false): Promise<DatabaseUsage>;
export function runDatabaseCommand(binary: string, dataDir: string, compact: true): Promise<DatabaseCompactionResult>;
export function runDatabaseCommand(
  binary: string,
  dataDir: string,
  compact: boolean
): Promise<DatabaseUsage | DatabaseCompactionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['--data-dir', dataDir, 'database', ...(compact ? ['--compact'] : [])], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) {
        child.kill();
        reject(new Error('invalid_response'));
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    child.once('error', () => reject(new Error('backend_unavailable')));
    child.once('close', (code) => {
      try {
        const envelope = JSON.parse(stdout.trim()) as ResultEnvelope;
        if (code !== 0 || !envelope.success) {
          reject(new Error(envelope.code || 'operation_failed'));
          return;
        }
        if (!envelope.data || typeof envelope.data !== 'object') throw new Error('invalid_response');
        const data = envelope.data as Record<string, unknown>;
        const required = compact
          ? ['before_bytes', 'after_bytes', 'reclaimed_bytes']
          : [
              'database_bytes',
              'wal_bytes',
              'free_bytes',
              'available_bytes',
              'required_free_bytes',
              'conversation_count',
            ];
        if (
          required.some(
            (key) => typeof data[key] !== 'number' || !Number.isFinite(data[key]) || (data[key] as number) < 0
          )
        ) {
          throw new Error('invalid_response');
        }
        if (
          !compact &&
          (!Array.isArray(data.messages) ||
            data.messages.some((entry: unknown) => {
              if (!entry || typeof entry !== 'object') return true;
              const row = entry as Record<string, unknown>;
              return (
                typeof row.message_type !== 'string' ||
                ['count', 'content_bytes'].some(
                  (key) => typeof row[key] !== 'number' || !Number.isFinite(row[key]) || (row[key] as number) < 0
                )
              );
            }))
        )
          throw new Error('invalid_response');
        resolve(envelope.data as DatabaseUsage | DatabaseCompactionResult);
      } catch {
        reject(
          new Error(
            /unrecognized subcommand|unexpected argument/i.test(stderr) ? 'backend_update_required' : 'invalid_response'
          )
        );
      }
    });
  });
}
