// The public interface: published hash vectors, circuit list, and what arguments carry.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { C, VeilcoreSimulator, hex } from "./veilcore-simulator.js";

const here = (p: string): string => new URL(p, import.meta.url).pathname;
type Vector = { circuit: string; tag: string; args: string[]; out: string };
const vectors = JSON.parse(
  readFileSync(here("../../vectors/v1.json"), "utf8"),
) as {
  protocolVersion: number;
  inputs: Record<string, string>;
  vectors: Vector[];
};
const info = JSON.parse(
  readFileSync(here("../managed/veilcore/compiler/contract-info.json"), "utf8"),
) as {
  circuits: { name: string; pure: boolean; arguments: { name: string }[] }[];
  witnesses: { name: string }[];
};

const b = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, "hex"));
const { s1, s2, s3, zero } = vectors.inputs;
/** The inputs each vector names, spelled out. */
const resolve = (arg: string): Uint8Array =>
  ({
    s1: b(s1),
    s2: b(s2),
    s3: b(s3),
    zero: b(zero),
    "commit(s1)": C.commit(b(s1)),
    "commit(s3)": C.commit(b(s3)),
    "licenseCommit(s2, commit(s1))": C.licenseCommit(b(s2), C.commit(b(s1))),
  })[arg] ??
  (() => {
    throw new Error(`unknown vector input ${arg}`);
  })();

/** An independent implementation: plain SHA-256, no Midnight code. */
const sha256Tagged = (tag: string, inputs: Uint8Array[]): string => {
  const t = Buffer.alloc(32);
  t.write(tag, "utf8");
  return createHash("sha256")
    .update(Buffer.concat([t, ...inputs]))
    .digest("hex");
};

describe("published vectors (vectors/v1.json)", () => {
  for (const v of vectors.vectors) {
    it(`${v.circuit}(${v.args.join(", ")})`, () => {
      const args = v.args.map(resolve);
      const compiled = (
        C as unknown as Record<string, (...a: Uint8Array[]) => Uint8Array>
      )[v.circuit](...args);
      expect(hex(compiled)).toBe(v.out);
      expect(sha256Tagged(v.tag, args)).toBe(v.out);
    });
  }

  it("the deployed contract declares the same protocol version", () => {
    expect(new VeilcoreSimulator().state.protocolVersion).toBe(
      BigInt(vectors.protocolVersion),
    );
  });
});

describe("circuits", () => {
  const impure = info.circuits
    .filter((c) => !c.pure)
    .map((c) => c.name)
    .sort();

  it("exposes exactly the intended entry points", () => {
    expect(impure).toEqual(
      [
        "acceptObligation",
        "anchor",
        "anchorBatch",
        "approveTransfer",
        "confirmParent",
        "countersignLicense",
        "discharge",
        "encumberOwnRecord",
        "issueLicense",
        "pairDna",
        "proposeObligation",
        "proposeParent",
        "proposeTransfer",
        "proveLicense",
        "proveOwnership",
        "recoverRecordSecret",
        "replaceRecoveryCommitment",
        "revokeLicense",
        "rotateRecordSecret",
        "sealRevocations",
        "withdrawObligation",
        "withdrawParent",
        "withdrawTransfer",
      ].sort(),
    );
  });

  it("no circuit takes a secret as an argument", () => {
    for (const c of info.circuits.filter((x) => !x.pure)) {
      expect(
        c.arguments.map((a) => a.name).filter((n) => /secret/i.test(n)),
        c.name,
      ).toEqual([]);
    }
  });

  it("no circuit takes the caller's own record: it is derived from their secret", () => {
    const takesCaller = [
      "anchor",
      "issueLicense",
      "pairDna",
      "proveOwnership",
      "encumberOwnRecord",
      "withdrawParent",
    ];
    for (const n of takesCaller) {
      const args = info.circuits
        .find((c) => c.name === n)!
        .arguments.map((a) => a.name);
      expect(
        args.filter((a) => /record/i.test(a)),
        n,
      ).toEqual([]);
    }
  });
});
