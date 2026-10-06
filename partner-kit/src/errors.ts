// Telling a contract's refusal from anything else going wrong.
// SPDX-License-Identifier: Apache-2.0
//
// midnight-js runs a circuit locally before proving it, and wraps what it throws:
// callTx → submitCallTx → a scoped transaction → createUnprovenCallTx. A refusal reaches
// the caller two causes deep (midnight-js 4.1.1, test/witness-error.test.ts):
//
//   [0] Error "Unexpected error executing scoped transaction '<unnamed>': ContractRuntimeError: …"
//   [1] ContractRuntimeError "Error executing circuit 'proveLicense'"
//   [2] Error "No live licence for that secret and record"      (or "failed assert: …")
//
// So the whole cause chain is read, as the VeilCore smoke test does
// (bboard-cli/src/smoke.ts, isContractRefusal).

const MAX_DEPTH = 12;

/** Every name and message in an error and its causes, outermost first, without repeats. */
export const errorChain = (e: unknown): string[] => {
  const out: string[] = [];
  const seen = new Set<unknown>();
  for (
    let cur: unknown = e, depth = 0;
    cur !== undefined && cur !== null && !seen.has(cur) && depth < MAX_DEPTH;
    depth++
  ) {
    seen.add(cur);
    if (typeof cur !== 'object') {
      out.push(typeof cur === 'string' ? cur : typeof cur);
      break;
    }
    const o = cur as { name?: unknown; message?: unknown; _tag?: unknown; cause?: unknown };
    for (const v of [o.name, o._tag, o.message]) if (typeof v === 'string' && v !== '' && !out.includes(v)) out.push(v);
    cur = o.cause;
  }
  return out;
};

/**
 * Whether `e` is the CONTRACT refusing a call (nothing was sent, no fee was paid), as
 * opposed to anything else going wrong: the proof server down, the indexer unreachable,
 * a timeout, a bug.
 *  - a Compact `assert` that failed: "failed assert: <message>";
 *  - the licence witness finding no live licence for that secret and record;
 *  - a call the chain itself rejected after landing (CallTxFailedError).
 */
export const isContractRefusal = (e: unknown): boolean =>
  errorChain(e).some(
    (t) =>
      /^failed assert: /.test(t) ||
      t.includes('No live licence for that secret and record') ||
      t === 'CallTxFailedError',
  );
