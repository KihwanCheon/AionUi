import { app, ipcMain, safeStorage, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { ipcBridge } from '@/common';
import {
  MOBILE_PUSH_CHANNEL,
  MOBILE_PUSH_CHANGED,
  type MobilePushLabels,
  type MobilePushNotice,
  type MobilePushOptions,
  type MobilePushResult,
} from '@/common/types/platform/mobilePush';
import { MobilePushManager } from './manager';
import { MobilePushStore } from './store';
import { MobilePushFault, record } from './protocol';
import { resolveNoticeContent } from './contentResolver';
import { startPushRelay } from './relay';
import { createMobilePushWebHandler } from './web';

let window: BrowserWindow | undefined;
let manager: MobilePushManager | undefined;
let installed = false;
const startedAt = Date.now();
let relay: Awaited<ReturnType<typeof startPushRelay>> | undefined;
let startingRelay: Promise<void> | undefined;

async function closePushRelay(): Promise<void> {
  await startingRelay?.catch(() => {});
  const previous = relay;
  relay = undefined;
  await previous?.close();
}

async function updatePushRelay(native: MobilePushManager, userId: string): Promise<void> {
  const status = native.status(userId);
  if (!status.enabled || !status.mnpEnabled) {
    await closePushRelay();
    return;
  }
  if (relay) return;
  startingRelay ??= startPushRelay(async (body) => {
    if (!window || window.isDestroyed()) throw new MobilePushFault('unsupported');
    const current = await ipcBridge.auth.currentUser.invoke();
    return native.enqueueMnp(current.id, body);
  })
    .then((value) => {
      relay = value;
    })
    .finally(() => {
      startingRelay = undefined;
    });
  await startingRelay;
}

/** Only the application renderer may import keys, pair phones, or enqueue pushes. */
export function setMobilePushWindow(value: BrowserWindow): void {
  window = value;
  value.once('closed', () => {
    if (window === value) {
      window = undefined;
      manager?.stop();
      void closePushRelay();
    }
  });
}

function trusted(event: IpcMainInvokeEvent): boolean {
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== event.sender.mainFrame
  )
    return false;
  try {
    const url = new URL(event.senderFrame.url);
    return (
      url.protocol === 'file:' ||
      ((url.protocol === 'http:' || url.protocol === 'https:') &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

function service(): MobilePushManager {
  if (process.platform !== 'win32' || !process.versions.electron) throw new MobilePushFault('unsupported');
  if (manager) return manager;
  const store = new MobilePushStore(
    path.join(app.getPath('userData'), 'mobile-push.json'),
    path.join(
      process.env.LOCALAPPDATA ?? app.getPath('userData'),
      'AionUiPush',
      'firebase',
      'firebase-service-account.json'
    ),
    os.hostname(),
    {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
      decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
    }
  );
  manager = new MobilePushManager(store, {
    startedAt,
    resolveNotice: async (notice) => {
      const content = await resolveNoticeContent(notice, (conversationId, messageId) =>
        ipcBridge.database.getConversationMessage.invoke({ conversation_id: conversationId, message_id: messageId })
      );
      if (content.state !== 'ready' || notice.kind === 'failure') return content;
      const conversation = await ipcBridge.conversation.get.invoke({ id: notice.conversationId });
      return { ...content, conversationName: conversation.name };
    },
    ownsConversation: async (id) => {
      try {
        return (await ipcBridge.conversation.get.invoke({ id }))?.id === id;
      } catch (error) {
        const status = record(error).status;
        if (status === 403 || status === 404) return false;
        throw new MobilePushFault('firebase', true);
      }
    },
    changed: () => {
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send(MOBILE_PUSH_CHANGED);
    },
  });
  return manager;
}

export function initMobilePushProviders(): void {
  if (installed || !ipcMain) return;
  installed = true;
  ipcMain.handle(MOBILE_PUSH_CHANNEL, async (event, request: unknown): Promise<MobilePushResult<unknown>> => {
    if (!trusted(event)) return { ok: false, error: 'unsupported' };
    try {
      const native = service();
      let userId: string;
      try {
        userId = (await ipcBridge.auth.currentUser.invoke()).id;
      } catch {
        throw new MobilePushFault('identity');
      }
      const input = record(request),
        data = record(input.data);
      let value: unknown;
      switch (input.operation) {
        case 'status':
          value = native.status(userId);
          break;
        case 'configure':
          value = await native.configure(userId, data.credentialPath as string);
          break;
        case 'options':
          value = await native.options(userId, data as MobilePushOptions);
          break;
        case 'pair':
          value = await native.pair(userId);
          break;
        case 'refresh':
          value = await native.refresh(userId);
          break;
        case 'unlink':
          value = await native.unlink(userId, data.deviceId as string);
          break;
        case 'test':
          value = await native.test(userId, data.deviceId as string, data.title as string, data.body as string);
          break;
        case 'sync':
          value = native.sync(userId, data.notices as MobilePushNotice[], data.labels as MobilePushLabels);
          break;
        default:
          throw new MobilePushFault('invalidInput');
      }
      await updatePushRelay(native, userId);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: error instanceof MobilePushFault ? error.code : 'firebase' };
    }
  });
  app?.once('before-quit', () => {
    manager?.stop();
    void closePushRelay();
  });
}

/** WebUI may manage an existing desktop profile, but cannot read files or enqueue notices. */
export async function invokeMobilePushForWeb(userId: string, request: unknown): Promise<MobilePushResult<unknown>> {
  try {
    if (!window || window.isDestroyed()) throw new MobilePushFault('unsupported');
    if ((await ipcBridge.auth.currentUser.invoke()).id !== userId) throw new MobilePushFault('identity');
    const input = record(request),
      data = record(input.data);
    const native = service();
    let value: unknown;
    switch (input.operation) {
      case 'status':
        value = native.status(userId);
        break;
      case 'options':
        value = await native.options(userId, data as MobilePushOptions);
        break;
      case 'pair':
        value = await native.pair(userId);
        break;
      case 'refresh':
        value = await native.refresh(userId);
        break;
      case 'unlink':
        value = await native.unlink(userId, data.deviceId as string);
        break;
      case 'test':
        value = await native.test(userId, data.deviceId as string, data.title as string, data.body as string);
        break;
      default:
        throw new MobilePushFault('unsupported');
    }
    if ((await ipcBridge.auth.currentUser.invoke()).id !== userId) throw new MobilePushFault('identity');
    await updatePushRelay(native, userId);
    if (['status', 'options', 'refresh', 'unlink'].includes(String(input.operation)))
      value = { ...record(value), credentialPath: '' };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof MobilePushFault ? error.code : 'identity' };
  }
}

export const handleMobilePushWebRequest = createMobilePushWebHandler(invokeMobilePushForWeb);
