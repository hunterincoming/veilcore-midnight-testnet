// The deployment-record gate, as a decision table that runs.
//
// The first version of this guard lived inside veilcore-api.ts and its table lived
// in a commit message. veilcore-api.ts cannot be imported without the whole managed
// contract bundle, so that table could never be executed — and `api` had no `test`
// script to execute it with. Both are fixed here: the guard is a leaf module, and
// every row below runs against the code that ships.
//
// `decide` is pure so the table can cover networks exhaustively. `setNetworkId` is a
// global singleton with no unset, so the live wiring — getNetworkId throwing when
// nothing has been set, and the lowercasing — is covered by the subprocess rows at
// the bottom, one process each.
//
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from 'node:child_process';
import { decide, RECORD_NOT_REQUIRED, REQUIRED_RECORD_REVISION } from './dist/api/src/deploy-guard.js';

const ALLOW = 'ALLOW';
const REFUSE = 'REFUSE';

// [network, VEILCORE_DEPLOYMENT_RECORD_REVISION, expected, why this row exists]
const rows = [
  // The allowlist, with no revision declared at all. These three are the whole of
  // it, and they are exactly the three that something in this repository sets.
  ['undeployed', undefined, ALLOW, 'StandaloneConfig declares this'],
  ['preview', undefined, ALLOW, 'PreviewRemoteConfig and .env.preview declare this'],
  ['preprod', undefined, ALLOW, 'PreprodRemoteConfig and .env.preprod declare this'],

  // Formerly allowlisted, deliberately removed: nothing sets them, so each was a
  // name an outside caller could pick and be waved through with no record filed.
  ['standalone', undefined, REFUSE, 'removed from the allowlist — nothing sets it'],
  ['devnet', undefined, REFUSE, 'removed from the allowlist — nothing sets it'],
  ['testnet', undefined, REFUSE, 'removed from the allowlist — nothing sets it'],

  // Everything else refuses. This is the allowlist doing its job.
  ['mainnet', undefined, REFUSE, 'the one this exists for'],
  ['main', undefined, REFUSE, 'near-miss spelling'],
  ['prod', undefined, REFUSE, 'near-miss spelling'],
  ['production', undefined, REFUSE, 'near-miss spelling'],
  ['midnight-mainnet', undefined, REFUSE, 'a name nobody has coined yet'],
  [null, undefined, REFUSE, 'setNetworkId never called — cannot say where it deploys'],

  // Revision parsing, on a network that does require a record.
  ['mainnet', '4', ALLOW, 'the declaration this guard asks for'],
  ['mainnet', '5', ALLOW, 'a later revision is still current'],
  ['mainnet', '004', ALLOW, 'leading zeros are still four'],
  ['mainnet', '  4  ', ALLOW, 'trimmed before parsing'],
  ['mainnet', '3', REFUSE, 'the revision that predates the constructor'],
  ['mainnet', '0', REFUSE, 'below the floor'],
  ['mainnet', '', REFUSE, 'set-but-empty is not a declaration'],

  // Typos. Every one of these deployed silently before 964415d: Number('v4') is NaN
  // and NaN < 4 is false, so the input most likely to be mistyped disabled the check
  // it was mistyped into.
  ['mainnet', 'v4', REFUSE, 'typo that used to disable the check'],
  ['mainnet', 'four', REFUSE, 'typo that used to disable the check'],
  ['mainnet', '4.0.0', REFUSE, 'typo that used to disable the check'],
  ['mainnet', '4.5', REFUSE, 'typo that used to disable the check'],
  ['mainnet', '0x4', REFUSE, 'typo that used to disable the check'],
  ['mainnet', '1e9', REFUSE, 'exponent notation is not a revision'],
  ['mainnet', '٤', REFUSE, 'non-ASCII digit — \\d is ASCII-only without /u'],
  ['mainnet', '4abc', REFUSE, 'trailing junk'],

  // A declared revision overrides nothing about the network, and an allowlisted
  // network needs no declaration: the two halves are independent.
  ['preview', 'v4', ALLOW, 'allowlist short-circuits before parsing'],

  // Set.has, not object lookup — no inherited-key surprises.
  ['__proto__', undefined, REFUSE, 'not a member of a Set'],
  ['constructor', undefined, REFUSE, 'not a member of a Set'],
  ['hasOwnProperty', undefined, REFUSE, 'not a member of a Set'],

  // Whitespace and case in the network name fail closed, not open. resolveNetwork
  // lowercases but does not trim.
  [' preview ', undefined, REFUSE, 'untrimmed network name fails closed'],
];

let failed = 0;
const w = [17, 9, 8];
console.log('deployment-record gate — decision table\n');
console.log(
  `${'network'.padEnd(w[0])}${'revision'.padEnd(w[1])}${'expect'.padEnd(w[2])}actual   note`,
);
console.log('-'.repeat(96));

for (const [network, raw, expected, note] of rows) {
  const actual = decide(network, raw).allow ? ALLOW : REFUSE;
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(
    `${String(network).padEnd(w[0])}${JSON.stringify(raw ?? null).padEnd(w[1])}` +
      `${expected.padEnd(w[2])}${actual.padEnd(9)}${ok ? note : `MISMATCH — ${note}`}`,
  );
}

// The live getNetworkId wiring, one process per row because setNetworkId cannot be
// undone. These are the rows the pure table cannot reach.
console.log('\nlive getNetworkId wiring (subprocess each)\n');
const live = [
  [null, REFUSE, 'setNetworkId never called — getNetworkId throws, treated as unknown'],
  ['MainNet', REFUSE, 'lowercased, then refused by the allowlist'],
  ['PREVIEW', ALLOW, 'lowercased, then allowed by the allowlist'],
  ['mainnet', REFUSE, 'the real thing, refused with the revision unset'],
];

for (const [network, expected, note] of live) {
  const script =
    (network === null ? '' : `const n=await import('@midnight-ntwrk/midnight-js-network-id');n.setNetworkId(${JSON.stringify(network)});`) +
    `const g=await import('./dist/api/src/deploy-guard.js');` +
    `try{g.assertDeploymentRecordCurrent('lineage');process.stdout.write('${ALLOW}');}` +
    `catch{process.stdout.write('${REFUSE}');}`;
  const actual = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: import.meta.dirname,
    env: { ...process.env, VEILCORE_DEPLOYMENT_RECORD_REVISION: '' },
    encoding: 'utf8',
  });
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(
    `${String(network).padEnd(w[0])}${''.padEnd(w[1])}${expected.padEnd(w[2])}${actual.padEnd(9)}` +
      `${ok ? note : `MISMATCH — ${note}`}`,
  );
}

console.log(
  `\nrequired revision: ${REQUIRED_RECORD_REVISION}` +
    `   allowlist: ${[...RECORD_NOT_REQUIRED].join(', ')}`,
);

if (failed > 0) {
  console.error(`\n${failed} row(s) MISMATCHED`);
  process.exit(1);
}
console.log(`\nall ${rows.length + live.length} rows as documented`);
