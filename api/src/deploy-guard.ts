// The deployment-record gate, for every contract this project deploys.
//
// SPDX-License-Identifier: Apache-2.0
//
// This module imports the network id and nothing else. That is the point. The first
// version of this guard lived inside veilcore-api.ts, which cannot be loaded without
// the whole managed contract bundle, so its decision table could be described in a
// commit message but never run. Here it is a leaf, and `test-deploy-guard.mjs` runs
// every row of the table against the code that actually ships.

import { type Logger } from 'pino';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

/**
 * The deployment-record revision this build requires before it may be deployed
 * anywhere that is not on the list below.
 *
 * PR #314 corrected a revision that described a fix its own fingerprints did not
 * contain, and committed publicly to filing a fourth before the deploy key is used.
 * A fourth revision needs fresh `npm run compact` fingerprints from the build being
 * deployed, the current circuit count, and the second contract.
 *
 * ONE RECORD, ONE COUNTER, FOR BOTH CONTRACTS. There is a single deployment record
 * in midnightntwrk/midnight-improvement-proposals, and revision 4 is the revision
 * that first describes lineage — that is what makes it the fourth rather than a
 * refresh of the third. So lineage's requirement is not a coincidentally equal
 * number, it is the same number for the same reason.
 *
 * A second counter would imply a second document. There isn't one, and inventing
 * `VEILCORE_LINEAGE_RECORD_REVISION=1` would let someone satisfy a lineage guard by
 * declaring a revision of a record that was never filed, while the record that does
 * exist still stops at three. Two counters can drift apart; one cannot drift from
 * itself.
 *
 * Neither scheme can read the document, so neither can tell a revision 4 that
 * describes both contracts from one that refreshed veilcore and forgot lineage.
 * That limit is identical either way, so it is not a reason to prefer two.
 *
 * Raise this when a later build needs a later revision. It is a constant rather than
 * an environment variable so that moving it is a reviewed change.
 */
export const REQUIRED_RECORD_REVISION = 4;

/** The one environment variable, for the one record. */
export const REVISION_VAR = 'VEILCORE_DEPLOYMENT_RECORD_REVISION';

/**
 * Networks a deployment may target without a current deployment record.
 *
 * AN ALLOWLIST, NOT A DENYLIST, and that is the whole point. The previous guard
 * asked whether the network was mainnet and let everything else through, keyed on an
 * environment variable nothing in this repository set — so the obvious way to add
 * mainnet, a config class calling `setNetworkId('mainnet')` beside the preview and
 * preprod ones, would have passed it without anyone touching the guard.
 *
 * Refusing by default costs one line here when a genuinely new development network
 * appears. Missing a production deploy costs a deployment record that describes a
 * contract nobody is running.
 *
 * EXACTLY THE THREE THIS REPOSITORY SETS, and no more. Every `setNetworkId` call in
 * the tree passes one of these: `undeployed` from StandaloneConfig, `preview` and
 * `preprod` from the two remote configs, and the same three again from the UI's
 * `.env.preview` / `.env.preprod` via `VITE_NETWORK_ID`.
 *
 * `standalone`, `devnet` and `testnet` used to be here too, and were removed. They
 * were wider than anything that sets a network, which made each of them a name an
 * outside caller could pick and be waved through with no record filed — an accident
 * needing nobody to do anything wrong. A deploy path outside this repository is
 * exactly the caller most likely to pick one, which is what made them worth removing
 * rather than leaving as harmless spares.
 *
 * An outside caller that needs another network gets it as a reviewed line here.
 */
export const RECORD_NOT_REQUIRED: ReadonlySet<string> = new Set(['undeployed', 'preview', 'preprod']);

/** Allowed, with the reason; or refused, with both halves of the reason. */
export type Decision =
  | { readonly allow: true; readonly because: string }
  | { readonly allow: false; readonly where: string; readonly why: string };

/**
 * The entire decision, as a pure function of its two inputs. `network` is null when
 * nothing has set one.
 *
 * Split out from the throwing wrapper so that the decision table is something that
 * runs rather than something that is asserted: `setNetworkId` is a global singleton
 * with no unset, so a table routed through `getNetworkId()` could only ever cover one
 * network per process.
 */
export const decide = (network: string | null, raw: string | undefined): Decision => {
  if (network !== null && RECORD_NOT_REQUIRED.has(network)) {
    return { allow: true, because: `network ${network} — deployment record not required` };
  }

  // Strict decimal digits. `Number('v4')` is NaN and `NaN < 4` is false, so the
  // original `filed < 4` test let a typo through silently: the one input most likely
  // to be mistyped disabled the check it was mistyped into.
  const trimmed = (raw ?? '').trim();
  const filed = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;

  if (Number.isInteger(filed) && filed >= REQUIRED_RECORD_REVISION) {
    return {
      allow: true,
      because: `deployment record revision ${filed} declared for network ${network ?? 'unknown'}`,
    };
  }

  return {
    allow: false,
    where:
      network === null
        ? 'No network is set — setNetworkId() has not been called, so this process cannot say\nwhere it is deploying.'
        : `Network "${network}" is not on the list of networks that may be deployed to\nwithout a current deployment record.`,
    why:
      trimmed === ''
        ? `${REVISION_VAR} is unset.`
        : `${REVISION_VAR}="${trimmed}" is not a whole number of at least ${REQUIRED_RECORD_REVISION}.`,
  };
};

/**
 * The network this process is configured for, or null if nothing has set one.
 *
 * `getNetworkId()` throws rather than returning a default when `setNetworkId` has
 * not been called, and null is treated as unknown — which refuses. A caller that
 * cannot say where it is deploying is not a caller that should be deploying.
 */
export const resolveNetwork = (): string | null => {
  try {
    return getNetworkId().toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Refuse to deploy `contractName` until the deployment record describes this build.
 *
 * Throws unless the target network is one where the record is not a gate, or a
 * sufficient revision has been declared as filed.
 *
 * Exported so that a deploy path outside this repository can call it directly at its
 * own deploy site. The lineage service deploys lineage.compact from outside this
 * tree; a guard it never calls is a guard that sits where the deploy never touches.
 */
export const assertDeploymentRecordCurrent = (contractName: string, logger?: Logger): void => {
  const outcome = decide(resolveNetwork(), process.env[REVISION_VAR]);

  if (outcome.allow) {
    logger?.info(`${contractName}: ${outcome.because}`);
    return;
  }

  throw new Error(
    `Refusing to deploy ${contractName}: the deployment record is behind this build.\n\n` +
      `${outcome.where}\n${outcome.why}\n\n` +
      'The record in midnightntwrk/midnight-improvement-proposals carries artefact\n' +
      'fingerprints and a circuit list. PR #314 corrected a revision that described a\n' +
      'fix its own fingerprints did not contain, and states that a fourth revision will\n' +
      'be filed before the deploy key is used. The third revision predates the\n' +
      'constructor, the licence tree and the recovery circuit, and no revision so far\n' +
      'mentions the lineage contract at all.\n\n' +
      `File the revision, then set ${REVISION_VAR}=${REQUIRED_RECORD_REVISION}.\n` +
      'Setting it without filing is the thing this guard exists to catch.\n\n' +
      'For a new development network, add it to RECORD_NOT_REQUIRED in deploy-guard.ts.\n' +
      'Widening this is a reviewed code change, deliberately — it is not an\n' +
      'environment variable, because the previous guard was and nothing ever set it.',
  );
};
