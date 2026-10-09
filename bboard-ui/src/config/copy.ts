// Sentences in the record app that depend on which network the build describes. The
// public pages take theirs from i18n (en.ts, and en-mainnet.ts in a mainnet build); the
// app is English-only, so its few network-dependent phrases live here, in one place.
// SPDX-License-Identifier: Apache-2.0

import { CLAIMS_ON_MAINNET, IS_MAINNET } from './network';

/** What this site is called in app sentences: a demo on a test network; on mainnet the records are real. */
export const THIS_SITE = IS_MAINNET ? 'this web app' : 'this web demo';

/** The tag on buttons that only simulate an agreement step. */
export const SIMULATED_TAG = IS_MAINNET ? '(simulated)' : '(demo)';

/** The heading over an agreement saved on this site. */
export const AGREEMENT_RECORDED = IS_MAINNET ? 'Saved here, simulated' : 'Recorded in this demo';

/** Where what the holder types is kept. */
export const OUR_SERVER = IS_MAINNET ? 'VeilCore’s server' : 'VeilCore’s test server';

/** Where this site's records are dated, as a phrase. */
export const DATED_ON = IS_MAINNET ? 'Midnight’s main network' : 'a Midnight test network';

/** Where the claims contract stands, for the line under the disclosure choice. */
export const CLAIMS_WHERE = CLAIMS_ON_MAINNET
  ? 'It’s on Midnight’s main network but isn’t in this web app yet.'
  : IS_MAINNET
    ? 'It isn’t on Midnight’s main network yet, and isn’t in this web app.'
    : 'It’s tested on Midnight’s preprod test network but isn’t in this web demo yet.';

/** What the contract can do for licenses that this website cannot. */
export const LICENSE_PROOF_NOTE = `Proving that a license is live, without showing its terms, is done by VeilCore’s contract on ${
  IS_MAINNET ? 'Midnight’s main network' : 'Midnight'
}. That needs a wallet, which this website doesn’t use, so it doesn’t offer it.`;

/** The one line every simulated agreement screen carries. */
export const AGREEMENTS_SIMULATED = `Simulated in ${THIS_SITE}: the other party doesn’t sign anything here, and nothing is sent to Midnight.`;
