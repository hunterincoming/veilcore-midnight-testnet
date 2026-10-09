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
  /** Whether the chain has ever seen this record anchored. Nothing else here means anything if not. */
  readonly anchored: boolean;
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
  /**
   * Anchored, and no obligation in force on the record or any ancestor. Not the same as
   * complete (rule 4).
   */
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
  const anchored = isAnchored(ledger, record);
  const clean = anchored && encumbered.length === 0;
  const known = new Set(recognisedRoots.map((r) => hex(identityOf(ledger, r))));
  const rootsKnown = roots.length > 0 && roots.every((r) => known.has(hex(r)));
  return {
    identity,
    anchored,
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
 * revocation was waiting for a seal AT THE MOMENT IT WAS PROVED (so every older root it
 * could have used excludes revoked leaves). That flag is the one the presentation itself
 * recorded, never the live one: a seal landing after it, even in the same transaction,
 * clears the live flag without making the presentation's root any safer.
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
  if (!afterTx.lastPresentationUnsealed)
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

/**
 * Rule 5, issuer-scoped (8 October 2026 review). acceptPresentation refuses a
 * presentation proved against an older root while any revocation was waiting, whoever
 * revoked. A griefer with one throwaway licence of their own, revoked again after every
 * seal, plus cheap root changes (activating more of their own licences), makes that
 * refusal permanent for every honest licensee (attack-licences.test.ts, ATTACK 1).
 *
 * This rule asks the narrower question that matters: could the licence behind this
 * presentation have been taken away since the root it proved against? The leaf belongs
 * to the asked-about issuer (the tag names one of its records), and only that issuer's
 * identity can remove one of its leaves, by revoking it or by approving its transfer. So
 * the presentation is accepted when no licence the issuer held at that root was revoked
 * or transferred by the issuer between that root and the presentation. Revocations and
 * transfers by anyone else cannot touch the issuer's leaves and are ignored.
 *
 * `history` is the contract state after EVERY call on the contract, in order, ending with
 * the presentation's own (`afterTx`). It must reach back at least to the last seal before
 * the presentation (a root proved against is never older than that), and it must have no
 * gaps: a missing call could be the revocation. It comes from the indexer, which is
 * trusted for it as for everything else (ask a second one). From each pair of
 * consecutive states:
 *  - a leaf the tree held at the root is REMOVED from its slot and the issuer's active
 *    count (`activeLicensesBy` of its identity) went down: the issuer revoked it;
 *  - a leaf the tree held at the root is REPLACED in its slot by
 *    licenseKey(lastTransferredLicense, r) for one of the issuer's records r: the
 *    issuer approved its transfer.
 * Either refuses. Anything the history cannot settle (the root is not in it) refuses.
 */
export const acceptPresentationScoped = (
  history: readonly Ledger[],
  issuer: Uint8Array,
  challenge: Uint8Array,
): { readonly accepted: boolean; readonly reason: string } => {
  if (history.length === 0)
    return { accepted: false, reason: "no contract history was given" };
  const afterTx = history[history.length - 1];
  const strict = acceptPresentation(afterTx, issuer, challenge);
  if (
    strict.accepted ||
    !strict.reason.startsWith("proved against an older root")
  )
    return strict;
  const root = afterTx.lastPresentationRoot.field;
  let j = -1;
  for (let i = history.length - 2; i >= 0; i--)
    if (history[i].activeLicenses.root().field === root) {
      j = i;
      break;
    }
  if (j < 0)
    return {
      accepted: false,
      reason:
        "proved against an older root that the history given does not reach; give the history since the last seal, or ask again",
    };
  // The tree as it was at that root: slot -> licence key.
  const atRoot = new Map<string, string>();
  for (const [slot, k] of history[j].licenseAtSlot)
    atRoot.set(String(slot), hex(k));
  const origin = identityOf(afterTx, issuer);
  const mine = commitmentsOf(afterTx, issuer);
  const activeCount = (l: Ledger): bigint =>
    l.activeLicensesBy.member(origin)
      ? l.activeLicensesBy.lookup(origin).read()
      : 0n;
  const slots = (l: Ledger): Map<string, string> => {
    const m = new Map<string, string>();
    for (const [slot, k] of l.licenseAtSlot) m.set(String(slot), hex(k));
    return m;
  };
  for (let i = j + 1; i < history.length; i++) {
    const prev = slots(history[i - 1]);
    const next = slots(history[i]);
    let changes = 0;
    const touched: { slot: string; now: string | undefined }[] = [];
    for (const [slot, key] of prev) {
      const now = next.get(slot);
      if (now === key) continue;
      changes++;
      if (atRoot.get(slot) === key) touched.push({ slot, now });
    }
    for (const slot of next.keys()) if (!prev.has(slot)) changes++;
    if (touched.length === 0) continue;
    // One call changes at most one leaf. Several changes between two states means the
    // history is not one state per call, and who removed what cannot be told apart.
    if (changes > 1)
      return {
        accepted: false,
        reason:
          "proved against an older root, and the history given is not one state per call; ask again",
      };
    const { now } = touched[0];
    if (now === undefined) {
      if (activeCount(history[i]) < activeCount(history[i - 1]))
        return {
          accepted: false,
          reason:
            "proved against an older root, and this issuer has revoked a licence since; ask again",
        };
      continue; // another issuer's revocation
    }
    const transferred = history[i].lastTransferredLicense;
    if (mine.some((r) => hex(pureCircuits.licenseKey(transferred, r)) === now))
      return {
        accepted: false,
        reason:
          "proved against an older root, and this issuer has approved a transfer since; ask again",
      };
  }
  return {
    accepted: true,
    reason:
      "a live licence from this issuer, proved against an older root; the issuer has revoked or transferred none of its licences since",
  };
};

/**
 * How old a licence presentation may be when the verifier decides on it. A presentation
 * shows the licence was live when it landed, nothing later: a licence revoked and sealed
 * since still has its old presentation on chain (round D, D-7). An hour leaves time to
 * look the transaction up; ask again for anything older.
 */
export const MAX_PRESENTATION_AGE_MS = 60 * 60 * 1000;

/**
 * Rule 5 with the time of the presentation. `landedAt` is the time (ms) of the block the
 * presentation landed in, from the same indexer answer as `afterTx`. Refused when the
 * time is unknown, when it landed before the challenge was issued (`issuedAt`, from the
 * challenge book: no honest answer can come before the question), or when it is older
 * than `maxAgeMs` at `now`. Otherwise acceptPresentation decides, and an acceptance says
 * what it means: the licence was live WHEN PRESENTED.
 *
 * Given `history` (the state after every call, ending with this presentation's: see
 * acceptPresentationScoped), the issuer-scoped rule decides instead, so a griefer's own
 * revocations no longer send an honest presentation back. `rule: 'strict'` keeps the
 * original rule even then. Without a history the strict rule applies, as before.
 */
export const acceptPresentationAt = (
  afterTx: Ledger,
  issuer: Uint8Array,
  challenge: Uint8Array,
  when: {
    readonly landedAt: number | undefined;
    readonly blockHeight?: number;
    readonly issuedAt?: number;
    readonly now?: number;
    readonly maxAgeMs?: number;
    readonly history?: readonly Ledger[];
    readonly rule?: "strict" | "issuer-scoped";
  },
): { readonly accepted: boolean; readonly reason: string } => {
  const scoped = when.history !== undefined && when.rule !== "strict";
  if (scoped) {
    const last = when.history[when.history.length - 1];
    if (
      last === undefined ||
      last.presentationSeq !== afterTx.presentationSeq ||
      !same(last.lastPresentation, afterTx.lastPresentation)
    )
      return {
        accepted: false,
        reason: "the history given does not end with this presentation",
      };
  }
  const v = scoped
    ? acceptPresentationScoped(when.history, issuer, challenge)
    : acceptPresentation(afterTx, issuer, challenge);
  if (!v.accepted) return v;
  const { landedAt, blockHeight, issuedAt } = when;
  const now = when.now ?? Date.now();
  const maxAgeMs = when.maxAgeMs ?? MAX_PRESENTATION_AGE_MS;
  if (landedAt === undefined)
    return {
      accepted: false,
      reason: "the indexer did not say when the presentation landed; ask again",
    };
  // A minute of slack for clocks that disagree; anything earlier came before the question.
  if (issuedAt !== undefined && landedAt < issuedAt - 60_000)
    return {
      accepted: false,
      reason: "the presentation landed before you issued this challenge",
    };
  const age = now - landedAt;
  if (age > maxAgeMs)
    return {
      accepted: false,
      reason: `the presentation is ${Math.floor(age / 60_000)} minutes old (at most ${Math.floor(maxAgeMs / 60_000)}); the licence may have been revoked since. Ask for a new one`,
    };
  const at = `${blockHeight === undefined ? "" : `block ${blockHeight}, `}${new Date(landedAt).toISOString()}, ${Math.max(0, Math.floor(age / 60_000))} minutes ago`;
  return {
    accepted: true,
    reason:
      `the licence was live when presented (${at}); ${v.reason.replace(/^a live licence from this issuer[,;]? ?/, "")}`.replace(
        /; $/,
        "",
      ),
  };
};

/**
 * Rule 8. Accept an ownership proof. `afterTx` is the contract state recorded for the
 * proof's own `proveOwnership` call, found by transaction id. The verifier chose
 * `challenge` (32 fresh random bytes, used once) and asked about `record`, any
 * commitment of the identity. Accepted when that call answered this challenge, for this
 * identity, from the commitment that was its live head at the time.
 *
 * Pass `now`, the contract state as it is now, and a proof is also refused when the
 * proving commitment is no longer the identity's head: the identity was rotated since,
 * or recovered away from whoever made the proof (a thief, possibly). Either way, ask
 * for a fresh proof. VeilcoreAPI.checkOwnership always passes it.
 */
export const acceptOwnership = (
  afterTx: Ledger,
  record: Uint8Array,
  challenge: Uint8Array,
  now?: Ledger,
): { readonly accepted: boolean; readonly reason: string } => {
  if (challenge.length !== 32 || challenge.every((b) => b === 0))
    return { accepted: false, reason: "not a usable challenge" };
  if (afterTx.proofSeq === 0n)
    return {
      accepted: false,
      reason: "no ownership proof has been made on this contract",
    };
  if (!same(afterTx.lastOwnershipChallenge, challenge))
    return {
      accepted: false,
      reason: "that transaction did not answer this challenge",
    };
  const prover = afterTx.lastOwnershipProof;
  if (!same(identityOf(afterTx, prover), identityOf(afterTx, record)))
    return {
      accepted: false,
      reason: "that transaction proved a different record",
    };
  if (!isLive(afterTx, prover) || !isAnchored(afterTx, prover))
    return {
      accepted: false,
      reason: "the proving commitment was not the live, anchored head",
    };
  if (now !== undefined && !isLive(now, prover))
    return {
      accepted: false,
      reason:
        "this identity has moved to a new secret since the proof (rotated or recovered); ask for a fresh proof",
    };
  return {
    accepted: true,
    reason: "the holder of this record answered your challenge",
  };
};

// ───────────────────────────────────────────── rules 5 and 8: each challenge used once

/** What a challenge is for. Never shared: an ownership proof publishes its challenge. */
export type ChallengeKind = "licence" | "ownership";

/** One challenge a verifier issued: when, for what, and whether (when) it was used. */
export type ChallengeEntry = {
  readonly challenge: string; // hex
  readonly kind: ChallengeKind;
  readonly issuedAt: number; // ms since epoch
  readonly usedAt?: number;
};

export type ChallengeVerdict = {
  readonly ok: boolean;
  readonly reason: string;
};

/** A week: time enough for the other party to answer, short enough to bound the book. */
export const DEFAULT_CHALLENGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const fresh32 = (): Uint8Array =>
  globalThis.crypto.getRandomValues(new Uint8Array(32));

/**
 * Rules 5 and 8: "keep the challenges you issued, when, and whether each was used".
 * issue(kind) makes a fresh 32-byte challenge and records it; consume(challenge, kind)
 * says ok exactly once, for a challenge this book issued, for that kind, younger than
 * `maxAgeMs`. In memory; a caller that must remember across runs saves `entries()` and
 * passes them back in (the CLI keeps them in an encrypted file under ~/.veilcore).
 */
export class ChallengeBook {
  private readonly book = new Map<string, ChallengeEntry>();
  readonly maxAgeMs: number;
  private readonly now: () => number;
  private readonly random: () => Uint8Array;

  constructor(
    options: {
      readonly entries?: readonly ChallengeEntry[];
      readonly maxAgeMs?: number;
      readonly now?: () => number;
      readonly random?: () => Uint8Array;
    } = {},
  ) {
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_CHALLENGE_MAX_AGE_MS;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? fresh32;
    for (const e of options.entries ?? []) this.book.set(e.challenge, e);
  }

  /** A fresh challenge for `kind`, recorded as issued now. */
  issue(kind: ChallengeKind): { challenge: Uint8Array; issuedAt: number } {
    let challenge = this.random();
    while (this.book.has(hex(challenge))) challenge = this.random();
    const issuedAt = this.now();
    this.book.set(hex(challenge), {
      challenge: hex(challenge),
      kind,
      issuedAt,
    });
    return { challenge, issuedAt };
  }

  /** Whether `challenge` could be used now for `kind`. Changes nothing. */
  check(challenge: Uint8Array, kind: ChallengeKind): ChallengeVerdict {
    const e = this.book.get(hex(challenge));
    if (e === undefined)
      return { ok: false, reason: "that is not a challenge you issued here" };
    if (e.kind !== kind)
      return {
        ok: false,
        reason: `that challenge was issued for ${e.kind === "licence" ? "a licence presentation" : "an ownership proof"}, not this`,
      };
    if (e.usedAt !== undefined)
      return {
        ok: false,
        reason: `that challenge was already used (${new Date(e.usedAt).toISOString()}); issue a new one`,
      };
    if (this.now() - e.issuedAt > this.maxAgeMs)
      return {
        ok: false,
        reason: "that challenge is too old; issue a new one",
      };
    return { ok: true, reason: "an unused challenge you issued" };
  }

  /** When `challenge` was issued (ms), if this book issued it. */
  issuedAt(challenge: Uint8Array): number | undefined {
    return this.book.get(hex(challenge))?.issuedAt;
  }

  /** Use `challenge` for `kind`: ok once, then never again. */
  consume(challenge: Uint8Array, kind: ChallengeKind): ChallengeVerdict {
    const v = this.check(challenge, kind);
    if (!v.ok) return v;
    const e = this.book.get(hex(challenge));
    if (e === undefined) return { ok: false, reason: "not issued" }; // unreachable after check
    this.book.set(e.challenge, { ...e, usedAt: this.now() });
    return { ok: true, reason: "used now" };
  }

  /**
   * Take in entries saved by another run of the verifier: a challenge either side has
   * used stays used. Without this, two runs open at once each saved its own copy and the
   * later save erased the other's "used" mark (re-attack, round 11).
   */
  absorb(entries: readonly ChallengeEntry[]): void {
    for (const e of entries) {
      const mine = this.book.get(e.challenge);
      if (mine === undefined) this.book.set(e.challenge, e);
      else if (e.usedAt !== undefined && mine.usedAt === undefined)
        this.book.set(e.challenge, { ...mine, usedAt: e.usedAt });
    }
  }

  /** Everything recorded, minus entries older than the maximum age (no longer usable anyway). */
  entries(): ChallengeEntry[] {
    const cutoff = this.now() - this.maxAgeMs;
    return [...this.book.values()].filter((e) => e.issuedAt >= cutoff);
  }
}

/**
 * Rule 5 with its "use it once": refused if the book does not allow the challenge;
 * otherwise acceptPresentation, and the challenge is used up only when it accepts (a
 * refusal, such as the wrong transaction id, leaves it usable for the right one).
 */
export const acceptPresentationOnce = (
  book: ChallengeBook,
  afterTx: Ledger,
  issuer: Uint8Array,
  challenge: Uint8Array,
): { readonly accepted: boolean; readonly reason: string } => {
  const c = book.check(challenge, "licence");
  if (!c.ok) return { accepted: false, reason: c.reason };
  const v = acceptPresentation(afterTx, issuer, challenge);
  if (v.accepted) book.consume(challenge, "licence");
  return v;
};

/** Rule 8 with its "use it once", as acceptPresentationOnce. */
export const acceptOwnershipOnce = (
  book: ChallengeBook,
  afterTx: Ledger,
  record: Uint8Array,
  challenge: Uint8Array,
  now?: Ledger,
): { readonly accepted: boolean; readonly reason: string } => {
  const c = book.check(challenge, "ownership");
  if (!c.ok) return { accepted: false, reason: c.reason };
  const v = acceptOwnership(afterTx, record, challenge, now);
  if (v.accepted) book.consume(challenge, "ownership");
  return v;
};
