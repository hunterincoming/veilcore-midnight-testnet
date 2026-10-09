// The partner kit, end to end, on a live network, through the public package only:
// what a partner's own code would do on launch day. Runs the three examples (laboratory,
// breeder licence, claim) against VeilCore's contracts and prints a PASS line per check.
//
// From the repository folder:   npm run partner-check
// (preprod by default; VEILCORE_NETWORK=undeployed for the local chain in partner-kit/local)
//
// The wallet seed and the private-state password are always typed at the prompt here
// (hidden), never taken from the command line or a file. About 10 to 15 minutes on
// preprod once the wallet is synced: each step is a proved transaction.
// SPDX-License-Identifier: Apache-2.0
import { FINGERPRINTS_BUILT, errorChain } from '@veilcore/contracts';
import { setup } from './setup.mjs';
import { labFlow } from './lab.mjs';
import { licenceFlow } from './breeder-licence.mjs';
import { claimsFlow } from './claims.mjs';

let n = 0;
const check = (ok, what) => {
  n++;
  if (!ok) throw new Error(`FAILED at check ${n}: ${what}`);
  console.log(`PASS ${n}. ${what}`);
};
const say = (m) => console.log(`        ${m}`);

console.log('\nVeilCore partner kit check: the public package (@veilcore/contracts) against a live network.');
console.log('Nothing secret is printed or written to a log. Ctrl+C stops it.\n');

let ctx;
let passed = false;
try {
  ctx = await setup({ say, prompt: (process.env.VEILCORE_NETWORK ?? 'preprod') !== 'undeployed' });
  check(
    true,
    `keys: all ${ctx.nKeys} proving keys, verifier keys and circuits match the deployment record ` +
      `(main contract built at ${FINGERPRINTS_BUILT.veilcore.commit}, claims at ${FINGERPRINTS_BUILT['veilcore-claims'].commit})`,
  );
  check(
    true,
    `joined VeilCore at ${ctx.vc.address}: every circuit key on chain matches, and it started from the constructor`,
  );
  check(true, `joined the claims contract at ${ctx.claims.address}: every circuit key on chain matches`);

  console.log('\nA laboratory: intake, anchor, batch root, signed report, possession\n');
  await labFlow(ctx, { check, say });
  console.log('\nA breeder licenses a grower; a buyer checks it\n');
  await licenceFlow(ctx, { check, say });
  console.log('\nA claim about a sealed record\n');
  await claimsFlow(ctx, { check, say });
  passed = true;
  console.log(
    `\nPARTNER KIT CHECK PASSED: ${n} checks passed on ${ctx.network}. VeilCore ${ctx.vc.address}, claims ${ctx.claims.address}`,
  );
} catch (e) {
  // Every cause, outermost first: midnight-js wraps what went wrong two or three levels deep.
  const chain = errorChain(e).filter((t) => !/^(Error|ContractRuntimeError|CompactError)$/.test(t));
  console.error('');
  chain.forEach((t, i) => console.error(i === 0 ? t : `${'  '.repeat(Math.min(i, 6))}cause: ${t}`));
  const all = chain.join('\n');
  if (/OutOfDustValidityWindow|[Cc]ustom error:? ?171\b/.test(all))
    console.error(
      'custom error 171: the network refused it because its indexer was behind. Nothing was spent. Wait and run again.',
    );
  if (/StartingStateUnreachable|Could not check how the contract/.test(all))
    console.error("Run again with VEILCORE_DEPLOY_TX_ID set to the contract's deploy transaction id.");
  console.error('PARTNER KIT CHECK FAILED. Copy the lines above (they hold no secrets) and send them to Claude.');
} finally {
  await ctx?.stop();
  process.exitCode = passed ? 0 : 1;
  // A wallet's connections can outlive stop() by a moment; do not hang on them.
  setTimeout(() => process.exit(), 3_000).unref();
}
