// What a verifier checks, as code. Reads only chain state (the contract's Ledger),
// so a verifier needs nothing from VeilCore or its registry. docs/design.md,
// "Verifier rules", states the same rules in prose.
// SPDX-License-Identifier: Apache-2.0

import { type Ledger } from "./managed/veilcore/contract/index.js";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const same = (a: Uint8Array, b: Uint8Array): boolean => hex(a) === hex(b);

/** The identity (origin) a commitment belongs to. */
export const identityOf = (ledger: Ledger, record: Uint8Array): Uint8Array =>
  ledger.originOf.member(record) ? ledger.originOf.lookup(record) : record;

/** Whether a commitment is the current head of its identity, and so may act. */
export const isLive = (ledger: Ledger, record: Uint8Array): boolean => {
  const origin = identityOf(ledger, record);
  return ledger.headOf.member(origin)
    ? same(ledger.headOf.lookup(origin), record)
    : same(origin, record);
};

/** Whether a commitment belongs to an anchored identity. */
export const isAnchored = (ledger: Ledger, record: Uint8Array): boolean =>
  ledger.recoveryOf.member(identityOf(ledger, record));

/** How many obligations are in force against a record's identity. */
export const openObligations = (ledger: Ledger, record: Uint8Array): bigint => {
  const id = identityOf(ledger, record);
  return ledger.obligationCountOf.member(id)
    ? ledger.obligationCountOf.lookup(id)
    : 0n;
};

export type LineageReport = {
  /** The identity checked. */
  readonly identity: Uint8Array;
  /** Every ancestor identity reachable through confirmed parentage, nearest first. */
  readonly ancestors: readonly Uint8Array[];
  /** Ancestors with no confirmed parent. A registry decides whether it recognises them. */
  readonly roots: readonly Uint8Array[];
  /** Ancestors carrying an obligation in force. */
  readonly encumbered: readonly Uint8Array[];
  /** True when no ancestor carries an obligation in force. */
  readonly clean: boolean;
};

/**
 * Walk a record's confirmed pedigree and report which ancestors carry obligations.
 *
 * The walk is the verifier's, from chain state; nothing the seller hands over is
 * trusted, so an ancestor cannot be left out. Cycles (two identities confirming each
 * other as parents) are visited once. "Clean" means no ancestor on chain owes anything;
 * it does not mean the pedigree is complete: check `roots` against origins you
 * recognise.
 */
export const checkLineage = (
  ledger: Ledger,
  record: Uint8Array,
): LineageReport => {
  const identity = identityOf(ledger, record);
  const seen = new Set<string>([hex(identity)]);
  const ancestors: Uint8Array[] = [];
  const roots: Uint8Array[] = [];
  let frontier: Uint8Array[] = [identity];
  while (frontier.length > 0) {
    const next: Uint8Array[] = [];
    for (const child of frontier) {
      if (!ledger.parentsOf.member(child)) {
        if (!same(child, identity)) roots.push(child);
        continue;
      }
      for (const parent of ledger.parentsOf.lookup(child)) {
        if (seen.has(hex(parent))) continue;
        seen.add(hex(parent));
        ancestors.push(parent);
        next.push(parent);
      }
    }
    frontier = next;
  }
  const encumbered = ancestors.filter((a) =>
    ledger.obligationCountOf.member(a),
  );
  return {
    identity,
    ancestors,
    roots,
    encumbered,
    clean: encumbered.length === 0,
  };
};
