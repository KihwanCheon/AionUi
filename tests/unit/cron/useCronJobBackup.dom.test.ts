/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICronJob } from '@/common/adapter/ipcBridge';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  addJobMock,
  errorMock,
  listJobsMock,
  readUserFileMock,
  showOpenMock,
  successMock,
  updateJobMock,
  warningMock,
  writeUserFileMock,
} = vi.hoisted(() => ({
  addJobMock: vi.fn(),
  errorMock: vi.fn(),
  listJobsMock: vi.fn(),
  readUserFileMock: vi.fn(),
  showOpenMock: vi.fn(),
  successMock: vi.fn(),
  updateJobMock: vi.fn(),
  warningMock: vi.fn(),
  writeUserFileMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    cron: {
      listJobs: { invoke: listJobsMock },
      addJob: { invoke: addJobMock },
      updateJob: { invoke: updateJobMock },
    },
    dialog: {
      readUserFile: { invoke: readUserFileMock },
      showOpen: { invoke: showOpenMock },
      writeUserFile: { invoke: writeUserFileMock },
    },
  },
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    error: errorMock,
    success: successMock,
    warning: warningMock,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? { key, ...options } : key),
  }),
}));

import { useCronJobBackup } from '@/renderer/pages/cron/useCronJobBackup';

const makeJob = (overrides: Partial<ICronJob> = {}): ICronJob => ({
  id: 'cron_1',
  name: 'Daily report',
  enabled: true,
  schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Seoul', description: 'Every day at 09:00' },
  target: { payload: { kind: 'message', text: 'Write the report' }, execution_mode: 'new_conversation' },
  metadata: {
    conversation_id: '',
    agent_type: 'acp',
    created_by: 'user',
    created_at: 1,
    updated_at: 2,
    agent_config: { name: 'Claude', assistant_id: 'assistant-1' },
  },
  state: { run_count: 0, retry_count: 0, max_retries: 3, queue_enabled: false },
  ...overrides,
});

const backupFile = (jobs: unknown[]) =>
  JSON.stringify({ type: 'aionui-cron-jobs-backup', version: 1, exported_at: 1, jobs });

describe('cron job backup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('warns and skips the folder dialog when there is nothing to back up', async () => {
    listJobsMock.mockResolvedValue([]);
    const { result } = renderHook(() => useCronJobBackup());

    await act(async () => {
      await result.current.backupCronJobs();
    });

    expect(warningMock).toHaveBeenCalledWith(expect.objectContaining({ key: 'cron.backup.backupEmpty' }));
    expect(showOpenMock).not.toHaveBeenCalled();
    expect(writeUserFileMock).not.toHaveBeenCalled();
  });

  it('writes every listed job into a typed envelope in the chosen folder', async () => {
    const jobs = [makeJob(), makeJob({ id: 'cron_2', name: 'Weekly digest' })];
    listJobsMock.mockResolvedValue(jobs);
    showOpenMock.mockResolvedValue(['D:/backups/']);
    writeUserFileMock.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useCronJobBackup());

    await act(async () => {
      await result.current.backupCronJobs();
    });

    expect(writeUserFileMock).toHaveBeenCalledTimes(1);
    const [{ path, data }] = writeUserFileMock.mock.calls[0];
    expect(path).toMatch(/^D:\/backups\/aionui-cron-jobs-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);
    const parsed = JSON.parse(data);
    expect(parsed.type).toBe('aionui-cron-jobs-backup');
    expect(parsed.version).toBe(1);
    expect(parsed.jobs).toEqual(jobs);
    expect(successMock).toHaveBeenCalledWith(expect.objectContaining({ key: 'cron.backup.backupSuccess', count: 2 }));
    expect(result.current.backingUp).toBe(false);
  });

  it('reports a failed write without claiming success', async () => {
    listJobsMock.mockResolvedValue([makeJob()]);
    showOpenMock.mockResolvedValue(['D:/backups']);
    writeUserFileMock.mockResolvedValue({ success: false, error: 'EACCES' });
    const { result } = renderHook(() => useCronJobBackup());

    await act(async () => {
      await result.current.backupCronJobs();
    });

    expect(errorMock).toHaveBeenCalledWith(expect.objectContaining({ key: 'cron.backup.backupFailed' }));
    expect(successMock).not.toHaveBeenCalled();
  });
});

describe('cron job restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('treats an empty file selection as cancellation', async () => {
    showOpenMock.mockResolvedValue([]);
    const { result } = renderHook(() => useCronJobBackup());

    await act(async () => {
      await result.current.restoreCronJobs();
    });

    expect(readUserFileMock).not.toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();
  });

  it('reports malformed JSON without attempting a restore', async () => {
    showOpenMock.mockResolvedValue(['D:/backup.json']);
    readUserFileMock.mockResolvedValue({ success: true, content: '{invalid' });
    const { result } = renderHook(() => useCronJobBackup());

    await act(async () => {
      await result.current.restoreCronJobs();
    });

    expect(errorMock).toHaveBeenCalledWith(expect.objectContaining({ key: 'cron.backup.restoreInvalid' }));
    expect(listJobsMock).not.toHaveBeenCalled();
    expect(result.current.restoring).toBe(false);
  });

  it('rejects a backup file of another type', async () => {
    showOpenMock.mockResolvedValue(['D:/backup.json']);
    readUserFileMock.mockResolvedValue({
      success: true,
      content: JSON.stringify({ type: 'aionui-assistants-backup', assistants: [] }),
    });
    const { result } = renderHook(() => useCronJobBackup());

    await act(async () => {
      await result.current.restoreCronJobs();
    });

    expect(errorMock).toHaveBeenCalledWith(expect.objectContaining({ key: 'cron.backup.restoreInvalid' }));
    expect(addJobMock).not.toHaveBeenCalled();
  });

  it('overwrites matches in place, re-creates the rest, and counts failures', async () => {
    const existingById = makeJob({ id: 'cron_1', name: 'Renamed locally' });
    const existingByName = makeJob({ id: 'cron_9', name: 'Weekly digest' });
    listJobsMock.mockResolvedValue([existingById, existingByName]);
    showOpenMock.mockResolvedValue(['D:/backup.json']);
    readUserFileMock.mockResolvedValue({
      success: true,
      content: backupFile([
        makeJob({ id: 'cron_1', name: 'Daily report' }),
        makeJob({ id: 'cron_x', name: 'Weekly digest' }),
        makeJob({
          id: 'cron_gone',
          name: 'Paused check',
          enabled: false,
          state: { run_count: 0, retry_count: 0, max_retries: 7, queue_enabled: true },
        }),
        makeJob({ id: 'cron_bad', name: 'Broken' }),
        { name: 'not a job' },
      ]),
    });
    updateJobMock.mockResolvedValue(undefined);
    addJobMock.mockImplementation(async (params: { name: string }) => {
      if (params.name === 'Broken') throw new Error('assistant not found');
      return makeJob({ id: 'cron_new', name: params.name, enabled: true });
    });
    const { result } = renderHook(() => useCronJobBackup());

    await act(async () => {
      await result.current.restoreCronJobs();
    });

    // Matched by id → overwritten under its current id; matched by name → overwritten under that id.
    expect(updateJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: 'cron_1', updates: expect.objectContaining({ name: 'Daily report' }) })
    );
    expect(updateJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: 'cron_9', updates: expect.objectContaining({ name: 'Weekly digest' }) })
    );
    // Removed job → created without the backed-up id, then paused with its retry budget.
    expect(addJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Paused check', queue_enabled: true, prompt: 'Write the report' })
    );
    expect(addJobMock.mock.calls.find(([params]) => params.name === 'Paused check')?.[0]).not.toHaveProperty('id');
    expect(updateJobMock).toHaveBeenCalledWith({
      job_id: 'cron_new',
      updates: { enabled: false, state: { max_retries: 7 } },
    });
    expect(successMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'cron.backup.restoreSuccess', imported: 1, updated: 2, skipped: 2 })
    );
    expect(result.current.restoring).toBe(false);
  });

  it('does not pause a re-created job that was enabled with default retries', async () => {
    listJobsMock.mockResolvedValue([]);
    showOpenMock.mockResolvedValue(['D:/backup.json']);
    readUserFileMock.mockResolvedValue({ success: true, content: backupFile([makeJob()]) });
    addJobMock.mockResolvedValue(makeJob({ id: 'cron_new' }));
    const { result } = renderHook(() => useCronJobBackup());

    await act(async () => {
      await result.current.restoreCronJobs();
    });

    expect(addJobMock).toHaveBeenCalledTimes(1);
    expect(updateJobMock).not.toHaveBeenCalled();
    expect(successMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'cron.backup.restoreSuccess', imported: 1, updated: 0, skipped: 0 })
    );
  });
});
