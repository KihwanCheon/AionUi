/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCronJobBackup } from '@renderer/pages/cron/useCronJobBackup';
import { Button } from '@arco-design/web-react';
import { Download, Upload } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Self-contained backup / restore actions for scheduled tasks. Owns the
 * backup hook; the task list refreshes through the cron WebSocket events, so
 * the host only needs to render it — no prop wiring. Kept separate from the
 * page to minimize edits to that upstream-owned file.
 */
const CronJobBackupActions: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { t } = useTranslation();
  const { backupCronJobs, backingUp, restoreCronJobs, restoring } = useCronJobBackup();

  return (
    <div className='flex items-stretch gap-8px'>
      <Button
        type='outline'
        size='small'
        loading={backingUp}
        className={`!flex-1 !rounded-8px ${compact ? '!h-36px' : '!h-32px !px-8px'}`}
        icon={<Download size={14} fill='currentColor' />}
        onClick={() => void backupCronJobs()}
        data-testid='btn-backup-cron-jobs'
      >
        {t('cron.backup.backup', { defaultValue: 'Backup' })}
      </Button>
      <Button
        type='outline'
        size='small'
        loading={restoring}
        className={`!flex-1 !rounded-8px ${compact ? '!h-36px' : '!h-32px !px-8px'}`}
        icon={<Upload size={14} fill='currentColor' />}
        onClick={() => void restoreCronJobs()}
        data-testid='btn-restore-cron-jobs'
      >
        {t('cron.backup.restore', { defaultValue: 'Restore' })}
      </Button>
    </div>
  );
};

export default CronJobBackupActions;
