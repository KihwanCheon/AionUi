/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { getBaseUrl } from '@/common/adapter/httpBridge';
import { emitter } from '@/renderer/utils/emitter';
import i18nConfig from '@/common/config/i18n-config.json';
import type { Assistant, CreateAssistantRequest } from '@/common/types/agent/assistantTypes';
import { Message } from '@arco-design/web-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SUPPORTED_LOCALES = i18nConfig.supportedLanguages as string[];

const BACKUP_TYPE = 'aionui-assistants-backup';
const BACKUP_VERSION = 1;

/** One assistant entry in the backup file: an import-compatible request plus its per-locale rules. */
type AssistantBackupEntry = {
  request: CreateAssistantRequest;
  rules_i18n: Record<string, string>;
};

type AssistantBackupFile = {
  type: typeof BACKUP_TYPE;
  version: number;
  exported_at: number;
  assistants: AssistantBackupEntry[];
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * Make the avatar self-contained in the backup. Backend-served avatars are a
 * `/api/assistants/<id>/avatar` URL that breaks once the source assistant is
 * gone (restore uses a fresh id). Fetch the image and inline it as a `data:`
 * URL — the backend stores that verbatim and the UI renders it directly, so it
 * survives restore and restart. Emoji / data / unknown values are kept as-is.
 */
const embedAvatar = async (avatar?: string): Promise<string | undefined> => {
  if (!avatar) return undefined;
  if (avatar.startsWith('data:')) return avatar;
  const isRemote =
    avatar.startsWith('/api/assistants/') || avatar.startsWith('http://') || avatar.startsWith('https://');
  if (!isRemote) return avatar;
  try {
    const url = avatar.startsWith('/') ? `${getBaseUrl()}${avatar}` : avatar;
    const res = await fetch(url);
    if (!res.ok) return avatar;
    return await blobToDataUrl(await res.blob());
  } catch {
    return avatar;
  }
};

/** Build the import-compatible request from a (user-owned) assistant list item + its defaults. */
const toCreateRequest = (
  assistant: Assistant,
  defaults: CreateAssistantRequest['defaults'],
  avatar: string | undefined
): CreateAssistantRequest => ({
  id: assistant.id,
  name: assistant.name,
  name_i18n: assistant.name_i18n,
  description: assistant.description,
  description_i18n: assistant.description_i18n,
  avatar,
  agent_id: assistant.agent_id,
  enabled_skills: assistant.enabled_skills,
  custom_skill_names: assistant.custom_skill_names,
  disabled_builtin_skills: assistant.disabled_builtin_skills,
  recommended_prompts: assistant.prompts,
  recommended_prompts_i18n: assistant.prompts_i18n,
  models: assistant.models,
  defaults,
});

/** Read every locale's rules file for an assistant, keeping only non-empty ones. */
const collectRules = async (assistantId: string): Promise<Record<string, string>> => {
  const rules: Record<string, string> = {};
  await Promise.all(
    SUPPORTED_LOCALES.map(async (locale) => {
      try {
        const content = await ipcBridge.fs.readAssistantRule.invoke({ assistant_id: assistantId, locale });
        if (content && content.trim()) {
          rules[locale] = content;
        }
      } catch {
        // No rules for this locale — skip.
      }
    })
  );
  return rules;
};

export const buildAssistantBackupFileName = (timestamp: number): string => {
  // Filesystem-safe ISO-ish stamp (no colons): YYYY-MM-DDTHH-mm-ss.
  const iso = new Date(timestamp).toISOString().slice(0, 19).replace(/:/g, '-');
  return `aionui-assistants-backup-${iso}.json`;
};

/** Narrow an unknown parsed JSON value to a backup file shape. */
export const isAssistantBackupFile = (value: unknown): value is AssistantBackupFile => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AssistantBackupFile>;
  return candidate.type === BACKUP_TYPE && Array.isArray(candidate.assistants);
};

/**
 * Bulk export/restore of user-created (custom) assistants.
 *
 * Export writes an import-compatible JSON file (built-ins excluded) that also
 * carries each assistant's per-locale rules content, since rules are stored
 * separately from the assistant record.
 *
 * Restore re-creates removed assistants under a fresh id (never reusing the
 * backed-up id, which would collide with the soft-deleted tombstone), overwrites
 * existing ones matched by name, and writes per-locale rules. After a restore it
 * emits `assistant.list.refresh` so the list reloads — no caller wiring needed.
 */
export const useAssistantBackup = () => {
  const { t } = useTranslation();
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const backupAssistants = useCallback(async () => {
    if (backingUp) return;
    setBackingUp(true);
    try {
      const all = await ipcBridge.assistants.list.invoke();
      const custom = (all ?? []).filter((assistant) => assistant.source === 'user');
      if (custom.length === 0) {
        Message.warning(t('settings.assistantBackupEmpty', { defaultValue: 'No custom assistants to back up' }));
        return;
      }

      const folders = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory', 'createDirectory'] });
      const targetDir = folders?.[0];
      if (!targetDir) return; // user cancelled

      const entries = await Promise.all(
        custom.map(async (assistant): Promise<AssistantBackupEntry> => {
          const detail = await ipcBridge.assistants.get.invoke({ id: assistant.id });
          const rules_i18n = await collectRules(assistant.id);
          const avatar = await embedAvatar(assistant.avatar);
          return { request: toCreateRequest(assistant, detail?.defaults, avatar), rules_i18n };
        })
      );

      const timestamp = Date.now();
      const payload: AssistantBackupFile = {
        type: BACKUP_TYPE,
        version: BACKUP_VERSION,
        exported_at: timestamp,
        assistants: entries,
      };
      const targetPath = `${targetDir.replace(/[\\/]+$/, '')}/${buildAssistantBackupFileName(timestamp)}`;
      const result = await ipcBridge.dialog.writeUserFile.invoke({
        path: targetPath,
        data: JSON.stringify(payload, null, 2),
      });
      if (!result?.success) {
        console.error('Failed to write backup file:', result?.error);
        Message.error(t('settings.assistantBackupFailed', { defaultValue: 'Failed to back up assistants' }));
        return;
      }
      Message.success(
        t('settings.assistantBackupSuccess', {
          defaultValue: 'Backed up {{count}} assistant(s)',
          count: entries.length,
        })
      );
    } catch (error) {
      console.error('Failed to back up assistants:', error);
      Message.error(t('settings.assistantBackupFailed', { defaultValue: 'Failed to back up assistants' }));
    } finally {
      setBackingUp(false);
    }
  }, [backingUp, t]);

  const restoreAssistants = useCallback(async () => {
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
        Message.error(t('settings.assistantRestoreInvalid', { defaultValue: 'Not a valid assistant backup file' }));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(read.content);
      } catch {
        parsed = null;
      }
      if (!isAssistantBackupFile(parsed)) {
        Message.error(t('settings.assistantRestoreInvalid', { defaultValue: 'Not a valid assistant backup file' }));
        return;
      }

      // Existing user assistants, indexed for match: same id → overwrite in place;
      // same name but different/no id → overwrite that one; otherwise create new.
      // A deleted assistant leaves a soft-deleted definition behind, so when we
      // create we never reuse the backed-up id (would collide with the tombstone).
      const existing = await ipcBridge.assistants.list.invoke();
      const userAssistants = (existing ?? []).filter((a) => a.source === 'user');
      const byId = new Map(userAssistants.map((a) => [a.id, a]));
      const byName = new Map(userAssistants.map((a) => [a.name, a]));
      // Ids that existed before this restore — anything new with the same name
      // after a failed create is an orphan to clean up.
      const originalIds = new Set(userAssistants.map((a) => a.id));

      const writeRules = (assistantId: string, rules: Record<string, string>) =>
        Promise.all(
          Object.entries(rules ?? {}).map(([locale, content]) =>
            ipcBridge.fs.writeAssistantRule.invoke({ assistant_id: assistantId, content, locale })
          )
        );

      // A non-atomic backend create can insert the assistants row before failing,
      // leaving an "active row + deleted definition" orphan that breaks the next
      // startup's assistant bootstrap. After a failed create, remove any newly
      // appeared row with this name to keep storage consistent.
      const cleanupOrphan = async (name: string): Promise<void> => {
        try {
          const after = await ipcBridge.assistants.list.invoke();
          const orphan = (after ?? []).find((a) => a.source === 'user' && a.name === name && !originalIds.has(a.id));
          if (orphan) {
            await ipcBridge.assistants.delete.invoke({ id: orphan.id });
          }
        } catch (cleanupError) {
          console.error('Failed to clean up orphaned assistant after restore failure:', name, cleanupError);
        }
      };

      let imported = 0;
      let updated = 0;
      let skipped = 0;
      for (const entry of parsed.assistants) {
        const target = (entry.request.id ? byId.get(entry.request.id) : undefined) ?? byName.get(entry.request.name);
        try {
          if (target) {
            // Overwrite the existing assistant in place (keeps its id).
            const { id: _backupId, ...rest } = entry.request;
            await ipcBridge.assistants.update.invoke({ id: target.id, ...rest });
            await writeRules(target.id, entry.rules_i18n);
            updated += 1;
          } else {
            // Restore a removed assistant under a fresh backend-assigned id.
            const { id: _backupId, ...rest } = entry.request;
            const created = await ipcBridge.assistants.create.invoke(rest);
            byId.set(created.id, created);
            byName.set(created.name, created);
            await writeRules(created.id, entry.rules_i18n);
            imported += 1;
          }
        } catch (entryError) {
          console.error('Failed to restore assistant:', entry.request.name, entryError);
          // A new assistant create may have orphaned a row before failing; clean it up.
          if (!target) {
            await cleanupOrphan(entry.request.name);
          }
          skipped += 1;
        }
      }

      emitter.emit('assistant.list.refresh');
      Message.success(
        t('settings.assistantRestoreSuccess', {
          defaultValue: 'Restored: {{imported}} new, {{updated}} overwritten, {{skipped}} failed',
          imported,
          updated,
          skipped,
        })
      );
    } catch (error) {
      console.error('Failed to restore assistants:', error);
      Message.error(t('settings.assistantRestoreFailed', { defaultValue: 'Failed to restore assistants' }));
    } finally {
      setRestoring(false);
    }
  }, [restoring, t]);

  return { backupAssistants, backingUp, restoreAssistants, restoring };
};
