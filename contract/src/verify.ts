// The reference verifier: the rules in docs/design.md ("Verifier rules"), as code.
// Reads only chain state (the contract's Ledger), so a verifier needs nothing from
// VeilCore or its registry.
// SPDX-License-Identifier: Apache-2.0

import {
  type Ledger,
  pureCircuits,
} from "./managed/veilcore/contract/index.js";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const same = (a: Uint8Array, b: Uint8Array): boolean => hex(a) === hex(b);

/** Rule 1. The identity (origin) a commitment belongs to. */
export const identityOf = (ledger: Ledger, record: Uint8Array): Uint8Array =>
  ledger.originOf.member(record) ? ledger.originOf.lookup(record) : record;

/** Rule 1. Whether a commitment is its identity's current head, and so may act. */
export const isLive = (ledger: Ledger, record: Uint8Array): boolean => {
  const origin = identityOf(ledger, record);
  return ledger.headOf.member(origin)
    ? same(ledger.headOf.lookup(origin), record)
    : same(origin, record);
};

/** Whether a commitment belongs to an anchored identity. */
export const isAnchored = (ledger: Ledger, record: Uint8Array): boolean =>
  ledger.recoveryOf.member(identityOf(ledger, record));

/** Every commitment an identity has had: its origin, then each successor. */
export const commitmentsOf = (
  ledger: Ledger,
  record: Uint8Array,
): Uint8Array[] => {
  const origin = identityOf(ledger, record);
  const successors = [...ledger.originOf]
    .filter(([, o]) => same(o, origin))
    .map(([s]) => s);
  return [origin, ...successors];
};

/** Rule 3. How many obligations are in force against a record's identity. */
export const openObligations = (ledger: Ledger, record: Uint8Array): bigint => {
  const id = identityOf(ledger, record);
  return ledger.obligationCountOf.member(id)
    ? ledger.obligationCountOf.lookup(id).read()
    : 0n;
};

export type LineageReport = {
  /** The identity checked. */
  readonly identity: Uint8Array;
  /** Every ancestor identity reachable through confirmed parentage. */
  readonly ancestors: readonly Uint8Array[];
  /**
   * Rule 4. Where the pedigree starts: identities in it with no confirmed parent,
   * including the record itself when it has none.
   */
  readonly roots: readonly Uint8Array[];
  /** Rule 4. Some identity is its own ancestor. A shared ancestor (a backcross) is not a cycle. */
  readonly cyclic: boolean;
  /** Rule 3. The record itself, and ancestors, carrying an obligation in force. */
  readonly encumbered: readonly Uint8Array[];
  /** No obligation in force on the record or any ancestor. Not the same as complete (rule 4). */
  readonly clean: boolean;
  /** Clean, acyclic, and every root is one the caller recognises. */
  readonly accepted: boolean;
};

/**
 * Rules 2 to 4. Walk a record's confirmed pedigree from chain state, never from what a
 * seller hands over, and report obligations, roots and cycles. `recognisedRoots` are the
 * origins the verifier trusts as the start of a line (a breeder, a gene bank); without
 * them nothing is `accepted`, since anyone can anchor fresh material with no history.
 */
export const checkLineage = (
  ledger: Ledger,
  record: Uint8Array,
  recognisedRoots: readonly Uint8Array[] = [],
): LineageReport => {
  const identity = identityOf(ledger, record);
  const parentsOf = (id: Uint8Array): Uint8Array[] =>
    ledger.parentsOf.member(id) ? [...ledger.parentsOf.lookup(id)] : [];
  const done = new Set<string>();
  const onPath = new Set<string>();
  const ancestors: Uint8Array[] = [];
  const roots: Uint8Array[] = [];
  let cyclic = false;
  // Depth-first with an explicit stack (a recursive walk overflows on long pedigrees),
  // tracking the current path: meeting an identity already on the path is a cycle;
  // meeting one another branch has finished is a shared ancestor.
  type Frame = { id: Uint8Array; parents: Uint8Array[]; next: number };
  const enter = (id: Uint8Array): Frame => {
    onPath.add(hex(id));
    if (!same(id, identity)) ancestors.push(id);
    const parents = parentsOf(id);
    if (parents.length === 0) roots.push(id);
    return { id, parents, next: 0 };
  };
  const stack: Frame[] = [enter(identity)];
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (top.next === top.parents.length) {
      onPath.delete(hex(top.id));
      done.add(hex(top.id));
      stack.pop();
      continue;
    }
    const p = top.parents[top.next++];
    if (onPath.has(hex(p))) cyclic = true;
    else if (!done.has(hex(p))) stack.push(enter(p));
  }
  const owes = (id: Uint8Array): boolean =>
    ledger.obligationCountOf.member(id) &&
    ledger.obligationCountOf.lookup(id).read() > 0n;
  const encumbered = [identity, ...ancestors].filter(owes);
  const clean = encumbered.length === 0;
  const known = new Set(recognisedRoots.map((r) => hex(identityOf(ledger, r))));
  const rootsKnown = roots.length > 0 && roots.every((r) => known.has(hex(r)));
  return {
    identity,
    ancestors,
    roots,
    cyclic,
    encumbered,
    clean,
    accepted: clean && !cyclic && rootsKnown,
  };
};

/**
 * Rule 5. Accept a licence presentation.
 *
 * `afterTx` is the contract state IMMEDIATELY AFTER the presentation's own transaction,
 * from the indexer by transaction id (VeilcoreAPI.stateAfterTransaction). The tag is
 * read from that state, never taken from the licensee, who can compute any tag for a
 * challenge they hold. The verifier chose `challenge` (32 fresh random bytes, sent
 * privately) and asked about `issuer`, any commitment of the licensing identity.
 *
 * The presentation is accepted when the root it proved against is the tree's current
 * root in that state (the leaf was live then, whatever was revoked earlier), or when no
 * revocation was waiting for a seal (so every older root still accepted excludes revoked
 * leaves).
 */
export const acceptPresentation = (
  afterTx: Ledger,
  issuer: Uint8Array,
  challenge: Uint8Array,
): { readonly accepted: boolean; readonly reason: string } => {
  if (challenge.length !== 32 || challenge.every((b) => b === 0))
    return { accepted: false, reason: "not a usable challenge" };
  if (afterTx.presentationSeq === 0n)
    return {
      accepted: false,
      reason: "no presentation has been made on this contract",
    };
  const tag = afterTx.lastPresentation;
  const matches = commitmentsOf(afterTx, issuer).some((c) =>
    same(pureCircuits.presentationTag(c, challenge), tag),
  );
  if (!matches)
    return {
      accepted: false,
      reason: "that transaction did not answer this challenge for this issuer",
    };
  const current =
    afterTx.lastPresentationRoot.field === afterTx.activeLicenses.root().field;
  if (current)
    return {
      accepted: true,
      reason:
        "a live licence from this issuer, proved against the current root",
    };
  if (!afterTx.unsealedChanges)
    return {
      accepted: true,
      reason: "a live licence from this issuer; no revocation was waiting",
    };
  return {
    accepted: false,
    reason:
      "proved against an older root while a revocation was waiting; ask again",
  };
};
