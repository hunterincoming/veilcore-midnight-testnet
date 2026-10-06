// Leaving VeilCore-run ("rotate us out"), and handing a partner their secrets.
// SPDX-License-Identifier: Apache-2.0
//
// What the contract allows decides the design (contract/src/veilcore.compact):
//
//  - rotateRecordSecret needs BOTH the current record secret and the new one (the circuit
//    checks the caller holds the secret behind the new commitment). So VeilCore cannot
//    rotate a record to a secret only the partner has seen: whoever sends a rotation
//    holds the new secret, at least for that moment.
//  - replaceRecoveryCommitment needs only the CURRENT recovery secret and the new recovery
//    COMMITMENT. So where VeilCore holds a record's recovery secret, it can install one the
//    partner made, without ever seeing the secret behind it.
//  - recoverRecordSecret, with the recovery secret, moves an identity away from whoever
//    holds its record secret, VeilCore included, and installs a new recovery commitment
//    in the same transaction.
//  - proposeTransfer moves a licence the partner holds to a licence commitment the partner
//    made (secret never seen); the issuer must approve it.
//
// So no exit is finished until the PARTNER has recovered each record with their own
// recovery secret (partner-recover, on their computer): that is the one step that leaves
// nothing VeilCore's software made or held in control. VeilCore can prepare everything up
// to it:
//
//  - self: VeilCore hands over everything (a bundle sealed to the partner's key) and stops.
//  - assisted: VeilCore installs the partner's recovery commitment where it held the
//    recovery secret, then rotates each record to a new secret it makes inside the exit
//    run, seals into the partner's bundle at once, never writes in plain text and drops
//    when the run ends. VeilCore's stored copies then control nothing; the hand-over
//    secrets control the records until the partner's own recovery.
//
// Bundles are sealed to the partner's public key (bundle.ts): nothing on VeilCore's side
// can open one, and no passphrase is typed there.

import { readFile } from 'node:fs/promises';
import {
  LandedButUnconfirmedError,
  type Ledger,
  RecoveryReplacedButUnconfirmedError,
  commit,
  fromHex,
  isLive,
  newSecret,
  toHex,
} from '@veilcore/contracts';
import { readAudit } from './audit.ts';
import { type ExitBundle, type RecordHandover, BUNDLE_FORMAT, writeBundle } from './bundle.ts';
import { type Ctx, anchorAudit, proposeTransferForExit } from './operator.ts';
import {
  type ExitAnswer,
  type ExitRequest,
  REQUEST_FORMAT,
  fingerprintMatches,
  fingerprintOf,
} from './partner-keys.ts';
import { type ExitMode, type ExitState, type VaultPayload } from './vault.ts';

const now = (): string => new Date().toISOString();

type Contracts = { readonly veilcore?: string; readonly claims?: string };

const auditOf = async (ctx: Ctx): Promise<ExitBundle['audit']> => (await readAudit(ctx.audit.file)).entries;

/** What has to be settled before a partner can leave: nothing may be left half-done. */
export const exitBlockers = (p: VaultPayload): string[] => [
  ...p.records
    .filter((r) => r.status === 'new')
    .map((r) => `record "${r.label}" was stored but never anchored: run anchor again to finish it, or abandon it`),
  ...p.licences
    .filter((l) => l.role === 'licensee' && l.status === 'requested')
    .map((l) => `licence "${l.label}" was requested but never countersigned: countersign it, or abandon it`),
  ...p.licences
    .filter((l) => l.role === 'issuer' && l.status === 'issuing')
    .map((l) => `licence "${l.label}" may or may not have been issued: check list --chain, then revoke or keep it`),
];
const refuseBlockers = (p: VaultPayload): void => {
  const b = exitBlockers(p);
  if (b.length > 0) throw new Error(`Not yet: ${b.join('; ')}. Nothing was sent.`);
};

const keyFor = (p: VaultPayload): string => {
  const k = p.exit?.bundleKey ?? p.partnerKey?.bundleKey;
  if (k === undefined)
    throw new Error(
      `Partner ${p.partner.id} has given no bundle key. They run partner-keys on their own computer (--count 0 is ` +
        'enough for a key only); then import-pool with the fingerprint they read out. Nothing was written.',
    );
  return k;
};

/**
 * A copy of everything VeilCore holds for a partner, sealed to the partner's key, for
 * safekeeping on their side. The partner stays in VeilCore-run (nothing changes). After a
 * self exit (before the purge) it is a second copy of the exit bundle.
 */
export const exportBundle = async (
  ctx: Ctx,
  o: { readonly out: string; readonly contracts?: Contracts },
): Promise<{ readonly sha256: string }> => {
  const p = ctx.vault.read();
  if (p.purgedAt !== undefined)
    throw new Error(`Partner ${p.partner.id}'s secrets were purged; there is nothing to export.`);
  // After an assisted exit the live secrets are in the partner's exit bundle only: what is
  // left here controls nothing, and a bundle of it would mislead.
  if (p.retired?.mode === 'assisted')
    throw new Error(
      `Partner ${p.partner.id} left with an assisted exit: their live secrets are only in their exit bundle. Nothing was written.`,
    );
  const kind = p.retired === undefined ? 'export' : 'exit-self';
  const bundle: ExitBundle = {
    format: BUNDLE_FORMAT,
    kind,
    madeAt: now(),
    partner: { id: p.partner.id, displayName: p.partner.displayName, network: p.partner.network },
    ...(o.contracts === undefined ? {} : { contracts: o.contracts }),
    vault: p,
    procedure: procedure(p, kind === 'export' ? 'export' : 'self'),
    audit: await auditOf(ctx),
  };
  const sha256 = await writeBundle(o.out, keyFor(p), bundle);
  await ctx.vault.addBundle({ path: o.out, sha256, madeAt: bundle.madeAt, kind });
  await ctx.audit.write({ op: 'export', ok: true, note: `bundle sha256 ${sha256}, sealed to the partner's key` });
  return { sha256 };
};

/** Public: what a leaving partner needs to prepare an assisted exit on their own computer. */
export const exitRequest = (p: VaultPayload): ExitRequest => ({
  format: REQUEST_FORMAT,
  partner: p.partner.id,
  network: p.partner.network,
  records: p.records
    .filter((r) => r.status === 'anchored' && r.recovery.secret !== undefined)
    .map((r) => ({ label: r.label, origin: r.origin })),
  licences: p.licences
    .filter((l) => l.role === 'licensee' && l.status === 'active')
    .map((l) => ({ label: l.label, issuerRecord: l.role === 'licensee' ? l.issuerRecord : '' })),
});

/**
 * Leave, the partner sending the transactions: hand over everything (sealed to their key)
 * and retire the store. VeilCore's copies keep working on chain until the partner runs
 * partner-recover. Also the way out when an assisted exit cannot finish.
 */
export const exitSelf = async (
  ctx: Ctx,
  o: { readonly out: string; readonly contracts?: Contracts },
): Promise<{ readonly sha256: string }> => {
  await ctx.vault.assertActive();
  const p = ctx.vault.read();
  refuseBlockers(p);
  const key = keyFor(p);
  const bundle: ExitBundle = {
    format: BUNDLE_FORMAT,
    kind: 'exit-self',
    madeAt: now(),
    partner: { id: p.partner.id, displayName: p.partner.displayName, network: p.partner.network },
    ...(o.contracts === undefined ? {} : { contracts: o.contracts }),
    vault: p,
    ...(p.exit === undefined ? {} : { earlierBundles: earlierBundles(p.exit) }),
    procedure: procedure(p, 'self'),
    audit: await auditOf(ctx),
  };
  const sha256 = await writeBundle(o.out, key, bundle);
  await ctx.vault.addBundle({ path: o.out, sha256, madeAt: bundle.madeAt, kind: 'exit-self' });
  await ctx.vault.retire('self', sha256);
  await ctx.audit.write({ op: 'exit', ok: true, note: `self; bundle sha256 ${sha256}; store retired` });
  return { sha256 };
};

const earlierBundles = (e: ExitState): { sha256: string; labels: string[] }[] => {
  const by = new Map<string, string[]>();
  for (const [label, st] of Object.entries(e.records))
    if (st.bundleSha256 !== undefined && st.status === 'done')
      by.set(st.bundleSha256, [...(by.get(st.bundleSha256) ?? []), label]);
  return [...by].map(([sha256, labels]) => ({ sha256, labels }));
};

const MAX_ROTATIONS = 16n;

/**
 * Leave, VeilCore sending the transactions (see the top of this file).
 *
 * `confirmedFingerprint` is what the partner read out from their own screen when they
 * made `answer` (partner-keys), typed by the operator: an answer changed or forged on the
 * way is refused before anything is sent, because it decides who controls the records.
 *
 * The exit is recorded in the store before anything is sent, so running this again (after
 * an error, a kill or a power cut) resumes it: what landed is found on chain, nothing is
 * started twice, and only a record whose VeilCore secret is still live gets a new hand-over
 * secret. Each run writes one bundle; the partner gets every one.
 */
export const exitAssisted = async (
  ctx: Ctx,
  o: {
    readonly answer: ExitAnswer;
    readonly confirmedFingerprint: string;
    readonly out: string;
    readonly contracts?: Contracts;
  },
): Promise<{ readonly sha256: string; readonly handover: readonly RecordHandover[]; readonly complete: boolean }> => {
  await ctx.vault.assertActive();
  if (ctx.vc === undefined) throw new Error('An assisted exit sends transactions: it needs the chain.');
  const vc = ctx.vc;
  const a = o.answer;
  let p = ctx.vault.read();
  if (a.partner !== p.partner.id || a.network !== p.partner.network)
    throw new Error(`That answer was made for ${a.partner} on ${a.network}. Refused.`);
  if (!fingerprintMatches(o.confirmedFingerprint, a))
    throw new Error(
      'That is not the fingerprint of this answer: it was changed on the way, or is not the one the partner made. ' +
        'Refused: nothing was sent.',
    );
  refuseBlockers(p);
  const fp = fingerprintOf(a);
  if (p.exit !== undefined && (p.exit.mode !== 'assisted' || p.exit.answerFingerprint !== fp))
    throw new Error(
      `An exit for ${p.partner.id} is already under way (started ${p.exit.startedAt}) with another answer. Refused: ` +
        'run it again with that answer, or fall back to a self exit.',
    );
  for (const r of exitRequest(p).records)
    if (!a.records.some((x) => x.label === r.label))
      throw new Error(`The answer has no new recovery commitment for record "${r.label}". Nothing was sent.`);
  const seen = new Set<string>();
  for (const x of a.records) {
    if (seen.has(x.recoveryCommitment)) throw new Error('The answer repeats a recovery commitment. Refused.');
    seen.add(x.recoveryCommitment);
  }
  if (p.exit === undefined) {
    const state: ExitState = {
      mode: 'assisted',
      startedAt: now(),
      bundleKey: a.bundleKey,
      answerFingerprint: fp,
      records: {},
      licences: {},
    };
    await ctx.vault.update((v) => void (v.exit = state));
    await ctx.audit.write({ op: 'exit-start', ok: true, note: `assisted; answer fingerprint ${fp} confirmed` });
    p = ctx.vault.read();
  }

  // ── Where each record stands, from the chain ──────────────────────────────────────────
  const ledger: Ledger = await vc.ledger();
  const live = (c: string | undefined): boolean => c !== undefined && isLive(ledger, fromHex(c));
  /** Whether `record` is the head of the identity anchored as `origin` (isLive alone is true of any unused commitment). */
  const isHead = (l: Ledger, origin: string, record: string | undefined): boolean => {
    if (record === undefined) return false;
    const o = fromHex(origin);
    return toHex(l.headOf.member(o) ? l.headOf.lookup(o) : o) === record;
  };
  const fresh = new Map<string, Uint8Array>(); // label → hand-over secret, this run only
  const handover: RecordHandover[] = [];
  const settle: Record<string, ExitState['records'][string]> = {};
  for (const r of p.records.filter((x) => x.status === 'anchored' || x.status === 'handed-over')) {
    const st = p.exit!.records[r.label];
    if (st?.status === 'done' || st?.status === 'taken-back') continue;
    if (isHead(ledger, r.origin, st?.newRecord)) {
      // An earlier run's rotation landed though it reported an error, or the run was cut short.
      settle[r.label] = { ...st, status: 'done', note: 'found on chain' };
      continue;
    }
    const oldLive = r.secret !== undefined && live(toHex(commit.record(fromHex(r.secret))));
    if (!oldLive) {
      settle[r.label] = {
        txIds: st?.txIds ?? [],
        status: 'taken-back',
        note: 'neither VeilCore nor its hand-over controls it',
      };
      continue;
    }
    const origin = fromHex(r.origin);
    const used = ledger.rotationsOf.member(origin) ? ledger.rotationsOf.lookup(origin).read() : 0n;
    const ans = a.records.find((x) => x.label === r.label);
    if (used >= MAX_ROTATIONS) {
      handover.push({
        label: r.label,
        origin: r.origin,
        ...(r.recovery.secret !== undefined && ans !== undefined
          ? { newRecoveryCommitment: ans.recoveryCommitment }
          : {}),
        status: 'not-rotatable',
        txIds: [],
        note: `all ${MAX_ROTATIONS} rotations used: only the partner's recovery can move it`,
      });
      continue;
    }
    const s = newSecret();
    fresh.set(r.label, s);
    handover.push({
      label: r.label,
      origin: r.origin,
      newSecret: toHex(s),
      newRecord: toHex(commit.record(s)),
      ...(r.recovery.secret !== undefined && ans !== undefined
        ? { newRecoveryCommitment: ans.recoveryCommitment }
        : {}),
      status: 'sent',
      txIds: [],
    });
  }

  // ── The bundle, sealed to the partner's key, BEFORE anything is sent ───────────────────
  const contracts = o.contracts ?? {
    veilcore: vc.address,
    ...(ctx.claims === undefined ? {} : { claims: ctx.claims.address }),
  };
  const view = partnerView(p, handover, a);
  const bundle: ExitBundle = {
    format: BUNDLE_FORMAT,
    kind: 'exit-assisted',
    madeAt: now(),
    partner: { id: p.partner.id, displayName: p.partner.displayName, network: p.partner.network },
    contracts,
    vault: view,
    handover,
    earlierBundles: earlierBundles(p.exit!),
    procedure: procedure(view, 'assisted', handover),
    audit: await auditOf(ctx),
  };
  // The hex copies in `handover` were only needed for the bundle.
  const sha256 = await writeBundle(o.out, p.exit!.bundleKey, bundle);
  for (const h of handover) delete (h as { newSecret?: string }).newSecret;
  await ctx.vault.addBundle({ path: o.out, sha256, madeAt: bundle.madeAt, kind: 'exit-assisted' });
  await ctx.vault.update((v) => {
    const e = v.exit!;
    Object.assign(e.records, settle);
    for (const h of handover) {
      e.records[h.label] = {
        ...(h.newRecord === undefined ? {} : { newRecord: h.newRecord }),
        bundleSha256: sha256,
        status: h.status === 'not-rotatable' ? 'not-rotatable' : 'planned',
        txIds: e.records[h.label]?.txIds ?? [],
        ...(e.records[h.label]?.recoveryReplaced ? { recoveryReplaced: true } : {}),
      };
      const x = v.records.find((y) => y.label === h.label);
      if (x !== undefined && h.newRecord !== undefined) x.made.push(h.newRecord); // VeilCore's software made it
    }
    for (const [label, st] of Object.entries(settle)) {
      const x = v.records.find((y) => y.label === label);
      if (x !== undefined && st.status === 'done' && st.newRecord !== undefined) {
        delete x.secret;
        delete x.pendingSecret;
        x.current = st.newRecord;
        x.status = 'handed-over';
      }
    }
  });
  for (const [label, st] of Object.entries(settle))
    await ctx.audit.write({
      op: 'exit-rotate',
      ok: true,
      label,
      ...(st.newRecord === undefined ? {} : { record: st.newRecord }),
      note: st.note ?? st.status,
    });

  // ── Send ───────────────────────────────────────────────────────────────────────────────
  try {
    for (const h of handover) {
      const r = ctx.vault.read().records.find((x) => x.label === h.label)!;
      try {
        // 1. The partner's recovery commitment replaces the recovery secret VeilCore holds
        //    (unless an earlier run already did: then VeilCore's is no longer current).
        if (
          h.newRecoveryCommitment !== undefined &&
          r.recovery.secret !== undefined &&
          (await vc.recoverySecretIsCurrent(fromHex(r.origin), fromHex(r.recovery.secret)))
        ) {
          let txId: string | undefined;
          try {
            txId = (
              await vc.replaceRecoveryCommitment({
                originalRecord: fromHex(r.origin),
                recoverySecret: fromHex(r.recovery.secret),
                newRecoveryCommitment: fromHex(h.newRecoveryCommitment),
              })
            ).txId;
          } catch (e) {
            if (!(e instanceof RecoveryReplacedButUnconfirmedError)) throw e;
          }
          if (txId !== undefined) h.txIds.push(txId);
          const ans = a.records.find((x) => x.label === h.label);
          const newRc = h.newRecoveryCommitment;
          await ctx.vault.update((v) => {
            const x = v.records.find((y) => y.label === h.label)!;
            x.recovery = {
              heldBy: 'partner',
              commitment: newRc,
              ...(ans === undefined ? {} : { pool: { id: a.poolId, index: ans.index } }),
            };
            v.exit!.records[h.label].recoveryReplaced = true;
          });
          await ctx.audit.write({
            op: 'exit-replace-recovery',
            ok: true,
            label: h.label,
            record: r.current,
            ...(txId === undefined ? { note: 'landed; confirming it failed' } : { txId }),
          });
        }
        if (h.status === 'not-rotatable') continue;

        // 2. Rotate to the hand-over secret: VeilCore's stored copy stops working.
        const s = fresh.get(h.label)!;
        let txId: string | undefined;
        await vc.useRecordSecret(fromHex(r.secret!));
        try {
          txId = (await vc.rotateRecordSecret(s)).txId;
        } catch (e) {
          // "Not seen" is not "did not land": ask the chain.
          const after = await vc.ledger().catch(() => undefined);
          const landed = after !== undefined && isHead(after, r.origin, h.newRecord);
          if (!landed && !(e instanceof LandedButUnconfirmedError)) throw e;
        } finally {
          s.fill(0);
        }
        if (txId !== undefined) h.txIds.push(txId);
        h.status = 'done';
        const newRecord = h.newRecord!;
        await ctx.vault.update((v) => {
          const x = v.records.find((y) => y.label === h.label)!;
          delete x.secret; // controls nothing now
          delete x.pendingSecret;
          x.current = newRecord; // public; the secret behind it is NOT stored here
          x.status = 'handed-over';
          const st = v.exit!.records[h.label];
          st.status = 'done';
          st.txIds.push(...h.txIds);
        });
        await ctx.audit.write({
          op: 'exit-rotate',
          ok: true,
          label: h.label,
          record: newRecord,
          ...(txId === undefined ? { note: 'landed; confirming it failed' } : { txId }),
        });
      } catch (e) {
        h.status = 'failed';
        h.note = e instanceof Error ? e.name : 'Error';
        await ctx.vault.update((v) => {
          const st = v.exit!.records[h.label];
          st.status = 'failed';
          st.note = h.note;
        });
        await ctx.audit.write({ op: 'exit-rotate', ok: false, label: h.label, note: h.note }).catch(() => undefined);
        break; // stop here: run exit again once the cause is fixed; it resumes
      }
    }
  } finally {
    for (const s of fresh.values()) s.fill(0);
    fresh.clear();
  }

  // 3. Licences the partner holds: propose moving each to the commitment they made.
  let licencesDone = true;
  if (!handover.some((h) => h.status === 'failed'))
    for (const l of a.licences) {
      if (ctx.vault.read().exit!.licences[l.label] === 'proposed') continue;
      const entry = ctx.vault.read().licences.find((x) => x.label === l.label);
      if (entry === undefined || entry.role !== 'licensee' || entry.status !== 'active') continue;
      try {
        await proposeTransferForExit(ctx, { label: l.label, newCommitment: l.licenceCommitment });
        await ctx.vault.update((v) => void (v.exit!.licences[l.label] = 'proposed'));
      } catch {
        licencesDone = false; // audited by proposeTransfer; the next run tries again
      }
    }

  const e = ctx.vault.read().exit!;
  const complete =
    licencesDone &&
    ctx.vault
      .read()
      .records.filter((r) => r.status === 'anchored' || r.status === 'handed-over')
      .every((r) => {
        const st = e.records[r.label];
        if (st === undefined) return false;
        if (st.status === 'not-rotatable') return r.recovery.secret === undefined; // only the partner's recovery is left
        return st.status === 'done' || st.status === 'taken-back';
      });
  if (complete) {
    await anchorAudit(ctx).catch(() => undefined); // a receipt for the partner, when the chain allows
    await ctx.vault.retire('assisted', sha256);
    await ctx.audit.write({ op: 'exit', ok: true, note: `assisted; last bundle sha256 ${sha256}; store retired` });
  } else {
    await ctx.audit.write({
      op: 'exit',
      ok: false,
      note: `assisted, not finished; bundle sha256 ${sha256}; store NOT retired`,
    });
  }
  return { sha256, handover, complete };
};

/** The partner's view in an assisted-exit bundle: hand-over secrets in, VeilCore's own out. */
const partnerView = (p: VaultPayload, handover: readonly RecordHandover[], a: ExitAnswer): VaultPayload => {
  const v = structuredClone(p);
  delete v.exit;
  v.bundles = [];
  for (const r of v.records) {
    const h = handover.find((x) => x.label === r.label);
    if (h !== undefined && h.newSecret !== undefined) {
      // Becomes the record's secret once the rotation lands (partner-check says which is live).
      r.pendingSecret = h.newSecret;
    }
    if (h?.status !== 'not-rotatable') delete r.secret; // VeilCore's copy: dead once rotated
    if (h?.newRecoveryCommitment !== undefined) {
      const ans = a.records.find((x) => x.label === r.label);
      r.recovery = {
        heldBy: 'partner',
        commitment: h.newRecoveryCommitment,
        ...(ans === undefined ? {} : { pool: { id: a.poolId, index: ans.index } }),
      };
    }
  }
  return v;
};

// ─────────────────────────────────────────────────────────── the procedure

const KIT =
  "import { VeilCore, commit, fromHex, newSecret } from '@veilcore/contracts'; // see docs/PARTNERS.md to connect";

/** Plain-English steps for the partner, with the commands for whoever helps them. */
export const procedure = (
  p: VaultPayload,
  mode: 'export' | ExitMode,
  handover: readonly RecordHandover[] = [],
): string => {
  const L: string[] = [];
  const say = (...s: string[]): void => void L.push(...s);
  say(`For ${p.partner.displayName} (${p.partner.id}), network ${p.partner.network}.`, '');
  if (mode === 'export') {
    say(
      'This is a COPY of what VeilCore holds for you, sealed to your own key: only your master secret opens it.',
      'You are still in VeilCore-run, and VeilCore still acts for you with these same secrets. To leave, ask',
      'VeilCore for an exit; see docs/MANAGED.md, "How to leave".',
    );
    return L.join('\n');
  }
  say('WHAT YOU HAVE', '');
  say(
    '- This bundle, sealed to your own key: only your master secret opens it. VeilCore cannot open it.',
    '- Your audit log: everything VeilCore did for you, with transaction ids you can look up yourself.',
    '',
  );
  if (mode === 'assisted') {
    say('WHAT VEILCORE HAS DONE (or is doing as this bundle is made)', '');
    for (const h of handover)
      say(
        `- ${h.label}: ` +
          (h.status === 'not-rotatable'
            ? `could not be rotated (${h.note ?? 'rotation limit'}); `
            : "rotated to the new record secret in this bundle, which VeilCore's software made for the hand-over; ") +
          (h.newRecoveryCommitment === undefined
            ? ''
            : 'the recovery commitment you made replaces the one VeilCore held.'),
      );
    say('');
  }
  say(
    'WHAT YOU MUST STILL DO: REQUIRED',
    '',
    'Take every record back with YOUR OWN recovery secret. Until you do, ' +
      (mode === 'self'
        ? "VeilCore's copies of your secrets still control your records."
        : "the record secrets VeilCore's software made for the hand-over control your records, and anyone who\n" +
          "had control of VeilCore's computer during the exit could have them."),
    '',
    'On your own computer (Node 24, Docker, a Midnight wallet holding DUST; docs/PARTNERS.md), with your',
    'master sheet, from the VeilCore repository:',
    `  npm run managed -- partner-recover --partner ${p.partner.id} --bundle <this bundle> [--bundle <each other bundle>]`,
    `  npm run managed -- partner-check --partner ${p.partner.id} --bundle <this bundle> [--bundle ...]`,
    'partner-recover sends one recovery per record, to a record secret and a recovery secret derived from your',
    'master that no VeilCore software has ever seen. partner-check confirms on chain, for every record, that',
    'both are yours. Then tell VeilCore: its exit-check shows the same.',
    '',
  );
  for (const r of p.records.filter((x) => x.status === 'anchored' || x.status === 'handed-over'))
    say(
      `- ${r.label} (anchored as ${r.origin.slice(0, 16)}…): recovers with ` +
        (r.recovery.secret !== undefined
          ? 'the recovery secret VeilCore held (in this bundle).'
          : r.recovery.pool !== undefined
            ? `your recovery secret number ${r.recovery.pool.index} (pool ${r.recovery.pool.id}).`
            : 'the recovery secret you supplied for it.'),
    );
  say('', 'ALSO', '');
  const held = p.licences.filter(
    (l) => l.role === 'licensee' && (l.status === 'active' || l.status === 'transfer-proposed'),
  );
  if (held.length > 0)
    say(
      '- Licences you hold: whoever holds a licence secret can present the licence, and VeilCore had these.',
      '  Each one moves to a licence secret only you hold when its issuer approves the transfer' +
        (mode === 'assisted' ? ' VeilCore proposed' : ' (propose it with the kit)') +
        ". Until then, VeilCore's copy still works:",
      ...held.map(
        (l) =>
          `    ${l.label}: issuer record ${l.role === 'licensee' ? l.issuerRecord : ''}${l.role === 'licensee' && l.transferTo !== undefined ? ` (proposed to ${l.transferTo})` : ''}`,
      ),
    );
  if (p.fieldSets.length > 0)
    say(
      '- Sealed field sets: whoever holds one can prove claims about that record, and the chain cannot',
      '  change that. VeilCore deletes its copies when you confirm you can open this bundle ("purge").',
    );
  if (p.labKeys.length > 0)
    say(
      '- Laboratory claims keys: a key cannot be changed on chain. Make a new one, publish its public key,',
      '  and tell the people who check your signatures to stop trusting the old one.',
    );
  say(
    '- Then tell VeilCore you have opened this bundle. VeilCore purges every secret it still holds for you,',
    '  deletes the bundle files on its computer, and keeps only the audit log. Deleting a file cannot be',
    '  guaranteed to erase it from a solid-state disk or from backups: that is why your own recovery matters.',
    '',
    `For a developer: ${KIT}`,
  );
  return L.join('\n');
};

/** Read a JSON file a partner sent (a pool or an exit answer). */
export const readJson = async (file: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    throw new Error(`${file} is not a JSON file.`);
  }
};
