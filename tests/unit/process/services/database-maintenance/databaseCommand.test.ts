import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runDatabaseCommand } from '@process/services/database/maintenance/databaseCommand';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn }));

function child() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}

describe('database command boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes paths with spaces as arguments without invoking a shell', async () => {
    const process = child();
    spawn.mockReturnValue(process);
    const result = runDatabaseCommand('C:\\App Files\\aioncore.exe', 'D:\\User Data', true);
    process.stdout.end(
      JSON.stringify({ success: true, data: { before_bytes: 100, after_bytes: 60, reclaimed_bytes: 40 } })
    );
    process.emit('close', 0);
    await expect(result).resolves.toMatchObject({ reclaimed_bytes: 40 });
    expect(spawn).toHaveBeenCalledWith(
      'C:\\App Files\\aioncore.exe',
      ['--data-dir', 'D:\\User Data', 'database', '--compact'],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  });

  it('reports old backends as requiring an update', async () => {
    const process = child();
    spawn.mockReturnValue(process);
    const result = runDatabaseCommand('core', 'data', false);
    process.stderr.end("error: unrecognized subcommand 'database'");
    process.emit('close', 2);
    await expect(result).rejects.toThrow('backend_update_required');
  });

  it('preserves an actionable failure code without leaking stderr', async () => {
    const process = child();
    spawn.mockReturnValue(process);
    const result = runDatabaseCommand('core', 'data', true);
    process.stdout.end('{"success":false,"code":"insufficient_space"}');
    process.stderr.end('private details');
    process.emit('close', 1);
    await expect(result).rejects.toThrow('insufficient_space');
  });

  it('rejects malformed results instead of presenting misleading sizes', async () => {
    const process = child();
    spawn.mockReturnValue(process);
    const result = runDatabaseCommand('core', 'data', true);
    process.stdout.end('{"success":true,"data":{"before_bytes":-1,"after_bytes":0,"reclaimed_bytes":1}}');
    process.emit('close', 0);
    await expect(result).rejects.toThrow('invalid_response');
  });

  it('reports unavailable binaries', async () => {
    const process = child();
    spawn.mockReturnValue(process);
    const result = runDatabaseCommand('missing', 'data', false);
    process.emit('error', new Error('ENOENT'));
    await expect(result).rejects.toThrow('backend_unavailable');
  });
});
