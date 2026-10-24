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

let window: BrowserWindow | undefined;
let manager: MobilePushManager | undefined;
let installed = false;
const startedAt = Date.now();

/** Only the application renderer may import keys, pair phones, or enqueue pushes. */
export function setMobilePushWindow(value: BrowserWindow): void {
  window = value;
  value.once('closed', () => {
    if (window === value) {
      window = undefined;
      manager?.stop();
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
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: error instanceof MobilePushFault ? error.code : 'firebase' };
    }
  });
  app?.once('before-quit', () => manager?.stop());
}
