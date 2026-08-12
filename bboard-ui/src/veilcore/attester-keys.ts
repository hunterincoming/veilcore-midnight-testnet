// An attester's own keys.
//
// The private key never leaves this device. That is the whole point: an attestation
// signed on our server would be our claim about a lab rather than the lab's own
// statement, and a registry that can sign for its members can forge evidence.
//
// The cost is the same non-custodial tradeoff as holder keys, with sharper
// consequences: lose the key and you cannot sign new attestations. Past ones stay
// valid, and retraction goes through the registry rather than the key, so nothing
// already issued is stranded.
//
// SPDX-License-Identifier: Apache-2.0

import { generateKeypair, signAttestation, signRetraction, type Keypair } from 'veilcore-records';

const KEY = 'veilcore.attester.v1';
const BASE = import.meta.env.VITE_API_BASE ?? '';

export type AttesterProfile = {
  keypair: Keypair;
  displayName?: string;
  role?: 'laboratory' | 'inspector' | 'registry' | 'breeder' | 'other';
  accreditation?: { scheme: string; identifier: string; accreditor: string };
  registeredAt?: number;
};

export const loadAttester = (): AttesterProfile | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AttesterProfile) : null;
  } catch {
    return null;
  }
};

const save = (p: AttesterProfile): void => localStorage.setItem(KEY, JSON.stringify(p));

/** Create an attester identity. The keypair is generated here and stays here. */
export const createAttester = async (
  displayName: string,
  role: AttesterProfile['role'],
  accreditation?: AttesterProfile['accreditation'],
): Promise<AttesterProfile> => {
  const keypair = await generateKeypair();
  const profile: AttesterProfile = { keypair, displayName, role, accreditation };
  save(profile);
  return profile;
};

/**
 * Publish the public half so a verifier can resolve a signature to a name.
 *
 * Only the public key, the display name and any accreditation leave the device. The
 * accreditation is recorded as the attester's own claim with a named accreditor —
 * VeilCore does not verify it and says so.
 */
export const publishAttester = async (p: AttesterProfile): Promise<{ attesterId?: string; error?: string }> => {
  try {
    const res = await fetch(`${BASE}/attesters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: p.keypair.publicKey,
        displayName: p.displayName,
        role: p.role,
        accreditation: p.accreditation,
      }),
    });
    const out = await res.json();
    if (!out.error) save({ ...p, registeredAt: Date.now() });
    return out;
  } catch {
    return { error: 'could not reach the registry' };
  }
};

/** Sign an attestation about a record and submit it. */
export const attestRecord = async (
  p: AttesterProfile,
  subjectCommitment: string,
  documentHash: string,
  type: 'laboratory-report' | 'genetic-fingerprint' | 'inspection' | 'chain-of-custody' = 'laboratory-report',
): Promise<{ attestationId?: string; strength?: string; error?: string }> => {
  const signed = await signAttestation({
    attestationId: `att_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    type,
    subjectCommitment,
    attester: { publicKey: p.keypair.publicKey, displayName: p.displayName, role: p.role },
    documentHash,
    hashAlgorithm: 'sha256',
    issuedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }, p.keypair.privateKey);

  try {
    const res = await fetch(`${BASE}/attestations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signed),
    });
    return await res.json();
  } catch {
    return { error: 'could not reach the registry' };
  }
};

/**
 * Retract an attestation you issued.
 *
 * Signed with the same key, so the registry can prove it came from the issuer. The
 * attestation is not deleted — it happened, and a registry that erases its own history
 * is not a registry.
 */
export const retract = async (
  p: AttesterProfile,
  attestationId: string,
  reason: 'issued-in-error' | 'superseded' | 'sample-compromised' | 'other',
  note?: string,
): Promise<{ retracted?: boolean; error?: string }> => {
  const signed = await signRetraction({
    attestationId,
    attesterPublicKey: p.keypair.publicKey,
    reason,
    note,
    retractedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }, p.keypair.privateKey);

  try {
    const res = await fetch(`${BASE}/attestations/${encodeURIComponent(attestationId)}/retract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signed),
    });
    return await res.json();
  } catch {
    return { error: 'could not reach the registry' };
  }
};
