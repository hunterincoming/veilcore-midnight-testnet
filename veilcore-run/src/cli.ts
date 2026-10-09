// VeilCore-run: the operator's command line. `npm run managed -- <command> [options]`.
// SPDX-License-Identifier: Apache-2.0
//
// One command per run, one partner per command. The partner's vault is opened with that
// partner's password (asked, hidden), used for this command, and closed. Commands that
// send transactions also start VeilCore's operator wallet (which pays) and join the
// contracts with in-memory private state. Nothing secret is printed, except where a
// command exists to show one (a new partner password, once) and on a partner's own
// computer (partner-derive). Nothing secret is ever taken from the command line.
// docs/MANAGED.md is the procedure.

import { readFile, readdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import {
  type FieldSetFile,
  type RangeDirection,
  checkBatchAnchor,
  fromHex,
  passwordProblem,
  readLedger,
  toHex,
} from '@veilcore/contracts';
import { AuditLog, readAudit, AUDIT_FILE, auditLines, receiptHolds, verifyAnchors } from './audit.ts';
import { type ExitBundle, readBundle, bundleRecipient } from './bundle.ts';
import { sameText } from './box.ts';
import { type Chain, openChain, settingsFrom } from './chain.ts';
import { cancelExit, exitAssisted, exitRequest, exitSelf, exportBundle, readJson } from './exit.ts';
import { defaultRoot, exists, partnerDir, writePrivate } from './files.ts';
import { type Io, describeError, scrub, terminalIo } from './io.ts';
import * as op from './operator.ts';
import {
  answerExit,
  bundleKeyOf,
  fingerprintOf,
  licenceSecretAt,
  makePool,
  newMaster,
  parseAnswer,
  parsePool,
  parseRequest,
  poolIdOf,
  recoverySecretAt,
} from './partner-keys.ts';
import { checkRecords, recordsIn, recoverRecords } from './partner-side.ts';
import { custodySheet, fromPaper, masterSheet } from './sheet.ts';
import { PartnerVault, type RecoveryHolder, readStatus } from './vault.ts';

const HELP = `VeilCore-run: VeilCore operates on chain for partners who have no developers.

  npm run managed -- <command> --partner <id> [options]      (network: --network or VEILCORE_NETWORK, default preprod)

Partners
  partners                                     list partners (no password)
  add-partner --name "<name>" [--recovery partner|custody]
  import-pool --file <recovery-pool.json>      the partner's bundle key and recovery commitments (partner-keys);
                                               the partner reads its fingerprint out to you
  list [--chain]                               what VeilCore runs for them; --chain: what VeilCore can still do (no wallet)
  audit [--verify]                             their audit log; --verify checks its anchors on chain (no wallet)
  audit-anchor                                 timestamp the log's head on chain; give the partner the receipt
  change-password
Records (send transactions)
  anchor --label <L> [--recovery partner|custody] [--recovery-commitment <hex>]
  abandon --record <L> | --licence <X>         drop a record never anchored / a licence never countersigned
  date --root <hex> [--label <L>]              timestamp a batch root or a record's SDK commitment
  seal-fields --label <L> --file <field-set.json> [--date]
  pair-dna --record <L> (--report-file <file> | --report <sha256 hex>) --evidence <out.json> [--again]
                                               a bound pairing: the report's hash never goes on chain;
                                               give the partner the evidence file with the report
  pair-evidence (--record <L> | --binding <hex>) --evidence <out.json>   that file again (no transaction)
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
Lineage and obligations (terms are typed at a prompt, or read from --terms-file; never on the command line)
  lineage-propose --record <child L> --parent <L|hex>
  lineage-confirm --record <parent L> --child <L|hex>
  obligation-encumber --record <L> --label <O> [--terms-file <file>]
  obligation-propose --record <L> --on <L|hex> --label <O> [--terms-file <file>]
  obligation-accept --record <L> --commitment <hex> --beneficiary <L|hex>
  obligation-discharge --label <O>
Claims
  lab-key --label <K>                          a laboratory claims key, kept in custody
  claim --fields <L> --kind value|range|distinct|unchanged|attested
        [--slot N] [--direction at-least|at-most] [--bound N] [--other <L>] [--corrected <L>]
        [--may-change 1,4] [--lab-key <K>] [--publish-value]
Hand-over and leaving (every bundle is sealed to the partner's own key; nothing typed on this computer opens it)
  export --out <bundle>                        a copy for the partner; they stay in
  exit-request --out <file>                    public: what the partner prepares for an assisted exit
  exit --mode self --out <bundle>
  exit --mode assisted --answer <file> --out <bundle>    (the partner reads the answer's fingerprint out to you;
                                               run it again to resume an exit that stopped)
  exit-cancel                                  cancel an assisted exit that has sent nothing (checked on chain)
  exit-check                                   whether the partner has taken every record back (no wallet)
  purge                                        after exit, once the partner has opened their bundle; then anchors the log
On the PARTNER's computer
  partner-keys --partner <id> --out-dir <dir> [--count N] [--start N] [--request <exit-request.json>]
  open-bundle --file <bundle> [--sheet <file>] [--out <file.json>]
  partner-recover --partner <id> --bundle <bundle> [--bundle ...]     REQUIRED to finish leaving (wallet with DUST)
  partner-check --partner <id> --bundle <bundle> [--bundle ...]       confirms every record is yours (no wallet)
  partner-check-receipt --partner <id> (--bundle <bundle> | --log <audit.jsonl>) --line N --head <hex> --tx <id>
                                               checks a receipt VeilCore gave you against the log (no wallet)
  partner-derive --index N [--kind licence]
`;

const CHAIN_COMMANDS = new Set([
  'anchor',
  'abandon',
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
  'audit-anchor',
  'purge',
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
  'report-file': { type: 'string' },
  evidence: { type: 'string' },
  binding: { type: 'string' },
  again: { type: 'boolean' },
  challenge: { type: 'string' },
  commitment: { type: 'string' },
  issuer: { type: 'string' },
  to: { type: 'string' },
  'new-label': { type: 'string' },
  parent: { type: 'string' },
  child: { type: 'string' },
  on: { type: 'string' },
  'terms-file': { type: 'string' },
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
  verify: { type: 'boolean' },
  out: { type: 'string' },
  'out-dir': { type: 'string' },
  sheet: { type: 'string' },
  mode: { type: 'string' },
  answer: { type: 'string' },
  bundle: { type: 'string', multiple: true },
  count: { type: 'string' },
  start: { type: 'string' },
  request: { type: 'string' },
  index: { type: 'string' },
  line: { type: 'string' },
  head: { type: 'string' },
  tx: { type: 'string' },
  log: { type: 'string' },
  licence: { type: 'string' },
  help: { type: 'boolean' },
} as const;

type Opts = {
  [K in keyof typeof OPTIONS]?: (typeof OPTIONS)[K] extends { multiple: true }
    ? string[]
    : (typeof OPTIONS)[K]['type'] extends 'boolean'
      ? boolean
      : string;
};

/** Hooks for tests: a chain to use instead of a wallet and the network. */
export type MainDeps = {
  readonly env?: NodeJS.ProcessEnv;
  readonly chain?: (o: { readonly claims: boolean; readonly who?: 'operator' | 'partner' }) => Promise<Chain>;
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
    const need = (name: Exclude<keyof Opts, 'bundle'>): string => {
      const v = o[name];
      if (typeof v !== 'string' || v.trim() === '') throw new Error(`${command} needs --${name}.`);
      return v;
    };
    const confirm = async (what: string, expected: string): Promise<void> => {
      const typed = await io.ask(`${what}\nType ${expected} to go ahead, or anything else to stop: `);
      if (typed.trim() !== expected) throw new Error('Stopped. Nothing was changed.');
    };
    const openChainFor = async (claims: boolean, who: 'operator' | 'partner' = 'operator'): Promise<Chain> =>
      deps.chain
        ? deps.chain({ claims, who })
        : // Typed secrets (seed, password, Blockfrost id) go through `hidden`, so every
          // line printed afterwards has them redacted too.
          openChain(settingsFrom(env, network), { ...io, print: out, askHidden: hidden }, env, { claims, who });
    const chainCheck =
      (address?: string) =>
      async (txId: string, head: string): Promise<boolean> =>
        (
          await checkBatchAnchor({
            network: network as never,
            txId,
            root: fromHex(head),
            ...(address === undefined ? {} : { address }),
            ...(env.VEILCORE_BLOCKFROST_PROJECT_ID ? { blockfrostProjectId: env.VEILCORE_BLOCKFROST_PROJECT_ID } : {}),
          })
        ).accepted;
    const ledgerNow = () =>
      readLedger({
        network: network as never,
        ...(env.VEILCORE_ADDRESS ? { address: env.VEILCORE_ADDRESS } : {}),
        ...(env.VEILCORE_BLOCKFROST_PROJECT_ID ? { blockfrostProjectId: env.VEILCORE_BLOCKFROST_PROJECT_ID } : {}),
      });

    // ── commands with no partner vault ─────────────────────────────────────────
    if (command === 'partners') {
      const dirs = await readdir(root).catch(() => [] as string[]);
      let n = 0;
      for (const d of dirs.sort()) {
        const st = await readStatus(path.join(root, d)).catch(() => null);
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
      const file = path.join(partnerDir(root, id), AUDIT_FILE);
      const r = await readAudit(file);
      for (const e of r.entries)
        out(
          `${e.seq}. ${e.at}  ${e.op}${e.phase === 'sending' ? ' (sending)' : e.ok ? '' : ' FAILED'}` +
            `${e.label === undefined ? '' : `  ${e.label}`}${e.txId === undefined ? '' : `  tx ${e.txId}`}` +
            `${e.anchoredHead === undefined ? '' : `  head of line ${e.anchoredSeq}: ${e.anchoredHead}`}` +
            `${e.note === undefined ? '' : `  (${e.note})`}`,
        );
      out(
        r.intact
          ? `${r.entries.length} entries; each line follows the one before. (That alone does not show a rewrite of the whole log after a line: the anchors do.)`
          : `WARNING: ${r.problem}.`,
      );
      if (o.verify !== true) return r.intact ? 0 : 1;
      const v = await verifyAnchors(file, chainCheck(env.VEILCORE_ADDRESS));
      for (const p of v.problems) out(`WARNING: ${p}.`);
      out(
        v.anchors === 0
          ? 'No anchors yet (audit-anchor): nothing shows a rewrite of the log.'
          : `${v.anchors} anchors checked on chain; ${v.problems.length === 0 ? 'every one matches' : `${v.problems.length} do not`}. Compare the receipts the partner was given with these.`,
      );
      return r.intact && v.problems.length === 0 ? 0 : 1;
    }
    if (command === 'partner-keys') return await partnerKeys(o, need, hidden, out, network);
    if (command === 'partner-derive') {
      const master = fromPaper(await hidden('Your master secret, as on your sheet, with its check (nothing shows): '));
      known.add(toHex(master));
      const i = Number(need('index'));
      const lic = o.kind === 'licence';
      const s = lic ? licenceSecretAt(master, i) : recoverySecretAt(master, i);
      // Shown on purpose: this runs on the partner's own computer.
      io.print(`${lic ? 'Licence' : 'Recovery'} secret ${i}: ${toHex(s)}`);
      io.print('Close this window when you have used it.');
      return 0;
    }
    if (command === 'open-bundle') {
      const [b] = await openBundles([need('file')], hidden, known);
      out(
        `Bundle for ${b.partner.displayName} (${b.partner.id}) on ${b.partner.network}, ${b.kind}, made ${b.madeAt}.`,
      );
      out(
        `${b.vault.records.length} records, ${b.vault.licences.length} licences, ${b.vault.obligations.length} obligations, ` +
          `${b.vault.fieldSets.length} field sets, ${b.vault.labKeys.length} lab keys; ${b.audit.length} audit entries.`,
      );
      if (b.contracts !== undefined) out(`Contracts: ${JSON.stringify(b.contracts)}`);
      for (const e of b.earlierBundles ?? [])
        out(`Earlier bundle ${e.sha256.slice(0, 16)}… holds the hand-over secrets of: ${e.labels.join(', ')}`);
      out('\n' + b.procedure);
      if (o.sheet !== undefined) {
        await writePrivate(
          o.sheet,
          custodySheet(b.vault, { title: 'YOUR SECRETS', madeAt: new Date().toISOString() }),
          { exclusive: true },
        );
        out(`\nPrintable sheet (secrets in plain text, on THIS computer): ${o.sheet}. Print it, then delete the file.`);
      }
      if (o.out !== undefined) {
        await writePrivate(o.out, JSON.stringify(b, null, 2) + '\n', { exclusive: true });
        out(
          `\nWrote everything, secrets included, in plain JSON to ${o.out} (readable by you only). Move it into your secret store, then delete it.`,
        );
      }
      return 0;
    }
    if (command === 'partner-check-receipt') {
      // On the partner's computer (or anyone's): does a receipt VeilCore gave still hold for the log?
      let lines: string[];
      if (o.log !== undefined) lines = await auditLines(o.log);
      else {
        const file = o.bundle?.[0];
        if (file === undefined) throw new Error('partner-check-receipt needs --bundle or --log.');
        const [b] = await openBundles([file], hidden, known);
        if (b.auditLines === undefined)
          throw new Error('That bundle carries no raw audit log; use --log with the log file.');
        lines = [...b.auditLines];
      }
      const receipt = { seq: Number(need('line')), head: need('head').trim().toLowerCase(), txId: need('tx').trim() };
      const ok = await receiptHolds(lines, receipt, chainCheck(env.VEILCORE_ADDRESS));
      out(
        ok
          ? `The receipt holds: line ${receipt.seq} of this log is the one timestamped on chain in transaction ${receipt.txId}. Nothing up to it was changed.`
          : `The receipt does NOT hold: line ${receipt.seq} of this log is not what was timestamped (or the transaction is not that timestamp). The log was changed or cut before that line.`,
      );
      return ok ? 0 : 1;
    }
    if (command === 'partner-check' || command === 'partner-recover') {
      const id = need('partner');
      const files = o.bundle ?? [];
      if (files.length === 0) throw new Error(`${command} needs --bundle (each bundle VeilCore gave you).`);
      const masters: Uint8Array[] = [];
      const bundles = await openBundles(files, hidden, known, masters);
      if (bundles.some((b) => b.partner.id !== id)) throw new Error(`Those bundles are not all for ${id}.`);
      const latest = [...bundles].sort((a, b) => (a.madeAt < b.madeAt ? 1 : -1))[0];
      const own = masters.find((m) => bundleKeyOf(m).publicHex === latest.ownKey)!;
      const records = recordsIn(bundles.map((b) => b.bundle));
      // Recovery secrets may come from another master (an earlier pool): ask for any missing.
      for (const r of records) {
        const pool = r.recovery.pool;
        if (r.recovery.secret === undefined && pool !== undefined && !masters.some((m) => poolIdOf(m) === pool.id)) {
          const m = fromPaper(
            await hidden(`The master secret for pool ${pool.id} (record ${r.label}; nothing shows): `),
          );
          known.add(toHex(m));
          if (poolIdOf(m) !== pool.id) throw new Error(`That master is pool ${poolIdOf(m)}, not ${pool.id}.`);
          masters.push(m);
        }
      }
      if (command === 'partner-recover') {
        chain = await openChainFor(false, 'partner');
        for (const r of await recoverRecords(chain.vc, records, own, masters))
          out(`  ${r.label}: ${r.outcome}${r.txId === undefined ? '' : ` (transaction ${r.txId})`}`);
      }
      const checks = checkRecords(chain === undefined ? await ledgerNow() : await chain.vc.ledger(), records, own);
      for (const c of checks)
        out(
          `  ${c.label}: ${c.yours ? 'yours: record secret and recovery secret both from your master' : 'NOT yet yours'}`,
        );
      const all = checks.every((c) => c.yours);
      out(
        all
          ? 'Every record is yours. Tell VeilCore; its exit-check will show the same.'
          : 'Not finished: run partner-recover.',
      );
      return all ? 0 : 1;
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
      const made = vault;
      const audit = new AuditLog(made.dir, id, network, () => made.secrets());
      await audit.write({ op: 'add-partner', ok: true, note: `recovery secrets held by: ${recovery}` });
      if (generated) {
        // Shown once, on screen only (io.print, never through the scrubbed log path).
        io.print(
          `\n  Password for ${id}'s custody store (save it in the password manager NOW, one entry for this partner):`,
        );
        io.print(`  ${password}\n  (shown once; not written anywhere)\n`);
      }
      out(`Partner ${id} added: ${made.dir}`);
      out(
        recovery === 'partner'
          ? 'Next: the partner runs partner-keys on THEIR computer (master sheet, bundle key, recovery pool); then import-pool.'
          : 'Recovery secrets will be held by VeilCore (custody). The partner still runs partner-keys (--count 0) for a bundle key; then import-pool.',
      );
      return 0;
    }

    const password = await hidden(`Password for ${id}'s custody store (nothing shows): `);
    vault = await PartnerVault.open({ root, id, network, password });
    for (const s of vault.secrets()) known.add(s);
    // The audit log always asks the vault in use NOW (change-password replaces it).
    const audit = new AuditLog(vault.dir, id, network, () => {
      const s = vault!.secrets();
      for (const x of s) known.add(x);
      return s;
    });
    const v = vault;
    if (
      CHAIN_COMMANDS.has(command) ||
      (command === 'seal-fields' && o.date === true) ||
      (command === 'exit' && o.mode === 'assisted')
    ) {
      if (command !== 'audit-anchor' && command !== 'purge') await v.assertActive(); // before starting a wallet for nothing
      if (command === 'purge' && v.retired === undefined)
        throw new Error(`Partner ${id} has not left (exit) yet. Refused: purge only follows an exit.`);
      chain = await openChainFor(command === 'claim');
    }
    const ctx: op.Ctx = {
      vault: v,
      audit,
      ...(chain === undefined ? {} : { vc: chain.vc, ...(chain.claims === undefined ? {} : { claims: chain.claims }) }),
    };
    const tx = (r: { txId: string; blockHeight?: number }): string =>
      `transaction ${r.txId}${r.blockHeight === undefined ? '' : ` (block ${r.blockHeight})`}`;
    /** Obligation terms: private, so never from the command line. */
    const terms = async (): Promise<string> =>
      o['terms-file'] !== undefined
        ? (await readFile(o['terms-file'], 'utf8')).trim()
        : (await io.ask('The obligation terms, exactly as agreed (one line): ')).trim();
    const fingerprint = async (what: string, value: unknown): Promise<string> => {
      void value; // checked against what is typed; never shown here, so it cannot be copied instead of heard
      out(`${what} decides who controls the partner's records. The partner reads ITS FINGERPRINT out to you, from`);
      out('their own screen (partner-keys printed it), in person or by phone: not by email or chat.');
      return io.ask('Type the fingerprint the partner reads out: ');
    };

    switch (command) {
      case 'list': {
        out(JSON.stringify(op.listPartner(v.read(), o.chain === true ? await ledgerNow() : undefined), null, 2));
        return 0;
      }
      case 'exit-check': {
        const listing = op.listPartner(v.read(), await ledgerNow());
        for (const r of listing.records)
          out(
            `  ${r.label}: ${
              r.chain?.exitComplete
                ? 'taken back: nothing VeilCore made or held controls it'
                : r.chain?.veilcoreCanAct
                  ? 'VeilCore CAN still act as it' +
                    (r.chain.veilcoreHoldsCurrentRecovery ? ' (it holds the current recovery secret)' : '')
                  : r.chain?.headMadeByVeilcore
                    ? "a hand-over secret VeilCore's software made still controls it: the partner's recovery is needed"
                    : r.chain?.recoveryOnceVeilcores
                      ? "its recovery commitment is one VeilCore held: the partner's recovery is needed"
                      : 'not anchored'
            }`,
          );
        const done = listing.records.every((r) => r.chain?.exitComplete === true || r.status === 'new');
        out(done ? 'Exit complete on chain for every record.' : 'Exit NOT complete on chain.');
        return done ? 0 : 1;
      }
      case 'change-password': {
        const next = await hidden('New password (nothing shows): ');
        if (!sameText(await io.askHidden('The same again: '), next))
          throw new Error('The two passwords differ. Nothing was changed.');
        vault = await v.changePassword(next);
        await audit.write({ op: 'change-password', ok: true });
        out(
          'Password changed. Update the password manager entry for this partner now: the old password no longer opens it.',
        );
        return 0;
      }
      case 'import-pool': {
        const pool = parsePool(await readJson(need('file')));
        const typed = await fingerprint('This pool', pool);
        const r = await op.importPool(ctx, pool, typed);
        out(
          `Imported: fingerprint confirmed. ${r.added} recovery commitments; ${r.unused} unused in all; bundle key registered.`,
        );
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
      case 'abandon': {
        if (o.record !== undefined) await op.abandonRecord(ctx, { label: o.record });
        else if (o.licence !== undefined) await op.abandonLicence(ctx, { label: o.licence });
        else throw new Error('abandon needs --record or --licence.');
        out('Abandoned; its secret is deleted from the store.');
        return 0;
      }
      case 'date':
        out(
          `Timestamped: ${tx(await op.dateRoot(ctx, { root: need('root'), ...(o.label === undefined ? {} : { label: o.label }) }))}.`,
        );
        return 0;
      case 'seal-fields': {
        let file: FieldSetFile;
        try {
          file = JSON.parse(await readFile(need('file'), 'utf8')) as FieldSetFile;
        } catch {
          // Never JSON.parse's own message: it quotes the file, which holds hidden values.
          throw new Error(`${need('file')} is not a JSON field-set file.`);
        }
        const r = await op.sealFieldSet(ctx, { label: need('label'), file, date: o.date === true });
        out(
          `Sealed into custody. Record commitment ${r.commitment}; schema ${r.schemaId}; field-set root ${r.setRoot}.`,
        );
        if (r.tx !== undefined) out(`Timestamped: ${tx(r.tx)}.`);
        out(
          `The file ${need('file')} holds the hidden values: delete it now that it is in custody (docs/MANAGED.md on what deleting can and cannot do).`,
        );
        return 0;
      }
      case 'pair-dna': {
        const file = need('evidence');
        // Checked before sending: the transaction cannot be taken back if the file then fails.
        if (await exists(file)) throw new Error(`${file} already exists. Refused: nothing was sent.`);
        const r = await op.pairDna(ctx, {
          record: need('record'),
          ...(o.report === undefined ? {} : { report: o.report }),
          ...(o['report-file'] === undefined ? {} : { reportFile: o['report-file'] }),
          again: o.again === true,
        });
        await writePrivate(file, JSON.stringify(r.evidence, null, 2) + '\n', { exclusive: true });
        out(`Paired: ${tx(r)}.`);
        out(
          `Evidence written to ${file}. It holds the salt that hides the report: give it to the partner privately, ` +
            'to keep with the report file. With both, anyone can check the pairing; without the salt, nobody can.',
        );
        return 0;
      }
      case 'pair-evidence': {
        const ev = op.pairEvidence(ctx, {
          ...(o.record === undefined ? {} : { record: o.record }),
          ...(o.binding === undefined ? {} : { binding: o.binding }),
        });
        await writePrivate(need('evidence'), JSON.stringify(ev, null, 2) + '\n', { exclusive: true });
        out(`Evidence written to ${need('evidence')} (pairing ${ev.txId}). Give it to the partner privately.`);
        return 0;
      }
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
          `Obligation placed: ${tx(await op.obligationEncumber(ctx, { record: need('record'), terms: await terms(), label: need('label') }))}.`,
        );
        return 0;
      case 'obligation-propose':
        out(
          `Obligation proposed: ${tx(await op.obligationPropose(ctx, { record: need('record'), on: need('on'), terms: await terms(), label: need('label') }))}.`,
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
      case 'audit-anchor': {
        const r = await op.anchorAudit(ctx);
        out(`Anchored the log's head (line ${r.seq}) in transaction ${r.txId}.`);
        out(
          `Receipt for the partner (send it to them; not secret): line ${r.seq}, head ${r.head}, transaction ${r.txId}.`,
        );
        return 0;
      }
      case 'export': {
        const r = await exportBundle(ctx, { out: need('out') });
        out(
          `Bundle written to ${need('out')} (sha256 ${r.sha256}), sealed to the partner's key: only their master opens it.`,
        );
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
        if (mode === 'self') {
          await confirm(
            `Partner ${id} leaves VeilCore-run (self). Afterwards every operation for them is refused.`,
            id,
          );
          const r = await exitSelf(ctx, { out: need('out'), ledger: await ledgerNow() });
          out(
            `Bundle written to ${need('out')} (sha256 ${r.sha256}), sealed to the partner's key. ${id}'s store is retired.`,
          );
          out(
            "VeilCore's copies still work on chain until the partner runs partner-recover (REQUIRED). exit-check shows when they have.",
          );
          return 0;
        }
        const answer = parseAnswer(await readJson(need('answer')));
        const typed = await fingerprint('This exit answer', answer);
        if (v.read().exit === undefined)
          await confirm(
            `Partner ${id} leaves VeilCore-run (assisted). VeilCore will send one or two transactions per record now.`,
            id,
          );
        const r = await exitAssisted(ctx, { answer, confirmedFingerprint: typed, out: need('out') });
        for (const h of r.handover)
          out(
            `  ${h.label}: ${h.status}${h.txIds.length === 0 ? '' : ` (${h.txIds.join(', ')})`}${h.note === undefined ? '' : ` ${h.note}`}`,
          );
        out(
          `Bundle written to ${need('out')} (sha256 ${r.sha256}), sealed to the partner's key. Give the partner EVERY bundle of this exit.`,
        );
        out(
          r.complete
            ? `Done on VeilCore's side: ${id}'s store is retired. The exit is complete when the partner has run partner-recover (REQUIRED); exit-check shows it. Then purge.`
            : 'NOT finished; the store is not retired. Fix the cause, then run the same exit again (a new --out): it resumes. If it cannot finish, exit --mode self.',
        );
        return r.complete ? 0 : 1;
      }
      case 'exit-cancel': {
        await confirm(`Cancel ${id}'s assisted exit? Only possible if it sent nothing (checked on chain).`, id);
        await cancelExit(ctx, await ledgerNow());
        out('Cancelled: nothing had been sent. The partner stays in VeilCore-run; a new exit can start from scratch.');
        return 0;
      }
      case 'purge': {
        await confirm(
          `Every secret VeilCore still holds for ${id}, and every bundle file of theirs on this computer, is deleted. The audit log stays.`,
          `PURGE ${id}`,
        );
        const r = await v.purge();
        await audit.write({
          op: 'purge',
          ok: true,
          note: `every secret removed from the custody store; ${r.deleted.length} bundle files deleted, ${r.missing.length} already gone`,
        });
        out(
          `Purged. ${v.dir}/custody.vcbox now holds no secrets. Deleted: ${r.deleted.join(', ') || 'no bundle files'}.`,
        );
        if (r.missing.length > 0)
          out(`Not found (moved or already deleted; find and delete any copies): ${r.missing.join(', ')}.`);
        // The purge line itself goes under an anchor, so the partner's last receipt covers it.
        const a = await op.anchorAudit(ctx);
        out(`Receipt for the partner (covers the purge line): line ${a.seq}, head ${a.head}, transaction ${a.txId}.`);
        out(
          'Deleting a file cannot be guaranteed to erase it from a solid-state disk, nor from backups: see docs/MANAGED.md, Backups.',
        );
        return 0;
      }
      default:
        throw new Error(`Unknown command ${command}. npm run managed -- help`);
    }
  } catch (e) {
    try {
      for (const s of vault?.secrets() ?? []) known.add(s);
    } catch {
      // the vault was closed (or replaced): what it held was already added
    }
    io.print(`\nSTOPPED: ${describeError(e, known)}`);
    return 1;
  } finally {
    await chain?.stop().catch(() => undefined);
    await vault?.close().catch(() => undefined);
  }
};

/** Open bundles on the partner's computer, asking for each master needed (by the key a bundle is sealed to). */
const openBundles = async (
  files: readonly string[],
  hidden: (q: string) => Promise<string>,
  known: Set<string>,
  masters: Uint8Array[] = [],
): Promise<(ExitBundle & { readonly bundle: ExitBundle; readonly ownKey: string })[]> => {
  const out: (ExitBundle & { bundle: ExitBundle; ownKey: string })[] = [];
  for (const f of files) {
    const recipient = await bundleRecipient(f);
    let m = masters.find((x) => bundleKeyOf(x).publicHex === recipient);
    if (m === undefined) {
      m = fromPaper(
        await hidden(`Your master secret for ${path.basename(f)}, as on your sheet, with its check (nothing shows): `),
      );
      known.add(toHex(m));
      masters.push(m);
    }
    const b = await readBundle(f, m);
    out.push({ ...b, bundle: b, ownKey: recipient });
  }
  return out;
};

/** partner-keys: on the partner's own computer. Makes (or reuses) the master; writes the sheet and the public files. */
const partnerKeys = async (
  o: Opts,
  need: (n: Exclude<keyof Opts, 'bundle'>) => string,
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
  const readOut = (v: unknown): void => {
    out('');
    out(`  FINGERPRINT: ${fingerprintOf(v)}`);
    out('  Read this out to VeilCore yourself (in person or by phone), from this screen. VeilCore types it in;');
    out('  if the file was changed on the way, it will not match and VeilCore will not use it.');
  };
  if (o.request !== undefined) {
    const request = parseRequest(await readJson(o.request));
    if (request.partner !== partner || request.network !== network)
      throw new Error(`That request is for ${request.partner} on ${request.network}.`);
    const answer = answerExit(request, master, start);
    const file = path.join(dir, 'exit-answer.json');
    await writePrivate(file, JSON.stringify(answer, null, 2) + '\n', { exclusive: true });
    const used = Math.max(answer.records.length, answer.licences.length);
    out(`Exit answer (no secrets; send it to VeilCore): ${file}`);
    out(`It used indexes ${start} to ${start + used - 1}. Next --start: ${start + used}.`);
    readOut(answer);
    return 0;
  }
  const pool = makePool({ partner, network, master, count, start });
  const file = path.join(dir, `recovery-pool-${pool.poolId}-${start}.json`);
  await writePrivate(file, JSON.stringify(pool, null, 2) + '\n', { exclusive: true });
  out(
    `Recovery pool and bundle key (no secrets; send it to VeilCore): ${file}. ${count} commitments` +
      (count === 0 ? '.' : `, indexes ${start} to ${start + count - 1}. Next --start: ${start + count}.`),
  );
  readOut(pool);
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
