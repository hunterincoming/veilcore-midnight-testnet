// VeilCore-run: the operator's command line. `npm run managed -- <command> [options]`.
// SPDX-License-Identifier: Apache-2.0
//
// One command per run, one partner per command. The partner's vault is opened with that
// partner's password (asked, hidden), used for this command, and closed. Commands that
// send transactions also start VeilCore's operator wallet (which pays) and join the
// contracts with in-memory private state. Nothing secret is printed, except where a
// command exists to show one (a new partner password, once) and on a partner's own
// computer (partner-derive). docs/MANAGED.md is the procedure.

import { readFile, readdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { type FieldSetFile, type RangeDirection, passwordProblem, readLedger, toHex } from '@veilcore/contracts';
import { AuditLog, readAudit, AUDIT_FILE } from './audit.ts';
import { readBundle } from './bundle.ts';
import { sameText } from './box.ts';
import { type Chain, openChain, settingsFrom } from './chain.ts';
import { exitAssisted, exitRequest, exitSelf, exportBundle, readJson } from './exit.ts';
import { defaultRoot, partnerDir, writePrivate } from './files.ts';
import { type Io, describeError, scrub, terminalIo } from './io.ts';
import * as op from './operator.ts';
import {
  answerExit,
  licenceSecretAt,
  makePool,
  newMaster,
  parseAnswer,
  parsePool,
  parseRequest,
  recoverySecretAt,
} from './partner-keys.ts';
import { fromPaper, masterSheet } from './sheet.ts';
import { PartnerVault, type RecoveryHolder, readStatus } from './vault.ts';

const HELP = `VeilCore-run: VeilCore operates on chain for partners who have no developers.

  npm run managed -- <command> --partner <id> [options]      (network: --network or VEILCORE_NETWORK, default preprod)

Partners
  partners                                     list partners (no password)
  add-partner --name "<name>" [--recovery partner|custody]
  import-pool --file <recovery-pool.json>      recovery commitments the partner made (partner-keys)
  list [--chain]                               what VeilCore runs for them; --chain: live status (no wallet)
  audit                                        their audit log, and whether it is intact (no password)
  change-password
Records (send transactions)
  anchor --label <L> [--recovery partner|custody] [--recovery-commitment <hex>]
  date --root <hex> [--label <L>]              timestamp a batch root or a record's SDK commitment
  seal-fields --label <L> --file <field-set.json> [--date]
  pair-dna --record <L> --report <hex>
  prove-ownership --record <L> --challenge <hex>
  rotate --record <L>
Licences
  licence-issue --record <L> --commitment <hex> --label <X>
  licence-revoke --label <X>
  licence-request --label <X> --issuer <hex>   (no transaction: prints the commitment for the issuer)
  licence-countersign --label <X>
  licence-prove --label <X> --challenge <hex>
  licence-transfer --label <X> --to <hex>
  licence-approve --label <X> --to <hex> --new-label <Y>
Lineage and obligations
  lineage-propose --record <child L> --parent <L|hex>
  lineage-confirm --record <parent L> --child <L|hex>
  obligation-encumber --record <L> --terms "<terms>" --label <O>
  obligation-propose --record <L> --on <L|hex> --terms "<terms>" --label <O>
  obligation-accept --record <L> --commitment <hex> --beneficiary <L|hex>
  obligation-discharge --label <O>
Claims
  lab-key --label <K>                          a laboratory claims key, kept in custody
  claim --fields <L> --kind value|range|distinct|unchanged|attested
        [--slot N] [--direction at-least|at-most] [--bound N] [--other <L>] [--corrected <L>]
        [--may-change 1,4] [--lab-key <K>] [--publish-value]
Hand-over and leaving
  export --out <bundle> [--sheet <file>]       a copy for the partner; they stay in
  exit-request --out <file>                    public: what the partner prepares for an assisted exit
  exit --mode self|assisted --out <bundle> [--sheet <file>] [--answer <file>] [--previous <bundle>]
  purge                                        after exit, once the partner has opened their bundle
On the PARTNER's computer
  partner-keys --partner <id> --out-dir <dir> [--count N] [--start N] [--request <exit-request.json>]
  partner-derive --index N [--licence]
  open-bundle --file <bundle> [--out <file.json>]
`;

const CHAIN_COMMANDS = new Set([
  'anchor',
  'date',
  'pair-dna',
  'prove-ownership',
  'rotate',
  'licence-issue',
  'licence-revoke',
  'licence-countersign',
  'licence-prove',
  'licence-transfer',
  'licence-approve',
  'lineage-propose',
  'lineage-confirm',
  'obligation-encumber',
  'obligation-propose',
  'obligation-accept',
  'obligation-discharge',
  'claim',
]);

const OPTIONS = {
  network: { type: 'string' },
  partner: { type: 'string' },
  name: { type: 'string' },
  recovery: { type: 'string' },
  'recovery-commitment': { type: 'string' },
  file: { type: 'string' },
  label: { type: 'string' },
  root: { type: 'string' },
  date: { type: 'boolean' },
  record: { type: 'string' },
  report: { type: 'string' },
  challenge: { type: 'string' },
  commitment: { type: 'string' },
  issuer: { type: 'string' },
  to: { type: 'string' },
  'new-label': { type: 'string' },
  parent: { type: 'string' },
  child: { type: 'string' },
  on: { type: 'string' },
  terms: { type: 'string' },
  beneficiary: { type: 'string' },
  fields: { type: 'string' },
  kind: { type: 'string' },
  slot: { type: 'string' },
  direction: { type: 'string' },
  bound: { type: 'string' },
  other: { type: 'string' },
  corrected: { type: 'string' },
  'may-change': { type: 'string' },
  'lab-key': { type: 'string' },
  'publish-value': { type: 'boolean' },
  chain: { type: 'boolean' },
  out: { type: 'string' },
  'out-dir': { type: 'string' },
  sheet: { type: 'string' },
  mode: { type: 'string' },
  answer: { type: 'string' },
  previous: { type: 'string' },
  count: { type: 'string' },
  start: { type: 'string' },
  request: { type: 'string' },
  index: { type: 'string' },
  licence: { type: 'boolean' },
  help: { type: 'boolean' },
} as const;

type Opts = { [K in keyof typeof OPTIONS]?: (typeof OPTIONS)[K]['type'] extends 'boolean' ? boolean : string };

/** Hooks for tests: a chain to use instead of the operator's wallet and the network. */
export type MainDeps = {
  readonly env?: NodeJS.ProcessEnv;
  readonly chain?: (o: { readonly claims: boolean }) => Promise<Chain>;
};

/** Run one command. Returns the exit code. */
export const main = async (argv: readonly string[], io: Io = terminalIo, deps: MainDeps = {}): Promise<number> => {
  const env = deps.env ?? process.env;
  const known = new Set<string>(); // everything to keep out of what is printed
  const out = (s: string): void => io.print(scrub(s, known));
  const hidden = async (q: string): Promise<string> => {
    const v = await io.askHidden(q);
    known.add(v);
    return v;
  };
  let vault: PartnerVault | undefined;
  let chain: Chain | undefined;
  try {
    const { positionals, values } = parseArgs({
      args: [...argv],
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
    const o = values as Opts;
    const command = positionals[0];
    if (command === undefined || command === 'help' || o.help === true) {
      out(HELP);
      return 0;
    }
    const network = o.network ?? env.VEILCORE_NETWORK ?? 'preprod';
    const root = env.VEILCORE_RUN_DIR ?? defaultRoot(network);
    const need = (name: keyof Opts): string => {
      const v = o[name];
      if (typeof v !== 'string' || v.trim() === '') throw new Error(`${command} needs --${name}.`);
      return v;
    };
    const confirm = async (what: string, expected: string): Promise<void> => {
      const typed = await io.ask(`${what}\nType ${expected} to go ahead, or anything else to stop: `);
      if (typed.trim() !== expected) throw new Error('Stopped. Nothing was changed.');
    };

    // ── commands with no partner vault ─────────────────────────────────────────
    if (command === 'partners') {
      const dirs = await readdir(root).catch(() => [] as string[]);
      let n = 0;
      for (const d of dirs.sort()) {
        const st = await readStatus(path.join(root, d));
        if (st === null) continue;
        n++;
        out(
          `${st.id}  ${st.displayName}  since ${st.createdAt.slice(0, 10)}` +
            (st.retired === undefined ? '' : `  LEFT ${st.retired.at.slice(0, 10)} (${st.retired.mode})`) +
            (st.purgedAt === undefined ? '' : '  purged'),
        );
      }
      if (n === 0) out(`No partners on ${network} (${root}).`);
      return 0;
    }
    if (command === 'audit') {
      const id = need('partner');
      const r = await readAudit(path.join(partnerDir(root, id), AUDIT_FILE));
      for (const e of r.entries)
        out(
          `${e.seq}. ${e.at}  ${e.op}${e.ok ? '' : ' FAILED'}${e.label === undefined ? '' : `  ${e.label}`}` +
            `${e.txId === undefined ? '' : `  tx ${e.txId}`}${e.note === undefined ? '' : `  (${e.note})`}`,
        );
      out(r.intact ? `${r.entries.length} entries; the chain of hashes is intact.` : `WARNING: ${r.problem}.`);
      return r.intact ? 0 : 1;
    }
    if (command === 'partner-keys') return await partnerKeys(o, need, hidden, out, network);
    if (command === 'partner-derive') {
      const master = fromPaper(await hidden('Your master secret, as on your sheet, with its check (nothing shows): '));
      known.add(toHex(master));
      const i = Number(need('index'));
      const s = o.licence === true ? licenceSecretAt(master, i) : recoverySecretAt(master, i);
      // Shown on purpose: this runs on the partner's own computer, for the procedure.
      io.print(`${o.licence === true ? 'Licence' : 'Recovery'} secret ${i}: ${toHex(s)}`);
      io.print('Close this window when you have used it.');
      return 0;
    }
    if (command === 'open-bundle') {
      const passphrase = await hidden('Passphrase for this bundle (nothing shows): ');
      const b = await readBundle(need('file'), passphrase);
      out(
        `Bundle for ${b.partner.displayName} (${b.partner.id}) on ${b.partner.network}, ${b.kind}, made ${b.madeAt}.`,
      );
      out(
        `${b.vault.records.length} records, ${b.vault.licences.length} licences, ${b.vault.obligations.length} obligations, ` +
          `${b.vault.fieldSets.length} field sets, ${b.vault.labKeys.length} lab keys; ${b.audit.length} audit entries.`,
      );
      if (b.contracts !== undefined) out(`Contracts: ${JSON.stringify(b.contracts)}`);
      out('\n' + b.procedure);
      if (o.out !== undefined) {
        await writePrivate(o.out, JSON.stringify(b, null, 2) + '\n', { exclusive: true });
        out(
          `\nWrote everything, secrets included, in plain JSON to ${o.out} (readable by you only). Move it into your secret store, then delete it.`,
        );
      }
      return 0;
    }

    // ── commands on one partner ────────────────────────────────────────────────
    const id = need('partner');
    if (command === 'add-partner') {
      const recovery = (o.recovery ?? 'partner') as RecoveryHolder;
      if (recovery !== 'partner' && recovery !== 'custody') throw new Error('--recovery is partner or custody.');
      let password = await hidden(`New password for ${id}'s custody store (16+ characters), or Enter to make one: `);
      let generated = false;
      if (password === '') {
        do password = randomBytes(24).toString('base64url') + '-9aZ';
        while (passwordProblem(password) !== null);
        generated = true;
      } else {
        const problem = passwordProblem(password);
        if (problem !== null) throw new Error(`That password will not be accepted: ${problem}.`);
        if (!sameText(await io.askHidden('The same password again: '), password))
          throw new Error('The two passwords differ. Nothing was made.');
      }
      vault = await PartnerVault.create({
        root,
        id,
        displayName: need('name'),
        network,
        password,
        defaultRecovery: recovery,
      });
      const audit = new AuditLog(vault.dir, id, network, () => vault!.secrets());
      await audit.write({ op: 'add-partner', ok: true, note: `recovery secrets held by: ${recovery}` });
      if (generated) {
        // Shown once, on screen only (io.print, never through the scrubbed log path).
        io.print(
          `\n  Password for ${id}'s custody store (save it in the password manager NOW, one entry for this partner):`,
        );
        io.print(`  ${password}\n  (shown once; not written anywhere)\n`);
      }
      out(`Partner ${id} added: ${vault.dir}`);
      if (recovery === 'partner')
        out(
          'Next: the partner makes their master secret and recovery pool on THEIR computer (partner-keys); then import-pool.',
        );
      else
        out(
          'Recovery secrets will be held by VeilCore (custody). docs/MANAGED.md says what that means for the partner.',
        );
      return 0;
    }

    const password = await hidden(`Password for ${id}'s custody store (nothing shows): `);
    vault = await PartnerVault.open({ root, id, network, password });
    for (const s of vault.secrets()) known.add(s);
    const v = vault;
    const audit = new AuditLog(v.dir, id, network, () => {
      const s = v.secrets();
      for (const x of s) known.add(x);
      return s;
    });
    if (
      CHAIN_COMMANDS.has(command) ||
      (command === 'seal-fields' && o.date === true) ||
      (command === 'exit' && o.mode === 'assisted')
    ) {
      await v.assertActive(); // before starting a wallet for nothing
      chain = deps.chain
        ? await deps.chain({ claims: command === 'claim' })
        : await openChain(settingsFrom(env, network), { ...io, print: out }, env, { claims: command === 'claim' });
    }
    const ctx: op.Ctx = {
      vault: v,
      audit,
      ...(chain === undefined ? {} : { vc: chain.vc, ...(chain.claims === undefined ? {} : { claims: chain.claims }) }),
    };
    const tx = (r: { txId: string; blockHeight?: number }): string =>
      `transaction ${r.txId}${r.blockHeight === undefined ? '' : ` (block ${r.blockHeight})`}`;

    switch (command) {
      case 'list': {
        const ledger =
          o.chain === true
            ? await readLedger({
                network: network as never,
                ...(env.VEILCORE_ADDRESS ? { address: env.VEILCORE_ADDRESS } : {}),
                ...(env.VEILCORE_BLOCKFROST_PROJECT_ID
                  ? { blockfrostProjectId: env.VEILCORE_BLOCKFROST_PROJECT_ID }
                  : {}),
              })
            : undefined;
        out(JSON.stringify(op.listPartner(v.read(), ledger), null, 2));
        return 0;
      }
      case 'change-password': {
        const next = await hidden('New password (nothing shows): ');
        if (!sameText(await io.askHidden('The same again: '), next))
          throw new Error('The two passwords differ. Nothing was changed.');
        vault = await v.changePassword(next);
        await audit.write({ op: 'change-password', ok: true });
        out('Password changed. Update the password manager entry for this partner now.');
        return 0;
      }
      case 'import-pool': {
        const r = await op.importPool(ctx, parsePool(await readJson(need('file'))));
        out(`Imported ${r.added} recovery commitments; ${r.unused} unused in all.`);
        return 0;
      }
      case 'anchor': {
        const r = await op.anchorRecord(ctx, {
          label: need('label'),
          ...(o.recovery === undefined ? {} : { recovery: o.recovery as RecoveryHolder }),
          ...(o['recovery-commitment'] === undefined ? {} : { recoveryCommitment: o['recovery-commitment'] }),
        });
        out(
          `Record ${r.label}: ${r.record}. Recovery secret held by: ${r.recoveryHeldBy === 'partner' ? 'the partner' : 'VeilCore (custody)'}.`,
        );
        out('alreadyAnchored' in r ? 'It was already anchored (an earlier run landed).' : `Anchored: ${tx(r)}.`);
        const left = op.unusedPool(v.read());
        if (r.recoveryHeldBy === 'partner' && left < 10)
          out(`Only ${left} recovery commitments left: ask the partner for a new pool.`);
        return 0;
      }
      case 'date':
        out(
          `Timestamped: ${tx(await op.dateRoot(ctx, { root: need('root'), ...(o.label === undefined ? {} : { label: o.label }) }))}.`,
        );
        return 0;
      case 'seal-fields': {
        const file = JSON.parse(await readFile(need('file'), 'utf8')) as FieldSetFile;
        const r = await op.sealFieldSet(ctx, { label: need('label'), file, date: o.date === true });
        out(
          `Sealed into custody. Record commitment ${r.commitment}; schema ${r.schemaId}; field-set root ${r.setRoot}.`,
        );
        if (r.tx !== undefined) out(`Timestamped: ${tx(r.tx)}.`);
        out(`The file ${need('file')} holds the hidden values: delete it securely now that it is in custody.`);
        return 0;
      }
      case 'pair-dna':
        out(`Paired: ${tx(await op.pairDna(ctx, { record: need('record'), report: need('report') }))}.`);
        return 0;
      case 'prove-ownership':
        out(
          `Proved. Give the verifier ${tx(await op.proveOwnership(ctx, { record: need('record'), challenge: need('challenge') }))}.`,
        );
        return 0;
      case 'rotate': {
        const r = await op.rotateRecord(ctx, { record: need('record') });
        out(
          'alreadyRotated' in r
            ? 'An earlier rotation had landed; the vault now holds that secret.'
            : `Rotated: ${tx(r)}.`,
        );
        return 0;
      }
      case 'licence-issue':
        out(
          `Issued: ${tx(await op.licenceIssue(ctx, { record: need('record'), licenceCommitment: need('commitment'), label: need('label') }))}.`,
        );
        return 0;
      case 'licence-revoke': {
        const r = await op.licenceRevoke(ctx, { label: need('label') });
        out(
          `Revoked: ${tx(r)}. ${r.sealed ? 'Sealed now.' : r.sealableAt === undefined ? '' : `Earlier presentations stop verifying at the next seal (from ${new Date(r.sealableAt * 1000).toISOString()}).`}`,
        );
        return 0;
      }
      case 'licence-request': {
        const r = await op.licenceRequest(ctx, { label: need('label'), issuerRecord: need('issuer') });
        out(`Send the issuer this licence commitment (not secret): ${r.licenceCommitment}`);
        out('When they have issued it: licence-countersign.');
        return 0;
      }
      case 'licence-countersign':
        out(`Countersigned: ${tx(await op.licenceCountersign(ctx, { label: need('label') }))}.`);
        return 0;
      case 'licence-prove':
        out(
          `Presented. Give the verifier ${tx(await op.licenceProve(ctx, { label: need('label'), challenge: need('challenge') }))}.`,
        );
        return 0;
      case 'licence-transfer':
        out(
          `Transfer proposed: ${tx(await op.licenceTransferPropose(ctx, { label: need('label'), newCommitment: need('to') }))}. The issuer approves it.`,
        );
        return 0;
      case 'licence-approve':
        out(
          `Transfer approved: ${tx(await op.licenceTransferApprove(ctx, { label: need('label'), newCommitment: need('to'), newLabel: need('new-label') }))}.`,
        );
        return 0;
      case 'lineage-propose':
        out(
          `Parent proposed: ${tx(await op.lineagePropose(ctx, { record: need('record'), parent: need('parent') }))}. The parent's holder confirms it.`,
        );
        return 0;
      case 'lineage-confirm':
        out(`Child confirmed: ${tx(await op.lineageConfirm(ctx, { record: need('record'), child: need('child') }))}.`);
        return 0;
      case 'obligation-encumber':
        out(
          `Obligation placed: ${tx(await op.obligationEncumber(ctx, { record: need('record'), terms: need('terms'), label: need('label') }))}.`,
        );
        return 0;
      case 'obligation-propose':
        out(
          `Obligation proposed: ${tx(await op.obligationPropose(ctx, { record: need('record'), on: need('on'), terms: need('terms'), label: need('label') }))}.`,
        );
        return 0;
      case 'obligation-accept':
        out(
          `Obligation accepted: ${tx(await op.obligationAccept(ctx, { record: need('record'), commitment: need('commitment'), beneficiary: need('beneficiary') }))}.`,
        );
        return 0;
      case 'obligation-discharge':
        out(`Discharged: ${tx(await op.obligationDischarge(ctx, { label: need('label') }))}.`);
        return 0;
      case 'lab-key': {
        const k = await op.labKeyNew(ctx, { label: need('label') });
        out(
          `Lab claims key ${need('label')} made, in custody. Public key (publish it; verifiers trust it): x=${k.x} y=${k.y}`,
        );
        return 0;
      }
      case 'claim': {
        const kind = need('kind');
        const fields = need('fields');
        const slot = (): number => Number(need('slot'));
        const req: op.ClaimRequest =
          kind === 'value'
            ? { kind, fields, slot: slot(), publish: o['publish-value'] === true }
            : kind === 'range'
              ? {
                  kind,
                  fields,
                  slot: slot(),
                  direction: need('direction').replace('-', ' ') as RangeDirection,
                  bound: BigInt(need('bound')),
                }
              : kind === 'distinct'
                ? { kind, fields, other: need('other') }
                : kind === 'unchanged'
                  ? {
                      kind,
                      fields,
                      corrected: need('corrected'),
                      mayChange: (o['may-change'] ?? '')
                        .split(',')
                        .filter((x) => x !== '')
                        .map(Number),
                    }
                  : kind === 'attested'
                    ? { kind, fields, labKey: need('lab-key') }
                    : (() => {
                        throw new Error('--kind is value, range, distinct, unchanged or attested.');
                      })();
        const r = await op.makeClaim(ctx, req);
        out(`Claim made (${r.claim.kind}). Give the verifier ${tx(r)}.`);
        return 0;
      }
      case 'export': {
        const passphrase = await partnerPassphrase(io, hidden, password);
        const r = await exportBundle(ctx, {
          passphrase,
          out: need('out'),
          ...(o.sheet === undefined ? {} : { sheet: o.sheet }),
        });
        out(`Bundle written to ${need('out')} (sha256 ${r.sha256}). It opens with the partner's passphrase only.`);
        if (o.sheet !== undefined)
          out(`Printable sheet: ${o.sheet}. Print it for the partner, then delete the file securely.`);
        return 0;
      }
      case 'exit-request': {
        await v.assertActive();
        await writePrivate(need('out'), JSON.stringify(exitRequest(v.read()), null, 2) + '\n', { exclusive: true });
        out(
          `Wrote ${need('out')} (no secrets). The partner runs partner-keys --request with it on their computer and sends back the answer.`,
        );
        return 0;
      }
      case 'exit': {
        const mode = need('mode');
        if (mode !== 'self' && mode !== 'assisted') throw new Error('--mode is self or assisted.');
        await v.assertActive();
        await confirm(
          `Partner ${id} leaves VeilCore-run (${mode}). Afterwards every operation for them is refused.` +
            (mode === 'assisted' ? ' VeilCore will send one or two transactions per record now.' : ''),
          id,
        );
        const passphrase = await partnerPassphrase(io, hidden, password);
        const sheet = o.sheet === undefined ? {} : { sheet: o.sheet };
        if (mode === 'self') {
          const r = await exitSelf(ctx, { passphrase, out: need('out'), ...sheet });
          out(`Bundle written to ${need('out')} (sha256 ${r.sha256}). ${id}'s store is retired.`);
          out("VeilCore's copies still work on chain until the partner runs the procedure in the bundle. Then: purge.");
          return 0;
        }
        const answer = parseAnswer(await readJson(need('answer')));
        const r = await exitAssisted(ctx, {
          answer,
          passphrase,
          out: need('out'),
          ...sheet,
          ...(o.previous === undefined ? {} : { previous: o.previous }),
        });
        for (const h of r.handover)
          out(`  ${h.label}: ${h.status}${h.txIds.length === 0 ? '' : ` (${h.txIds.join(', ')})`}`);
        out(`Bundle written to ${need('out')} (sha256 ${r.sha256}).`);
        out(
          r.complete
            ? `Done: ${id}'s store is retired. When the partner confirms they opened the bundle: purge.`
            : `NOT finished; the store is not retired. Fix the cause, then run exit again with --previous ${need('out')} and a new --out.`,
        );
        return r.complete ? 0 : 1;
      }
      case 'purge': {
        await confirm(
          `Every secret VeilCore still holds for ${id} is deleted for good. The audit log stays.`,
          `PURGE ${id}`,
        );
        await v.purge();
        await audit.write({ op: 'purge', ok: true, note: 'every secret removed from the custody store' });
        out(
          `Purged. ${v.dir}/custody.vcbox now holds no secrets. Delete any backup copies of the old file too (docs/MANAGED.md).`,
        );
        return 0;
      }
      default:
        throw new Error(`Unknown command ${command}. npm run managed -- help`);
    }
  } catch (e) {
    for (const s of vault?.secrets() ?? []) known.add(s);
    io.print(`\nSTOPPED: ${describeError(e, known)}`);
    return 1;
  } finally {
    await chain?.stop().catch(() => undefined);
    await vault?.close().catch(() => undefined);
  }
};

/** The partner chooses the passphrase for their bundle, and types it twice. */
const partnerPassphrase = async (
  io: Io,
  hidden: (q: string) => Promise<string>,
  vaultPassword: string,
): Promise<string> => {
  io.print(
    'The PARTNER now types a passphrase of their own for their bundle (16+ characters). VeilCore must not see it.',
  );
  const p = await hidden('Partner passphrase (nothing shows): ');
  const problem = passwordProblem(p);
  if (problem !== null) throw new Error(`That passphrase will not be accepted: ${problem}. Nothing was written.`);
  if (sameText(p, vaultPassword))
    throw new Error("That is VeilCore's password for this partner's store. Choose another. Nothing was written.");
  if (!sameText(await io.askHidden('The same passphrase again: '), p))
    throw new Error('The two passphrases differ. Nothing was written.');
  return p;
};

/** partner-keys: on the partner's own computer. Makes (or reuses) the master; writes the sheet and the public files. */
const partnerKeys = async (
  o: Opts,
  need: (n: keyof Opts) => string,
  hidden: (q: string) => Promise<string>,
  out: (s: string) => void,
  network: string,
): Promise<number> => {
  const partner = need('partner');
  const dir = need('out-dir');
  const typed = await hidden(
    'Your existing master secret from your sheet, or Enter to make a new one (nothing shows): ',
  );
  const master = typed === '' ? newMaster() : fromPaper(typed);
  const madeNew = typed === '';
  const start = Number(o.start ?? (madeNew ? '0' : 'NaN'));
  if (!Number.isInteger(start) || start < 0)
    throw new Error('With an existing master, give --start: the first index no earlier pool or answer used.');
  const count = Number(o.count ?? '100');
  if (madeNew) {
    const sheetFile = path.join(dir, 'master-sheet.txt');
    await writePrivate(sheetFile, masterSheet({ partner, network, master, madeAt: new Date().toISOString() }), {
      exclusive: true,
    });
    out(`Your master sheet: ${sheetFile}. Print two copies, store them apart, then delete the file.`);
  }
  if (o.request !== undefined) {
    const request = parseRequest(await readJson(o.request));
    if (request.partner !== partner || request.network !== network)
      throw new Error(`That request is for ${request.partner} on ${request.network}.`);
    const answer = answerExit(request, master, start);
    const file = path.join(dir, 'exit-answer.json');
    await writePrivate(file, JSON.stringify(answer, null, 2) + '\n', { exclusive: true });
    out(`Exit answer (no secrets; send it to VeilCore): ${file}`);
    out(
      `It used indexes ${start} to ${start + Math.max(answer.records.length, answer.licences.length) - 1}. Next --start: ${start + Math.max(answer.records.length, answer.licences.length)}.`,
    );
    return 0;
  }
  const pool = makePool({ partner, network, master, count, start });
  const file = path.join(dir, `recovery-pool-${pool.poolId}-${start}.json`);
  await writePrivate(file, JSON.stringify(pool, null, 2) + '\n', { exclusive: true });
  out(
    `Recovery pool (no secrets; send it to VeilCore): ${file}. ${count} commitments, indexes ${start} to ${start + count - 1}. Next --start: ${start + count}.`,
  );
  return 0;
};

const isMain = (): boolean => {
  try {
    return (
      process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
};

if (isMain()) {
  process.umask(0o077);
  process.exitCode = await main(process.argv.slice(2));
  setTimeout(() => process.exit(), 3_000).unref();
}
