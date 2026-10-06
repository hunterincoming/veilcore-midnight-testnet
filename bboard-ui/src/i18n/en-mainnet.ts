// The English strings that differ in a mainnet build (`--mode mainnet`). en.ts holds the
// test-network wording; in a mainnet build every key here replaces it, in every language,
// because a draft translation of the test-network sentence would be wrong on mainnet.
//
// Written before the launch, to be true once it has happened: the main contract is on
// Midnight's main network, the registry dates this site's records there in batches, and
// the web demo still sends no transactions itself (licenses and lab agreements are
// simulated; a DNA report pairing is saved but not dated). The claims contract deploys
// right after the main one; until its address is pinned, the strings say it is not on
// the main network yet. A mainnet build cannot happen before the main contract's address
// is pinned (vite.config.ts), so none of this can be published early.
//
// Every user-visible string here is listed for fact-checking in
// scratchpad/site-mainnet/new-copy.md.
// SPDX-License-Identifier: Apache-2.0

import type { StringKey } from './en';

type Overlay = Partial<Record<StringKey, string>>;

const common: Overlay = {
  'm.hero.status':
    "Now on Midnight's main network: records are dated there, in batches. Licenses and lab agreements in the web demo are still simulated.",
  'm.faq.3a':
    "It's built to be evidence, and our note for lawyers says what a record proves and what it doesn't. Records are now dated on Midnight's main network. A date there shows a record existed by then; what that's worth in a dispute is for the court to weigh.",
  'm.stat2.b': 'Main network',
  'm.foot.about': "An evidentiary record format for plant and animal genetics, dated on Midnight's main network.",
  'm.get.2b':
    "Licenses and lab agreements attach to the record. A licensee can prove they hold a live license without showing which one. An obligation on a parent, such as a royalty, shows on every offspring both holders confirmed; VeilCore records it and doesn't collect it. Built into the contract on Midnight's main network; simulated in the web demo.",
  'm.demo.lede':
    "No sign-up, no wallet. Records you seal here are dated on Midnight's main network, in batches, so a new record can take a while to show as dated. Licenses and lab agreements are simulated, and DNA report pairings aren't dated. Don't type anything you need to keep secret.",
  'm.post0.text':
    'Both contracts passed all 37 end-to-end checks in pre-launch testing, including the new claims: a value, a range, a difference, an unchanged correction and a signature from a test lab key. Made-up marker data.',
  'm.post2.title': 'A full pre-launch run',
  'm.post2.text':
    'The contract passed all 26 end-to-end checks in pre-launch testing on Midnight, using 16 of its 24 operations with real proofs.',
  'm.status.keyText':
    "The founders hold a maintenance key for VeilCore's main contract on Midnight. It can change how the contract works from then on. It cannot rewrite records already anchored in the network's history.",
  'm.status.keyLink': 'Read the maintenance policy →',
  'm.contact.1p': 'Try it, then tell us what it would need for your real records.',

  'm.privacy.lede':
    "This note covers the demo on this site. Records you seal here are dated on Midnight's main network.",
  'm.privacy.stored.title': 'Stored on our server',
  'm.privacy.stored.text':
    "What you type and what the app computes from it: cultivar and breeder names, species if you enter one, dates, notes, reference numbers, parents, fingerprints of records, photos and lab reports, lab report file names, agreement terms and counterparties, material you send to a lab (who it is addressed to, and the quantity), and, for labs, the public signing key and the attestations they publish. Also your holder key, which the app sends with every save so the server can find your records. The server is VeilCore's registry, hosted on Railway.",
  'm.privacy.test.title': "Dated on Midnight's main network",
  'm.privacy.test.text':
    "Your record's fingerprint goes into a batch, and the batch is dated on Midnight's main network. Only the batch's fingerprint goes on the network, never what you typed. A date on the network can't be taken back, even if we delete your data from our server.",
  'm.privacy.madeup.title': 'Type only what you are happy for us to keep',
  'm.privacy.madeup.text':
    "Everything you type is kept on our server, and a record's cultivar name is shown on its public check page. Don't type anything you need to keep secret. Genetic data and lab files stay on your computer.",
};

/** The claims contract's address is pinned: it is on the main network. */
const claimsLive: Overlay = {
  'm.claims.status':
    "A second Midnight contract, on Midnight's main network. Before launch it passed every end-to-end check, with made-up marker data. It isn't in this web demo yet.",
  'm.stat2.s': "Both contracts are on Midnight's main network. Records from this site are dated there, in batches.",
};

/** Not pinned yet: the main contract is live, the claims contract is still to follow. */
const claimsPending: Overlay = {
  'm.claims.status':
    "A second Midnight contract. It passed every end-to-end check in pre-launch testing, with made-up marker data. It isn't on Midnight's main network yet, and isn't in this web demo.",
  'm.stat2.s':
    "The main contract is on Midnight's main network, and records from this site are dated there, in batches. The claims contract follows.",
};

/** The overlay for a mainnet build. */
export const mainnetStrings = (claimsOnMainnet: boolean): Overlay => ({
  ...common,
  ...(claimsOnMainnet ? claimsLive : claimsPending),
});
