import { describe, expect, it, vi } from 'vitest';
import {
  MaintenanceController,
  type MaintenanceDependencies,
} from '@process/services/database/maintenance/MaintenanceController';
import type { DatabaseUsage } from '@/common/types/platform/databaseMaintenance';

const usage: DatabaseUsage = {
  database_bytes: 100,
  wal_bytes: 0,
  free_bytes: 40,
  available_bytes: 300,
  required_free_bytes: 200,
  conversation_count: 1,
  messages: [{ message_type: 'text', count: 1, content_bytes: 4 }],
};

function setup(overrides: Partial<MaintenanceDependencies> = {}) {
  const deps = {
    inspect: vi.fn(async () => usage),
    compact: vi.fn(async () => ({ before_bytes: 100, after_bytes: 60, reclaimed_bytes: 40 })),
    prepare: vi.fn(async () => 'lease'),
    release: vi.fn(async (_token: string) => undefined),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    log: vi.fn(),
    ...overrides,
  };
  return { deps, controller: new MaintenanceController(deps) };
}

async function settled(controller: MaintenanceController) {
  await vi.waitFor(() => expect(controller.getStatus().busy).toBe(false));
  return controller.getStatus();
}

async function inspected(controller: MaintenanceController) {
  controller.start('inspect');
  await settled(controller);
}

describe('database maintenance lifecycle', () => {
  it('never stops the backend just to inspect usage', async () => {
    const { controller, deps } = setup();
    await inspected(controller);
    expect(controller.getStatus().usage).toEqual(usage);
    expect(deps.stop).not.toHaveBeenCalled();
    expect(deps.compact).not.toHaveBeenCalled();
  });

  it('requires an explicit inspection before cleanup', () => {
    const { controller, deps } = setup();
    expect(controller.start('compact').error).toBe('inspection_required');
    expect(deps.prepare).not.toHaveBeenCalled();
  });

  it('does not stop an active backend when admission is refused', async () => {
    const { controller, deps } = setup({ prepare: vi.fn().mockRejectedValue(new Error('database_in_use')) });
    await inspected(controller);
    controller.start('compact');
    expect((await settled(controller)).error).toBe('database_in_use');
    expect(deps.stop).not.toHaveBeenCalled();
    expect(deps.compact).not.toHaveBeenCalled();
  });

  it.each([
    { ...usage, free_bytes: 0 },
    { ...usage, available_bytes: 199 },
  ])('rechecks space before interrupting service: %j', async (nextUsage) => {
    const inspect = vi.fn().mockResolvedValueOnce(usage).mockResolvedValue(nextUsage);
    const { controller, deps } = setup({ inspect });
    await inspected(controller);
    controller.start('compact');
    expect((await settled(controller)).phase).toBe('error');
    expect(deps.stop).not.toHaveBeenCalled();
  });

  it('restarts service even when compaction fails', async () => {
    const { controller, deps } = setup({ compact: vi.fn().mockRejectedValue(new Error('database_io')) });
    await inspected(controller);
    controller.start('compact');
    expect((await settled(controller)).error).toBe('database_io');
    expect(deps.restart).toHaveBeenCalledOnce();
    expect(deps.release).toHaveBeenCalledWith('lease');
  });

  it('restores service and releases admission if stopping fails', async () => {
    const { controller, deps } = setup({ stop: vi.fn().mockRejectedValue(new Error('stop_failed')) });
    await inspected(controller);
    controller.start('compact');
    await settled(controller);
    expect(deps.compact).not.toHaveBeenCalled();
    expect(deps.restart).toHaveBeenCalledOnce();
    expect(deps.release).toHaveBeenCalledWith('lease');
  });

  it('allows recovery after restart failure without running compaction again', async () => {
    const restart = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { controller, deps } = setup({ restart });
    await inspected(controller);
    controller.start('compact');
    expect(await settled(controller)).toMatchObject({ restartRequired: true, error: 'restart_failed' });
    controller.start('restart');
    expect(await settled(controller)).toMatchObject({ restartRequired: false, phase: 'done' });
    expect(deps.compact).toHaveBeenCalledOnce();
  });

  it('rejects inspection during a pending restart', async () => {
    const { controller } = setup({ restart: vi.fn().mockRejectedValue(new Error('offline')) });
    await inspected(controller);
    controller.start('compact');
    await settled(controller);
    expect(controller.start('inspect')).toMatchObject({ restartRequired: true, error: 'restart_required' });
  });

  it('owns one job across duplicate requests and exposes the current phase', async () => {
    let finish!: (value: { before_bytes: number; after_bytes: number; reclaimed_bytes: number }) => void;
    const compact = vi.fn(
      () =>
        new Promise<{ before_bytes: number; after_bytes: number; reclaimed_bytes: number }>((resolve) => {
          finish = resolve;
        })
    );
    const { controller, deps } = setup({ compact });
    await inspected(controller);
    controller.start('compact');
    await vi.waitFor(() => expect(controller.getStatus().phase).toBe('compacting'));
    expect(controller.start('compact').phase).toBe('compacting');
    finish({ before_bytes: 100, after_bytes: 60, reclaimed_bytes: 40 });
    expect((await settled(controller)).result?.reclaimed_bytes).toBe(40);
    expect(deps.compact).toHaveBeenCalledOnce();
  });

  it('does not expose mutable internal report state', async () => {
    const { controller } = setup();
    await inspected(controller);
    controller.getStatus().usage!.messages[0].count = 99;
    expect(controller.getStatus().usage!.messages[0].count).toBe(1);
  });
});
