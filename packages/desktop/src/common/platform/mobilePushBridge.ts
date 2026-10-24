import type {
  MobilePushLabels,
  MobilePushNotice,
  MobilePushOperation,
  MobilePushOptions,
  MobilePushPairing,
  MobilePushResult,
  MobilePushStatus,
} from '../types/platform/mobilePush';

type Invoke<T, P> = [P] extends [void]
  ? () => Promise<MobilePushResult<T>>
  : (params: P) => Promise<MobilePushResult<T>>;

function command<T, P = void>(operation: MobilePushOperation): { invoke: Invoke<T, P> } {
  return {
    invoke: (async (data?: P): Promise<MobilePushResult<T>> => {
      const api = typeof window !== 'undefined' ? window.electronAPI?.mobilePushRequest : undefined;
      if (!api) return { ok: false, error: 'unsupported' };
      try {
        return (await api({ operation, data })) as MobilePushResult<T>;
      } catch {
        return { ok: false, error: 'firebase' };
      }
    }) as Invoke<T, P>,
  };
}

/** Uses a dedicated, main-window-only preload endpoint rather than WebUI broadcasts. */
export const mobilePushBridge = {
  available: (): boolean =>
    typeof window !== 'undefined' && typeof window.electronAPI?.mobilePushRequest === 'function',
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
      return (typeof window !== 'undefined' && window.electronAPI?.onMobilePushChanged?.(listener)) || (() => {});
    },
  },
};
