// SPDX-License-Identifier: Apache-2.0
/**
 * The CLI's bound DNA pairings (contract/src/pairing.ts; design.md, rule 9): reading the
 * report a holder pairs, writing the evidence file they hand a verifier, and checking one
 * as a verifier. Kept apart from the menu so it can be tested without a terminal.
 *
 * An evidence file holds the record, the report's SHA-256, the salt and the transaction.
 * It goes to the verifier together with the report file itself: the verifier hashes the
 * report and compares, rather than taking the holder's word for the hash.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  type PairingEvidence,
  type ReadPairingEvidence,
  pairingEvidence,
  readPairingEvidence,
  reportHashOf,
} from '../../contract/src/pairing.js';
import { type PairingNote } from '../../contract/src/witnesses.js';
import { type VeilcoreAPI } from '../../api/src/veilcore-api.js';
import { type ActionSource } from '../../api/src/pairing-history.js';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const fromHex = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, 'hex'));

/** A report as the holder names it: a file (hashed here), or its SHA-256 typed as 64 hex. */
export const reportFromAnswer = (answer: string): { readonly reportHash: Uint8Array; readonly reportFile?: string } => {
  const a = answer.trim();
  if (a !== '' && existsSync(a) && statSync(a).isFile())
    return { reportHash: reportHashOf(new Uint8Array(readFileSync(a))), reportFile: path.basename(a) };
  const h = a.replace(/^0x/, '').toLowerCase();
  if (/^[0-9a-f]{64}$/.test(h)) return { reportHash: fromHex(h) };
  throw new Error('No such file, and not a SHA-256 (64 hex characters). Nothing was sent.');
};

/** Where an evidence file goes by default: the working folder, named by the binding. */
export const defaultEvidencePath = (binding: Uint8Array | string): string =>
  path.resolve(`veilcore-pairing-${(typeof binding === 'string' ? binding : hex(binding)).slice(0, 16)}.json`);

/** Write an evidence file (JSON). Refuses to overwrite one that is there. */
export const writeEvidence = (file: string, evidence: PairingEvidence): string => {
  const to = path.resolve(file);
  if (existsSync(to)) throw new Error(`${to} already exists; choose another name. Nothing was overwritten.`);
  writeFileSync(to, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  return to;
};

/** Evidence for each pairing this client saved, and the ones that never showed a transaction. */
export const evidenceFromNotes = (
  notes: readonly PairingNote[],
  where: { readonly network: string; readonly contractAddress: string },
): { readonly ready: PairingEvidence[]; readonly unconfirmed: PairingNote[] } => {
  const ready: PairingEvidence[] = [];
  const unconfirmed: PairingNote[] = [];
  for (const n of notes) {
    if (n.txId === undefined) {
      unconfirmed.push(n);
      continue;
    }
    ready.push(
      pairingEvidence({
        ...where,
        txId: n.txId,
        identity: fromHex(n.identity),
        reportHash: fromHex(n.reportSha256),
        salt: fromHex(n.salt),
      }),
    );
  }
  return { ready, unconfirmed };
};

/** Read an evidence file from disk; throws with a plain reason. */
export const readEvidenceFile = (file: string): ReadPairingEvidence => {
  const f = file.trim();
  if (!existsSync(f)) throw new Error('No such evidence file.');
  return readPairingEvidence(readFileSync(f, 'utf8'));
};

export type PairingVerdict = Awaited<ReturnType<VeilcoreAPI['checkPairing']>> & {
  /** Whether the report's SHA-256 was computed here from the file, or taken from the evidence. */
  readonly reportChecked: boolean;
};

/**
 * Check an evidence file as a verifier, on the contract this client joined. Refused before
 * anything is read when the file names another network or contract, when no report file
 * is given, or when the report file given is not the one paired. Without the report the
 * hash in the evidence is the holder's word, and a hash is all anyone needs to make such a
 * pairing (the 9 October review, M1). With `history` (pairing-history.ts), the verdict
 * also says whether the report's hash was paired raw earlier.
 */
export const checkEvidence = async (
  api: Pick<VeilcoreAPI, 'checkPairing' | 'deployedContractAddress'>,
  indexerUri: string,
  network: string,
  evidence: ReadPairingEvidence,
  report: Uint8Array | undefined,
  history?: ActionSource,
): Promise<PairingVerdict> => {
  if (evidence.network !== network)
    return {
      accepted: false,
      reason: `the evidence is for ${evidence.network}, and this client is on ${network}`,
      reportChecked: false,
    };
  if (evidence.contractAddress !== api.deployedContractAddress.toLowerCase())
    return {
      accepted: false,
      reason: 'the evidence names another contract than the one this client joined',
      reportChecked: false,
    };
  if (report === undefined)
    return {
      accepted: false,
      reason:
        "no report file was given. The SHA-256 in the evidence file is the holder's word, and anyone who has seen " +
        'that hash can make such a pairing without the report. Ask for the report file and give it here',
      reportChecked: false,
    };
  if (hex(reportHashOf(report)) !== hex(evidence.reportHash))
    return {
      accepted: false,
      reason: 'the report file you were given is not the one paired (its SHA-256 differs)',
      reportChecked: true,
    };
  const v = await api.checkPairing(indexerUri, evidence.txId, evidence.record, evidence.reportHash, evidence.salt, {
    history,
  });
  return { ...v, reportChecked: true };
};

/**
 * What the holder is told after pairing. Plain about what the date shows, and about a hash
 * typed in rather than a file hashed here.
 */
export const afterPairingMessage = (fromFile: boolean): string =>
  (fromFile
    ? "Paired. It shows that whoever controlled this record's identity at that date had this report, or its SHA-256, " +
      'by then; not who controls the record later. '
    : "Paired the SHA-256 you typed (no file was read here). It shows that whoever controlled this record's identity " +
      'at that date had a report with that SHA-256, or the hash itself, by then; a verifier needs the report file. ') +
  'To show it, give a verifier the report file and the evidence file (their option 44). Back up the evidence ' +
  'file with the report: without the salt in it this pairing can never be shown, and the salt is not derived from ' +
  'your record secret, so your paper copy of that does not bring it back.';
