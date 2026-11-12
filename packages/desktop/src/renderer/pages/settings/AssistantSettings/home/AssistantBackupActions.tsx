/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAssistantBackup } from '@/renderer/hooks/assistant';
import { Button } from '@arco-design/web-react';
import { Download, Upload } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Self-contained backup / restore actions for custom assistants. Owns the
 * backup hook and refreshes the list via the `assistant.list.refresh` event,
 * so the host only needs to render it — no prop wiring. Kept separate from
 * AssistantListPanel to minimize edits to that upstream-owned file.
 */
const AssistantBackupActions: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { t } = useTranslation();
  const { backupAssistants, backingUp, restoreAssistants, restoring } = useAssistantBackup();

  return (
    <div className='flex items-stretch gap-8px'>
      <Button
        type='outline'
        size='small'
        loading={backingUp}
        className={`!flex-1 !rounded-8px ${compact ? '!h-36px' : '!h-32px !px-8px'}`}
        icon={<Download size={14} fill='currentColor' />}
        onClick={() => void backupAssistants()}
        data-testid='btn-backup-assistants'
      >
        {t('settings.assistantBackup', { defaultValue: 'Backup' })}
      </Button>
      <Button
        type='outline'
        size='small'
        loading={restoring}
        className={`!flex-1 !rounded-8px ${compact ? '!h-36px' : '!h-32px !px-8px'}`}
        icon={<Upload size={14} fill='currentColor' />}
        onClick={() => void restoreAssistants()}
        data-testid='btn-restore-assistants'
      >
        {t('settings.assistantRestore', { defaultValue: 'Restore' })}
      </Button>
    </div>
  );
};

export default AssistantBackupActions;
