// The reference verifier for claims: SPEC 4.5's nine checks ("What a verifier of a claim
// shall check"), applied to one claim as the chain recorded it.
//
// Some checks are mechanical given the right inputs, and are made here: the schema
// document recomputes to the claim's schema id (3), the slot has the type the claim
// needs (3), a record's committed JSON matches the claim (4), every record the claim
// names carries a laboratory's attested claim and, if the verifier lists the keys it
// trusts, by one of them (6), an unchanged
// claim's mask is not every slot and the correction names the original (8), and what
// earlier claims on the same slot already published (9). The rest need knowledge this
// code cannot have (who identified a reference, whether a key was valid on a date) and
// are returned as "to check: ..." lines, so a report never looks more complete than it is.
//
// Read a claim per contract call (api/src/claims-api.ts, readClaim): a transaction can
// carry several calls and only the last is in the event cells afterwards.
// SPDX-License-Identifier: Apache-2.0

import {
  ClaimKind,
  RangeOp,
  type Ledger as ClaimsLedger,
} from "./managed/veilcore-claims/contract/index.js";
import {
  type FieldSchema,
  type FieldSchemaSlot,
  type TypedSlotValue,
  fieldRecordCommitment,
  fieldSchemaId,
  slotOf,
  slotValueOf,
} from "./field-schema.js";
import { SLOTS, numberFrom } from "./fields.js";
import { type JubjubPoint } from "./attest.js";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

/**
 * One claim, as published. "attested" is a laboratory's signature on a record (the record
 * commitment, which binds every value); read together with another claim on the same
 * record, it makes that claim about values a laboratory sealed.
 */
export type Claim = {
  readonly kind: "value" | "range" | "distinct" | "unchanged" | "attested";
  /** The record the claim is about (distinct: the first; unchanged: the original). */
  readonly record: Uint8Array;
  /** distinct: the other record; unchanged: the correction. */
  readonly other?: Uint8Array;
  /** The schema id (32 zero bytes for an attested claim, which names none). */
  readonly schema: Uint8Array;
  /** value and range: the slot. */
  readonly slot?: number;
  /** value: the 32-byte slot value published. */
  readonly value?: Uint8Array;
  /** range: the bound and its direction. */
  readonly bound?: bigint;
  readonly op?: "at least" | "at most";
  /** unchanged: the slots allowed to change. */
  readonly mayChange?: boolean[];
  /** attested: the laboratory's key. */
  readonly attester?: JubjubPoint;
};

const maskFrom = (b: Uint8Array): boolean[] => {
  let n = 0n;
  for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(b[i]);
  return Array.from(
    { length: SLOTS },
    (_, i) => ((n >> BigInt(i)) & 1n) === 1n,
  );
};

/** The claim in a claims contract's event cells, read for ONE call. */
export const claimFromCells = (l: ClaimsLedger): Claim => {
  const attester =
    l.lastClaimAttesterX === 0n && l.lastClaimAttesterY === 0n
      ? undefined
      : { x: l.lastClaimAttesterX, y: l.lastClaimAttesterY };
  const base = {
    record: l.lastClaimRecord,
    schema: l.lastClaimSchema,
    ...(attester ? { attester } : {}),
  };
  switch (l.lastClaimKind) {
    case ClaimKind.VALUE:
      return {
        ...base,
        kind: "value",
        slot: Number(l.lastClaimSlot),
        value: l.lastClaimParam,
      };
    case ClaimKind.RANGE:
      return {
        ...base,
        kind: "range",
        slot: Number(l.lastClaimSlot),
        bound: numberFrom(l.lastClaimParam),
        op: l.lastClaimOp === RangeOp.AT_MOST ? "at most" : "at least",
      };
    case ClaimKind.DISTINCT:
      return { ...base, kind: "distinct", other: l.lastClaimOther };
    case ClaimKind.UNCHANGED:
      return {
        ...base,
        kind: "unchanged",
        other: l.lastClaimOther,
        mayChange: maskFrom(l.lastClaimParam),
      };
    case ClaimKind.ATTESTED:
      if (attester === undefined)
        throw new Error(
          "An attested claim with no laboratory key: not a claim this contract writes.",
        );
      return { ...base, kind: "attested" };
    default:
      throw new Error("Those cells hold no claim (no claim has been made).");
  }
};

// ─────────────────────────────────────────────── the verdict

export type ClaimCheck = {
  /** SPEC 4.5 check number. */
  readonly spec: number;
  readonly ok: boolean;
  readonly detail: string;
};

export type ClaimVerdict = {
  readonly claim: Claim;
  /** The claim in plain words, as it may be reported. */
  readonly statement: string;
  /** Checks made here. */
  readonly checks: readonly ClaimCheck[];
  /** Checks this code cannot make, each starting "to check: ". Never empty. */
  readonly toCheck: readonly string[];
  /** Every check made here passed. The toCheck list still stands. */
  readonly passed: boolean;
};

export type ClaimVerifyInput = {
  /** The claim, or the claims contract's cells read for the claim's call. */
  readonly claim: Claim | ClaimsLedger;
  /** The schema document, as obtained from its publisher (not from the prover). */
  readonly schema?: FieldSchema;
  /** Committed JSON of the record(s) the claim names, where held. */
  readonly records?: readonly Record<string, unknown>[];
  /** value claims: the value the verifier was shown, to compare with what is published. */
  readonly shownValue?: TypedSlotValue;
  /** Laboratory keys the verifier trusts (SPEC 7). */
  readonly trustedAttesters?: readonly JubjubPoint[];
  /**
   * Attested claims (a laboratory's signature, read from the chain) on the record(s) this
   * claim names. Each named record needs its own.
   */
  readonly attestations?: readonly Claim[];
  /** Earlier claims on the same record(s), read from the chain, for disclosure accounting. */
  readonly earlierClaims?: readonly Claim[];
};

const isClaim = (c: Claim | ClaimsLedger): c is Claim => "kind" in c;

/** A uint as the schema means it: the stored number divided by `scale`, with its unit. */
const measured = (n: bigint, d?: { scale?: number; unit?: string }): string => {
  const scale = BigInt(d?.scale ?? 1);
  const whole = n / scale;
  const frac = n % scale;
  const digits = String(scale).length - 1;
  const num =
    scale === 1n ? String(n) : `${whole}.${String(frac).padStart(digits, "0")}`;
  return d?.unit ? `${num} ${d.unit}` : num;
};

const short = (b: Uint8Array): string => hex(b).slice(0, 16) + "…";

export const verifyClaim = (input: ClaimVerifyInput): ClaimVerdict => {
  const claim = isClaim(input.claim)
    ? input.claim
    : claimFromCells(input.claim);
  const checks: ClaimCheck[] = [];
  const toCheck: string[] = [];
  const check = (spec: number, ok: boolean, detail: string): void => {
    checks.push({ spec, ok, detail });
  };
  const schema = input.schema;
  const d =
    claim.slot !== undefined && schema !== undefined
      ? slotOf(schema, claim.slot)
      : undefined;
  const slotName =
    claim.slot === undefined
      ? ""
      : `slot ${claim.slot}${d ? ` (${d.path})` : ""}`;

  // 1. Which contract, read how.
  toCheck.push(
    "to check: the claim is on the published claims contract, whose verifier keys match the published fingerprints, and it was read per contract call (readClaim does this), not per transaction or block",
  );

  // 2. Anchored records.
  const named = [claim.record, ...(claim.other ? [claim.other] : [])];
  toCheck.push(
    `to check: ${named.length === 1 ? "the record is" : "both records are"} anchored (${named.map(short).join(", ")})` +
      (claim.kind === "distinct"
        ? ", and the reference's anchor predates the purpose of the claim (an application, a dispute)"
        : ""),
  );

  // 3. The schema (an attested claim names none: the signature is on the whole record).
  if (claim.kind === "attested") {
    // nothing to check
  } else if (schema === undefined) {
    toCheck.push(
      `to check: obtain schema ${short(claim.schema)} from its publisher and recompute its id; apply its scale and unit`,
    );
  } else {
    let id: string | undefined;
    try {
      id = hex(fieldSchemaId(schema));
    } catch (e) {
      check(
        3,
        false,
        `the schema document is not a valid field schema: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (id !== undefined) {
      check(
        3,
        id === hex(claim.schema),
        id === hex(claim.schema)
          ? `the schema document "${schema.id}" recomputes to the claim's schema id`
          : `the schema document recomputes to ${id}, not to the claim's ${hex(claim.schema)}: it is not the schema the claim is about`,
      );
    }
    if (claim.kind === "range") {
      check(
        3,
        d?.type === "uint",
        d?.type === "uint"
          ? `${slotName} is a number slot`
          : `${slotName} is ${d ? `a ${d.type} slot` : "not described by the schema"}, not a number slot`,
      );
    }
    if (claim.kind === "value") {
      if (d === undefined)
        check(3, false, `${slotName} is not described by the schema`);
      else if (d.type === "uint") {
        let ok = true;
        try {
          numberFrom(claim.value!);
        } catch {
          ok = false;
        }
        check(
          3,
          ok,
          ok
            ? `${slotName} is a number slot and the published value is a number`
            : `${slotName} is a number slot but the published value is not a number`,
        );
      } else check(3, true, `${slotName} is a text slot`);
    }
  }
  if (claim.kind === "value" && input.shownValue !== undefined) {
    let shown: string | undefined;
    try {
      shown = hex(slotValueOf(input.shownValue));
    } catch (e) {
      check(
        3,
        false,
        `the value you were shown is not a slot value: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (shown !== undefined)
      check(
        3,
        shown === hex(claim.value!),
        shown === hex(claim.value!)
          ? "the value you were shown is the sealed one"
          : "the value you were shown is NOT the sealed one",
      );
  } else if (
    claim.kind === "value" &&
    !(d?.type === "uint" && isNumber(claim.value!))
  ) {
    toCheck.push(
      "to check: the published value is a SHA-256 digest of text; compare it with the text you were shown (pass shownValue)",
    );
  }

  // 4. The records' committed JSON.
  const records = input.records ?? [];
  const recordFor = new Map<string, Record<string, unknown>>();
  for (const [i, env] of records.entries()) {
    let c: string | undefined;
    try {
      c = fieldRecordCommitment(env);
    } catch (e) {
      check(
        4,
        false,
        `record JSON ${i + 1} is refused: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    const which = named.findIndex((n) => hex(n) === c);
    if (which < 0) {
      check(
        4,
        false,
        `record JSON ${i + 1} recomputes to ${c}, which the claim does not name`,
      );
      continue;
    }
    recordFor.set(c, env);
    const schemaOk =
      claim.kind === "attested" || env.fieldSchema === hex(claim.schema);
    check(
      4,
      schemaOk,
      schemaOk
        ? `record JSON ${i + 1} is sha256/fields/v1, recomputes to ${short(named[which])}${claim.kind === "attested" ? "" : " and names the claim's schema"}`
        : `record JSON ${i + 1} recomputes to a named record but its fieldSchema is not the claim's schema`,
    );
    if (
      typeof env.commitment === "string" &&
      env.commitment !== "" &&
      env.commitment !== c
    )
      check(
        4,
        false,
        `record JSON ${i + 1} states commitment ${env.commitment}, but its contents give ${c}`,
      );
  }
  const missing = named.filter((n) => !recordFor.has(hex(n)));
  if (missing.length > 0)
    toCheck.push(
      `to check: where you hold the committed JSON of ${missing.map(short).join(", ")}, that it is sha256/fields/v1 and its fieldSchema and fieldSetRoot match (pass records)`,
    );

  // 5. Currency.
  toCheck.push(
    "to check: whether the record is current (not superseded). Until that is established, report the claim as about the record as sealed",
  );

  // 6. Laboratory signatures: the claim itself (attested), or one attested claim per record.
  const trust = (k: JubjubPoint): void => {
    if (input.trustedAttesters !== undefined) {
      const trusted = input.trustedAttesters.some(
        (t) => t.x === k.x && t.y === k.y,
      );
      check(
        6,
        trusted,
        trusted
          ? `laboratory key ${keyText(k)} is one you trust`
          : `laboratory key ${keyText(k)} is NOT one you listed as trusted`,
      );
    } else
      toCheck.push(
        `to check: laboratory key ${keyText(k)} belongs to a laboratory you trust (SPEC 7)`,
      );
  };
  const signers: JubjubPoint[] = [];
  if (claim.kind === "attested") {
    const k = claim.attester!;
    check(
      6,
      k.x !== 0n || k.y !== 0n,
      `laboratory key ${keyText(k)} is published`,
    );
    trust(k);
    signers.push(k);
  } else if (input.attestations === undefined) {
    toCheck.push(
      "note: no laboratory signature was considered. It shows only that the holder sealed these values; pass the laboratory's attested claims on the record(s) to check that a laboratory did",
    );
  } else {
    for (const a of input.attestations) {
      if (a.kind !== "attested" || a.attester === undefined) {
        check(
          6,
          false,
          `an attestation given is a ${a.kind} claim, not a laboratory's signature`,
        );
        continue;
      }
      if (!named.some((n) => hex(n) === hex(a.record)))
        check(
          6,
          false,
          `an attestation given is on record ${short(a.record)}, which this claim does not name`,
        );
    }
    for (const n of named) {
      const on = input.attestations.filter(
        (a) =>
          a.kind === "attested" &&
          a.attester !== undefined &&
          hex(a.record) === hex(n),
      );
      check(
        6,
        on.length > 0,
        on.length > 0
          ? `record ${short(n)} is signed by a laboratory (attested claim)`
          : `record ${short(n)} has no laboratory's attested claim among those given`,
      );
      for (const a of on) {
        trust(a.attester!);
        signers.push(a.attester!);
      }
    }
  }
  if (signers.length > 0)
    toCheck.push(
      "to check: each laboratory key was valid at the time of its attested claim, not only at the record's anchor",
    );

  // 7. Distinct: who identified the reference.
  if (claim.kind === "distinct")
    toCheck.push(
      `to check: the reference record (${short(claim.other!)}) was identified by someone other than the prover`,
    );

  // 8. Unchanged: the mask, and supersedes.
  if (claim.kind === "unchanged") {
    const all = claim.mayChange!.every(Boolean);
    check(
      8,
      !all,
      all
        ? "the mask allows every slot to change, so the claim says nothing"
        : `slots allowed to change: ${claim.mayChange!.flatMap((b, i) => (b ? [i] : [])).join(", ") || "none"}`,
    );
    const older = recordFor.get(hex(claim.record));
    const newer = recordFor.get(hex(claim.other!));
    if (older !== undefined && newer !== undefined) {
      const sup = newer.supersedes as { recordId?: unknown } | undefined;
      const ok = sup !== undefined && sup.recordId === older.recordId;
      check(
        8,
        ok,
        ok
          ? "the correction names the original in supersedes"
          : "the correction does NOT name the original in supersedes",
      );
    } else
      toCheck.push(
        "to check: the newer record names the older in supersedes (pass both records)",
      );
  }

  // 9. Disclosure accounting.
  if (input.earlierClaims !== undefined) {
    const same = input.earlierClaims.filter(
      (e) =>
        hex(e.record) === hex(claim.record) &&
        e.slot === claim.slot &&
        (e.kind === "range" || e.kind === "value"),
    );
    toCheck.push(
      `disclosed so far on this record and slot: ${disclosedText([...same, claim], d)}`,
    );
  } else if (claim.slot !== undefined) {
    toCheck.push(
      "to check: what earlier claims on this record and slot have already published (pass earlierClaims)",
    );
  }

  const labSigned =
    claim.kind !== "attested" &&
    input.attestations !== undefined &&
    checks.filter((c) => c.spec === 6).every((c) => c.ok) &&
    named.every((n) =>
      input.attestations!.some(
        (a) => a.kind === "attested" && hex(a.record) === hex(n),
      ),
    );
  return {
    claim,
    statement: statementOf(claim, schema, d, labSigned),
    checks,
    toCheck,
    passed: checks.every((c) => c.ok),
  };
};

const isNumber = (v: Uint8Array): boolean => {
  try {
    numberFrom(v);
    return true;
  } catch {
    return false;
  }
};

/** What a set of value and range claims on one slot reveals about its number. */
export const disclosedText = (
  claims: readonly Claim[],
  d?: { scale?: number; unit?: string },
): string => {
  let lo: bigint | undefined;
  let hi: bigint | undefined;
  const values = new Set<string>();
  for (const c of claims) {
    if (c.kind === "value" && c.value) {
      if (isNumber(c.value)) values.add(measured(numberFrom(c.value), d));
      else values.add(`text digest ${short(c.value)}`);
    }
    if (c.kind === "range" && c.bound !== undefined) {
      if (c.op === "at least")
        lo = lo === undefined || c.bound > lo ? c.bound : lo;
      else hi = hi === undefined || c.bound < hi ? c.bound : hi;
    }
  }
  const parts: string[] = [];
  if (values.size > 0)
    parts.push(`the value itself (${[...values].join("; ")})`);
  if (lo !== undefined && hi !== undefined)
    parts.push(
      lo === hi
        ? `the number exactly: ${measured(lo, d)}`
        : `the number is between ${measured(lo, d)} and ${measured(hi, d)}`,
    );
  else if (lo !== undefined)
    parts.push(`the number is at least ${measured(lo, d)}`);
  else if (hi !== undefined)
    parts.push(`the number is at most ${measured(hi, d)}`);
  return parts.length === 0 ? "nothing about its value" : parts.join("; ");
};

const keyText = (k: JubjubPoint): string =>
  `(${k.x.toString(16).slice(0, 12)}…, ${k.y.toString(16).slice(0, 12)}…)`;

const statementOf = (
  c: Claim,
  schema: FieldSchema | undefined,
  d: FieldSchemaSlot | undefined,
  labSigned: boolean,
): string => {
  const lab = labSigned ? ", on values a laboratory signed" : "";
  const where = `slot ${c.slot}${d?.path ? ` (${d.path})` : ""}`;
  switch (c.kind) {
    case "value":
      return isNumber(c.value!) && d?.type !== "text"
        ? `${where} of record ${hex(c.record)}, as sealed, holds ${measured(numberFrom(c.value!), d)}${lab}.`
        : `${where} of record ${hex(c.record)}, as sealed, holds the text whose SHA-256 is ${hex(c.value!)}${lab}.`;
    case "range":
      return `the number in ${where} of record ${hex(c.record)}, as sealed, is ${c.op} ${measured(c.bound!, d)}${lab}. The number itself is not published.`;
    case "distinct":
      return `records ${hex(c.record)} and ${hex(c.other!)}, as sealed, differ in at least ${schema ? schema.k : "the schema's k"} comparable values${lab}. This is a count, not a determination of distinctness, which is the examining body's.`;
    case "unchanged":
      return `record ${hex(c.other!)} has the same values as record ${hex(c.record)} outside slots ${c.mayChange!.flatMap((b, i) => (b ? [i] : [])).join(", ") || "(none)"}${lab}. It does not say which is the correction.`;
    case "attested":
      return `the laboratory with key ${keyText(c.attester!)} signed record ${hex(c.record)} (its commitment, which binds every value it seals).`;
  }
};
