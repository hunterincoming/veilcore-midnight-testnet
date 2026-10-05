// The deployment-record gate.
// SPDX-License-Identifier: Apache-2.0
//
// VeilCore's deployment record (midnightntwrk/midnight-improvement-proposals) states,
// for each build, its circuits and key fingerprints. A build may reach a network that
// matters only after the record describing it is filed. This module decides that from
// two inputs, the network id and a declared revision number, and imports nothing else
// so the decision table can be tested on its own (test-deploy-guard.mjs).

import { type Logger } from 'pino';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

/** The record revision that describes this build. A constant, so moving it is a reviewed change. */
export const REQUIRED_RECORD_REVISION = 4;

/** Declares the filed revision, e.g. VEILCORE_DEPLOYMENT_RECORD_REVISION=4. */
export const REVISION_VAR = 'VEILCORE_DEPLOYMENT_RECORD_REVISION';

/**
 * Development networks, which need no record. An allowlist: any other network,
 * mainnet included, or no network at all, requires the declared revision.
 */
export const RECORD_NOT_REQUIRED: ReadonlySet<string> = new Set(['undeployed', 'preview', 'preprod']);

export type Decision =
  | { readonly allow: true; readonly because: string }
  | { readonly allow: false; readonly where: string; readonly why: string };

/** The whole decision, as a pure function. `network` is null when nothing has set one. */
export const decide = (network: string | null, raw: string | undefined): Decision => {
  if (network !== null && RECORD_NOT_REQUIRED.has(network)) {
    return { allow: true, because: `network ${network}: deployment record not required` };
  }
  // Strict digits: Number('v4') is NaN, and NaN < 4 is false, which once let a typo through.
  const trimmed = (raw ?? '').trim();
  const filed = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (Number.isInteger(filed) && filed >= REQUIRED_RECORD_REVISION) {
    return { allow: true, because: `deployment record revision ${filed} declared for network ${network ?? 'unknown'}` };
  }
  return {
    allow: false,
    where: network === null ? 'No network is set.' : `Network "${network}" requires a filed deployment record.`,
    why:
      trimmed === ''
        ? `${REVISION_VAR} is unset.`
        : `${REVISION_VAR}="${trimmed}" is not a whole number of at least ${REQUIRED_RECORD_REVISION}.`,
  };
};

/** The configured network, or null if none is set. */
export const resolveNetwork = (): string | null => {
  try {
    return getNetworkId().toLowerCase();
  } catch {
    return null;
  }
};

/**
 * The VeilCore contract's address on mainnet, as the filed deployment record names it.
 * Empty until the mainnet deploy: set it then, in a reviewed commit, to the address the
 * deploy printed, and put the same address in the deployment record. Until it is set,
 * joining on mainnet is refused (deploying, and finishing a deploy, are not joins by
 * address and still work).
 *
 * Why: a contract with this build's exact circuits can be deployed by anyone, with any
 * starting state (round D, D-1). Matching verifier keys show the code; only the address
 * says which contract is VeilCore's.
 */
export const MAINNET_VEILCORE_ADDRESS = '';

/**
 * Throw unless the VeilCore contract at `address` may be joined on the configured
 * network. Development networks accept any address; every other network, mainnet
 * included, or no network at all, accepts only MAINNET_VEILCORE_ADDRESS, and nothing
 * while that is empty. The same allowlist as the record gate and assertClaimsDeployAllowed.
 */
export const assertJoinAllowed = (
  address: string,
  logger?: Logger,
  pinned: string = MAINNET_VEILCORE_ADDRESS,
): void => {
  const network = resolveNetwork();
  if (network !== null && RECORD_NOT_REQUIRED.has(network)) return;
  const want = pinned.trim().toLowerCase().replace(/^0x/, '');
  if (want === '') {
    throw new Error(
      `Refusing to join a VeilCore contract on ${network ?? 'an unknown network'}: this build pins no address yet ` +
        '(MAINNET_VEILCORE_ADDRESS in api/src/deploy-guard.ts is empty until the deployed address is in the filed ' +
        'deployment record). Nothing was sent.',
    );
  }
  if (address.trim().toLowerCase().replace(/^0x/, '') !== want) {
    throw new Error(
      `Refusing to join ${address}: on ${network ?? 'this network'} the VeilCore contract is ${want} ` +
        '(the deployment record). Another address can carry the same circuits with a forged starting state. Nothing was sent.',
    );
  }
  logger?.info(`Contract address matches the pinned VeilCore address for ${network ?? 'this network'}.`);
};

/** Throw unless `contractName` may be deployed to the configured network. */
export const assertDeploymentRecordCurrent = (contractName: string, logger?: Logger): void => {
  const outcome = decide(resolveNetwork(), process.env[REVISION_VAR]);
  if (outcome.allow) {
    logger?.info(`${contractName}: ${outcome.because}`);
    return;
  }
  throw new Error(
    `Refusing to deploy ${contractName}. ${outcome.where} ${outcome.why}\n` +
      `File deployment record revision ${REQUIRED_RECORD_REVISION}, then set ${REVISION_VAR}=${REQUIRED_RECORD_REVISION}.`,
  );
};
