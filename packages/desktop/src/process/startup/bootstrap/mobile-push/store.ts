import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { credential, MobilePushFault, record, type FirebaseCredential } from './protocol';

export type PushProfile = {
  sourceId: string;
  sourceName: string;
  enabled: boolean;
  includePreview: boolean;
  enabledAt: number;
  credentialPath: string;
  ciphertext?: string;
  projectId?: string;
  lastSentAt?: number;
  sent: Record<string, number>;
  receipts: Record<string, { fingerprint: string; revision: number }>;
};

export type PushProtection = {
  available: () => boolean;
  encrypt: (value: string) => string;
  decrypt: (value: string) => string;
};

/** Local app/user profiles, with OS-protected credentials and an atomic delivery ledger. */
export class MobilePushStore {
  private profiles: Record<string, PushProfile> = {};
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    readonly defaultCredentialPath: string,
    private readonly defaultName: string,
    readonly protection: PushProtection
  ) {
    try {
      if (!existsSync(file)) return;
      const disk = record(JSON.parse(readFileSync(file, 'utf8')));
      if (disk.version !== 1) return;
      for (const [key, value] of Object.entries(record(disk.profiles))) {
        const item = record(value);
        if (!/^[a-f0-9]{64}$/.test(key) || typeof item.sourceId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.sourceId))
          continue;
        this.profiles[key] = {
          sourceId: item.sourceId,
          sourceName: typeof item.sourceName === 'string' ? item.sourceName.slice(0, 120) : defaultName,
          enabled: item.enabled === true,
          includePreview: item.includePreview === true,
          enabledAt: typeof item.enabledAt === 'number' ? item.enabledAt : 0,
          credentialPath: typeof item.credentialPath === 'string' ? item.credentialPath : defaultCredentialPath,
          ciphertext: typeof item.ciphertext === 'string' ? item.ciphertext : undefined,
          projectId: typeof item.projectId === 'string' ? item.projectId : undefined,
          lastSentAt: typeof item.lastSentAt === 'number' ? item.lastSentAt : undefined,
          sent: Object.fromEntries(
            Object.entries(record(item.sent)).filter(
              ([id, time]) => /^[a-f0-9]{64}$/.test(id) && typeof time === 'number'
            )
          ) as Record<string, number>,
          receipts: Object.fromEntries(
            Object.entries(record(item.receipts)).flatMap(([id, rawReceipt]) => {
              const receipt = record(rawReceipt);
              return /^[a-f0-9]{64}$/.test(id) &&
                typeof receipt.fingerprint === 'string' &&
                /^[a-f0-9]{64}$/.test(receipt.fingerprint) &&
                Number.isSafeInteger(receipt.revision) &&
                Number(receipt.revision) > 0
                ? [[id, { fingerprint: receipt.fingerprint, revision: Number(receipt.revision) }]]
                : [];
            })
          ),
        };
      }
    } catch {
      // Unreadable or unsupported state starts disabled rather than enabling delivery.
    }
  }

  profile(userId: string): PushProfile {
    if (!userId || userId.length > 256) throw new MobilePushFault('identity');
    const id = createHash('sha256').update(userId).digest('hex');
    return (this.profiles[id] ??= {
      sourceId: randomUUID(),
      sourceName: this.defaultName,
      enabled: false,
      includePreview: false,
      enabledAt: 0,
      credentialPath: this.defaultCredentialPath,
      sent: {},
      receipts: {},
    });
  }

  credential(userId: string): FirebaseCredential {
    if (!this.protection.available()) throw new MobilePushFault('secureStorage');
    const encrypted = this.profile(userId).ciphertext;
    if (!encrypted) throw new MobilePushFault('credentials');
    try {
      return credential(JSON.parse(this.protection.decrypt(encrypted)));
    } catch {
      throw new MobilePushFault('secureStorage');
    }
  }

  async configure(userId: string, file: string): Promise<void> {
    if (!this.protection.available()) throw new MobilePushFault('secureStorage');
    if (typeof file !== 'string' || file.length > 4096 || !path.isAbsolute(file))
      throw new MobilePushFault('credentials');
    let parsed: FirebaseCredential;
    try {
      const handle = await open(file, 'r');
      try {
        if ((await handle.stat()).size > 64000) throw new MobilePushFault('credentials');
        parsed = credential(JSON.parse(await handle.readFile('utf8')));
      } finally {
        await handle.close();
      }
    } catch {
      throw new MobilePushFault('credentials');
    }
    const profile = this.profile(userId);
    // Replacing the project is an explicit opt-out, requiring a new enable action.
    profile.enabled = false;
    profile.ciphertext = this.protection.encrypt(JSON.stringify(parsed));
    profile.projectId = parsed.project_id;
    profile.credentialPath = file;
    await this.save();
  }

  save(): Promise<void> {
    const snapshot = JSON.stringify({ version: 1, profiles: this.profiles });
    const operation = this.writing
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
        const temporary = `${this.file}.tmp`;
        await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, this.file);
      });
    this.writing = operation;
    return operation.catch(() => {
      throw new MobilePushFault('storage');
    });
  }
}
