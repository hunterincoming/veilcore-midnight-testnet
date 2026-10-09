// Bound DNA pairings through the client (api/src/veilcore-api.ts pairReport, checkPairing)
// and the CLI's evidence file (pairing-evidence.ts), on the live contract's circuits run
// locally (the simulator). The indexer lookup is replaced so the test decides which
// transaction a txId names; everything else is the real code.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for async interfaces */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NEVER } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VeilcoreAPI } from '../../api/src/veilcore-api';
import { C, VeilcoreSimulator, as, freshRecovery, secret } from '../../contract/src/test/veilcore-simulator';
import { dnaPairBinding, pairingEvidence, readPairingEvidence, reportHashOf } from '../../contract/src/pairing';
import {
  checkEvidence,
  defaultEvidencePath,
  evidenceFromNotes,
  readEvidenceFile,
  reportFromAnswer,
  writeEvidence,
} from './pairing-evidence';

/** txId -> the raw contract state right after that call, and its block time. */
const txs = vi.hoisted(() => new Map<string, { data: unknown; entryPoint: string; time: number; height: number }>());
vi.mock('../../api/src/presentation-lookup', () => ({
  singleCallState: async (_i: string, _a: string, txId: string, entryPoints: string[], refusal: string) => {
    const t = txs.get(txId);
    if (t === undefined) throw new Error('No such transaction.');
    if (!entryPoints.includes(t.entryPoint)) throw new Error(refusal);
    return {
      entryPoint: t.entryPoint,
      state: { data: t.data },
      blockHeight: t.height,
      blockTime: t.time,
      authority: { committee: 1, threshold: 1, counter: 0n, retired: false },
      keys: 'unchecked',
    };
  },
  presentationWithTime: async () => {
    throw new Error('not used here');
  },
}));

const ADDR = 'ab'.repeat(32);
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const REPORT = new TextEncoder().encode('%PDF-1.7 certificate of analysis, lot 7 (test data)');
const REPORT_HASH = reportHashOf(REPORT);

let sim: VeilcoreSimulator;
let n = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = (): unknown => (sim as any).ctx.currentQueryContext.state;

/** Run a circuit on the simulator as `own`, record the state after it under a fresh txId. */
const land = (own: Uint8Array, circuit: string, ...args: unknown[]): { txId: string } => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (sim as any).call(as(own), circuit, ...args);
  const txId = (++n).toString(16).padStart(64, '0');
  txs.set(txId, { data: raw(), entryPoint: circuit, time: Number(sim.now) * 1000, height: n });
  return { txId };
};

/** A VeilcoreAPI acting as `own`, whose calls land on the simulator. */
const client = (own: Uint8Array) => {
  let ps: Record<string, unknown> = { geneticSecret: own };
  const providers = {
    privateStateProvider: {
      setContractAddress: () => undefined,
      get: async () => ps,
      set: async (_: string, v: Record<string, unknown>) => {
        ps = v;
      },
    },
    publicDataProvider: { contractStateObservable: () => NEVER, queryContractState: async () => ({ data: raw() }) },
  };
  const callTx = {
    pairDna: async (v: Uint8Array) => {
      const { txId } = land(ps.geneticSecret as Uint8Array, 'pairDna', v);
      return {
        public: { txId, txHash: `h${n}`, blockHeight: n },
        private: { result: C.commit(ps.geneticSecret as Uint8Array) },
      };
    },
  };
  const deployed = { deployTxData: { public: { contractAddress: ADDR } }, callTx };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = new (VeilcoreAPI as any)(deployed, providers) as VeilcoreAPI;
  return { api, privateState: () => ps, actAs: (s: Uint8Array) => (ps = { ...ps, geneticSecret: s }) };
};

const A = secret('cli-pair-A'),
  B = secret('cli-pair-B');
const A_REC = C.commit(A),
  B_REC = C.commit(B);

beforeEach(() => {
  sim = new VeilcoreSimulator();
  txs.clear();
  land(A, 'anchor', freshRecovery());
  land(B, 'anchor', freshRecovery());
});

describe('pairReport', () => {
  it('pairs the binding, never the report hash, and keeps the salt (saved before sending)', async () => {
    const { api, privateState } = client(A);
    const p = await api.pairReport(REPORT_HASH);
    expect(hex(sim.state.lastPairedDna)).toBe(hex(p.binding));
    expect(hex(sim.state.lastPairedDna)).not.toBe(hex(REPORT_HASH));
    expect(hex(p.binding)).toBe(hex(dnaPairBinding(REPORT_HASH, A_REC, p.salt)));
    expect(hex(p.identity)).toBe(hex(A_REC));
    expect(privateState().pairings).toEqual([
      {
        binding: hex(p.binding),
        reportSha256: hex(REPORT_HASH),
        identity: hex(A_REC),
        salt: hex(p.salt),
        txId: p.txId,
      },
    ]);
    // A fresh salt each time.
    const again = await api.pairReport(REPORT_HASH);
    expect(hex(again.salt)).not.toBe(hex(p.salt));
    expect(await api.pairings()).toHaveLength(2);
  });

  it('a pairing whose confirmation fails keeps its salt', async () => {
    const { api, privateState } = client(A);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).deployedContract.callTx.pairDna = async () => {
      throw new Error('confirmation timed out');
    };
    await expect(api.pairReport(REPORT_HASH)).rejects.toThrow(/timed out/);
    const saved = privateState().pairings as { salt: string; txId?: string }[];
    expect(saved).toHaveLength(1);
    expect(saved[0].txId).toBeUndefined();
    expect(saved[0].salt).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses before anything is saved or sent: not 32 bytes, or not anchored', async () => {
    const { api, privateState } = client(secret('never anchored'));
    await expect(api.pairReport(new Uint8Array(31))).rejects.toThrow(/32 bytes/);
    await expect(api.pairReport(REPORT_HASH)).rejects.toThrow(/Anchor this record/);
    expect(privateState().pairings).toBeUndefined();
  });
});

describe('checkPairing', () => {
  it("accepts the holder's evidence and dates it by the pairing's block", async () => {
    sim.advance(500n);
    const { api } = client(A);
    const p = await api.pairReport(REPORT_HASH);
    const v = await api.checkPairing('http://indexer', p.txId, A_REC, REPORT_HASH, p.salt);
    expect(v.accepted).toBe(true);
    expect(v.pairedAt).toBe(txs.get(p.txId)!.time);
    expect(v.authority?.counter).toBe(0n);
  });

  it('a copied binding fails for the copier, even when the copy landed first', async () => {
    const { api } = client(A);
    // The holder's binding, built but not landed yet: B sees it pending and pairs it first.
    const salt = secret('a-salt');
    const binding = dnaPairBinding(REPORT_HASH, A_REC, salt);
    const copy = land(B, 'pairDna', binding);
    sim.advance(20n);
    const real = land(A, 'pairDna', binding);
    expect((await api.checkPairing('http://indexer', copy.txId, B_REC, REPORT_HASH, salt)).reason).toMatch(
      /did not pair this report/,
    );
    expect((await api.checkPairing('http://indexer', copy.txId, A_REC, REPORT_HASH, salt)).reason).toBe(
      'that transaction paired a different record',
    );
    expect((await api.checkPairing('http://indexer', real.txId, A_REC, REPORT_HASH, salt)).accepted).toBe(true);
  });

  it('a wrong salt or report fails; a raw pairing is refused; another kind of call is not a pairing', async () => {
    const { api } = client(A);
    const p = await api.pairReport(REPORT_HASH);
    for (const [report, salt] of [
      [REPORT_HASH, secret('wrong')],
      [reportHashOf(new TextEncoder().encode('another report')), p.salt],
    ])
      expect((await api.checkPairing('http://indexer', p.txId, A_REC, report, salt)).accepted).toBe(false);
    const rawTx = land(A, 'pairDna', REPORT_HASH);
    expect((await api.checkPairing('http://indexer', rawTx.txId, A_REC, REPORT_HASH, p.salt)).reason).toMatch(
      /raw report hash/,
    );
    const anchorTx = land(secret('someone'), 'anchor', freshRecovery());
    await expect(api.checkPairing('http://indexer', anchorTx.txId, A_REC, REPORT_HASH, p.salt)).rejects.toThrow(
      /not a single pairDna call/,
    );
  });

  it('after the holder rotates, the pairing checks with the new record, and new pairings bind the same identity', async () => {
    const { api, actAs } = client(A);
    const p = await api.pairReport(REPORT_HASH);
    const A2 = secret('cli-pair-A2');
    sim.call(as(A, { incoming: A2 }), 'rotateRecordSecret', C.commit(A2));
    expect(hex(sim.state.headOf.lookup(A_REC))).toBe(hex(C.commit(A2)));
    expect((await api.checkPairing('http://indexer', p.txId, C.commit(A2), REPORT_HASH, p.salt)).accepted).toBe(true);
    actAs(A2);
    const q = await api.pairReport(REPORT_HASH);
    expect(hex(q.identity)).toBe(hex(A_REC));
    expect((await api.checkPairing('http://indexer', q.txId, A_REC, REPORT_HASH, q.salt)).accepted).toBe(true);
  });
});

describe('the CLI evidence file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vc-pair-'));

  it('the report is read from a file (hashed here) or taken as 64 hex', () => {
    const f = path.join(dir, 'coa.pdf');
    writeFileSync(f, REPORT);
    expect(hex(reportFromAnswer(f).reportHash)).toBe(hex(REPORT_HASH));
    expect(reportFromAnswer(f).reportFile).toBe('coa.pdf');
    expect(hex(reportFromAnswer(hex(REPORT_HASH).toUpperCase()).reportHash)).toBe(hex(REPORT_HASH));
    expect(() => reportFromAnswer(path.join(dir, 'missing.pdf'))).toThrow(/No such file/);
  });

  it('is written, read back, and checked by a verifier with the report file', async () => {
    const { api } = client(A);
    const p = await api.pairReport(REPORT_HASH);
    const ev = pairingEvidence({
      network: 'preprod',
      contractAddress: ADDR,
      txId: p.txId,
      identity: p.identity,
      reportHash: REPORT_HASH,
      salt: p.salt,
      reportFile: 'coa.pdf',
    });
    const file = writeEvidence(path.join(dir, path.basename(defaultEvidencePath(p.binding))), ev);
    expect(() => writeEvidence(file, ev)).toThrow(/already exists/);
    const read = readEvidenceFile(file);
    const verifier = client(secret('verifier')).api;
    const ok = await checkEvidence(verifier, 'http://indexer', 'preprod', read, REPORT);
    expect(ok).toMatchObject({ accepted: true, reportChecked: true });
    // Without the report the hash is the holder's word, and the verdict says so.
    expect(await checkEvidence(verifier, 'http://indexer', 'preprod', read)).toMatchObject({
      accepted: true,
      reportChecked: false,
    });
    const other = await checkEvidence(verifier, 'http://indexer', 'preprod', read, new TextEncoder().encode('x'));
    expect(other).toMatchObject({ accepted: false });
    expect(other.reason).toMatch(/not the one paired/);
    expect((await checkEvidence(verifier, 'http://indexer', 'mainnet', read, REPORT)).reason).toMatch(
      /evidence is for preprod/,
    );
    // An edited salt is refused when the file is read.
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), salt: 'ff'.repeat(32) }));
    expect(() => readEvidenceFile(file)).toThrow(/damaged or was edited/);
  });

  it('saved pairings become evidence files; unconfirmed ones are listed with their salt', async () => {
    const { api } = client(A);
    const p = await api.pairReport(REPORT_HASH);
    const notes = [
      ...(await api.pairings()),
      { binding: 'aa'.repeat(32), reportSha256: 'bb'.repeat(32), identity: hex(A_REC), salt: 'cc'.repeat(32) },
    ];
    const { ready, unconfirmed } = evidenceFromNotes(notes, { network: 'preprod', contractAddress: ADDR });
    expect(ready).toHaveLength(1);
    expect(unconfirmed).toHaveLength(1);
    const back = readPairingEvidence(ready[0]);
    expect(back.txId).toBe(p.txId);
    expect(hex(back.salt)).toBe(hex(p.salt));
  });
});
