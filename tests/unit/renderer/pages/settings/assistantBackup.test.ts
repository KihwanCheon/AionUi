import { buildAssistantBackupFileName, isAssistantBackupFile } from '@/renderer/hooks/assistant/useAssistantBackup';
import { describe, expect, it } from 'vitest';

describe('assistant backup format', () => {
  it('builds a filesystem-safe timestamped file name', () => {
    expect(buildAssistantBackupFileName(Date.UTC(2026, 6, 24, 12, 34, 56))).toBe(
      'aionui-assistants-backup-2026-07-24T12-34-56.json'
    );
  });

  it('accepts the assistant backup envelope and rejects unrelated JSON', () => {
    expect(
      isAssistantBackupFile({
        type: 'aionui-assistants-backup',
        version: 1,
        exported_at: 1,
        assistants: [],
      })
    ).toBe(true);
    expect(isAssistantBackupFile({ type: 'aionui-assistants-backup', assistants: null })).toBe(false);
    expect(isAssistantBackupFile({ assistants: [] })).toBe(false);
  });
});
