/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICronJob } from '@/common/adapter/ipcBridge';
import {
  buildCronJobBackupFileName,
  isCronJobBackupFile,
  toCronAgentConfigWrite,
  toCronJobCreateParams,
  toCronJobUpdateParams,
  toPostCreateUpdates,
} from '@/renderer/pages/cron/useCronJobBackup';
import { describe, expect, it } from 'vitest';

const makeJob = (overrides: Partial<ICronJob> = {}): ICronJob => ({
  id: 'cron_1',
  name: 'Daily report',
  description: 'Summarize the day',
  enabled: false,
  schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Seoul', description: 'Every day at 09:00' },
  target: { payload: { kind: 'message', text: 'Write the report' }, execution_mode: 'new_conversation' },
  metadata: {
    conversation_id: 'conv_1',
    conversation_title: 'Reports',
    agent_type: 'acp',
    created_by: 'user',
    created_at: 1,
    updated_at: 2,
    agent_config: {
      name: 'Claude',
      cli_path: '/usr/bin/claude',
      is_preset: true,
      assistant_id: 'assistant-1',
      custom_agent_id: 'legacy-1',
      mode: 'yolo',
      model_id: 'claude-sonnet-5',
      config_options: { effort: 'high' },
      workspace: 'D:/work',
    },
  },
  state: { run_count: 4, retry_count: 0, max_retries: 5, queue_enabled: true, last_status: 'ok' },
  ...overrides,
});

describe('cron job backup format', () => {
  it('builds a filesystem-safe timestamped file name', () => {
    expect(buildCronJobBackupFileName(Date.UTC(2026, 8, 19, 12, 34, 56))).toBe(
      'aionui-cron-jobs-backup-2026-09-19T12-34-56.json'
    );
  });

  it('accepts the cron backup envelope and rejects unrelated JSON', () => {
    expect(isCronJobBackupFile({ type: 'aionui-cron-jobs-backup', version: 1, exported_at: 1, jobs: [] })).toBe(true);
    expect(isCronJobBackupFile({ type: 'aionui-cron-jobs-backup', jobs: null })).toBe(false);
    expect(isCronJobBackupFile({ type: 'aionui-assistants-backup', assistants: [] })).toBe(false);
    expect(isCronJobBackupFile({ jobs: [] })).toBe(false);
  });
});

describe('cron job restore mapping', () => {
  it('strips read-only agent config fields the backend rejects', () => {
    expect(toCronAgentConfigWrite(makeJob().metadata.agent_config)).toEqual({
      name: 'Claude',
      assistant_id: 'assistant-1',
      mode: 'yolo',
      model_id: 'claude-sonnet-5',
      model: undefined,
      config_options: { effort: 'high' },
      workspace: 'D:/work',
    });
    expect(toCronAgentConfigWrite(undefined)).toBeUndefined();
  });

  it('falls back to the legacy assistant identity when assistant_id is missing', () => {
    const legacy = makeJob().metadata.agent_config!;
    delete legacy.assistant_id;
    expect(toCronAgentConfigWrite(legacy)?.assistant_id).toBe('legacy-1');
  });

  it('builds an import-compatible create request from a listed job', () => {
    const params = toCronJobCreateParams(makeJob());
    expect(params).toEqual({
      name: 'Daily report',
      description: 'Summarize the day',
      schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Seoul', description: 'Every day at 09:00' },
      prompt: 'Write the report',
      conversation_id: 'conv_1',
      conversation_title: 'Reports',
      created_by: 'user',
      execution_mode: 'new_conversation',
      queue_enabled: true,
      agent_config: expect.objectContaining({ assistant_id: 'assistant-1' }),
    });
    expect(params).not.toHaveProperty('id');
  });

  it('overwrites a new-conversation job including its assistant', () => {
    const job = makeJob();
    const updates = toCronJobUpdateParams(job, makeJob({ id: 'cron_other' }));
    expect(updates.name).toBe('Daily report');
    expect(updates.enabled).toBe(false);
    expect(updates.target).toEqual({
      payload: { kind: 'message', text: 'Write the report' },
      execution_mode: 'new_conversation',
    });
    expect(updates.metadata?.agent_config?.assistant_id).toBe('assistant-1');
    expect(updates.state).toEqual({ max_retries: 5, queue_enabled: true });
  });

  it('keeps the assistant untouched when either side runs in an ongoing conversation', () => {
    const ongoing = makeJob({ target: { payload: { kind: 'message', text: 'x' }, execution_mode: 'existing' } });
    const fresh = makeJob();
    expect(toCronJobUpdateParams(ongoing, fresh).metadata?.agent_config).toBeUndefined();
    expect(toCronJobUpdateParams(fresh, ongoing).metadata?.agent_config).toBeUndefined();

    // Jobs stored before execution_mode existed default to the ongoing conversation.
    const legacy = makeJob({ target: { payload: { kind: 'message', text: 'x' } } });
    expect(toCronJobUpdateParams(fresh, legacy).metadata?.agent_config).toBeUndefined();
  });

  it('only issues a follow-up update when creation defaults differ from the backup', () => {
    const created = makeJob({ id: 'cron_new', enabled: true, state: { ...makeJob().state, max_retries: 3 } });
    expect(toPostCreateUpdates(created, makeJob())).toEqual({ enabled: false, state: { max_retries: 5 } });

    const alreadyMatching = makeJob({ enabled: true, state: { ...makeJob().state, max_retries: 3 } });
    expect(toPostCreateUpdates(created, alreadyMatching)).toBeNull();
  });
});
