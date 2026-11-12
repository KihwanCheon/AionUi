export type DatabaseUsage = {
  database_bytes: number;
  wal_bytes: number;
  free_bytes: number;
  available_bytes: number;
  required_free_bytes: number;
  conversation_count: number;
  messages: Array<{ message_type: string; count: number; content_bytes: number }>;
};

export type DatabaseCompactionResult = {
  before_bytes: number;
  after_bytes: number;
  reclaimed_bytes: number;
};

export type DatabaseMaintenanceAction = 'inspect' | 'compact' | 'restart';
export type DatabaseMaintenancePhase =
  | 'idle'
  | 'inspecting'
  | 'preparing'
  | 'stopping'
  | 'compacting'
  | 'restarting'
  | 'done'
  | 'error';

export type DatabaseMaintenanceStatus = {
  phase: DatabaseMaintenancePhase;
  busy: boolean;
  startedAt: number | null;
  inspectedAt: number | null;
  usage: DatabaseUsage | null;
  result: DatabaseCompactionResult | null;
  error: string | null;
  restartRequired: boolean;
};
