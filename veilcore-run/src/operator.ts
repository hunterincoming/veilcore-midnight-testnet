// What VeilCore's operator does on chain for a partner, through the partner kit's public
// surface only (@veilcore/contracts): exactly the calls a partner running the kit
// themselves would make. Each one takes the secrets it needs from the partner's vault
// for this call, stores any new secret in the vault BEFORE it is used, and writes one
// audit line (no secrets) for what it did.
// SPDX-License-Identifier: Apache-2.0

import {
  type ClaimRef,
  type FieldSetFile,
  type Ledger,
  type RangeDirection,
  type TxRef,
  type VeilCore,
  type VeilCoreClaims,
  LandedButUnconfirmedError,
  commit,
  errorChain,
  fromHex,
  identityOf,
  isAnchored,
  isContractRefusal,
  isLive,
  labKeyOf,
  newLabKey,
  newSecret,
  openObligations,
  sealFields,
  signRecord,
  toHex,
} from '@veilcore/contracts';
import { type AuditFields, type AuditLog } from './audit.ts';
import { type RecoveryPool } from './partner-keys.ts';
import {
  type FieldSetEntry,
  type HeldLicence,
  type IssuedLicence,
  type ObligationEntry,
  type PartnerVault,
  type RecordEntry,
  type RecoveryHolder,
  type VaultPayload,
} from './vault.ts';

/** What every operation works with: one partner's vault and audit log, and the kit's clients. */
export type Ctx = {
  readonly vault: PartnerVault;
  readonly audit: AuditLog;
  /** The kit's client for VeilCore's main contract, joined with in-memory private state. */
  readonly vc?: VeilCore;
  /** The kit's client for the claims contract (claims only). */
  readonly claims?: VeilCoreClaims;
};

const HEX64 = /^[0-9a-fA-F]{64}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** 32 bytes from hex, or a clear refusal naming what was expected. */
export const bytes32 = (hex: string, what: string): Uint8Array => {
  const h = hex.trim().replace(/^0x/i, '');
  if (!HEX64.test(h)) throw new Error(`${what} is 64 hex characters (32 bytes).`);
  return fromHex(h);
};

const checkLabel = (label: string): void => {
  if (!LABEL.test(label))
    throw new Error(
      'A label is 1 to 64 letters, digits, dots, dashes or underscores (it names the item in this vault).',
    );
};

const needVc = (ctx: Ctx): VeilCore => {
  if (ctx.vc === undefined) throw new Error('This needs the chain: no VeilCore client was joined.');
  return ctx.vc;
};

const recordOf = (p: VaultPayload, label: string): RecordEntry => {
  const r = p.records.find((x) => x.label === label);
  if (r === undefined) throw new Error(`Partner ${p.partner.id} has no record "${label}".`);
  return r;
};

/** A record given as one of this partner's labels, or as 64 hex (someone else's record). */
export const recordArg = (p: VaultPayload, v: string): Uint8Array => {
  const own = p.records.find((x) => x.label === v);
  return own !== undefined ? fromHex(own.current) : bytes32(v, `"${v}" is not a record label of this partner, so it`);
};

/** What an audit line says about a failure: never the error's text, which could quote an input. */
const failureNote = (e: unknown): string =>
  isContractRefusal(e)
    ? 'refused by the contract; nothing was sent'
    : e instanceof LandedButUnconfirmedError
      ? 'landed, but confirming it failed'
      : `failed (${e instanceof Error ? e.name : typeof e})`;

/** Run one transaction, and write its audit line, success or failure. */
const sent = async <T extends TxRef>(ctx: Ctx, base: Omit<AuditFields, 'ok'>, f: () => Promise<T>): Promise<T> => {
  let r: T;
  try {
    r = await f();
  } catch (e) {
    await ctx.audit.write({ ...base, ok: false, note: failureNote(e) }).catch(() => undefined);
    throw e;
  }
  await ctx.audit.write({ ...base, ok: true, txId: r.txId, txHash: r.txHash, blockHeight: r.blockHeight });
  return r;
};

/**
 * Act as one of the partner's records for the next call. Refused if the chain shows its
 * secret was rotated or recovered away: the partner has taken it back.
 */
const actAs = async (ctx: Ctx, r: RecordEntry): Promise<{ anchored: boolean }> => {
  if (r.secret === undefined) throw new Error(`Record "${r.label}" has no secret in custody (purged).`);
  try {
    return await needVc(ctx).useRecordSecret(fromHex(r.secret));
  } catch (e) {
    if (errorChain(e).some((t) => t.includes('not the current one of its identity')))
      throw new Error(
        `The chain shows record "${r.label}" was rotated or recovered to a secret VeilCore does not hold: the ` +
          'partner (or whoever holds its recovery secret) has taken it over. VeilCore can no longer act as it. ' +
          'Nothing was sent.',
        { cause: e },
      );
    throw e;
  }
};

// ─────────────────────────────────────────────────────────── recovery pools

/** Take in the recovery commitments a partner made on their own computer (partner-keys). */
export const importPool = async (ctx: Ctx, pool: RecoveryPool): Promise<{ added: number; unused: number }> => {
  await ctx.vault.assertActive();
  const p = ctx.vault.read();
  if (pool.partner !== p.partner.id || pool.network !== p.partner.network)
    throw new Error(`That pool was made for ${pool.partner} on ${pool.network}. Refused.`);
  const known = new Set(p.recoveryPools.flatMap((x) => x.commitments));
  for (const r of p.records) known.add(r.recovery.commitment);
  if (pool.commitments.some((c) => known.has(c)))
    throw new Error(
      'That pool repeats a recovery commitment already in this vault. Refused: make the next pool from a later index.',
    );
  await ctx.vault.update((v) => {
    v.recoveryPools.push({ poolId: pool.poolId, start: pool.start, commitments: [...pool.commitments], used: [] });
  });
  await ctx.audit.write({
    op: 'import-recovery-pool',
    ok: true,
    note: `${pool.commitments.length} recovery commitments, pool ${pool.poolId}, indexes ${pool.start} to ${pool.start + pool.commitments.length - 1}`,
  });
  return { added: pool.commitments.length, unused: unusedPool(ctx.vault.read()) };
};

export const unusedPool = (p: VaultPayload): number =>
  p.recoveryPools.reduce((n, x) => n + x.commitments.length - x.used.length, 0);

// ─────────────────────────────────────────────────────────── records

export type AnchorResult = TxRef & {
  readonly label: string;
  readonly record: string;
  readonly recoveryHeldBy: RecoveryHolder;
  readonly resumed: boolean;
};

/**
 * Make a record for the partner and anchor it. The record secret (and, in custody mode,
 * the recovery secret) is stored in the vault first. In partner mode the recovery
 * commitment is the next unused one from the partner's pool (or `recoveryCommitment`),
 * and VeilCore never sees the recovery secret. Running it again with the same label
 * finishes an anchor that was interrupted.
 */
export const anchorRecord = async (
  ctx: Ctx,
  o: { readonly label: string; readonly recovery?: RecoveryHolder; readonly recoveryCommitment?: string },
): Promise<AnchorResult | (Omit<AnchorResult, keyof TxRef> & { readonly alreadyAnchored: true })> => {
  await ctx.vault.assertActive();
  checkLabel(o.label);
  let p = ctx.vault.read();
  let entry = p.records.find((r) => r.label === o.label);
  const resumed = entry !== undefined;
  if (entry !== undefined && entry.status !== 'new')
    throw new Error(`Record "${o.label}" already exists. Nothing was sent.`);
  if (entry === undefined) {
    const holder = o.recovery ?? (o.recoveryCommitment !== undefined ? 'partner' : p.partner.defaultRecovery);
    let recovery: RecordEntry['recovery'];
    if (holder === 'custody') {
      if (o.recoveryCommitment !== undefined) throw new Error('A recovery commitment is for partner mode only.');
      const rs = newSecret();
      recovery = { heldBy: 'custody', commitment: toHex(commit.recovery(rs)), secret: toHex(rs) };
    } else if (o.recoveryCommitment !== undefined) {
      recovery = { heldBy: 'partner', commitment: toHex(bytes32(o.recoveryCommitment, 'A recovery commitment')) };
    } else {
      const pool = p.recoveryPools.find((x) => x.used.length < x.commitments.length);
      if (pool === undefined)
        throw new Error(
          `Partner ${p.partner.id} keeps their own recovery secrets, and no unused recovery commitment is left. ` +
            'Import a pool they made on their own computer (partner-keys), or give one with --recovery-commitment. Nothing was sent.',
        );
      const i = pool.commitments.findIndex((_, k) => !pool.used.includes(pool.start + k));
      recovery = {
        heldBy: 'partner',
        commitment: pool.commitments[i],
        pool: { id: pool.poolId, index: pool.start + i },
      };
    }
    const taken = new Set(p.records.map((r) => r.recovery.commitment));
    if (taken.has(recovery.commitment))
      throw new Error(
        'That recovery commitment is already used by another record (it would link them on chain). Refused.',
      );
    const secret = newSecret();
    const record = toHex(commit.record(secret));
    const fresh: RecordEntry = {
      label: o.label,
      secret: toHex(secret),
      origin: record,
      current: record,
      recovery,
      status: 'new',
      createdAt: new Date().toISOString(),
    };
    await ctx.vault.update((v) => {
      v.records.push(fresh);
      const pool = recovery.pool;
      if (pool !== undefined)
        v.recoveryPools
          .find((x) => x.poolId === pool.id && x.start <= pool.index && pool.index < x.start + x.commitments.length)
          ?.used.push(pool.index);
    });
    p = ctx.vault.read();
    entry = recordOf(p, o.label);
  }
  const me = await actAs(ctx, entry);
  const done = { label: o.label, record: entry.current, recoveryHeldBy: entry.recovery.heldBy, resumed };
  if (me.anchored) {
    await ctx.vault.update((v) => void (recordOf(v, o.label).status = 'anchored'));
    await ctx.audit.write({
      op: 'anchor',
      ok: true,
      label: o.label,
      record: entry.current,
      note: 'found already anchored',
    });
    return { ...done, alreadyAnchored: true };
  }
  const tx = await sent(ctx, { op: 'anchor', label: o.label, record: entry.current }, () =>
    needVc(ctx).anchor(fromHex(entry.recovery.commitment)),
  );
  await ctx.vault.update((v) => void (recordOf(v, o.label).status = 'anchored'));
  return { ...done, ...tx };
};

/** Timestamp a batch root or a record's SDK commitment (managed dating). Needs no record. */
export const dateRoot = async (ctx: Ctx, o: { readonly root: string; readonly label?: string }): Promise<TxRef> => {
  await ctx.vault.assertActive();
  const root = bytes32(o.root, 'A root');
  return sent(ctx, { op: 'date', label: o.label, note: `root ${toHex(root)}` }, () => needVc(ctx).anchorBatch(root));
};

/** Bind a report's fingerprint (e.g. the SHA-256 of a DNA report) to a record. */
export const pairDna = async (ctx: Ctx, o: { readonly record: string; readonly report: string }): Promise<TxRef> => {
  await ctx.vault.assertActive();
  const r = recordOf(ctx.vault.read(), o.record);
  const report = bytes32(o.report, 'A report fingerprint');
  await actAs(ctx, r);
  return sent(ctx, { op: 'pair-dna', label: r.label, record: r.current, note: `report ${toHex(report)}` }, () =>
    needVc(ctx).pairDna(report),
  );
};

/** Answer a verifier's challenge for a record. Give the verifier the txId. */
export const proveOwnership = async (
  ctx: Ctx,
  o: { readonly record: string; readonly challenge: string },
): Promise<TxRef> => {
  await ctx.vault.assertActive();
  const r = recordOf(ctx.vault.read(), o.record);
  const challenge = bytes32(o.challenge, "The verifier's challenge");
  await actAs(ctx, r);
  return sent(ctx, { op: 'prove-ownership', label: r.label, record: r.current }, () =>
    needVc(ctx).proveOwnership(challenge),
  );
};

/**
 * Move a record to a new secret VeilCore makes (stored first). The old secret stops
 * working. For routine hygiene, or after a suspected leak of VeilCore's copy. If an
 * earlier rotation was interrupted, the chain is asked whether it landed first.
 */
export const rotateRecord = async (
  ctx: Ctx,
  o: { readonly record: string },
): Promise<TxRef | { readonly alreadyRotated: true }> => {
  await ctx.vault.assertActive();
  let r = recordOf(ctx.vault.read(), o.record);
  const promote = (pending: string): Promise<void> =>
    ctx.vault.update((v) => {
      const x = recordOf(v, o.record);
      x.secret = pending;
      x.current = toHex(commit.record(fromHex(pending)));
      delete x.pendingSecret;
    });
  if (r.pendingSecret !== undefined) {
    // A secret that a rotation moved the identity to is anchored (it is the identity's
    // head); one that was never used is fresh, and useRecordSecret says not anchored.
    const pending = r.pendingSecret;
    const probe = await needVc(ctx)
      .useRecordSecret(fromHex(pending))
      .catch(() => ({ anchored: false }));
    if (probe.anchored) {
      await promote(pending);
      await ctx.audit.write({ op: 'rotate', ok: true, label: r.label, note: 'an earlier rotation had landed' });
      return { alreadyRotated: true };
    }
  } else {
    const next = toHex(newSecret());
    await ctx.vault.update((v) => void (recordOf(v, o.record).pendingSecret = next));
    r = recordOf(ctx.vault.read(), o.record);
  }
  const pending = r.pendingSecret as string;
  await actAs(ctx, r);
  try {
    const tx = await sent(ctx, { op: 'rotate', label: r.label, record: r.current }, () =>
      needVc(ctx).rotateRecordSecret(fromHex(pending)),
    );
    await promote(pending);
    return tx;
  } catch (e) {
    if (e instanceof LandedButUnconfirmedError) await promote(pending);
    throw e;
  }
};

// ─────────────────────────────────────────────────────────── licences

/** As issuer: issue a licence to the commitment the licensee sent (commit.license of their secret and this record). */
export const licenceIssue = async (
  ctx: Ctx,
  o: { readonly record: string; readonly licenceCommitment: string; readonly label: string },
): Promise<TxRef> => {
  await ctx.vault.assertActive();
  checkLabel(o.label);
  const p = ctx.vault.read();
  if (p.licences.some((l) => l.label === o.label)) throw new Error(`Licence "${o.label}" already exists.`);
  const lc = toHex(bytes32(o.licenceCommitment, 'A licence commitment'));
  if (p.licences.some((l) => l.role === 'issuer' && l.commitment === lc && l.status === 'revoked'))
    throw new Error(
      `Refused: this partner revoked licence ${lc} before. Nothing was sent. The licensee makes a new licence secret.`,
    );
  const r = recordOf(p, o.record);
  await actAs(ctx, r);
  const tx = await sent(ctx, { op: 'licence-issue', label: o.label, record: r.current, licence: lc }, () =>
    needVc(ctx).issueLicense(fromHex(lc)),
  );
  const entry: IssuedLicence = {
    label: o.label,
    role: 'issuer',
    recordLabel: r.label,
    issuedUnder: r.current,
    commitment: lc,
    status: 'issued',
  };
  await ctx.vault.update((v) => void v.licences.push(entry));
  return tx;
};

const issued = (p: VaultPayload, label: string): IssuedLicence => {
  const l = p.licences.find((x) => x.label === label);
  if (l === undefined || l.role !== 'issuer') throw new Error(`Partner ${p.partner.id} issued no licence "${label}".`);
  return l;
};
const held = (p: VaultPayload, label: string): HeldLicence => {
  const l = p.licences.find((x) => x.label === label);
  if (l === undefined || l.role !== 'licensee') throw new Error(`Partner ${p.partner.id} holds no licence "${label}".`);
  return l;
};

/** As issuer: revoke. Remembered in the vault before sending, so it is never re-issued from here. */
export const licenceRevoke = async (
  ctx: Ctx,
  o: { readonly label: string },
): Promise<TxRef & { readonly sealed: boolean; readonly sealableAt?: number }> => {
  await ctx.vault.assertActive();
  const p = ctx.vault.read();
  const l = issued(p, o.label);
  if (l.status === 'revoked') throw new Error(`Licence "${o.label}" is already revoked.`);
  const r = recordOf(p, l.recordLabel);
  await ctx.vault.update((v) => void (issued(v, o.label).status = 'revoked'));
  await actAs(ctx, r);
  return sent(ctx, { op: 'licence-revoke', label: o.label, licence: l.commitment, record: l.issuedUnder }, () =>
    needVc(ctx).revokeLicense(fromHex(l.commitment), fromHex(l.issuedUnder)),
  );
};

/**
 * As licensee: make the licence secret (stored first) and return the commitment to send
 * the issuer. Nothing goes on chain until the issuer issues it; then licenceCountersign.
 */
export const licenceRequest = async (
  ctx: Ctx,
  o: { readonly label: string; readonly issuerRecord: string },
): Promise<{ readonly licenceCommitment: string }> => {
  await ctx.vault.assertActive();
  checkLabel(o.label);
  const p = ctx.vault.read();
  if (p.licences.some((l) => l.label === o.label)) throw new Error(`Licence "${o.label}" already exists.`);
  const issuer = toHex(bytes32(o.issuerRecord, "The issuer's record"));
  const s = newSecret();
  const lc = toHex(commit.license(s, fromHex(issuer)));
  const entry: HeldLicence = {
    label: o.label,
    role: 'licensee',
    secret: toHex(s),
    issuerRecord: issuer,
    commitment: lc,
    status: 'requested',
  };
  await ctx.vault.update((v) => void v.licences.push(entry));
  await ctx.audit.write({ op: 'licence-request', ok: true, label: o.label, licence: lc, note: `issuer ${issuer}` });
  return { licenceCommitment: lc };
};

/** As licensee: activate the licence the issuer issued. */
export const licenceCountersign = async (ctx: Ctx, o: { readonly label: string }): Promise<TxRef> => {
  await ctx.vault.assertActive();
  const l = held(ctx.vault.read(), o.label);
  if (l.secret === undefined) throw new Error('No licence secret in custody (purged).');
  const s = l.secret;
  const tx = await sent(ctx, { op: 'licence-countersign', label: o.label, licence: l.commitment }, () =>
    needVc(ctx).countersignLicense(fromHex(s), fromHex(l.issuerRecord)),
  );
  await ctx.vault.update((v) => void (held(v, o.label).status = 'active'));
  return tx;
};

/** As licensee: prove the licence to a verifier's challenge. Give them the txId. */
export const licenceProve = async (
  ctx: Ctx,
  o: { readonly label: string; readonly challenge: string },
): Promise<TxRef> => {
  await ctx.vault.assertActive();
  const l = held(ctx.vault.read(), o.label);
  if (l.secret === undefined) throw new Error('No licence secret in custody (purged).');
  const s = l.secret;
  const challenge = bytes32(o.challenge, "The verifier's challenge");
  return sent(ctx, { op: 'licence-prove', label: o.label, licence: l.commitment }, () =>
    needVc(ctx).proveLicense(fromHex(s), fromHex(l.issuerRecord), challenge),
  );
};

/** As licensee: propose moving the licence to a commitment the incoming holder built (never seen secret). */
export const licenceTransferPropose = async (
  ctx: Ctx,
  o: { readonly label: string; readonly newCommitment: string },
): Promise<TxRef> => {
  await ctx.vault.assertActive();
  return proposeTransfer(ctx, o);
};

const proposeTransfer = async (
  ctx: Ctx,
  o: { readonly label: string; readonly newCommitment: string },
): Promise<TxRef> => {
  const l = held(ctx.vault.read(), o.label);
  if (l.secret === undefined) throw new Error('No licence secret in custody (purged).');
  const s = l.secret;
  const to = toHex(bytes32(o.newCommitment, 'The new licence commitment'));
  const tx = await sent(
    ctx,
    { op: 'licence-transfer-propose', label: o.label, licence: l.commitment, note: `to ${to}` },
    () => needVc(ctx).proposeTransfer(fromHex(s), fromHex(l.issuerRecord), fromHex(to)),
  );
  await ctx.vault.update((v) => {
    const x = held(v, o.label);
    x.status = 'transfer-proposed';
    x.transferTo = to;
  });
  return tx;
};
/** @internal for exit.ts: propose a transfer on a partner who is leaving (the vault is not retired yet). */
export const proposeTransferForExit = proposeTransfer;

/** As issuer: approve a transfer the licensee proposed, to the commitment you were shown. */
export const licenceTransferApprove = async (
  ctx: Ctx,
  o: { readonly label: string; readonly newCommitment: string; readonly newLabel: string },
): Promise<TxRef> => {
  await ctx.vault.assertActive();
  checkLabel(o.newLabel);
  const p = ctx.vault.read();
  const l = issued(p, o.label);
  if (p.licences.some((x) => x.label === o.newLabel)) throw new Error(`Licence "${o.newLabel}" already exists.`);
  const to = toHex(bytes32(o.newCommitment, 'The new licence commitment'));
  if (p.licences.some((x) => x.role === 'issuer' && x.commitment === to && x.status === 'revoked'))
    throw new Error(`Refused: this partner revoked licence ${to} before. Nothing was sent.`);
  const r = recordOf(p, l.recordLabel);
  await actAs(ctx, r);
  const tx = await sent(
    ctx,
    { op: 'licence-transfer-approve', label: o.label, licence: l.commitment, note: `to ${to}` },
    () => needVc(ctx).approveTransfer(fromHex(l.commitment), fromHex(l.issuedUnder), fromHex(to)),
  );
  await ctx.vault.update((v) => {
    issued(v, o.label).status = 'revoked'; // the old commitment is gone; never re-issue it
    v.licences.push({ ...l, label: o.newLabel, commitment: to, status: 'issued' });
  });
  return tx;
};

// ─────────────────────────────────────────────────────────── lineage

/** As the child's holder: name a parent (a label of this partner, or someone else's record in hex). */
export const lineagePropose = async (
  ctx: Ctx,
  o: { readonly record: string; readonly parent: string },
): Promise<TxRef> => {
  await ctx.vault.assertActive();
  const p = ctx.vault.read();
  const child = recordOf(p, o.record);
  const parent = recordArg(p, o.parent);
  await actAs(ctx, child);
  return sent(
    ctx,
    { op: 'lineage-propose', label: child.label, record: child.current, note: `parent ${toHex(parent)}` },
    () => needVc(ctx).proposeParent(parent),
  );
};

/** As the parent's holder: confirm the child that named this record. */
export const lineageConfirm = async (
  ctx: Ctx,
  o: { readonly record: string; readonly child: string },
): Promise<TxRef> => {
  await ctx.vault.assertActive();
  const p = ctx.vault.read();
  const parent = recordOf(p, o.record);
  const child = recordArg(p, o.child);
  await actAs(ctx, parent);
  return sent(
    ctx,
    { op: 'lineage-confirm', label: parent.label, record: parent.current, note: `child ${toHex(child)}` },
    () => needVc(ctx).confirmParent(child),
  );
};

// ─────────────────────────────────────────────────────────── obligations

const obligationOf = (p: VaultPayload, label: string): ObligationEntry => {
  const o = p.obligations.find((x) => x.label === label);
  if (o === undefined) throw new Error(`Partner ${p.partner.id} has no obligation "${label}".`);
  return o;
};

/**
 * Place an obligation on one of the partner's own records, in its own favour (a breeder
 * marking a licensed mother). The terms and a fresh salt are stored first.
 */
export const obligationEncumber = async (
  ctx: Ctx,
  o: { readonly record: string; readonly terms: string; readonly label: string },
): Promise<TxRef> => {
  await ctx.vault.assertActive();
  return placeObligation(ctx, { ...o, kind: 'own', on: o.record });
};

/** As beneficiary: propose an obligation on someone else's record (binds nobody until they accept). */
export const obligationPropose = async (
  ctx: Ctx,
  o: { readonly record: string; readonly on: string; readonly terms: string; readonly label: string },
): Promise<TxRef> => {
  await ctx.vault.assertActive();
  return placeObligation(ctx, { ...o, kind: 'proposed' });
};

const placeObligation = async (
  ctx: Ctx,
  o: { record: string; on: string; terms: string; label: string; kind: 'own' | 'proposed' },
): Promise<TxRef> => {
  checkLabel(o.label);
  let p = ctx.vault.read();
  const existing = p.obligations.find((x) => x.label === o.label);
  if (
    existing !== undefined &&
    !(existing.status === 'proposed' && existing.terms === o.terms && existing.kind === o.kind)
  )
    throw new Error(`Obligation "${o.label}" already exists.`);
  const r = recordOf(p, o.record);
  if (existing === undefined) {
    if (o.terms.trim() === '') throw new Error('An obligation needs terms.');
    const salt = newSecret();
    const entry: ObligationEntry = {
      label: o.label,
      recordLabel: r.label,
      onRecord: toHex(o.kind === 'own' ? fromHex(r.current) : recordArg(p, o.on)),
      terms: o.terms,
      salt: toHex(salt),
      commitment: toHex(commit.obligation(o.terms, salt)),
      kind: o.kind,
      status: 'proposed',
    };
    await ctx.vault.update((v) => void v.obligations.push(entry));
    p = ctx.vault.read();
  }
  const ob = obligationOf(p, o.label);
  await actAs(ctx, r);
  const tx = await sent(
    ctx,
    {
      op: o.kind === 'own' ? 'obligation-encumber' : 'obligation-propose',
      label: o.label,
      record: ob.onRecord,
      obligation: ob.commitment,
    },
    () =>
      o.kind === 'own'
        ? needVc(ctx).encumberOwnRecord(fromHex(ob.commitment))
        : needVc(ctx).proposeObligation(fromHex(ob.onRecord), fromHex(ob.commitment)),
  );
  if (o.kind === 'own') await ctx.vault.update((v) => void (obligationOf(v, o.label).status = 'open'));
  return tx;
};

/** As holder: accept an obligation another party proposed on one of the partner's records. */
export const obligationAccept = async (
  ctx: Ctx,
  o: { readonly record: string; readonly commitment: string; readonly beneficiary: string },
): Promise<TxRef> => {
  await ctx.vault.assertActive();
  const p = ctx.vault.read();
  const r = recordOf(p, o.record);
  const c = bytes32(o.commitment, 'An obligation commitment');
  const b = recordArg(p, o.beneficiary);
  await actAs(ctx, r);
  return sent(ctx, { op: 'obligation-accept', label: r.label, record: r.current, obligation: toHex(c) }, () =>
    needVc(ctx).acceptObligation(c, b),
  );
};

/** As beneficiary: release an obligation owed to the partner. */
export const obligationDischarge = async (ctx: Ctx, o: { readonly label: string }): Promise<TxRef> => {
  await ctx.vault.assertActive();
  const p = ctx.vault.read();
  const ob = obligationOf(p, o.label);
  if (ob.status === 'discharged') throw new Error(`Obligation "${o.label}" is already discharged.`);
  const beneficiary = recordOf(p, ob.recordLabel);
  await actAs(ctx, beneficiary);
  const tx = await sent(
    ctx,
    { op: 'obligation-discharge', label: o.label, record: ob.onRecord, obligation: ob.commitment },
    () => needVc(ctx).discharge(fromHex(ob.onRecord), fromHex(ob.commitment)),
  );
  await ctx.vault.update((v) => void (obligationOf(v, o.label).status = 'discharged'));
  return tx;
};

// ─────────────────────────────────────────────────────────── claims

/**
 * Seal a record's field set (the opening: hidden values and field secret) into custody.
 * Returns the public parts. `date`: also timestamp the record commitment on chain.
 */
export const sealFieldSet = async (
  ctx: Ctx,
  o: { readonly label: string; readonly file: FieldSetFile; readonly date?: boolean },
): Promise<{
  readonly commitment: string;
  readonly schemaId: string;
  readonly setRoot: string;
  readonly tx?: TxRef;
}> => {
  await ctx.vault.assertActive();
  checkLabel(o.label);
  if (ctx.vault.read().fieldSets.some((f) => f.label === o.label))
    throw new Error(`Field set "${o.label}" already exists.`);
  const s = sealFields(o.file); // throws, naming the problem, on anything the SDK would refuse
  const entry: FieldSetEntry = {
    label: o.label,
    file: structuredClone(o.file),
    commitment: toHex(s.commitment),
    schemaId: toHex(s.schemaId),
    setRoot: toHex(s.setRoot),
    createdAt: new Date().toISOString(),
  };
  await ctx.vault.update((v) => void v.fieldSets.push(entry));
  await ctx.audit.write({ op: 'seal-fields', ok: true, label: o.label, fields: entry.commitment });
  const out = { commitment: entry.commitment, schemaId: entry.schemaId, setRoot: entry.setRoot };
  if (o.date !== true) return out;
  const tx = await sent(ctx, { op: 'date', label: o.label, fields: entry.commitment }, () =>
    needVc(ctx).anchorBatch(s.commitment),
  );
  return { ...out, tx };
};

/** Make a laboratory claims key in custody; returns its public key (what verifiers trust). */
export const labKeyNew = async (
  ctx: Ctx,
  o: { readonly label: string },
): Promise<{ readonly x: string; readonly y: string }> => {
  await ctx.vault.assertActive();
  checkLabel(o.label);
  if (ctx.vault.read().labKeys.some((k) => k.label === o.label))
    throw new Error(`Lab key "${o.label}" already exists.`);
  const k = newLabKey();
  const key = { x: k.key.x.toString(16), y: k.key.y.toString(16) };
  await ctx.vault.update((v) => void v.labKeys.push({ label: o.label, secret: k.secret.toString(16), key }));
  await ctx.audit.write({ op: 'lab-key-new', ok: true, label: o.label, note: `public key x=${key.x} y=${key.y}` });
  return key;
};

export type ClaimRequest =
  | { readonly kind: 'value'; readonly fields: string; readonly slot: number; readonly publish: boolean }
  | {
      readonly kind: 'range';
      readonly fields: string;
      readonly slot: number;
      readonly direction: RangeDirection;
      readonly bound: bigint;
    }
  | { readonly kind: 'distinct'; readonly fields: string; readonly other: string }
  | {
      readonly kind: 'unchanged';
      readonly fields: string;
      readonly corrected: string;
      readonly mayChange: readonly number[];
    }
  | { readonly kind: 'attested'; readonly fields: string; readonly labKey: string };

/** Prove one fact about a sealed record. A value claim PUBLISHES the value: `publish` must be true. */
export const makeClaim = async (ctx: Ctx, c: ClaimRequest): Promise<ClaimRef> => {
  await ctx.vault.assertActive();
  if (ctx.claims === undefined) throw new Error('This needs the claims contract: no claims client was joined.');
  const claims = ctx.claims;
  const p = ctx.vault.read();
  const sealedOf = (label: string): ReturnType<typeof sealFields> & { readonly file: FieldSetFile } => {
    const f = p.fieldSets.find((x) => x.label === label);
    if (f === undefined) throw new Error(`Partner ${p.partner.id} has no field set "${label}".`);
    if (f.file === undefined) throw new Error(`Field set "${label}" has no opening in custody (purged).`);
    return { ...sealFields(f.file), file: f.file };
  };
  const first = sealedOf(c.fields);
  const base = { op: `claim-${c.kind}`, label: c.fields, fields: toHex(first.commitment) };
  switch (c.kind) {
    case 'value':
      if (!c.publish)
        throw new Error(
          'A value claim PUBLISHES the value on chain, for good. Confirm it to go ahead. Nothing was sent.',
        );
      return sent(ctx, { ...base, note: `slot ${c.slot}` }, () => claims.proveValue(first.record, c.slot));
    case 'range':
      return sent(ctx, { ...base, note: `slot ${c.slot} ${c.direction} ${c.bound}` }, () =>
        claims.proveRange(first.record, first.file.schema, c.slot, c.direction, c.bound),
      );
    case 'distinct': {
      const other = sealedOf(c.other);
      return sent(ctx, { ...base, note: `distinct from ${toHex(other.commitment)}` }, () =>
        claims.proveDistinct(first.record, other.record, first.file.schema),
      );
    }
    case 'unchanged': {
      const corrected = sealedOf(c.corrected);
      const may = Array.from({ length: 16 }, (_, i) => c.mayChange.includes(i));
      return sent(
        ctx,
        { ...base, note: `corrected ${toHex(corrected.commitment)}; may change ${c.mayChange.join(',') || 'none'}` },
        () => claims.proveUnchanged(first.record, corrected.record, may),
      );
    }
    case 'attested': {
      const k = p.labKeys.find((x) => x.label === c.labKey);
      if (k === undefined) throw new Error(`Partner ${p.partner.id} has no lab key "${c.labKey}".`);
      if (k.secret === undefined) throw new Error(`Lab key "${c.labKey}" has no secret in custody (purged).`);
      const secret = BigInt(`0x${k.secret}`);
      const key = labKeyOf(secret);
      return sent(ctx, { ...base, note: `lab key ${k.label}` }, () =>
        claims.proveAttested(first.record, { key, signature: signRecord(secret, first.commitment) }),
      );
    }
  }
};

// ─────────────────────────────────────────────────────────── listing

export type Listing = {
  readonly partner: { readonly id: string; readonly displayName: string; readonly network: string };
  readonly retired?: { readonly at: string; readonly mode: string };
  readonly purged: boolean;
  readonly unusedRecoveryCommitments: number;
  readonly records: readonly {
    readonly label: string;
    readonly status: string;
    readonly record: string;
    readonly anchoredAs: string;
    readonly recoveryHeldBy: RecoveryHolder;
    readonly chain?: { readonly anchored: boolean; readonly veilcoreCanAct: boolean; readonly openObligations: string };
  }[];
  readonly licences: readonly {
    readonly label: string;
    readonly role: string;
    readonly status: string;
    readonly commitment: string;
  }[];
  readonly obligations: readonly {
    readonly label: string;
    readonly kind: string;
    readonly status: string;
    readonly commitment: string;
  }[];
  readonly fieldSets: readonly { readonly label: string; readonly commitment: string }[];
  readonly labKeys: readonly { readonly label: string; readonly x: string; readonly y: string }[];
};

/**
 * What VeilCore runs for a partner, public parts only (no secrets), and, given the
 * ledger (readLedger needs no wallet), whether each record is anchored and whether
 * VeilCore's copy of its secret can still act.
 */
export const listPartner = (p: VaultPayload, ledger?: Ledger): Listing => ({
  partner: { id: p.partner.id, displayName: p.partner.displayName, network: p.partner.network },
  ...(p.retired === undefined ? {} : { retired: { at: p.retired.at, mode: p.retired.mode } }),
  purged: p.purgedAt !== undefined,
  unusedRecoveryCommitments: unusedPool(p),
  records: p.records.map((r) => ({
    label: r.label,
    status: r.status,
    record: r.current,
    anchoredAs: r.origin,
    recoveryHeldBy: r.recovery.heldBy,
    ...(ledger === undefined
      ? {}
      : {
          chain: {
            anchored: isAnchored(ledger, fromHex(r.current)),
            veilcoreCanAct: isLive(ledger, fromHex(r.current)),
            openObligations: String(openObligations(ledger, identityOf(ledger, fromHex(r.current)))),
          },
        }),
  })),
  licences: p.licences.map((l) => ({ label: l.label, role: l.role, status: l.status, commitment: l.commitment })),
  obligations: p.obligations.map((o) => ({ label: o.label, kind: o.kind, status: o.status, commitment: o.commitment })),
  fieldSets: p.fieldSets.map((f) => ({ label: f.label, commitment: f.commitment })),
  labKeys: p.labKeys.map((k) => ({ label: k.label, x: k.key.x, y: k.key.y })),
});
