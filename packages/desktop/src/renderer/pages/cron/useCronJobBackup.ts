/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  ICreateCronJobParams,
  ICronAgentConfigRead,
  ICronAgentConfigWrite,
  ICronJob,
  ICronJobUpdateParams,
} from '@/common/adapter/ipcBridge';
import { Message } from '@arco-design/web-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

const BACKUP_TYPE = 'aionui-cron-jobs-backup';
const BACKUP_VERSION = 1;

type CronJobBackupFile = {
  type: typeof BACKUP_TYPE;
  version: number;
  exported_at: number;
  /** Jobs exactly as the backend listed them, so the file stays self-describing. */
  jobs: ICronJob[];
};

export const buildCronJobBackupFileName = (timestamp: number): string => {
  // Filesystem-safe ISO-ish stamp (no colons): YYYY-MM-DDTHH-mm-ss.
  const iso = new Date(timestamp).toISOString().slice(0, 19).replace(/:/g, '-');
  return `aionui-cron-jobs-backup-${iso}.json`;
};

/** Narrow an unknown parsed JSON value to a backup file shape. */
export const isCronJobBackupFile = (value: unknown): value is CronJobBackupFile => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CronJobBackupFile>;
  return candidate.type === BACKUP_TYPE && Array.isArray(candidate.jobs);
};

/** Minimal shape check so a hand-edited entry fails as "skipped" instead of throwing mid-loop. */
const isRestorableCronJob = (value: unknown): value is ICronJob => {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<ICronJob>;
  return (
    typeof job.name === 'string' &&
    Boolean(job.schedule) &&
    typeof job.target?.payload?.text === 'string' &&
    Boolean(job.metadata) &&
    Boolean(job.state)
  );
};

/**
 * Keep only the fields the write DTO accepts. The backend rejects the legacy
 * read-only fields (`is_preset`, `custom_agent_id`) with deny_unknown_fields,
 * and a legacy job that only carries `custom_agent_id` is re-created under
 * that id so the assistant lookup still resolves.
 */
export const toCronAgentConfigWrite = (config: ICronAgentConfigRead | undefined): ICronAgentConfigWrite | undefined => {
  if (!config) return undefined;
  return {
    name: config.name,
    assistant_id: config.assistant_id ?? config.custom_agent_id,
    mode: config.mode,
    model_id: config.model_id,
    model: config.model,
    config_options: config.config_options,
    workspace: config.workspace,
  };
};

// Jobs stored before execution_mode existed run in their conversation; the
// task editor applies the same default.
const isOngoingConversationJob = (job: Pick<ICronJob, 'target'>): boolean =>
  (job.target.execution_mode ?? 'existing') === 'existing';

/** Build the create request for a job that no longer exists. */
export const toCronJobCreateParams = (job: ICronJob): ICreateCronJobParams => ({
  name: job.name,
  description: job.description,
  schedule: job.schedule,
  prompt: job.target.payload.text,
  conversation_id: job.metadata.conversation_id,
  conversation_title: job.metadata.conversation_title,
  created_by: job.metadata.created_by,
  execution_mode: job.target.execution_mode,
  queue_enabled: job.state.queue_enabled,
  agent_config: toCronAgentConfigWrite(job.metadata.agent_config),
});

/** Build the in-place overwrite for a job matched by id or name. */
export const toCronJobUpdateParams = (job: ICronJob, target: ICronJob): ICronJobUpdateParams => {
  const metadata: ICronJobUpdateParams['metadata'] = {
    conversation_title: job.metadata.conversation_title,
  };
  // The backend refuses assistant changes when either the current or the
  // requested mode keeps running in an ongoing conversation.
  if (!isOngoingConversationJob(job) && !isOngoingConversationJob(target)) {
    metadata.agent_config = toCronAgentConfigWrite(job.metadata.agent_config);
  }
  return {
    name: job.name,
    description: job.description,
    enabled: job.enabled,
    schedule: job.schedule,
    target: {
      payload: { kind: 'message', text: job.target.payload.text },
      execution_mode: job.target.execution_mode,
    },
    metadata,
    state: {
      max_retries: job.state.max_retries,
      queue_enabled: job.state.queue_enabled,
    },
  };
};

/**
 * Creation always yields an enabled job with the backend's default retry
 * budget, so a paused or tuned job needs one follow-up update.
 */
export const toPostCreateUpdates = (created: ICronJob, job: ICronJob): ICronJobUpdateParams | null => {
  const updates: ICronJobUpdateParams = {};
  if (created.enabled && !job.enabled) {
    updates.enabled = false;
  }
  if (created.state.max_retries !== job.state.max_retries) {
    updates.state = { max_retries: job.state.max_retries };
  }
  return Object.keys(updates).length > 0 ? updates : null;
};

/**
 * Bulk export/restore of scheduled tasks (cron jobs), mirroring the assistant
 * backup: export writes the job list to a user-chosen folder; restore
 * overwrites jobs matched by id or name in place and re-creates the rest under
 * a fresh backend-assigned id. The list refreshes through the cron WebSocket
 * events, so callers only render the actions.
 *
 * Skill files attached to a job are not part of the backup: the backend only
 * exposes whether one exists, not its content.
 */
export const useCronJobBackup = () => {
  const { t } = useTranslation();
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const backupCronJobs = useCallback(async () => {
    if (backingUp) return;
    setBackingUp(true);
    try {
      const jobs = (await ipcBridge.cron.listJobs.invoke()) ?? [];
      if (jobs.length === 0) {
        Message.warning(t('cron.backup.backupEmpty', { defaultValue: 'No scheduled tasks to back up' }));
        return;
      }

      const folders = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory', 'createDirectory'] });
      const targetDir = folders?.[0];
      if (!targetDir) return; // user cancelled

      const timestamp = Date.now();
      const payload: CronJobBackupFile = {
        type: BACKUP_TYPE,
        version: BACKUP_VERSION,
        exported_at: timestamp,
        jobs,
      };
      const targetPath = `${targetDir.replace(/[\\/]+$/, '')}/${buildCronJobBackupFileName(timestamp)}`;
      const result = await ipcBridge.dialog.writeUserFile.invoke({
        path: targetPath,
        data: JSON.stringify(payload, null, 2),
      });
      if (!result?.success) {
        console.error('Failed to write scheduled task backup file:', result?.error);
        Message.error(t('cron.backup.backupFailed', { defaultValue: 'Failed to back up scheduled tasks' }));
        return;
      }
      Message.success(
        t('cron.backup.backupSuccess', {
          defaultValue: 'Backed up {{count}} scheduled task(s)',
          count: jobs.length,
        })
      );
    } catch (error) {
      console.error('Failed to back up scheduled tasks:', error);
      Message.error(t('cron.backup.backupFailed', { defaultValue: 'Failed to back up scheduled tasks' }));
    } finally {
      setBackingUp(false);
    }
  }, [backingUp, t]);

  const restoreCronJobs = useCallback(async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const files = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      const sourcePath = files?.[0];
      if (!sourcePath) return; // user cancelled

      const read = await ipcBridge.dialog.readUserFile.invoke({ path: sourcePath });
      if (!read?.success || !read.content) {
        Message.error(t('cron.backup.restoreInvalid', { defaultValue: 'Not a valid scheduled task backup file' }));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(read.content);
      } catch {
        parsed = null;
      }
      if (!isCronJobBackupFile(parsed)) {
        Message.error(t('cron.backup.restoreInvalid', { defaultValue: 'Not a valid scheduled task backup file' }));
        return;
      }

      // Existing jobs, indexed for match: same id → overwrite in place; same
      // name but different/no id → overwrite that one; otherwise create new.
      const existing = (await ipcBridge.cron.listJobs.invoke()) ?? [];
      const byId = new Map(existing.map((job) => [job.id, job]));
      const byName = new Map(existing.map((job) => [job.name, job]));

      let imported = 0;
      let updated = 0;
      let skipped = 0;
      for (const entry of parsed.jobs) {
        if (!isRestorableCronJob(entry)) {
          console.error('Skipping malformed scheduled task backup entry');
          skipped += 1;
          continue;
        }
        const target = byId.get(entry.id) ?? byName.get(entry.name);
        let created: ICronJob | undefined;
        try {
          if (target) {
            await ipcBridge.cron.updateJob.invoke({ job_id: target.id, updates: toCronJobUpdateParams(entry, target) });
            updated += 1;
          } else {
            created = await ipcBridge.cron.addJob.invoke(toCronJobCreateParams(entry));
            byId.set(created.id, created);
            byName.set(created.name, created);
            imported += 1;
          }
        } catch (entryError) {
          console.error('Failed to restore scheduled task:', entry.name, entryError);
          skipped += 1;
          continue;
        }
        // The job exists at this point; a failed pause/retry adjustment leaves
        // it enabled with defaults rather than counting as a failed restore.
        const postCreate = created ? toPostCreateUpdates(created, entry) : null;
        if (created && postCreate) {
          try {
            await ipcBridge.cron.updateJob.invoke({ job_id: created.id, updates: postCreate });
          } catch (stateError) {
            console.error('Failed to restore scheduled task state:', entry.name, stateError);
          }
        }
      }

      Message.success(
        t('cron.backup.restoreSuccess', {
          defaultValue: 'Restored: {{imported}} new, {{updated}} overwritten, {{skipped}} failed',
          imported,
          updated,
          skipped,
        })
      );
    } catch (error) {
      console.error('Failed to restore scheduled tasks:', error);
      Message.error(t('cron.backup.restoreFailed', { defaultValue: 'Failed to restore scheduled tasks' }));
    } finally {
      setRestoring(false);
    }
  }, [restoring, t]);

  return { backupCronJobs, backingUp, restoreCronJobs, restoring };
};
