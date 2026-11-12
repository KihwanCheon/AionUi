import { createHash, randomUUID } from 'node:crypto';
import type {
  MobilePushError,
  MobilePushLabels,
  MobilePushNotice,
  MobilePushOptions,
  MobilePushPairing,
  MobilePushStatus,
  MnpPushNotice,
} from '@/common/types/platform/mobilePush';
import { FirebasePushClient } from './firebaseClient';
import { labels, MAX_AGE_MS, MobilePushFault, payload, validNotice, type LinkedDevice } from './protocol';
import type { MobilePushStore } from './store';
import type { NoticeContent } from '@/common/platform/mobilePush/noticeContent';
import { contentFingerprint } from './protocol';
import { mnpNotice, mnpPayload } from './mnpPush';

type PushClient = Pick<FirebasePushClient, 'devices' | 'pair' | 'unlink' | 'send'>;
type Job = { notice: MobilePushNotice | MnpPushNotice; attempts: number; due: number; version: number };
type ManagerDependencies = {
  now?: () => number;
  startedAt?: number;
  client?: (userId: string) => PushClient;
  ownsConversation: (conversationId: string) => Promise<boolean>;
  resolveNotice?: (notice: MobilePushNotice) => Promise<NoticeContent>;
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
  private mnpController = new AbortController();
  private client?: PushClient;
  private timer?: ReturnType<typeof setTimeout>;
  private timerAt = 0;
  private working?: Promise<void>;
  private jobs = new Map<string, Job>();
  private failed = new Set<string>();
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
      mnpEnabled: profile.mnpEnabled,
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
      (input.mnpEnabled !== undefined && typeof input.mnpEnabled !== 'boolean') ||
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
    if (input.mnpEnabled !== undefined) {
      if (input.mnpEnabled && !profile.mnpEnabled) profile.mnpEnabledAt = this.now();
      profile.mnpEnabled = input.mnpEnabled;
      if (!input.mnpEnabled) {
        this.mnpController.abort();
        this.mnpController = new AbortController();
        for (const [key, job] of this.jobs) if ('origin' in job.notice) this.jobs.delete(key);
      }
    }
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
    const current = new Map(usable.map((notice) => [`aionui:${notice.key}`, notice]));
    for (const [key, job] of this.jobs) if (!('origin' in job.notice) && !current.has(key)) this.jobs.delete(key);
    const profile = this.store.profile(userId);
    if (!profile.enabled) return;
    const cutoff = Math.max(this.activeAt, profile.enabledAt, this.now() - MAX_AGE_MS);
    for (const notice of usable) {
      if (
        notice.createdAt < cutoff ||
        notice.createdAt > this.now() + 300_000 ||
        this.failed.has(`aionui:${notice.key}`)
      )
        continue;
      const key = `aionui:${notice.key}`;
      const existing = this.jobs.get(key);
      if (existing) {
        if (!('origin' in existing.notice) && existing.notice.preview !== notice.preview) existing.version++;
        existing.notice = notice;
      } else this.jobs.set(key, { notice, attempts: 0, due: this.now() + 500, version: 0 });
    }
    this.schedule();
  }

  /** Accept a producer revision only for the active, explicitly opted-in desktop user. */
  async enqueueMnp(userId: string, input: unknown): Promise<{ state: 'queued'; eventId: string }> {
    this.activate(userId);
    const notice = mnpNotice(input, this.now());
    const profile = this.store.profile(userId);
    if (!profile.enabled || !profile.mnpEnabled) throw new MobilePushFault('disabled');
    if (notice.createdAt < Math.max(this.activeAt, profile.enabledAt, profile.mnpEnabledAt))
      throw new MobilePushFault('invalidInput');
    if (this.jobs.size >= 500 && !this.jobs.has(notice.key)) throw new MobilePushFault('invalidInput');
    const signal = AbortSignal.any([this.controller.signal, this.mnpController.signal]);
    if (!this.devicesAt || this.now() - this.devicesAt > 10_000) await this.refresh(userId);
    if (signal.aborted || !profile.enabled || !profile.mnpEnabled) throw new MobilePushFault('disabled');
    if (!this.devices.some((device) => device.enabled)) throw new MobilePushFault('device');
    const current = this.jobs.get(notice.key);
    if (!current) this.jobs.set(notice.key, { notice, attempts: 0, due: this.now(), version: 0 });
    else if ('origin' in current.notice && current.notice.revision < notice.revision) {
      current.notice = notice;
      current.version++;
      current.attempts = 0;
      current.due = this.now();
    }
    this.schedule();
    return { state: 'queued', eventId: notice.eventId };
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
    const userId = this.userId;
    const baseSignal = this.controller.signal;
    const profile = this.store.profile(userId);
    for (const [key, job] of this.jobs) {
      const external = 'origin' in job.notice;
      const signal = external ? AbortSignal.any([baseSignal, this.mnpController.signal]) : baseSignal;
      if (baseSignal.aborted || !profile.enabled) return;
      if (external && !profile.mnpEnabled) {
        this.jobs.delete(key);
        continue;
      }
      if (!external && !this.text) continue;
      if (job.due > this.now()) continue;
      const version = job.version;
      if (job.notice.createdAt < this.now() - MAX_AGE_MS) {
        this.jobs.delete(key);
        continue;
      }
      try {
        const original = job.notice;
        if (!('origin' in original) && !(await this.dependencies.ownsConversation(original.conversationId))) {
          this.jobs.delete(key);
          continue;
        }
        if (signal.aborted || !profile.enabled || !this.jobs.has(key)) continue;
        const content = !('origin' in original)
          ? ((await this.dependencies.resolveNotice?.(original)) ?? { state: 'ready' as const })
          : { state: 'ready' as const };
        if (signal.aborted || !profile.enabled || !this.jobs.has(key)) continue;
        if (content.state === 'ignored') {
          this.jobs.delete(key);
          continue;
        }
        if (content.state === 'pending') {
          job.due = this.now() + 1000;
          continue;
        }
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
            .update(
              JSON.stringify(
                'origin' in original
                  ? ['mnp', original.originId, original.eventId, device.id]
                  : [original.key, device.id]
              )
            )
            .digest('hex');
          const receipt = profile.receipts[deliveryKey];
          if ('origin' in original && receipt && receipt.revision >= original.revision) continue;
          const data =
            'origin' in original
              ? mnpPayload(
                  profile.sourceId,
                  original,
                  profile.includePreview,
                  this.now(),
                  createHash('sha256').update(original.key).digest('hex')
                )
              : payload(
                  profile.sourceId,
                  { ...original, detail: content.detail, conversationName: content.conversationName },
                  this.text!,
                  profile.includePreview,
                  this.now(),
                  (receipt?.revision ?? 0) + 1,
                  Boolean(receipt)
                );
          const fingerprint = contentFingerprint(data);
          if (receipt?.fingerprint === fingerprint || (!receipt && profile.sent[deliveryKey])) {
            if ('origin' in original && receipt && original.revision > receipt.revision) {
              receipt.revision = original.revision;
              await this.store.save();
            }
            continue;
          }
          if (signal.aborted || !profile.enabled || !this.jobs.has(key)) break;
          try {
            await this.api(userId).send(device, data, signal);
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
          profile.receipts[deliveryKey] = { fingerprint, revision: Number(data.revision) };
          profile.lastSentAt = this.now();
          profile.sent = Object.fromEntries(
            Object.entries(profile.sent)
              .toSorted((a, b) => b[1] - a[1])
              .slice(0, 2000)
          );
          profile.receipts = Object.fromEntries(
            Object.entries(profile.receipts).filter(([id]) => profile.sent[id] !== undefined)
          );
          await this.store.save();
          this.lastError = undefined;
          this.dependencies.changed();
        }
        if (signal.aborted || this.userId !== userId) return;
        if (job.version === version) this.jobs.delete(key);
        else job.due = this.now() + 500;
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
    this.mnpController.abort();
    this.mnpController = new AbortController();
    this.client = undefined;
    this.jobs.clear();
  }
}
