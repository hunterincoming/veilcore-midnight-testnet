// One partner's custody vault: every secret VeilCore holds for that partner, in one
// encrypted file under that partner's own password, in that partner's own folder.
// SPDX-License-Identifier: Apache-2.0
//
// Nothing here is shared between partners: one folder, one password, one key per
// partner. Nothing here touches the operator's own private state (the CLI's store, the
// wallet): the chain client VeilCore-run uses keeps its private state in memory only
// (memoryPrivateState), and gets each record secret from here for one command.
//
// What is in a partner's folder (0700), all 0600:
//   custody.vcbox   the vault: secrets, encrypted (box.ts)
//   partner.json    who the partner is, and whether they have left: no secrets
//   audit.jsonl     what was done, when, transaction ids: no secrets (audit.ts)
//   .lock           while a command runs

import { open, readFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { inspect } from 'node:util';
import { type FieldSetFile, passwordProblem } from '@veilcore/contracts';
import { BoxKey, type BoxFile, openBox, parseBox, sealBox } from './box.ts';
import { assertOwnerOnly, exists, partnerDir, privateDir, readPrivate, writePrivate } from './files.ts';

export const VAULT_FILE = 'custody.vcbox';
export const STATUS_FILE = 'partner.json';

/** Who holds a record's recovery secret: VeilCore, in this vault, or the partner alone. */
export type RecoveryHolder = 'custody' | 'partner';

export type RecordEntry = {
  readonly label: string;
  /** The record secret VeilCore acts with now (hex). Gone after a purge. */
  secret?: string;
  /** A rotation's new secret, stored before the rotation is sent; promoted once it lands. */
  pendingSecret?: string;
  /** The record this identity was anchored as: its name on chain through every rotation. */
  readonly origin: string;
  /** The record the current secret controls. */
  current: string;
  recovery: {
    heldBy: RecoveryHolder;
    commitment: string;
    /** Only when VeilCore holds it (custody). */
    secret?: string;
    /** Where the partner derives it from (partner-keys.ts): their master's pool and index. */
    pool?: { readonly id: string; readonly index: number };
  };
  status: 'new' | 'anchored' | 'handed-over';
  readonly createdAt: string;
};

export type IssuedLicence = {
  readonly label: string;
  readonly role: 'issuer';
  readonly recordLabel: string;
  /** The record commitment the licence was issued under (its key on chain). */
  readonly issuedUnder: string;
  readonly commitment: string;
  status: 'issued' | 'revoked';
};

export type HeldLicence = {
  readonly label: string;
  readonly role: 'licensee';
  /** The licence secret: whoever holds it can present the licence. */
  secret?: string;
  readonly issuerRecord: string;
  readonly commitment: string;
  status: 'requested' | 'active' | 'transfer-proposed';
  transferTo?: string;
};

export type LicenceEntry = IssuedLicence | HeldLicence;

export type ObligationEntry = {
  readonly label: string;
  /** The partner's record that is the beneficiary (own encumbrance: also the record it is on). */
  readonly recordLabel: string;
  /** Any record commitment of the identity the obligation is on. */
  readonly onRecord: string;
  /** Terms and salt: what shows later what the commitment means. Private. */
  terms?: string;
  salt?: string;
  readonly commitment: string;
  readonly kind: 'own' | 'proposed';
  status: 'open' | 'proposed' | 'discharged';
};

export type FieldSetEntry = {
  readonly label: string;
  /** The field-set file: the hidden values and the field secret (the opening). Private. */
  file?: FieldSetFile;
  readonly commitment: string;
  readonly schemaId: string;
  readonly setRoot: string;
  readonly createdAt: string;
};

export type LabKeyEntry = {
  readonly label: string;
  /** The laboratory claims key's secret scalar (hex). Private. */
  secret?: string;
  /** Its public key: what verifiers trust. */
  readonly key: { readonly x: string; readonly y: string };
};

export type ExitMode = 'self' | 'assisted';

/** Recovery commitments a partner made from their master (public); each record takes the next unused one. */
export type StoredPool = {
  readonly poolId: string;
  readonly start: number;
  readonly commitments: readonly string[];
  /** Indexes already given to a record. */
  used: number[];
};

export type VaultPayload = {
  readonly version: 1;
  readonly partner: {
    readonly id: string;
    readonly displayName: string;
    readonly network: string;
    readonly createdAt: string;
    readonly defaultRecovery: RecoveryHolder;
  };
  records: RecordEntry[];
  licences: LicenceEntry[];
  obligations: ObligationEntry[];
  fieldSets: FieldSetEntry[];
  labKeys: LabKeyEntry[];
  recoveryPools: StoredPool[];
  retired?: { readonly at: string; readonly mode: ExitMode; readonly bundleSha256: string };
  purgedAt?: string;
};

/** What partner.json holds: enough to list partners without any password. */
export type PartnerStatus = {
  readonly id: string;
  readonly displayName: string;
  readonly network: string;
  readonly createdAt: string;
  readonly retired?: { readonly at: string; readonly mode: ExitMode };
  readonly purgedAt?: string;
};

/** A partner who has left: no further operations. */
export class RetiredPartnerError extends Error {
  constructor(id: string, at: string) {
    super(
      `Partner ${id} left VeilCore-run on ${at} (their custody store is retired). Refused: nothing was sent. ` +
        'Every operation for them is now theirs to run.',
    );
    this.name = 'RetiredPartnerError';
  }
}

/** Every secret in a payload (hex), for the guards that keep them out of logs and errors. */
export const secretsIn = (p: VaultPayload): Set<string> => {
  const s = new Set<string>();
  const add = (v: string | undefined): void => {
    if (v !== undefined && v.length >= 16) s.add(v.toLowerCase());
  };
  for (const r of p.records) {
    add(r.secret);
    add(r.pendingSecret);
    add(r.recovery.secret);
  }
  for (const l of p.licences) if (l.role === 'licensee') add(l.secret);
  for (const o of p.obligations) add(o.salt);
  for (const f of p.fieldSets) add(f.file?.fieldSecret?.replace(/^0x/i, ''));
  for (const k of p.labKeys) add(k.secret);
  return s;
};

const checkPassword = (password: string): void => {
  const problem = passwordProblem(password);
  if (problem !== null) throw new Error(`That password will not be accepted: ${problem}.`);
};

const now = (): string => new Date().toISOString();

/** Hold the partner's folder for one command: a second command on the same partner is refused. */
const lock = async (dir: string): Promise<() => Promise<void>> => {
  const file = path.join(dir, '.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(file, 'wx', 0o600);
      await fh.writeFile(String(process.pid));
      await fh.close();
      return () => rm(file, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const pid = Number((await readFile(file, 'utf8').catch(() => '')).trim());
      let alive = false;
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          alive = true;
        } catch (k) {
          alive = (k as NodeJS.ErrnoException).code === 'EPERM';
        }
      }
      if (alive) throw new Error(`Another command (process ${pid}) is working on this partner. Wait for it to end.`);
      await rm(file, { force: true }); // left by a command that was killed
    }
  }
  throw new Error('Could not take the partner folder lock.');
};

export class PartnerVault {
  readonly #dir: string;
  readonly #key: BoxKey;
  readonly #release: () => Promise<void>;
  #payload: VaultPayload;
  #closed = false;

  private constructor(dir: string, key: BoxKey, payload: VaultPayload, release: () => Promise<void>) {
    this.#dir = dir;
    this.#key = key;
    this.#payload = payload;
    this.#release = release;
  }

  /** Make a new partner's folder and vault. Refused if the partner already exists. */
  static async create(o: {
    readonly root: string;
    readonly id: string;
    readonly displayName: string;
    readonly network: string;
    readonly password: string;
    readonly defaultRecovery?: RecoveryHolder;
  }): Promise<PartnerVault> {
    checkPassword(o.password);
    if (o.displayName.trim() === '') throw new Error('Give the partner a display name.');
    const dir = partnerDir(o.root, o.id);
    if (await exists(path.join(dir, VAULT_FILE)))
      throw new Error(`Partner ${o.id} already exists. Nothing was changed.`);
    await privateDir(o.root);
    await privateDir(dir);
    const release = await lock(dir);
    try {
      const payload: VaultPayload = {
        version: 1,
        partner: {
          id: o.id,
          displayName: o.displayName.trim(),
          network: o.network,
          createdAt: now(),
          defaultRecovery: o.defaultRecovery ?? 'partner',
        },
        records: [],
        licences: [],
        obligations: [],
        fieldSets: [],
        labKeys: [],
        recoveryPools: [],
      };
      const v = new PartnerVault(dir, await BoxKey.fresh(o.password), payload, release);
      await v.#write(true);
      return v;
    } catch (e) {
      await release();
      throw e;
    }
  }

  /** Open an existing partner's vault with its password. Refused if the folder or file is not owner-only. */
  static async open(o: {
    readonly root: string;
    readonly id: string;
    readonly network: string;
    readonly password: string;
  }): Promise<PartnerVault> {
    const dir = partnerDir(o.root, o.id);
    const file = path.join(dir, VAULT_FILE);
    if (!(await exists(file))) throw new Error(`No partner ${o.id} on ${o.network} (no ${file}).`);
    await assertOwnerOnly(dir);
    const box: BoxFile = parseBox(await readPrivate(file), { kind: 'custody-vault' });
    if (box.partner !== o.id || box.network !== o.network)
      throw new Error(`That vault belongs to ${box.partner} on ${box.network}, not ${o.id} on ${o.network}. Refused.`);
    const release = await lock(dir);
    try {
      const key = await BoxKey.forHeader(o.password, box);
      let payload: VaultPayload;
      try {
        payload = openBox(key, box) as VaultPayload;
      } catch (e) {
        key.destroy();
        throw e;
      }
      if (payload.version !== 1 || payload.partner.id !== o.id || payload.partner.network !== o.network)
        throw new Error('That vault does not match its folder. Refused.');
      return new PartnerVault(dir, key, payload, release);
    } catch (e) {
      await release();
      throw e;
    }
  }

  get id(): string {
    return this.#payload.partner.id;
  }
  get network(): string {
    return this.#payload.partner.network;
  }
  get dir(): string {
    return this.#dir;
  }
  get retired(): VaultPayload['retired'] {
    return this.#payload.retired;
  }

  /** A copy of the payload. Holds secrets: never print, log or serialize it. */
  read(): VaultPayload {
    this.#assertOpen();
    return structuredClone(this.#payload);
  }

  /** The secrets in this vault, for the guards that keep them out of logs. */
  secrets(): Set<string> {
    this.#assertOpen();
    return secretsIn(this.#payload);
  }

  /** Refuse unless the partner is still in VeilCore-run (checks the vault and partner.json). */
  async assertActive(): Promise<void> {
    this.#assertOpen();
    if (this.#payload.retired !== undefined) throw new RetiredPartnerError(this.id, this.#payload.retired.at);
    const status = await readStatus(this.#dir);
    if (status?.retired !== undefined) throw new RetiredPartnerError(this.id, status.retired.at);
  }

  /**
   * Change the vault: `f` edits a copy, which is encrypted and written whole (renamed
   * into place) before this returns. If `f` throws, nothing is written.
   */
  async update(f: (p: VaultPayload) => void): Promise<void> {
    this.#assertOpen();
    const next = structuredClone(this.#payload);
    f(next);
    const before = this.#payload;
    this.#payload = next;
    try {
      await this.#write(false);
    } catch (e) {
      this.#payload = before;
      throw e;
    }
  }

  /** Re-encrypt under a new password (new salt, new key). */
  async changePassword(newPassword: string): Promise<PartnerVault> {
    this.#assertOpen();
    checkPassword(newPassword);
    const key = await BoxKey.fresh(newPassword);
    const box = sealBox(key, { kind: 'custody-vault', partner: this.id, network: this.network }, this.#payload);
    await writePrivate(path.join(this.#dir, VAULT_FILE), JSON.stringify(box));
    const v = new PartnerVault(this.#dir, key, this.#payload, this.#release);
    this.#key.destroy();
    this.#closed = true;
    return v;
  }

  /** Mark the partner as gone: every later operation is refused. */
  async retire(mode: ExitMode, bundleSha256: string): Promise<void> {
    await this.update((p) => {
      p.retired = { at: now(), mode, bundleSha256 };
    });
  }

  /**
   * After a partner has confirmed they hold their bundle: rewrite the vault with every
   * secret removed. Labels and public commitments stay, so the audit log still makes sense.
   */
  async purge(): Promise<void> {
    if (this.#payload.retired === undefined)
      throw new Error(`Partner ${this.id} has not left (exit) yet. Refused: purge only follows an exit.`);
    await this.update((p) => {
      for (const r of p.records) {
        delete r.secret;
        delete r.pendingSecret;
        delete r.recovery.secret;
      }
      for (const l of p.licences) if (l.role === 'licensee') delete l.secret;
      for (const o of p.obligations) {
        delete o.terms;
        delete o.salt;
      }
      for (const f of p.fieldSets) delete f.file;
      for (const k of p.labKeys) delete k.secret;
      p.purgedAt = now();
    });
  }

  /** Forget the key and let another command open this partner. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#key.destroy();
    await this.#release();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('This vault was closed.');
  }

  async #write(first: boolean): Promise<void> {
    const box = sealBox(this.#key, { kind: 'custody-vault', partner: this.id, network: this.network }, this.#payload);
    await writePrivate(path.join(this.#dir, VAULT_FILE), JSON.stringify(box), { exclusive: first });
    const p = this.#payload;
    const status: PartnerStatus = {
      id: p.partner.id,
      displayName: p.partner.displayName,
      network: p.partner.network,
      createdAt: p.partner.createdAt,
      ...(p.retired === undefined ? {} : { retired: { at: p.retired.at, mode: p.retired.mode } }),
      ...(p.purgedAt === undefined ? {} : { purgedAt: p.purgedAt }),
    };
    await writePrivate(path.join(this.#dir, STATUS_FILE), JSON.stringify(status, null, 2) + '\n');
  }

  [inspect.custom](): string {
    return `PartnerVault { id: ${this.#payload.partner.id}, network: ${this.#payload.partner.network}, secrets: [redacted] }`;
  }
  toJSON(): { id: string; network: string } {
    return { id: this.#payload.partner.id, network: this.#payload.partner.network };
  }
}

/** A partner's partner.json, or null. No password needed: it holds no secrets. */
export const readStatus = async (dir: string): Promise<PartnerStatus | null> => {
  const file = path.join(dir, STATUS_FILE);
  if (!(await exists(file))) return null;
  return JSON.parse(await readFile(file, 'utf8')) as PartnerStatus;
};
