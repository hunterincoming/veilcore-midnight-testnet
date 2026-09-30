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
