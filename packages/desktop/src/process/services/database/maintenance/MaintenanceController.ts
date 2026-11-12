import type {
  DatabaseCompactionResult,
  DatabaseMaintenanceAction,
  DatabaseMaintenancePhase,
  DatabaseMaintenanceStatus,
  DatabaseUsage,
} from '@/common/types/platform/databaseMaintenance';

export type MaintenanceDependencies = {
  inspect: () => Promise<DatabaseUsage>;
  compact: () => Promise<DatabaseCompactionResult>;
  prepare: () => Promise<string>;
  release: (token: string) => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  log: (phase: DatabaseMaintenancePhase, error?: string) => void;
};

/** Owns the job independently of settings-page navigation or IPC timeouts. */
export class MaintenanceController {
  private state: DatabaseMaintenanceStatus = {
    phase: 'idle',
    busy: false,
    startedAt: null,
    inspectedAt: null,
    usage: null,
    result: null,
    error: null,
    restartRequired: false,
  };

  constructor(private readonly deps: MaintenanceDependencies) {}

  getStatus(): DatabaseMaintenanceStatus {
    return structuredClone(this.state);
  }

  start(action: DatabaseMaintenanceAction): DatabaseMaintenanceStatus {
    if (this.state.busy) return this.getStatus();
    // Native bridge providers must return a status even for invalid requests;
    // throwing would leave their renderer callback waiting indefinitely.
    const rejection = !['inspect', 'compact', 'restart'].includes(action)
      ? 'invalid_action'
      : this.state.restartRequired && action !== 'restart'
        ? 'restart_required'
        : action === 'restart' && !this.state.restartRequired
          ? 'restart_not_required'
          : action === 'compact' && !this.state.usage
            ? 'inspection_required'
            : null;
    if (rejection) {
      this.state = { ...this.state, phase: 'error', error: rejection };
      return this.getStatus();
    }
    this.state = { ...this.state, busy: true, startedAt: Date.now(), error: null };
    void this.run(action);
    return this.getStatus();
  }

  private phase(phase: DatabaseMaintenancePhase): void {
    this.state.phase = phase;
    this.deps.log(phase);
  }

  private async inspect(): Promise<void> {
    this.phase('inspecting');
    this.state.usage = await this.deps.inspect();
    this.state.inspectedAt = Date.now();
  }

  private async restart(): Promise<void> {
    this.phase('restarting');
    await this.deps.restart();
    this.state.restartRequired = false;
  }

  private async run(action: DatabaseMaintenanceAction): Promise<void> {
    try {
      if (action === 'restart') {
        await this.restart();
      } else if (action === 'inspect') {
        await this.inspect();
      } else {
        this.state.result = null;
        // Refresh the estimate before stopping anything. The CLI rechecks the
        // actual space under the exclusive lock immediately before VACUUM.
        await this.inspect();
        const usage = this.state.usage;
        if (!usage || usage.free_bytes === 0) throw new Error('nothing_to_reclaim');
        if (usage.available_bytes < usage.required_free_bytes) throw new Error('insufficient_space');
        this.phase('preparing');
        const token = await this.deps.prepare();
        try {
          this.phase('stopping');
          this.state.restartRequired = true;
          await this.deps.stop();
          this.phase('compacting');
          this.state.result = await this.deps.compact();
        } finally {
          // Always restore service, including VACUUM/IO failures.
          try {
            await this.restart();
          } finally {
            await this.deps.release(token).catch((): void => undefined);
          }
        }
        await this.inspect();
      }
      this.phase('done');
    } catch (error) {
      this.state.error = this.state.restartRequired
        ? 'restart_failed'
        : error instanceof Error
          ? error.message
          : 'operation_failed';
      this.phase('error');
      this.deps.log('error', this.state.error);
    } finally {
      this.state.busy = false;
    }
  }
}
