import type {
  MobilePushLabels,
  MobilePushNotice,
  MobilePushOperation,
  MobilePushOptions,
  MobilePushPairing,
  MobilePushResult,
  MobilePushStatus,
} from '../../types/platform/mobilePush';
import { httpRequest } from '../../adapter/httpBridge';

let webCsrfToken = '';
type WebReply<T> = { result: MobilePushResult<T>; csrfToken: string };

async function invokeWeb<T>(operation: MobilePushOperation, data: unknown): Promise<MobilePushResult<T>> {
  if (operation === 'configure' || operation === 'sync') return { ok: false, error: 'unsupported' };
  try {
    if (operation === 'status' || !webCsrfToken) {
      const reply = await httpRequest<WebReply<T>>('GET', '/api/mobile-push', undefined, {
        silentStatuses: [401, 404, 503],
      });
      webCsrfToken = reply.csrfToken;
      if (operation === 'status' || !reply.result.ok) return reply.result;
    }
    const reply = await httpRequest<WebReply<T>>('POST', '/api/mobile-push', {
      csrfToken: webCsrfToken,
      request: { operation, data },
    });
    webCsrfToken = reply.csrfToken;
    return reply.result;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 429) return { ok: false, error: 'rateLimited' };
    if (status === 401 || status === 403) {
      webCsrfToken = '';
      return { ok: false, error: 'identity' };
    }
    return { ok: false, error: status === 404 || status === 503 ? 'unsupported' : 'firebase' };
  }
}

type Invoke<T, P> = [P] extends [void]
  ? () => Promise<MobilePushResult<T>>
  : (params: P) => Promise<MobilePushResult<T>>;

function command<T, P = void>(operation: MobilePushOperation): { invoke: Invoke<T, P> } {
  return {
    invoke: (async (data?: P): Promise<MobilePushResult<T>> => {
      const api = typeof window !== 'undefined' ? window.electronAPI?.mobilePushRequest : undefined;
      if (!api) return invokeWeb<T>(operation, data);
      try {
        return (await api({ operation, data })) as MobilePushResult<T>;
      } catch {
        return { ok: false, error: 'firebase' };
      }
    }) as Invoke<T, P>,
  };
}

/** Uses native IPC on desktop and an authenticated, CSRF-protected host endpoint on WebUI. */
export const mobilePushBridge = {
  available: (): boolean =>
    typeof window !== 'undefined' &&
    (typeof window.electronAPI?.mobilePushRequest === 'function' || /^https?:$/.test(window.location.protocol)),
  status: command<MobilePushStatus>('status'),
  configure: command<MobilePushStatus, { credentialPath: string }>('configure'),
  options: command<MobilePushStatus, MobilePushOptions>('options'),
  pair: command<MobilePushPairing>('pair'),
  refresh: command<MobilePushStatus>('refresh'),
  unlink: command<MobilePushStatus, { deviceId: string }>('unlink'),
  test: command<void, { deviceId: string; title: string; body: string }>('test'),
  sync: command<void, { notices: MobilePushNotice[]; labels: MobilePushLabels }>('sync'),
  changed: {
    on(listener: () => void): () => void {
      if (typeof window === 'undefined') return () => {};
      if (window.electronAPI?.onMobilePushChanged) return window.electronAPI.onMobilePushChanged(listener);
      const timer = window.setInterval(listener, 30000);
      return () => window.clearInterval(timer);
    },
  },
};
