import { createHash, randomUUID } from 'node:crypto';
import type {
  MobilePushError,
  MobilePushLabels,
  MobilePushNotice,
  MobilePushOptions,
  MobilePushPairing,
  MobilePushStatus,
} from '@/common/types/platform/mobilePush';
import { FirebasePushClient } from './firebaseClient';
import { labels, MAX_AGE_MS, MobilePushFault, payload, validNotice, type LinkedDevice } from './protocol';
import type { MobilePushStore } from './store';

type PushClient = Pick<FirebasePushClient, 'devices' | 'pair' | 'unlink' | 'send'>;
type Job = { notice: MobilePushNotice; attempts: number; due: number };
type ManagerDependencies = {
  now?: () => number;
  startedAt?: number;
  client?: (userId: string) => PushClient;
  ownsConversation: (conversationId: string) => Promise<boolean>;
  changed: () => void;
};

/** Delivery belongs to the running desktop process, independent of settings UI focus. */
export class MobilePushManager {
  private readonly now: () => number;
  private readonly startedAt: number;
  private activeAt: number;
  private userId = '';
  private devices: LinkedDevice[] = [];
  private devicesAt = 0;
  private controller = new AbortController();
  private client?: PushClient;
  private timer?: ReturnType<typeof setTimeout>;
  private timerAt = 0;
  private working?: Promise<void>;
  private jobs = new Map<string, Job>();
  private failed = new Set<string>();
  private completed = new Set<string>();
  private invalidTokens = new Set<string>();
  private text?: MobilePushLabels;
  private lastError?: MobilePushError;

  constructor(
    private readonly store: MobilePushStore,
    private readonly dependencies: ManagerDependencies
  ) {
    this.now = dependencies.now ?? Date.now;
    this.startedAt = dependencies.startedAt ?? this.now();
    this.activeAt = this.startedAt;
  }

  private activate(userId: string): void {
    if (this.userId === userId) return;
    this.stop();
    this.activeAt = this.userId ? this.now() : this.startedAt;
    this.userId = userId;
    this.devices = [];
    this.devicesAt = 0;
    this.lastError = undefined;
    this.failed.clear();
    this.completed.clear();
    this.invalidTokens.clear();
  }

  private api(userId: string): PushClient {
    if (this.userId !== userId) throw new MobilePushFault('identity');
    return (this.client ??=
      this.dependencies.client?.(userId) ?? new FirebasePushClient(this.store.credential(userId)));
  }

  status(userId: string): MobilePushStatus {
    this.activate(userId);
    return this.snapshot(userId);
  }

  private snapshot(userId: string): MobilePushStatus {
    const profile = this.store.profile(userId);
    return {
      supported: true,
      secureStorageAvailable: this.store.protection.available(),
      configured: Boolean(profile.ciphertext),
      enabled: profile.enabled,
      includePreview: profile.includePreview,
      credentialPath: profile.credentialPath,
      sourceName: profile.sourceName,
      projectId: profile.projectId,
      devices: this.userId === userId ? this.devices.map(({ id, name, enabled }) => ({ id, name, enabled })) : [],
      lastSentAt: profile.lastSentAt,
      lastError: this.lastError,
    };
  }

  async configure(userId: string, file: string): Promise<MobilePushStatus> {
    this.activate(userId);
    this.stop();
    await this.store.configure(userId, file);
    this.devices = [];
    this.lastError = undefined;
    this.dependencies.changed();
    return this.snapshot(userId);
  }

  async options(userId: string, input: MobilePushOptions): Promise<MobilePushStatus> {
    this.activate(userId);
    if (
      !input ||
      (input.enabled !== undefined && typeof input.enabled !== 'boolean') ||
      (input.includePreview !== undefined && typeof input.includePreview !== 'boolean') ||
      (input.sourceName !== undefined &&
        (typeof input.sourceName !== 'string' || !input.sourceName.trim() || input.sourceName.length > 120))
    )
      throw new MobilePushFault('invalidInput');
    const profile = this.store.profile(userId);
    if (input.enabled === true) {
      this.store.credential(userId);
      if (!profile.enabled) profile.enabledAt = this.now();
    }
    if (input.enabled !== undefined) profile.enabled = input.enabled;
    if (input.enabled === false) this.stop();
    if (input.includePreview !== undefined) profile.includePreview = input.includePreview;
    if (input.sourceName !== undefined) profile.sourceName = input.sourceName.trim();
    try {
      await this.store.save();
    } catch (error) {
      profile.enabled = false;
      this.stop();
      throw error;
    }
    this.dependencies.changed();
    return this.snapshot(userId);
  }

  async refresh(userId: string): Promise<MobilePushStatus> {
    this.activate(userId);
    const profile = this.store.profile(userId);
    const signal = this.controller.signal;
    const devices = await this.api(userId).devices(profile.sourceId, signal);
    if (signal.aborted || this.userId !== userId) throw new MobilePushFault('identity');
    this.devices = devices.map((device) => ({
      ...device,
      enabled: device.enabled && !this.invalidTokens.has(device.token),
    }));
    this.devicesAt = this.now();
    this.dependencies.changed();
    return this.snapshot(userId);
  }

  async pair(userId: string): Promise<MobilePushPairing> {
    this.activate(userId);
    const profile = this.store.profile(userId);
    if (!profile.enabled) throw new MobilePushFault('disabled');
    return this.api(userId).pair(profile.sourceId, profile.sourceName, this.controller.signal);
  }

  async unlink(userId: string, deviceId: string): Promise<MobilePushStatus> {
    await this.refresh(userId);
    const device = this.devices.find((item) => item.id === deviceId);
    if (!device) throw new MobilePushFault('device');
    await this.api(userId).unlink(device, this.controller.signal);
    this.devices = this.devices.filter((item) => item.id !== deviceId);
    this.dependencies.changed();
    return this.snapshot(userId);
  }

  async test(userId: string, deviceId: string, title: string, body: string): Promise<void> {
    this.activate(userId);
    if (!this.store.profile(userId).enabled) throw new MobilePushFault('disabled');
    if (typeof title !== 'string' || typeof body !== 'string' || title.length > 500 || body.length > 1500)
      throw new MobilePushFault('invalidInput');
    await this.refresh(userId);
    const device = this.devices.find((item) => item.id === deviceId && item.enabled);
    if (!device || !this.store.profile(userId).enabled) throw new MobilePushFault('device');
    const now = this.now();
    const data = payload(
      this.store.profile(userId).sourceId,
      { key: `test-${randomUUID()}`, kind: 'choice', conversationId: '', createdAt: now },
      { choiceTitle: title, choiceBody: body, failureTitle: title, failureBody: body },
      false,
      now
    );
    await this.api(userId).send(device, data, this.controller.signal);
    this.store.profile(userId).lastSentAt = this.now();
    await this.store.save();
    this.dependencies.changed();
  }

  sync(userId: string, notices: MobilePushNotice[], value: MobilePushLabels): void {
    this.activate(userId);
    if (!Array.isArray(notices) || notices.length > 500) throw new MobilePushFault('invalidInput');
    const usable = notices.filter(validNotice);
    this.text = labels(value);
    const current = new Map(usable.map((notice) => [notice.key, notice]));
    for (const key of this.jobs.keys()) if (!current.has(key)) this.jobs.delete(key);
    const profile = this.store.profile(userId);
    if (!profile.enabled) return;
    const cutoff = Math.max(this.activeAt, profile.enabledAt, this.now() - MAX_AGE_MS);
    for (const notice of usable) {
      if (
        notice.createdAt < cutoff ||
        notice.createdAt > this.now() + 300_000 ||
        this.failed.has(notice.key) ||
        this.completed.has(notice.key)
      )
        continue;
      const existing = this.jobs.get(notice.key);
      if (existing) existing.notice = notice;
      else this.jobs.set(notice.key, { notice, attempts: 0, due: this.now() + 500 });
    }
    this.schedule();
  }

  private schedule(): void {
    if (!this.jobs.size || !this.userId || !this.store.profile(this.userId).enabled) return;
    const due = Math.min(...[...this.jobs.values()].map((job) => job.due));
    if (this.timer && this.timerAt <= due) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = due;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.flush();
      },
      Math.max(0, due - this.now())
    );
    this.timer.unref?.();
  }

  /** Also permits deterministic queue tests without a live timer or Firebase project. */
  flush(): Promise<void> {
    if (!this.userId) return Promise.resolve();
    if (this.working) return this.working;
    this.working = this.drain().finally(() => {
      this.working = undefined;
      this.schedule();
    });
    return this.working;
  }

  private async drain(): Promise<void> {
    const userId = this.userId,
      signal = this.controller.signal;
    const profile = this.store.profile(userId);
    for (const [key, job] of this.jobs) {
      if (signal.aborted || !profile.enabled || !this.text) return;
      if (job.due > this.now()) continue;
      if (job.notice.createdAt < this.now() - MAX_AGE_MS) {
        this.jobs.delete(key);
        continue;
      }
      try {
        if (!(await this.dependencies.ownsConversation(job.notice.conversationId))) {
          this.jobs.delete(key);
          continue;
        }
        if (signal.aborted || !profile.enabled || !this.jobs.has(key)) continue;
        if (!this.devicesAt || this.now() - this.devicesAt > 10_000) {
          const refreshed = await this.api(userId).devices(profile.sourceId, signal);
          if (signal.aborted || this.userId !== userId) return;
          this.devices = refreshed;
          this.devicesAt = this.now();
        }
        const devices = this.devices.filter((device) => device.enabled && !this.invalidTokens.has(device.token));
        if (!devices.length) {
          job.due = this.now() + 10_000;
          continue;
        }
        for (const device of devices) {
          const deliveryKey = createHash('sha256')
            .update(JSON.stringify([key, device.id]))
            .digest('hex');
          if (profile.sent[deliveryKey]) continue;
          if (signal.aborted || !profile.enabled || !this.jobs.has(key)) break;
          try {
            await this.api(userId).send(
              device,
              payload(profile.sourceId, job.notice, this.text, profile.includePreview, this.now()),
              signal
            );
          } catch (error) {
            if (error instanceof MobilePushFault && error.code === 'device') {
              this.invalidTokens.add(device.token);
              device.enabled = false;
              continue;
            }
            throw error;
          }
          if (signal.aborted || this.userId !== userId) return;
          profile.sent[deliveryKey] = this.now();
          profile.lastSentAt = this.now();
          profile.sent = Object.fromEntries(
            Object.entries(profile.sent)
              .toSorted((a, b) => b[1] - a[1])
              .slice(0, 2000)
          );
          await this.store.save();
          this.lastError = undefined;
          this.dependencies.changed();
        }
        if (signal.aborted || this.userId !== userId) return;
        this.jobs.delete(key);
        this.completed.add(key);
      } catch (error) {
        if (signal.aborted) return;
        this.lastError = error instanceof MobilePushFault ? error.code : 'firebase';
        job.attempts++;
        if (job.attempts >= 3 || (error instanceof MobilePushFault && !error.retryable)) {
          this.jobs.delete(key);
          this.failed.add(key);
        } else job.due = this.now() + 1000 * 2 ** job.attempts;
        this.dependencies.changed();
      }
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller.abort();
    this.controller = new AbortController();
    this.client = undefined;
    this.jobs.clear();
  }
}
