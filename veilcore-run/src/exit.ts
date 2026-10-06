// Leaving VeilCore-run ("rotate us out"), and handing a partner their secrets.
// SPDX-License-Identifier: Apache-2.0
//
// What the contract allows decides the design (contract/src/veilcore.compact):
//
//  - rotateRecordSecret needs BOTH the current record secret and the new one (the circuit
//    checks the caller holds the secret behind the new commitment). So VeilCore cannot
//    rotate a record to a secret only the partner has seen: whoever sends a rotation
//    sees the new secret.
//  - replaceRecoveryCommitment needs only the CURRENT recovery secret and the new
//    recovery COMMITMENT. So where VeilCore holds a record's recovery secret, it can
//    install a recovery commitment the partner made, and never see the secret behind it.
//  - recoverRecordSecret, with the recovery secret, moves an identity away from whoever
//    holds its record secret, VeilCore included, and installs a new recovery commitment
//    in the same transaction.
//  - proposeTransfer moves a licence the partner holds to a licence commitment the
//    partner made (secret never seen); the issuer must approve it.
//
// Hence two ways out:
//
//  - self: VeilCore hands over everything (the bundle) and retires the partner's store.
//    The partner, or anyone they choose, sends one transaction per record with the kit:
//    a recovery (custody records: stops both of VeilCore's copies at once) or a rotation
//    (records whose recovery secret they already hold). Needs a wallet with DUST.
//  - assisted: VeilCore sends the transactions and pays. For each record: the partner's
//    new recovery commitment replaces VeilCore's recovery secret (custody records), then
//    VeilCore rotates the record to a new secret that goes ONLY into the partner's
//    encrypted bundle, never into VeilCore's vault. VeilCore's old copies then control
//    nothing. The new record secret did pass through VeilCore's software once; the
//    partner's recovery secret, which VeilCore never saw, outranks it, and one recovery
//    with it gives them a record secret no VeilCore software has touched.

import { readFile } from 'node:fs/promises';
import {
  RecoveryReplacedButUnconfirmedError,
  LandedButUnconfirmedError,
  commit,
  fromHex,
  newSecret,
  toHex,
} from '@veilcore/contracts';
import { readAudit } from './audit.ts';
import {
  type ExitBundle,
  type RecordHandover,
  BUNDLE_FORMAT,
  checkPassphrase,
  readBundle,
  writeBundle,
} from './bundle.ts';
import { writePrivate } from './files.ts';
import { type Ctx, proposeTransferForExit } from './operator.ts';
import { type ExitAnswer, type ExitRequest, REQUEST_FORMAT } from './partner-keys.ts';
import { custodySheet } from './sheet.ts';
import { type ExitMode, type VaultPayload } from './vault.ts';

const now = (): string => new Date().toISOString();

type Contracts = { readonly veilcore?: string; readonly claims?: string };

/** Write a printable sheet (plain text, secrets in it) to a NEW file, 0600. */
export const writeSheet = (file: string, text: string): Promise<void> => writePrivate(file, text, { exclusive: true });

const auditOf = async (ctx: Ctx): Promise<ExitBundle['audit']> => (await readAudit(ctx.audit.file)).entries;

/**
 * A copy of everything VeilCore holds for a partner, encrypted to the partner's passphrase,
 * for safekeeping on their side. The partner stays in VeilCore-run (nothing changes).
 */
export const exportBundle = async (
  ctx: Ctx,
  o: { readonly passphrase: string; readonly out: string; readonly sheet?: string; readonly contracts?: Contracts },
): Promise<{ readonly sha256: string }> => {
  checkPassphrase(o.passphrase);
  const p = ctx.vault.read();
  if (p.purgedAt !== undefined)
    throw new Error(`Partner ${p.partner.id}'s secrets were purged; there is nothing to export.`);
  // After an assisted exit the live secrets are in the partner's exit bundle only: what is
  // left here controls nothing, and a bundle of it would mislead. After a self exit, a
  // second copy of the exit bundle is what the partner may need.
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
  const sha256 = await writeBundle(o.out, o.passphrase, bundle);
  if (o.sheet !== undefined)
    await writeSheet(
      o.sheet,
      custodySheet(p, {
        title:
          kind === 'export'
            ? 'COPY OF YOUR SECRETS (you are still in VeilCore-run)'
            : 'YOUR SECRETS (you have left VeilCore-run)',
        madeAt: bundle.madeAt,
      }),
    );
  await ctx.audit.write({
    op: 'export',
    ok: true,
    note: `bundle sha256 ${sha256}${o.sheet === undefined ? '' : ', with a printed sheet'}`,
  });
  return { sha256 };
};

/** Public: what a leaving partner needs to prepare an assisted exit on their own computer. */
export const exitRequest = (p: VaultPayload): ExitRequest => ({
  format: REQUEST_FORMAT,
  partner: p.partner.id,
  network: p.partner.network,
  records: p.records
    .filter((r) => r.status === 'anchored' && r.recovery.heldBy === 'custody')
    .map((r) => ({ label: r.label, origin: r.origin })),
  licences: p.licences
    .filter((l) => l.role === 'licensee' && l.status === 'active')
    .map((l) => ({ label: l.label, issuerRecord: l.role === 'licensee' ? l.issuerRecord : '' })),
});

/**
 * Leave, the partner sending the transactions: hand over everything and retire the
 * store. VeilCore's copies keep working on chain until the partner runs the procedure.
 */
export const exitSelf = async (
  ctx: Ctx,
  o: { readonly passphrase: string; readonly out: string; readonly sheet?: string; readonly contracts?: Contracts },
): Promise<{ readonly sha256: string }> => {
  await ctx.vault.assertActive();
  checkPassphrase(o.passphrase);
  const p = ctx.vault.read();
  const bundle: ExitBundle = {
    format: BUNDLE_FORMAT,
    kind: 'exit-self',
    madeAt: now(),
    partner: { id: p.partner.id, displayName: p.partner.displayName, network: p.partner.network },
    ...(o.contracts === undefined ? {} : { contracts: o.contracts }),
    vault: p,
    procedure: procedure(p, 'self'),
    audit: await auditOf(ctx),
  };
  const sha256 = await writeBundle(o.out, o.passphrase, bundle);
  if (o.sheet !== undefined)
    await writeSheet(
      o.sheet,
      custodySheet(p, { title: 'YOUR SECRETS (you are leaving VeilCore-run)', madeAt: bundle.madeAt }),
    );
  await ctx.vault.retire('self', sha256);
  await ctx.audit.write({ op: 'exit', ok: true, note: `self; bundle sha256 ${sha256}; store retired` });
  return { sha256 };
};

/**
 * Leave, VeilCore sending the transactions (see the top of this file). The bundle is
 * written, encrypted to the partner's passphrase, BEFORE any rotation is sent, because
 * it is the only place the new record secrets are kept. `previous`: a bundle from an
 * interrupted run of this command (same passphrase), whose finished hand-overs carry over.
 */
export const exitAssisted = async (
  ctx: Ctx,
  o: {
    readonly answer: ExitAnswer;
    readonly passphrase: string;
    readonly out: string;
    readonly sheet?: string;
    readonly previous?: string;
    readonly contracts?: Contracts;
  },
): Promise<{ readonly sha256: string; readonly handover: readonly RecordHandover[]; readonly complete: boolean }> => {
  await ctx.vault.assertActive();
  checkPassphrase(o.passphrase);
  if (ctx.vc === undefined) throw new Error('An assisted exit sends transactions: it needs the chain.');
  const vc = ctx.vc;
  const p = ctx.vault.read();
  const a = o.answer;
  if (a.partner !== p.partner.id || a.network !== p.partner.network)
    throw new Error(`That answer was made for ${a.partner} on ${a.network}. Refused.`);
  const request = exitRequest(p);
  for (const r of request.records)
    if (!a.records.some((x) => x.label === r.label))
      throw new Error(`The answer has no new recovery commitment for record "${r.label}". Nothing was sent.`);
  const seen = new Set<string>();
  for (const x of a.records) {
    if (seen.has(x.recoveryCommitment)) throw new Error('The answer repeats a recovery commitment. Refused.');
    seen.add(x.recoveryCommitment);
  }

  const carried = new Map<string, RecordHandover>();
  if (o.previous !== undefined) {
    const prev = await readBundle(o.previous, o.passphrase);
    if (prev.partner.id !== p.partner.id) throw new Error('That earlier bundle is another partner’s. Refused.');
    for (const h of prev.handover ?? []) if (h.status !== 'failed') carried.set(h.label, h);
  }
  const handover: RecordHandover[] = p.records
    .filter((r) => r.status === 'anchored' || carried.has(r.label))
    .map((r) => {
      const before = carried.get(r.label);
      if (before !== undefined) return { ...before, txIds: [...before.txIds] };
      const s = newSecret();
      const ans = a.records.find((x) => x.label === r.label);
      return {
        label: r.label,
        origin: r.origin,
        newSecret: toHex(s),
        newRecord: toHex(commit.record(s)),
        ...(r.recovery.heldBy === 'custody' && ans !== undefined
          ? { newRecoveryCommitment: ans.recoveryCommitment }
          : {}),
        status: 'pending' as const,
        txIds: [],
      };
    });
  const contracts = o.contracts ?? {
    veilcore: vc.address,
    ...(ctx.claims === undefined ? {} : { claims: ctx.claims.address }),
  };
  const build = async (): Promise<ExitBundle> => {
    const now_ = ctx.vault.read();
    return {
      format: BUNDLE_FORMAT,
      kind: 'exit-assisted',
      madeAt: now(),
      partner: { id: p.partner.id, displayName: p.partner.displayName, network: p.partner.network },
      contracts,
      vault: partnerView(now_, handover, a),
      handover,
      procedure: procedure(partnerView(now_, handover, a), 'assisted', handover),
      audit: await auditOf(ctx),
    };
  };
  // The new secrets exist nowhere else yet: the bundle is written before anything is sent.
  await writeBundle(o.out, o.passphrase, await build());

  let complete = true;
  for (const h of handover) {
    if (h.status === 'done') continue;
    const r = ctx.vault.read().records.find((x) => x.label === h.label);
    if (r === undefined || r.secret === undefined) {
      h.status = 'failed';
      h.note = 'no record secret in custody';
      complete = false;
      continue;
    }
    const markDone = async (txId?: string): Promise<void> => {
      h.status = 'done';
      await ctx.vault.update((v) => {
        const x = v.records.find((y) => y.label === h.label);
        if (x === undefined) return;
        delete x.secret; // controls nothing now
        delete x.pendingSecret;
        x.current = h.newRecord; // public; the secret behind it is NOT stored here
        x.status = 'handed-over';
        if (h.newRecoveryCommitment !== undefined) {
          const ans = a.records.find((y) => y.label === h.label);
          x.recovery = {
            heldBy: 'partner',
            commitment: h.newRecoveryCommitment,
            ...(ans === undefined ? {} : { pool: { id: a.poolId, index: ans.index } }),
          };
        }
      });
      await ctx.audit.write({
        op: 'exit-rotate',
        ok: true,
        label: h.label,
        record: h.newRecord,
        ...(txId === undefined ? { note: 'landed; confirming it failed (or an earlier run sent it)' } : { txId }),
      });
    };
    try {
      // An earlier, interrupted run may already have rotated it: the hand-over secret is
      // then anchored (its identity's head); unused, it is fresh and not anchored.
      if ((await vc.useRecordSecret(fromHex(h.newSecret)).catch(() => ({ anchored: false }))).anchored) {
        await markDone();
        continue;
      }
      // 1. The partner's recovery commitment replaces the recovery secret VeilCore holds
      //    (unless an earlier run already did: then VeilCore's is no longer current).
      if (
        h.newRecoveryCommitment !== undefined &&
        r.recovery.secret !== undefined &&
        (await vc.recoverySecretIsCurrent(fromHex(r.origin), fromHex(r.recovery.secret)))
      ) {
        const rs = r.recovery.secret;
        const newRc = h.newRecoveryCommitment;
        let txId: string | undefined;
        try {
          const tx = await vc.replaceRecoveryCommitment({
            originalRecord: fromHex(r.origin),
            recoverySecret: fromHex(rs),
            newRecoveryCommitment: fromHex(newRc),
          });
          txId = tx.txId;
        } catch (e) {
          if (!(e instanceof RecoveryReplacedButUnconfirmedError)) throw e;
        }
        if (txId !== undefined) h.txIds.push(txId);
        const ans = a.records.find((x) => x.label === h.label);
        await ctx.vault.update((v) => {
          const x = v.records.find((y) => y.label === h.label);
          if (x === undefined) return;
          x.recovery = {
            heldBy: 'partner',
            commitment: newRc,
            ...(ans === undefined ? {} : { pool: { id: a.poolId, index: ans.index } }),
          };
        });
        await ctx.audit.write({
          op: 'exit-replace-recovery',
          ok: true,
          label: h.label,
          record: r.current,
          ...(txId === undefined ? { note: 'landed; confirming it failed' } : { txId }),
        });
      }
      // 2. Rotate to the hand-over secret: VeilCore's copy stops working.
      await vc.useRecordSecret(fromHex(r.secret));
      let txId: string | undefined;
      try {
        txId = (await vc.rotateRecordSecret(fromHex(h.newSecret))).txId;
      } catch (e) {
        if (!(e instanceof LandedButUnconfirmedError)) throw e;
      }
      if (txId !== undefined) h.txIds.push(txId);
      await markDone(txId);
    } catch (e) {
      h.status = 'failed';
      h.note = e instanceof Error ? e.name : 'Error';
      complete = false;
      await ctx.audit.write({ op: 'exit-rotate', ok: false, label: h.label, note: h.note }).catch(() => undefined);
      break; // stop here: re-run with --previous once the cause is fixed
    }
  }

  // 3. Licences the partner holds: propose moving each to the commitment they made.
  if (complete)
    for (const l of a.licences) {
      const entry = ctx.vault.read().licences.find((x) => x.label === l.label);
      if (entry === undefined || entry.role !== 'licensee' || entry.status !== 'active') continue;
      try {
        await proposeTransferForExit(ctx, { label: l.label, newCommitment: l.licenceCommitment });
      } catch {
        complete = false; // audited by proposeTransfer; the procedure says what is left
      }
    }

  const final = await build();
  const sha256 = await writeBundle(o.out, o.passphrase, final, { replace: true });
  if (o.sheet !== undefined)
    await writeSheet(
      o.sheet,
      custodySheet(final.vault, {
        title: 'YOUR SECRETS (VeilCore has handed your records over)',
        madeAt: final.madeAt,
      }),
    );
  if (complete) {
    await ctx.vault.retire('assisted', sha256);
    await ctx.audit.write({ op: 'exit', ok: true, note: `assisted; bundle sha256 ${sha256}; store retired` });
  } else {
    await ctx.audit.write({
      op: 'exit',
      ok: false,
      note: `assisted, not finished; bundle sha256 ${sha256}; store NOT retired`,
    });
  }
  return { sha256, handover, complete };
};

/** The partner's view after an assisted hand-over: their new secrets in, VeilCore's dead ones out. */
const partnerView = (p: VaultPayload, handover: readonly RecordHandover[], a: ExitAnswer): VaultPayload => {
  const v = structuredClone(p);
  for (const r of v.records) {
    const h = handover.find((x) => x.label === r.label);
    if (h === undefined) continue;
    if (h.status === 'done') {
      r.secret = h.newSecret;
      r.current = h.newRecord;
      delete r.pendingSecret;
    } else {
      // Not yet rotated: VeilCore's secret is still the live one, and the new one is pending.
      r.pendingSecret = h.newSecret;
    }
    if (h.newRecoveryCommitment !== undefined && h.status === 'done') {
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

/** Plain-English steps for the partner, with the kit calls for their developer. */
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
      'This is a COPY of what VeilCore holds for you. You are still in VeilCore-run, and VeilCore still acts',
      'for you with these same secrets. Keep this file and its passphrase apart. To leave, ask VeilCore for',
      'an exit; see docs/MANAGED.md, "How to leave".',
    );
    return L.join('\n');
  }
  say('WHAT YOU HAVE', '');
  say(
    '- This bundle: every secret below, encrypted to the passphrase you chose. VeilCore cannot open it.',
    '- Your audit log: everything VeilCore did for you, with transaction ids you can look up yourself.',
    '',
  );
  if (mode === 'self') {
    say(
      'WHAT YOU STILL NEED TO DO (VeilCore has stopped acting for you, but its copies of your secrets',
      'still work on chain until you do this)',
      '',
      'You, or a developer you choose, need a computer with Node 24, Docker and a Midnight wallet holding',
      'DUST (docs/PARTNERS.md, "What you need" and "Fees"). Then, for each record, ONE transaction:',
      '',
    );
    for (const r of p.records.filter((x) => x.status === 'anchored')) {
      if (r.recovery.secret !== undefined)
        say(
          `- ${r.label}: VeilCore held its recovery secret. Take it back with a RECOVERY, which stops VeilCore's`,
          '  record secret AND its recovery secret at once. Make a new record secret and a new recovery secret',
          '  first, store both (the recovery secret on paper), then:',
          `    await vc.recoverRecordSecret({ originalRecord: fromHex('${r.origin}'),`,
          '      recoverySecret: <"recovery secret" for this record, from the bundle>,',
          '      newRecordSecret: <your new record secret>, newRecoveryCommitment: commit.recovery(<your new recovery secret>) });',
          '',
        );
      else
        say(
          `- ${r.label}: you already hold its recovery secret. ROTATE it, which stops VeilCore's copy:`,
          '    await vc.useRecordSecret(<"record secret" for this record, from the bundle>);',
          '    await vc.rotateRecordSecret(<your new record secret, stored first>);',
          `  (or recover it with your own recovery secret${r.recovery.pool === undefined ? '' : `, number ${r.recovery.pool.index} from your master sheet`}: then the record secret in this bundle is never typed anywhere.)`,
          '',
        );
    }
  } else {
    say('WHAT VEILCORE HAS DONE', '');
    for (const h of handover)
      say(
        `- ${h.label}: ${h.status === 'done' ? 'handed over' : h.status === 'failed' ? 'NOT handed over (VeilCore will finish it)' : 'not yet handed over'}.` +
          (h.newRecoveryCommitment === undefined
            ? ''
            : ' The recovery commitment you made replaced the one VeilCore held.') +
          (h.status === 'done'
            ? " Rotated to the record secret in this bundle; VeilCore's old copy controls nothing."
            : '') +
          (h.txIds.length === 0 ? '' : ` Transactions: ${h.txIds.join(', ')}.`),
      );
    say(
      '',
      "The new record secrets in this bundle were made by VeilCore's software for the hand-over and written",
      'only into this bundle. They passed through that software once. Your recovery secrets, which VeilCore',
      'never saw, outrank them: for a record secret no VeilCore software has ever touched, recover each record',
      'once with your own recovery secret (docs/PARTNERS.md, recoverRecordSecret). Nothing else is needed.',
      '',
    );
  }
  say('WHAT IS LEFT', '');
  say(
    "- Check: the kit's whoAmI() shows your new record secret live. VeilCore's listing then shows",
    '  "veilcoreCanAct: false" for every record.',
  );
  const held = p.licences.filter(
    (l) => l.role === 'licensee' && (l.status === 'active' || l.status === 'transfer-proposed'),
  );
  if (held.length > 0)
    say(
      '- Licences you hold: whoever holds a licence secret can present the licence, and VeilCore had these.',
      '  Each one moves to a licence secret only you hold when its issuer approves the transfer' +
        (mode === 'assisted' ? ' VeilCore proposed' : '') +
        ':',
      ...held.map(
        (l) =>
          `    ${l.label}: issuer record ${l.role === 'licensee' ? l.issuerRecord : ''}${l.role === 'licensee' && l.transferTo !== undefined ? ` (proposed to ${l.transferTo})` : ''}`,
      ),
      '  Ask each issuer to approve. Until then, the old licence secret still works.',
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
    '- Then tell VeilCore you have opened this bundle. VeilCore purges every secret it still holds for you',
    '  and keeps only the audit log. Ask for the audit line that says so.',
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
